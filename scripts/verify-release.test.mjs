/* global Response */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyRelease} from './verify-release.mjs';
import {sourceIdentity} from './release-manifest.mjs';
import {hashContract} from '../server/live/release-contract.ts';
test('release verifier detects changed frontend bytes with an otherwise matching readback',async()=>{
 const root=mkdtempSync(join(tmpdir(),'release-verifier-'));
 try{
  mkdirSync(join(root,'tower-lord'));const js='console.log("original")';writeFileSync(join(root,'tower-lord/console.js'),js);
  const contract={...JSON.parse(readFileSync('.release/manifest.json','utf8')),...sourceIdentity(),buildComplete:true,frontendAssets:[{path:'tower-lord/console.js',access:'protected',sha256:createHash('sha256').update(js).digest('hex')}]};
  contract.frontendHash=await hashContract(contract.frontendAssets);delete contract.buildHash;contract.buildHash=await hashContract(contract);
  const {sourceSHA,sourceTreeHash,buildHash,rendererHash,frontendHash,migrationHash,schemaHash}=contract;
  writeFileSync(join(root,'expected.json'),JSON.stringify(contract));writeFileSync(join(root,'readback.json'),JSON.stringify({sourceSHA,sourceTreeHash,buildHash,rendererHash,frontendHash,migrationHash,expectedSchemaHash:schemaHash,schemaHash,ready:true,protectedAssetsReady:true,protectedAssetsHash:await hashContract(contract.frontendAssets)}));
  const args=['scripts/verify-release.mjs','--manifest',join(root,'expected.json'),'--readback',join(root,'readback.json'),'--assets',root];
  const good=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(good.status,0,good.stderr);
  writeFileSync(join(root,'tower-lord/console.js'),'console.log("tampered")');const bad=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(bad.status,1);assert.match(bad.stderr,/frontend_asset_mismatch/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('online release checks public bytes anonymously and protected bytes only through authenticated readback',async()=>{
 const root=mkdtempSync(join(tmpdir(),'release-online-')),previousFetch=globalThis.fetch,previousKey=process.env.RELEASE_OPERATOR_KEY;
 try{
  const assets=[{path:'assets/app.js',access:'public',bytes:'public script'},{path:'tower-lord/console.js',access:'protected',bytes:'private script'}];
  for(const asset of assets){mkdirSync(join(root,asset.path.split('/')[0]),{recursive:true});writeFileSync(join(root,asset.path),asset.bytes);}
  const frontendAssets=assets.map(({path,access,bytes})=>({path,access,sha256:createHash('sha256').update(bytes).digest('hex')}));
  const contract={...JSON.parse(readFileSync('.release/manifest.json','utf8')),...sourceIdentity(),buildComplete:true,frontendAssets,frontendHash:await hashContract(frontendAssets)};
  delete contract.buildHash;contract.buildHash=await hashContract(contract);writeFileSync(join(root,'manifest.json'),JSON.stringify(contract));
  const {sourceSHA,sourceTreeHash,buildHash,rendererHash,frontendHash,migrationHash,schemaHash}=contract;
  const readback={sourceSHA,sourceTreeHash,buildHash,rendererHash,frontendHash,migrationHash,schemaHash,ready:true,expectedSchemaHash:contract.schemaHash,protectedAssetsReady:true,protectedAssetsHash:await hashContract(frontendAssets.filter(a=>a.access==='protected'))};
  const calls=[];process.env.RELEASE_OPERATOR_KEY='synthetic-key';
  globalThis.fetch=async(url,options)=>{calls.push(new URL(url).pathname);if(new URL(url).pathname==='/api/v1/operator/release'){assert.equal(options.headers['X-Tower-Operator-Key'],'synthetic-key');return Response.json(readback);}assert.equal(options.headers,undefined);if(new URL(url).pathname.startsWith('/tower-lord/'))return new Response('Access denied',{status:403});return new Response('public script');};
  const args=['--manifest',join(root,'manifest.json'),'--assets',root,'--endpoint','https://release.example/api/v1/operator/release'];
  assert.equal((await verifyRelease(args)).ready,true);assert.deepEqual(calls,['/api/v1/operator/release','/assets/app.js']);
  readback.protectedAssetsReady=false;await assert.rejects(verifyRelease(args),/protected_assets_mismatch/);
  readback.protectedAssetsReady=true;readback.protectedAssetsHash='0'.repeat(64);await assert.rejects(verifyRelease(args),/protected_assets_mismatch/);
 }finally{globalThis.fetch=previousFetch;if(previousKey===undefined)delete process.env.RELEASE_OPERATOR_KEY;else process.env.RELEASE_OPERATOR_KEY=previousKey;rmSync(root,{recursive:true,force:true});}
});
