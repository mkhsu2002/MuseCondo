import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {sourceIdentity} from './release-manifest.mjs';
import {hashContract} from '../server/live/release-contract.ts';
test('release verifier detects changed frontend bytes with an otherwise matching readback',async()=>{
 const root=mkdtempSync(join(tmpdir(),'release-verifier-'));
 try{
  mkdirSync(join(root,'assets'));const js='console.log("original")';writeFileSync(join(root,'assets/app.js'),js);
  const contract={...JSON.parse(readFileSync('.release/manifest.json','utf8')),...sourceIdentity(),buildComplete:true,frontendAssets:[{path:'assets/app.js',sha256:createHash('sha256').update(js).digest('hex')}]};
  contract.frontendHash=await hashContract(contract.frontendAssets);delete contract.buildHash;contract.buildHash=await hashContract(contract);
  const {sourceSHA,sourceTreeHash,buildHash,rendererHash,frontendHash,migrationHash,schemaHash}=contract;
  writeFileSync(join(root,'expected.json'),JSON.stringify(contract));writeFileSync(join(root,'readback.json'),JSON.stringify({sourceSHA,sourceTreeHash,buildHash,rendererHash,frontendHash,migrationHash,expectedSchemaHash:schemaHash,schemaHash,ready:true}));
  const args=['scripts/verify-release.mjs','--manifest',join(root,'expected.json'),'--readback',join(root,'readback.json'),'--assets',root];
  const good=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(good.status,0,good.stderr);
  writeFileSync(join(root,'assets/app.js'),'console.log("tampered")');const bad=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(bad.status,1);assert.match(bad.stderr,/frontend_asset_mismatch/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
