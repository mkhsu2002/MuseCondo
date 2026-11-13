import test from 'node:test';
import assert from 'node:assert/strict';
import {localizeInterfaceResponse} from '../server/live/interface-html.ts';
const html='<!doctype html><html lang="en"><head><title>Home</title><meta name="muse-home-language" content="zh-TW"></head><body><h2>Dreams</h2><p data-no-translate>Dreams</p><textarea>Dreams</textarea><script>const name="Dreams";</script><button title="Home">Home</button></body></html>';
test('SSR follows volunteered home language while preserving resident text and protected content',async()=>{
 const response=await localizeInterfaceResponse(new Request('https://tower.example/home/abc'),new Response(html,{headers:{'Content-Type':'text/html','ETag':'old','Content-Security-Policy':"script-src 'self'"}}));
 const body=await response.text();assert.match(body,/<html lang="zh-TW">/);assert.match(body,/<h2[^>]*>夢境<\/h2>/);assert.match(body,/<p data-no-translate="">Dreams<\/p>/);assert.match(body,/<textarea>Dreams<\/textarea>/);assert.match(body,/const name="Dreams"/);assert.match(body,/data-interface-original=/);assert.match(body,/src="\/interface-language.js"/);
 assert.equal(response.headers.get('Content-Language'),'zh-TW');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('ETag'),null);assert.equal(response.headers.get('Content-Security-Policy'),"script-src 'self'");
});
test('URL and saved choice win; Accept-Language is fallback only; response contracts unchanged',async()=>{
 for(const [query,cookie,accept,want] of [['?lang=en','','zh-TW','en'],['','muse_interface_language=en','zh-TW','en'],['?lang=zh-TW','','en','zh-TW']] as const){const response=await localizeInterfaceResponse(new Request('https://tower.example/'+query,{headers:{Cookie:cookie,'Accept-Language':accept}}),new Response(html,{headers:{'Content-Type':'text/html'}}));assert.equal(response.headers.get('Content-Language'),want);}
 const fallback='<!doctype html><html><head></head><body><button>Home</button></body></html>';
 const r=await localizeInterfaceResponse(new Request('https://tower.example/',{headers:{'Accept-Language':'en;q=0.1,zh-Hant;q=0.9'}}),new Response(fallback,{headers:{'Content-Type':'text/html'}}));assert.equal(r.headers.get('Content-Language'),'zh-TW');
 for(const response of [new Response('{"error":"Home"}',{headers:{'Content-Type':'application/json'}}),new Response(null,{status:308,headers:{Location:'/home'}}),new Response('<h1>mock</h1>',{headers:{'Content-Type':'text/html'}})]){const expected=await response.clone().text(),result=await localizeInterfaceResponse(new Request('https://tower.example/'),response);assert.equal(await result.text(),expected);assert.equal(result.status,response.status);}
});

test('presentation cookie is removed before authority checks while all other cookies are preserved',async()=>{
 const {interfaceRuntimeRequest}=await import('../server/live/interface-html.ts');
 for(const [cookie,expected] of [['muse_interface_language=zh-TW',null],['muse_interface_language=en; session=secret','session=secret'],['muse_preview_abc=secret; muse_interface_language=zh-TW','muse_preview_abc=secret'],['muse_interface_language=invalid','muse_interface_language=invalid']] as const){
  const source=new Request('https://tower.example/api/v1/agent/home',{method:'PATCH',headers:{Cookie:cookie,Authorization:'Bearer test','Content-Type':'application/json'},body:'{"x":1}'}),result=interfaceRuntimeRequest(source);
  assert.equal(result.headers.get('Cookie'),expected);assert.equal(result.headers.get('Authorization'),'Bearer test');assert.equal(await result.text(),'{"x":1}');assert.equal(source.headers.get('Cookie'),cookie);
 }
});
