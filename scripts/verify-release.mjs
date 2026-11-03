/* global fetch, AbortSignal */
import {readFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {sourceIdentity} from './release-manifest.mjs';
import {hashContract,releaseAssetAccess} from '../server/live/release-contract.ts';
export async function compareReadback(manifest,readback){
 if(!manifest.buildComplete||!readback.ready)throw Error('release_not_ready');
 if(!readback.protectedAssetsReady||readback.protectedAssetsHash!==await hashContract(manifest.frontendAssets.filter(a=>releaseAssetAccess(a.path)==='protected')))throw Error('release_protected_assets_mismatch');
 for(const field of ['sourceSHA','sourceTreeHash','buildHash','rendererHash','frontendHash','migrationHash'])if(manifest[field]!==readback[field])throw Error('release_'+field+'_mismatch');
 if(manifest.schemaHash!==readback.schemaHash||manifest.schemaHash!==readback.expectedSchemaHash)throw Error('release_schema_mismatch');
}
export async function verifyRelease(args){
 const options={};for(let i=0;i<args.length;i+=2){if(!['--manifest','--readback','--endpoint','--assets'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('release_invalid_arguments');options[args[i]]=args[i+1];}
 if(Boolean(options['--readback'])===Boolean(options['--endpoint']))throw Error('release_choose_endpoint_or_readback');
 const manifest=JSON.parse(readFileSync(options['--manifest']||'.release/manifest.json','utf8'));
 const {buildHash,...contract}=manifest;if(await hashContract(contract)!==buildHash)throw Error('release_manifest_hash_mismatch');
 const identity=sourceIdentity();if(identity.sourceSHA!==manifest.sourceSHA||identity.sourceTreeHash!==manifest.sourceTreeHash)throw Error('release_source_mismatch_rebuild_required');
 if(!manifest.buildComplete||!manifest.frontendAssets.length)throw Error('release_build_incomplete');
 if(manifest.frontendAssets.some(a=>a.access!==releaseAssetAccess(a.path))||await hashContract(manifest.frontendAssets)!==manifest.frontendHash)throw Error('release_asset_manifest_invalid');
 const directory=resolve(options['--assets']||'dist');
 for(const asset of manifest.frontendAssets){
  const path=resolve(directory,asset.path);if(!path.startsWith(directory+sep))throw Error('release_asset_path_invalid');
  if(createHash('sha256').update(readFileSync(path)).digest('hex')!==asset.sha256)throw Error('release_frontend_asset_mismatch');
 }
 let readback;
 if(options['--readback'])readback=JSON.parse(readFileSync(options['--readback'],'utf8'));
 else{
  const endpoint=new URL(options['--endpoint']);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/api/v1/operator/release')throw Error('release_endpoint_invalid');
  const key=process.env.RELEASE_OPERATOR_KEY;if(!key)throw Error('release_operator_environment_required');
  const response=await fetch(endpoint,{headers:{'X-Tower-Operator-Key':key},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(response.status!==200)throw Error('release_endpoint_rejected_'+response.status);
  const body=await response.text();if(body.length>8192)throw Error('release_readback_too_large');readback=JSON.parse(body);
  for(const asset of manifest.frontendAssets.filter(a=>a.access==='public')){
   const url=new URL('/'+asset.path,endpoint);if(url.origin!==endpoint.origin)throw Error('release_asset_origin_invalid');
   const output=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!output.ok||createHash('sha256').update(new Uint8Array(await output.arrayBuffer())).digest('hex')!==asset.sha256)throw Error('release_deployed_frontend_asset_mismatch');
  }
 }
 await compareReadback(manifest,readback);return {ready:true,sourceSHA:manifest.sourceSHA,buildHash:manifest.buildHash};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(await verifyRelease(process.argv.slice(2))));}catch(error){console.error(/^release_[A-Za-z0-9_]+$/.test(error.message)?error.message:'release_verification_failed');process.exitCode=1;}}
