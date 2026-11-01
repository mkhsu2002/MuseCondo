import test from 'node:test';
import assert from 'node:assert/strict';
import {openMusePublicShare, MusePublicShareError} from '../server/live/muse-public-share.ts';

const key='A'.repeat(43),slug='synthetic-house-abc123',assetId='abc123';
const share=`https://muse.ai/s/${slug}/${key}`;
const host=`https://${assetId}.cf.metaaiusercontent.com`;
const space=`${host}/index.html?hatch_share=${slug}&share_key=${key}`;
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0]);
function wrapper(change:Record<string,unknown>={}){
 const row='0:'+JSON.stringify({preloadedId:slug,preloadedShareKey:key,preloadedShareData:{type:'space',share_type:'cloudflare',deployment_status:'ready',asset_id:assetId,space_url:space},...change})+'\n';
 return '<script>self.__next_f.push([1,'+JSON.stringify(row.slice(0,30))+'])</script><script>self.__next_f.push([1,'+JSON.stringify(row.slice(30))+'])</script>';
}
function fixture(page=wrapper(), redirect='/index.html', cookie='__Host-cf_space_read=synthetic_read_cookie; Secure; HttpOnly; Path=/'){
 const calls:{url:string;init:RequestInit|undefined}[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input);calls.push({url,init});
  if(url===share)return new Response(page,{headers:{'Content-Type':'text/html'}});
  if(url===space)return new Response(null,{status:302,headers:{Location:redirect,'Set-Cookie':cookie}});
  if(url===host+'/index.html')return new Response('<html><script>throw new Error("must not run")</script>synthetic</html>',{headers:{'Content-Type':'text/html'}});
  if(url===host+'/assets/home.png'||url===host+'/assets/dream.png')return new Response(png,{headers:{'Content-Type':'image/png'}});
  throw Error('unexpected URL '+url);
 };return {calls,fetcher};
}
async function rejectsCode(action:()=>unknown,code:string){await assert.rejects(async()=>action(),(error:unknown)=>error instanceof MusePublicShareError&&error.code===code&&!error.message.includes(key)&&!error.message.includes('synthetic_read_cookie'));}

test('reads split RSC chunks, narrowly carries read cookie, and returns inert HTML / PNG',async()=>{
 const f=fixture();const s=await openMusePublicShare(share,f.fetcher);assert.equal(s.assetId,assetId);
 assert.match(await s.readHtml(),/synthetic/);assert.deepEqual(await s.readAsset('home'),png);assert.deepEqual(await s.readAsset('dream'),png);
 assert.equal(f.calls.length,5);assert.equal(f.calls[0].init?.credentials,'omit');
 for(const call of f.calls){assert.equal(call.init?.method,'GET');assert.equal(call.init?.redirect,'manual');assert.equal(new Headers(call.init?.headers).get('Authorization'),null);}
 assert.equal(new Headers(f.calls[1].init?.headers).get('Cookie'),null);
 assert.equal(new Headers(f.calls[2].init?.headers).get('Cookie'),'__Host-cf_space_read=synthetic_read_cookie');
 const headers=new Headers(f.calls[1].init?.headers);assert.equal(headers.get('Referer'),'https://muse.ai/');assert.equal(headers.get('Sec-Fetch-Dest'),'iframe');assert.equal(headers.get('Sec-Fetch-Mode'),'navigate');assert.equal(headers.get('Sec-Fetch-Site'),'cross-site');
 assert.doesNotMatch(JSON.stringify(s),/synthetic_read_cookie|AAAAAAAA/);
});

test('rejects nonexact public links before any network access',async()=>{
 for(const value of [share+'?x=1',share+'#',share.replace('https:','http:'),share.replace('muse.ai','user@muse.ai'),share.replace('muse.ai','muse.ai:443'),share.replace('/s/','/s/%73/'),share.replace(key,'B'.repeat(42)),share.replace('muse.ai','MUSE.AI')]){
  let calls=0;await rejectsCode(()=>openMusePublicShare(value,async()=>{calls++;throw Error();}),'invalid_share_url');assert.equal(calls,0);
 }
});

