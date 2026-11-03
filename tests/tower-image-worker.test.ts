import test from 'node:test';
import assert from 'node:assert/strict';
import {runImageOptimization,type ImageOptimizationBindings} from '../workers/tower-manager/image-optimizer.ts';
const source=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]),output=new Uint8Array([82,73,70,70,9,8,7,6]);
const id='a'.repeat(64),lease='b'.repeat(32),sha=async(bytes:Uint8Array)=>Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))).toString('hex');
async function fixture(options:{idle?:boolean;tamper?:boolean;reject?:unknown;uploadFailures?:number;rejectUpload?:boolean;badOutput?:boolean}={}){
 let transforms=0,claims=0,uploads=0;const failures:string[]=[],uploaded:Uint8Array[]=[];
 const sourceSha=await sha(source);
 const env:ImageOptimizationBindings={PUBLIC_ORIGIN:'https://tower.example',MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic-trigger',IMAGES:{input(stream){
  transforms++;return {transform(parameters){assert.deepEqual(parameters,{width:1920,height:1920,fit:'scale-down'});return {async output(parameters){assert.deepEqual(parameters,{format:'image/webp',quality:85,anim:false});assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()),source);if(options.reject)throw options.reject;return {response(){return new Response(output,{headers:{'Content-Type':options.badOutput?'text/plain':'image/webp'}});}};}};}};
 }}};
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));assert.equal(url.origin,env.PUBLIC_ORIGIN);assert.equal(init?.redirect,'manual');assert.equal(new Headers(init?.headers).get('X-Manager-Schedule-Key'),'synthetic-trigger');assert.equal(init?.method,'POST');
  if(url.pathname==='/api/v1/manager/images/claim'){
   claims++;assert.equal(init?.body,'{}');if(options.idle)return new Response(null,{status:204});
   return new Response(options.tamper?new Uint8Array(source.length):source,{headers:{'Content-Type':'image/png','X-Image-Job-Id':id,'X-Image-Lease':lease,'X-Image-Source-Sha':sourceSha,'X-Image-Source-Size':String(source.length),'X-Image-Profile':'cf-webp-1920-q85-v1'}});
  }
  assert.equal(new Headers(init?.headers).get('X-Image-Lease'),lease);
  if(url.pathname===`/api/v1/manager/images/${id}/failed`){failures.push(JSON.parse(String(init?.body)).code);return Response.json({recorded:true});}
  assert.equal(url.pathname,`/api/v1/manager/images/${id}/complete`);assert.equal(new Headers(init?.headers).get('Content-Type'),'image/webp');uploads++;uploaded.push(new Uint8Array(await new Response(init?.body).arrayBuffer()));
  if(options.rejectUpload)return new Response(null,{status:409});if(uploads<=(options.uploadFailures??0))throw Error('upload response lost');return Response.json({ready:true});
 };
 return {env,fetcher,get transforms(){return transforms;},get claims(){return claims;},get uploads(){return uploads;},failures,uploaded};
}
test('missing Images binding cannot claim or consume a conversion reservation',async()=>{
 let requests=0;assert.deepEqual(await runImageOptimization({PUBLIC_ORIGIN:'https://tower.example',MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic'},async()=>{requests++;throw Error('must not request');}),{pending:false,state:'disabled'});assert.equal(requests,0);
});
test('one authorized claim transforms once and delivers the exact result without a public URL',async()=>{
 const f=await fixture();assert.deepEqual(await runImageOptimization(f.env,f.fetcher),{pending:true,state:'complete'});assert.equal(f.claims,1);assert.equal(f.transforms,1);assert.equal(f.uploads,1);assert.deepEqual(f.uploaded,[output]);assert.deepEqual(f.failures,[]);
});
test('empty durable queue cannot invoke Images',async()=>{
 const f=await fixture({idle:true});assert.deepEqual(await runImageOptimization(f.env,f.fetcher),{pending:false,state:'idle'});assert.equal(f.claims,1);assert.equal(f.transforms,0);assert.equal(f.uploads,0);
});
test('source digest mismatch is rejected before a billable transform',async()=>{
 const f=await fixture({tamper:true});assert.equal((await runImageOptimization(f.env,f.fetcher)).state,'source_rejected');assert.equal(f.transforms,0);assert.equal(f.uploads,0);assert.deepEqual(f.failures,['transform_rejected']);
});
test('lost completion response retries only the same bytes, never the transform',async()=>{
 for(const failures of [2,3]){
  const f=await fixture({uploadFailures:failures});const result=await runImageOptimization(f.env,f.fetcher);assert.equal(result.state,failures===2?'complete':'unknown');assert.equal(f.transforms,1);assert.equal(f.uploads,3);assert.deepEqual(f.uploaded,[output,output,output]);assert.deepEqual(f.failures,failures===2?[]:['transform_unknown']);
 }
});
test('an explicit Images quota rejection and an ambiguous failure are never retransformed',async()=>{
 for(const rejection of [{code:9422,message:'provider quota'},Error('unknown network outcome')]){
  const f=await fixture({reject:rejection});assert.equal((await runImageOptimization(f.env,f.fetcher)).state,'code' in rejection?'rejected':'unknown');assert.equal(f.transforms,1);assert.equal(f.uploads,0);assert.deepEqual(f.failures,['code' in rejection?'transform_rejected':'transform_unknown']);
 }
});
test('invalid transformed content and completion rejection do not cause another Images call',async()=>{
 const invalid=await fixture({badOutput:true});assert.equal((await runImageOptimization(invalid.env,invalid.fetcher)).state,'unknown');assert.equal(invalid.transforms,1);assert.equal(invalid.uploads,0);assert.deepEqual(invalid.failures,['transform_unknown']);
 const rejected=await fixture({rejectUpload:true});assert.equal((await runImageOptimization(rejected.env,rejected.fetcher)).state,'completion_rejected');assert.equal(rejected.transforms,1);assert.equal(rejected.uploads,1);
});
