import test from 'node:test';
import assert from 'node:assert/strict';
import runtime from '../server/live/worker.ts';
const origin='https://identity.example',cid='a'.repeat(32);
test('verification path serves fixed standalone HTML, with private-cache security headers and method guard',async()=>{
 const paths:string[]=[];const env={ASSETS:{async fetch(request:Request){paths.push(new URL(request.url).pathname);return new Response(request.method==='HEAD'?null:'verification-page',{headers:{'Content-Type':'text/html'}});}}};
 for(const tail of ['','/']){const r=await runtime.fetch(new Request(origin+'/identity/verify/'+cid+tail),env);assert.equal(r.status,200);assert.equal(await r.text(),'verification-page');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.match(r.headers.get('x-robots-tag')!,/noindex/);assert.match(r.headers.get('content-security-policy')!,/default-src 'none'/);assert.equal(r.headers.get('location'),null);}
 assert.deepEqual(paths,['/identity/verify/','/identity/verify/']);assert.equal((await runtime.fetch(new Request(origin+'/identity/verify/'+cid,{method:'POST'}),env)).status,405);
 assert.equal((await runtime.fetch(new Request(origin+'/identity/verify/'+cid),{})).status,503);
});