test('wrapper identity, status and destination must agree exactly',async()=>{
 for(const change of [{preloadedId:'other'},{preloadedShareKey:'B'.repeat(43)},{preloadedShareData:{type:'space',share_type:'cloudflare',deployment_status:'pending',asset_id:assetId,space_url:space}},{preloadedShareData:{type:'space',share_type:'cloudflare',deployment_status:'ready',asset_id:assetId,space_url:space+'&extra=1'}},{preloadedShareData:{type:'space',share_type:'cloudflare',deployment_status:'ready',asset_id:'evil',space_url:space}}]){
  const f=fixture(wrapper(change));await rejectsCode(()=>openMusePublicShare(share,f.fetcher),'invalid_share_data');assert.equal(f.calls.length,1);
 }
});

test('does not evaluate scripts or follow external redirects or paths',async()=>{
 for(const redirect of ['https://evil.test/index.html',host+'/api/auth',host+'/index.html?x=1',host+'/index.html#x','//other.cf.metaaiusercontent.com/index.html']){
  const f=fixture(wrapper(),redirect);await rejectsCode(()=>openMusePublicShare(share,f.fetcher),'unsafe_redirect');assert.equal(f.calls.length,2);
 }
 const f=fixture('<script>self.__next_f.push([1,(()=>{throw Error("run")})()])</script>');await rejectsCode(()=>openMusePublicShare(share,f.fetcher),'invalid_share_data');assert.equal(f.calls.length,1);
});

test('asset paths are restricted and PNG MIME and signature required',async()=>{
 const f=fixture(),s=await openMusePublicShare(share,f.fetcher);
 for(const path of ['https://evil.test/home.png','//evil.test/home.png','../home.png','/home.png','home.png?x=1','home.png#x','%68ome.png','api/auth','other.png'])await rejectsCode(()=>s.readAsset(path as 'home'),'invalid_asset_path');
 assert.equal(f.calls.length,3);
 const wrong:typeof fetch=async(input,init)=>String(input).endsWith('home.png')?new Response('<html/>',{headers:{'Content-Type':'image/png'}}):f.fetcher(input,init);
 const bad=await openMusePublicShare(share,wrong);await rejectsCode(()=>bad.readAsset('home'),'invalid_asset');
});

test('bounded bodies, request budget and shared timeout fail closed',async()=>{
 await rejectsCode(()=>openMusePublicShare(share,async()=>new Response('x'.repeat(256*1024+1),{headers:{'Content-Type':'text/html'}})),'body_too_large');
 const f=fixture(),s=await openMusePublicShare(share,f.fetcher,{maxRequests:3});await rejectsCode(()=>s.readAsset('home'),'request_limit');
 const slow:typeof fetch=async()=>new Promise(()=>{});await rejectsCode(()=>openMusePublicShare(share,slow,{timeoutMs:10}),'timeout');
});

test('ignores unrelated cookies, rejects malformed read cookies and redacts fetch errors',async()=>{
 const f=fixture(wrapper(),'/index.html','other=action_credential; Secure; Path=/');const s=await openMusePublicShare(share,f.fetcher);await s.readAsset('home');assert.equal(new Headers(f.calls[2].init?.headers).get('Cookie'),null);
 const bad=fixture(wrapper(),'/index.html','__Host-cf_space_read=secret; Secure; Domain=metaaiusercontent.com; Path=/');await rejectsCode(()=>openMusePublicShare(share,bad.fetcher),'invalid_read_cookie');
 await rejectsCode(()=>openMusePublicShare(share,async()=>{throw Error(key+' synthetic_read_cookie');}),'read_unavailable');
});

