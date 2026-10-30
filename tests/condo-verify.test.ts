import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {publicCondoProjection} from '../src/framework/condo.ts';
import {renderCondo} from '../src/framework/condo-render.ts';
import {verifyCondoURL} from '../server/framework/condo-verify.ts';
async function fixture(mode='good'){
 const input=JSON.parse(await readFile(new URL('../fixtures/condo/example.json',import.meta.url),'utf8'));
 const site=publicCondoProjection(input,'0123456789abcdef');const originalSite=structuredClone(site);if(['redirect','stale'].includes(mode)){site.dream=null;site.home.dreams=[];}
 const pngs=Object.fromEntries(await Promise.all(['home','dream'].map(async k=>[k,await readFile(new URL(`../fixtures/condo/art/${k}.png`,import.meta.url))])));
 const server=createServer((req,res)=>{const path=req.url??'';
  if(mode==='stale'&&path.endsWith('/assets/dream.png')){res.writeHead(404);res.end();}
  else if(mode==='redirect'&&path.endsWith('/assets/dream.png')){res.writeHead(302,{'Location':'./home.png'});res.end();}
  else if(path.endsWith('.png')){res.writeHead(200,{'Content-Type':'image/png'});res.end(pngs[path.includes('dream')?'dream':'home']);}
  else if(path.endsWith('.css')){res.writeHead(200,{'Content-Type':'text/css'});res.end('body{color:green}');}
  else if(path.endsWith('condo.json')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(mode==='private'?{...site,evidence:'PRIVATE'}:site));}
  else{const page=path.includes('dreams')?'dreams':path.includes('inside')?'inside':'home';res.writeHead(200,{'Content-Type':'text/html'});res.end(renderCondo(mode==='stale'?originalSite:site,mode==='spa'?'home':page));}
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number};
 return {url:`http://127.0.0.1:${address.port}/nested/condo/`,close:()=>new Promise<void>(r=>server.close(()=>r()))};
}
test('URL verification checks nested three pages and images without claiming full completion',async()=>{const f=await fixture();try{const r=await verifyCondoURL(f.url,{expectedId:'0123456789abcdef'});assert.equal(r.httpVerified,true);assert.equal(r.homeId,'0123456789abcdef');assert.equal(r.pages.length,3);assert.equal(r.images,2);assert.equal(r.homeComplete,false);await assert.rejects(verifyCondoURL(f.url,{expectedId:'ffffffffffffffff'}),/識別/);}finally{await f.close();}});
test('URL verification refuses private manifest fields and SPA fallback posing as three pages',async()=>{for(const mode of ['private','spa']){const f=await fixture(mode);try{await assert.rejects(verifyCondoURL(f.url));}finally{await f.close();}}});
test('URL input rejects embedded credentials, query tokens and insecure remote hosts',async()=>{for(const url of ['https://user:secret@example.com/','https://example.com/?token=secret','http://example.com/','https://example.com/#secret'])await assert.rejects(verifyCondoURL(url));});

test('withdrawal verification refuses a redirect that still exposes the withdrawn dream image',async()=>{const f=await fixture('redirect');try{await assert.rejects(verifyCondoURL(f.url));}finally{await f.close();}});

test('withdrawal verification rejects stale dream HTML even when the manifest and PNG are withdrawn',async()=>{const f=await fixture('stale');try{await assert.rejects(verifyCondoURL(f.url));}finally{await f.close();}});
