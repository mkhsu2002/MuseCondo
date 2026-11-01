// Optional cached tooling only. No provider credentials, browser or external traffic.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.argv[2];if(!root)throw Error('Pass an existing node_modules directory containing miniflare and esbuild');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(join(resolve(root),'miniflare/dist/src/index.js')).href);
const {build}=await import(pathToFileURL(join(resolve(root),'esbuild/lib/main.js')).href);
const compile=async contents=>(await build({stdin:{contents,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false})).outputFiles[0].text;
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