test('push-looking text inside comments, string literals and external scripts is ignored',async()=>{
 const push='self.__next_f.push([1,'+JSON.stringify('0:'+JSON.stringify({preloadedId:slug,preloadedShareKey:key,preloadedShareData:{type:'space',share_type:'cloudflare',deployment_status:'ready',asset_id:assetId,space_url:space}})+'\n')+'])';
 for(const page of ['<script>// '+push+'</script>','<script>const data='+JSON.stringify(push)+'</script>','<script src="https://evil.test/external.js">'+push+'</script>','<div>'+push+'</div>']){
  const f=fixture(page);await rejectsCode(()=>openMusePublicShare(share,f.fetcher),'invalid_share_data');assert.equal(f.calls.length,1);
 }
});

test('duplicate metadata, excessive RSC rows and nesting are rejected',async()=>{
 let nested:unknown={};for(let i=0;i<45;i++)nested={child:nested};
 const row='0:'+JSON.stringify(nested)+'\n';
 for(const page of [wrapper()+wrapper(),wrapper()+'<script>self.__next_f.push([1,'+JSON.stringify('\n'.repeat(2049))+'])</script>',wrapper()+'<script>self.__next_f.push([1,'+JSON.stringify(row)+'])</script>'])await rejectsCode(()=>openMusePublicShare(share,fixture(page).fetcher),'invalid_share_data');
});

test('allows at most two clean same-host redirects, never forwards other cookies',async()=>{
 const f=fixture();let redirected=0;
 const fetcher:typeof fetch=async(input,init)=>{
  if(String(input)===host+'/index.html'&&++redirected<3)return new Response(null,{status:302,headers:{Location:'/index.html'}});
  return f.fetcher(input,init);
 };
 await rejectsCode(()=>openMusePublicShare(share,fetcher),'unsafe_redirect');assert.equal(redirected,2);
 const two:typeof fetch=async(input,init)=>{
  if(String(input)===host+'/index.html'&&redirected++===0)return new Response(null,{status:307,headers:{Location:host+'/index.html','Set-Cookie':'unrelated=action_token; Secure; Path=/'}});
  return f.fetcher(input,init);
 };
 redirected=0;const session=await openMusePublicShare(share,two);assert.match(await session.readHtml(),/synthetic/);
});

test('HTML and asset response caps and non-PNG MIME stop reads',async()=>{
 for(const [at,body,type,code] of [['html','', 'text/html','body_too_large'],['asset','', 'image/png','body_too_large'],['asset','<html/>','text/html','invalid_asset']] as const){
  const f=fixture();const fetcher:typeof fetch=async(input,init)=>{
   const url=String(input);
   if(at==='html'&&url===host+'/index.html')return new Response(body,{headers:{'Content-Type':type,'Content-Length':String(2*1024*1024+1)}});
   if(at==='asset'&&url.endsWith('/assets/home.png'))return new Response(body,{headers:{'Content-Type':type,...(body?'':{'Content-Length':String(8*1024*1024+1)})}});
   return f.fetcher(input,init);
  };
  if(at==='html')await rejectsCode(()=>openMusePublicShare(share,fetcher),code);
  else{const s=await openMusePublicShare(share,fetcher);await rejectsCode(()=>s.readAsset('home'),code);}
 }
});

test('a stalled response cancellation cannot outlive the shared deadline',async()=>{
 const stream=new ReadableStream<Uint8Array>({cancel(){return new Promise(()=>{});}});
 const fetcher:typeof fetch=async()=>new Response(stream,{status:403});
 await Promise.race([
  rejectsCode(()=>openMusePublicShare(share,fetcher,{timeoutMs:10}),'read_unavailable'),
  new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('response cancellation stalled')),100)),
 ]);
});

test('streaming wrapper bytes are capped without Content-Length',async()=>{
 const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(128*1024));controller.enqueue(new Uint8Array(128*1024+1));}});
 await rejectsCode(()=>openMusePublicShare(share,async()=>new Response(stream,{headers:{'Content-Type':'text/html'}})),'body_too_large');
});

test('session asset reads retain the original deadline and cannot start a fresh timeout',async()=>{
 const f=fixture(),session=await openMusePublicShare(share,f.fetcher,{timeoutMs:25});
 await new Promise(resolve=>setTimeout(resolve,30));
 await rejectsCode(()=>session.readAsset('home'),'timeout');assert.equal(f.calls.length,3);
});
