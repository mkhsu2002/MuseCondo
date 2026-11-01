import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverHome,publicHomeURL} from '../server/live/home-discovery.ts';
const id='a'.repeat(16),manifest=()=>Response.json({templateVersion:'muse-condo-1',home:{id}});
test('homepages, index pages and published alternate links resolve without credentials or JavaScript',async()=>{
 for(const page of ['https://home.example/','https://home.example/room/index.html','https://home.example/room/']){
  const requests:string[]=[];const f:typeof fetch=async(url,init)=>{requests.push(String(url));assert.equal(init?.redirect,'manual');assert(!new Headers(init?.headers).has('Authorization'));return String(url).endsWith('condo.json')?manifest():new Response('<html><h1>My home</h1></html>',{headers:{'Content-Type':'text/html'}});};
  assert.deepEqual(await discoverHome(page,f),{sourceURL:new URL('./condo.json',page).href,residentId:id});assert.equal(requests.length,2);
 }
 const f:typeof fetch=async url=>String(url).endsWith('condo.json')?manifest():new Response('<link rel="alternate" type="application/json" href="./room/condo.json">',{headers:{'Content-Type':'text/html'}});
 assert.equal((await discoverHome('https://home.example/entry',f)).sourceURL,'https://home.example/room/condo.json');
});
test('one same-origin slash redirect resolves its real directory; external redirects and wrappers fail closed',async()=>{
 const seen:string[]=[];const f:typeof fetch=async url=>{seen.push(String(url));return String(url)==='https://home.example/room'?new Response(null,{status:301,headers:{Location:'/room/'}}):String(url).endsWith('condo.json')?manifest():new Response('<h1>Home</h1>',{headers:{'Content-Type':'text/html'}});};
 assert.equal((await discoverHome('https://home.example/room',f)).sourceURL,'https://home.example/room/condo.json');assert.equal(seen.length,3);
 for(const response of [()=>new Response(null,{status:302,headers:{Location:'https://other.example/'}}),()=>new Response('<iframe src="https://other.example/home"></iframe>',{headers:{'Content-Type':'text/html'}})]){
  const urls:string[]=[];await assert.rejects(discoverHome('https://home.example/share',async url=>{urls.push(String(url));return response();}));assert.deepEqual(urls,['https://home.example/share']);
 }
});
test('malformed homes never become a fetch proxy or treat soft-404 HTML as JSON',async()=>{
 for(const url of ['http://home.example/','https://127.0.0.1/','https://x.local/','https://user:password@home.example/','https://home.example/?token=secret','https://home.example/%2fprivate'])assert.throws(()=>publicHomeURL(url));
 for(const make of [()=>new Response('<html>Not found</html>',{headers:{'Content-Type':'text/html'}}),()=>Response.json({home:{id}}),()=>new Response('x'.repeat(256001),{headers:{'Content-Type':'text/html'}})]){
  let count=0;await assert.rejects(discoverHome('https://home.example/',async()=>{count++;return make();}));assert(count<=3);
 }
});
test('external manifest links are ignored and discovery has a fixed request bound',async()=>{
 const urls:string[]=[];await assert.rejects(discoverHome('https://home.example/',async url=>{urls.push(String(url));return String(url).endsWith('.json')?new Response(null,{status:404}):new Response('<link rel="alternate" type="application/json" href="https://private.internal/condo.json"><link rel="alternate" type="application/json" href="./a/condo.json"><link rel="alternate" type="application/json" href="./b/condo.json"><link rel="alternate" type="application/json" href="./c/condo.json">',{headers:{'Content-Type':'text/html'}});}));assert(urls.length<=3);assert(urls.every(u=>u.startsWith('https://home.example/')));
});

test('unused error and redirect bodies are canceled before fallback fetches',async()=>{
 for(const bad of [404,200,302]){
  let canceled=0;const stream=()=>new ReadableStream<Uint8Array>({cancel(){canceled++;}});
  if(bad===302){let calls=0;await assert.rejects(discoverHome('https://home.example/',async()=>{calls++;return new Response(stream(),{status:302,headers:{Location:'/again'}});}));assert.equal(calls,2);assert.equal(canceled,2);}
  else {let calls=0;const result=await discoverHome('https://home.example/',async()=>{calls++;if(calls===1)return new Response('<link rel="alternate" type="application/json" href="./a/condo.json"><link rel="alternate" type="application/json" href="./b/condo.json">',{headers:{'Content-Type':'text/html'}});if(calls===2)return new Response(stream(),{status:bad,headers:{'Content-Type':'text/html'}});assert.equal(canceled,1);return manifest();});assert.equal(result.residentId,id);assert.equal(canceled,1);}
 }
});
