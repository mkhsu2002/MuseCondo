// Optional cached tooling only. No provider credentials, browser or external traffic.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.argv[2];if(!root)throw Error('Pass an existing node_modules directory containing miniflare and esbuild');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(join(resolve(root),'miniflare/dist/src/index.js')).href);
const {build}=await import(pathToFileURL(join(resolve(root),'esbuild/lib/main.js')).href);
const compile=async (contents,extra={})=>(await build({...extra,stdin:{contents,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false})).outputFiles[0].text;
const origin='https://native-edge.example',key='a'.repeat(64);
const edge=await compile("import edge from './workers/edge-guard/worker.ts';export default edge;");
const pages=await compile(`import runtime from './server/live/worker.ts';let dbCalls=0,cardCalls=0;export default {async fetch(r,env){if(new URL(r.url).pathname==='/__synthetic-counts')return Response.json({dbCalls,cardCalls});return runtime.fetch(r,{...env,DB:{prepare(){dbCalls++;throw Error('synthetic D1 boundary');},batch(){dbCalls++;throw Error('synthetic D1 boundary');}},IDENTITY_CARDS:{idFromName(){cardCalls++;throw Error('synthetic card boundary');},get(){cardCalls++;throw Error('synthetic card boundary');}}});}};`);
const config=JSON.parse(await readFile('workers/edge-guard/wrangler.jsonc','utf8'));
const ratelimits=Object.fromEntries(config.ratelimits.map(({name,...setting})=>[name,setting]));
const deny=()=>{throw Error('External traffic forbidden');};
const shared={modules:true,compatibilityDate:config.compatibility_date,outboundService:deny};
const options={workers:[{...shared,name:'pages',script:pages,bindings:{PUBLIC_ORIGIN:origin,EDGE_GUARD_REQUIRED:'true'},serviceBindings:{EDGE_GUARD:'guard'}},{...shared,name:'guard',script:edge,ratelimits}]};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
try{
 const counts=async()=>await(await mf.dispatchFetch(origin+'/__synthetic-counts')).json();
 const call=(ip,token=key,path='/api/v1/reception/cases',urlOrigin=origin)=>mf.dispatchFetch(urlOrigin+path,{method:'POST',headers:{'CF-Connecting-IP':ip,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});
 // Native rate bindings allow the configured six requests through to the deliberate DB boundary.
 for(let i=0;i<6;i++)assert.equal((await call('192.0.2.5')).status,503);
 assert.deepEqual(await counts(),{dbCalls:6,cardCalls:0});
 for(let i=0;i<3;i++){const r=await call('192.0.2.5',String(i).repeat(64));assert.equal(r.status,429);assert.deepEqual(await r.json(),{error:'rate_limited'});}
 assert.deepEqual(await counts(),{dbCalls:6,cardCalls:0});
 assert.equal((await call('192.0.2.6')).status,503);assert.equal((await counts()).dbCalls,7);
 assert.equal((await call('192.0.2.7',key,'/api/v1/status','https://alias.example')).status,403);assert.equal((await counts()).dbCalls,7);
 // A native service endpoint rejects raw principals and arbitrary fields before rate counters.
 const guard=await mf.getWorker('guard');
 assert.equal((await guard.fetch('https://edge-guard.internal/check',{method:'POST',body:JSON.stringify({kind:'read',ipHash:'192.0.2.5',credentialHash:null})})).status,400);
 const before=await counts();
 for(let i=0;i<45;i++)await mf.dispatchFetch(origin+'/api/v1/agent/identity/card',{headers:{'CF-Connecting-IP':'192.0.2.8'}});
 const saturated=await counts();assert.equal(saturated.dbCalls,before.dbCalls);assert.equal(saturated.cardCalls,40);assert.equal((await mf.dispatchFetch(origin+'/api/v1/agent/identity/card',{headers:{'CF-Connecting-IP':'192.0.2.8'}})).status,429);assert.deepEqual(await counts(),saturated);
 console.log('PASS native workerd Pages + private service + actual RateLimit bindings: six-open cap, shared IP across credential rotation, distinct IP, canonical alias guard, invalid raw fields, burst denial before D1/card, no external traffic');
}finally{await mf.dispose();}
// Missing binding in an actual compiled isolate must fail before the synthetic D1 boundary.
const missingOptions={...shared,script:pages,bindings:{PUBLIC_ORIGIN:origin,EDGE_GUARD_REQUIRED:'true'}};
const missing=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(missingOptions):missingOptions);
try{assert.equal((await missing.dispatchFetch(origin+'/api/v1/status')).status,503);assert.deepEqual(await(await missing.dispatchFetch(origin+'/__synthetic-counts')).json(),{dbCalls:0,cardCalls:0});console.log('PASS native workerd missing required edge binding fails closed with zero D1/card access');}finally{await missing.dispose();}

// Real static asset binding: protection stays on the public route, while the private
// integrity helper reads only the manifest-owned static file inside the isolate.
const assetDirectory=await mkdtemp(join(tmpdir(),'native-release-assets-'));
const staticBytes='synthetic protected static script';
const frontendAssets=[{path:'tower-lord/console.js',access:'protected',sha256:createHash('sha256').update(staticBytes).digest('hex')}];
try{
 await mkdir(join(assetDirectory,'tower-lord'));await writeFile(join(assetDirectory,'tower-lord/console.js'),staticBytes);
 const expectedManifest={...JSON.parse(await readFile('.release/manifest.json','utf8')),buildComplete:true,frontendAssets};
 expectedManifest.frontendHash=createHash('sha256').update(JSON.stringify(frontendAssets)).digest('hex');
 delete expectedManifest.buildHash;expectedManifest.buildHash=createHash('sha256').update(JSON.stringify(expectedManifest)).digest('hex');
 const releaseScript=await compile(`import runtime from './server/live/worker.ts';import {protectedAssetReadiness} from './server/live/release-contract.ts';
 const manifest={frontendAssets:${JSON.stringify(frontendAssets)}};
 export default {async fetch(r,env){const path=new URL(r.url).pathname;
 if(path==='/__synthetic-release')return Response.json(await protectedAssetReadiness(manifest,env.ASSETS,'${origin}'));
 if(path==='/__synthetic-tamper')return Response.json(await protectedAssetReadiness({...manifest,frontendAssets:manifest.frontendAssets.map(a=>({...a,sha256:'0'.repeat(64)}))},env.ASSETS,'${origin}'));
 if(path==='/__synthetic-missing')return Response.json(await protectedAssetReadiness(manifest,undefined,'${origin}'));
 return runtime.fetch(r,{...env,PUBLIC_ORIGIN:'${origin}',TOWER_OPERATOR_KEY:'synthetic-native-key',DB:{prepare(sql){return {async all(){return {results:sql.includes('sqlite_master')?${JSON.stringify(expectedManifest.schemaDefinitions.map(r=>({type:r.type,name:r.name,tbl_name:r.table,sql:r.sql})))}:${JSON.stringify(expectedManifest.migrations.map(m=>({name:m.name})))}};}};}}});}};`,{plugins:[{name:'synthetic-release-manifest',setup(build){build.onLoad({filter:/generated-release\.ts$/},()=>({contents:'export const RELEASE_MANIFEST='+JSON.stringify(expectedManifest)+';',loader:'ts'}));}}]});
 const assetOptions={...shared,script:releaseScript,assets:{directory:assetDirectory,binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}}};
 const nativeAssets=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(assetOptions):assetOptions);
 try{
  const protectedResponse=await nativeAssets.dispatchFetch(origin+'/tower-lord/console.js');assert.equal(protectedResponse.status,503,await protectedResponse.text());
  const endpoint=await nativeAssets.dispatchFetch(origin+'/api/v1/operator/release',{headers:{'X-Tower-Operator-Key':'synthetic-native-key'}});assert.equal(endpoint.status,200);const endpointBody=await endpoint.json();assert.equal(endpointBody.ready,true,JSON.stringify(endpointBody));assert.equal(endpointBody.runtimeBindingsReady,true);
  const ready=await(await nativeAssets.dispatchFetch(origin+'/__synthetic-release')).json();assert.equal(ready.protectedAssetsReady,true);assert.match(ready.protectedAssetsHash,/^[a-f0-9]{64}$/);
  for(const mode of ['tamper','missing'])assert.deepEqual(await(await nativeAssets.dispatchFetch(origin+'/__synthetic-'+mode)).json(),{protectedAssetsReady:false,protectedAssetsHash:null});
  console.log('PASS native workerd actual ASSETS binding: private route remains protected, matching bytes pass, tampered digest and missing binding fail closed; no external traffic');
 }finally{await nativeAssets.dispose();}
 await writeFile(join(assetDirectory,'tower-lord/console.js'),'tampered static script');
 const tamperedAssets=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(assetOptions):assetOptions);
 try{const readback=await(await tamperedAssets.dispatchFetch(origin+'/api/v1/operator/release',{headers:{'X-Tower-Operator-Key':'synthetic-native-key'}})).json();assert.equal(readback.ready,false);assert.equal(readback.protectedAssetsReady,false);}finally{await tamperedAssets.dispose();}
}finally{await rm(assetDirectory,{recursive:true,force:true});}
