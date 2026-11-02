/** Anonymous, bounded reads of a Muse native share. HTML is data and is never executed. */
export class MusePublicShareError extends Error {
 readonly code:'invalid_share_url'|'invalid_share_data'|'unsafe_redirect'|'invalid_read_cookie'|'invalid_asset_path'|'invalid_asset'|'body_too_large'|'request_limit'|'timeout'|'read_unavailable';
 constructor(code:MusePublicShareError['code']){super(code);this.name='MusePublicShareError';this.code=code;}
}
export interface MusePublicShareSession {
 readonly assetId:string;
 readHtml():Promise<string>;
 readAsset(kind:'home'|'dream'):Promise<Uint8Array>;
 readAssetPath(path:string):Promise<Uint8Array>;
}
export interface MusePublicShareOptions {
 /** Limits may only reduce the built-in ceilings. All session reads share these budgets. */
 maxRequests?:number;
 timeoutMs?:number;
}
const WRAPPER_MAX=256*1024,HTML_MAX=2*1024*1024,PNG_MAX=8*1024*1024,TOTAL_MAX=20*1024*1024;
const fail=(code:MusePublicShareError['code']):never=>{throw new MusePublicShareError(code);};
const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const mime=(response:Response)=>response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
const redirects=new Set([301,302,303,307,308]);

export function parseMuseShareURL(value:unknown){
 if(typeof value!=='string'||value.length>1024) return fail('invalid_share_url');
 const match=/^https:\/\/muse\.ai\/s\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,180})\/([A-Za-z0-9_-]{43})$/.exec(value);
 if(!match)return fail('invalid_share_url');
 const url=new URL(value);if(url.href!==value||url.username||url.password||url.port)return fail('invalid_share_url');
 return {url:value,slug:match[1],key:match[2]};
}

/** Parse only JSON string arguments to Next's RSC pushes; no JavaScript interpretation. */
function shareData(html:string,input:ReturnType<typeof parseMuseShareURL>){
 const parts:string[]=[];
 for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)){
  const pattern=/\s*self\.__next_f\.push\(\s*\[\s*1\s*,\s*("(?:[^"\\\r\n]|\\[\s\S])*")\s*\]\s*\)\s*;?\s*/y;
  const scriptParts:string[]=[];let offset=0;
  while(offset<script[1].length){
   pattern.lastIndex=offset;const match=pattern.exec(script[1]);if(!match)break;
   try{const part:unknown=JSON.parse(match[1]);if(typeof part!=='string')break;scriptParts.push(part);}catch{break;}
   offset=pattern.lastIndex;
  }
  // A complete script must consist solely of these JSON pushes. A push-looking
  // string literal, comment, external script or executable expression is ignored.
  if(offset===script[1].length&&!/\bsrc\s*=/i.test(script[0].slice(0,script[0].indexOf('>'))))parts.push(...scriptParts);
 }

 const candidates:Record<string,unknown>[]=[];let nodes=0;
 function visit(value:unknown,depth=0):void {
  if(depth>40||++nodes>10000)return fail('invalid_share_data');
  if(Array.isArray(value)){for(const item of value)visit(item,depth+1);}
  else if(object(value)){
   if(Object.hasOwn(value,'preloadedShareData'))candidates.push(value);
   for(const item of Object.values(value))visit(item,depth+1);
  }
 }
 const rows=parts.join('').split('\n');if(rows.length>2048)return fail('invalid_share_data');
 for(const row of rows){
  const match=/^[0-9a-f]+:(.*)$/i.exec(row);if(!match)continue;
  let parsed:unknown;try{parsed=JSON.parse(match[1]);}catch{continue;}visit(parsed);
 }
 if(candidates.length!==1)return fail('invalid_share_data');
 const candidate=candidates[0],data=candidate.preloadedShareData;
 if(candidate.preloadedId!==input.slug||candidate.preloadedShareKey!==input.key||!object(data)||data.type!=='space'||data.share_type!=='cloudflare'||data.deployment_status!=='ready'||typeof data.asset_id!=='string'||!/^[a-z0-9]{3,26}$/.test(data.asset_id)||!input.slug.endsWith('-'+data.asset_id))return fail('invalid_share_data');
 const origin=`https://${data.asset_id}.cf.metaaiusercontent.com`;
 const expected=`${origin}/index.html?hatch_share=${input.slug}&share_key=${input.key}`;
 if(data.space_url!==expected)return fail('invalid_share_data');
 return {assetId:data.asset_id,origin,spaceURL:expected};
}

function readCookie(response:Response):string|undefined {
 const cookies=typeof response.headers.getSetCookie==='function'?response.headers.getSetCookie():[response.headers.get('Set-Cookie')??''];
 let result:string|undefined;
 // Also handles combined Set-Cookie from adapters, without splitting Expires dates.
 for(const header of cookies)for(const raw of header.split(/,(?=\s*[^\s;,=]+=)/)){
  const fields=raw.trim().split(';').map(field=>field.trim());
  if(!fields[0].startsWith('__Host-cf_space_read='))continue;
  const value=fields[0].slice('__Host-cf_space_read='.length);
  const attrs=fields.slice(1).map(field=>field.toLowerCase());
  if(!/^[A-Za-z0-9!#$%&'*+.^_`|~:=/-]{1,4096}$/.test(value)||!attrs.includes('secure')||!attrs.includes('path=/')||attrs.some(field=>/^domain(?:=|$)/.test(field))||result)return fail('invalid_read_cookie');
  result='__Host-cf_space_read='+value;
 }
 return result;
}
function ceiling(value:number|undefined,max:number){return value===undefined?max:Number.isInteger(value)&&value>0&&value<=max?value:max;}

export async function openMusePublicShare(value:unknown,fetcher:typeof fetch=fetch,options:MusePublicShareOptions={}):Promise<MusePublicShareSession>{
 const input=parseMuseShareURL(value),timeoutMs=ceiling(options.timeoutMs,12000),maxRequests=ceiling(options.maxRequests,8);
 const deadline=Date.now()+timeoutMs,controller=new AbortController();let requests=0,total=0;
 async function timed<T>(operation:()=>Promise<T>):Promise<T>{
  const remaining=deadline-Date.now();if(remaining<=0)return fail('timeout');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new MusePublicShareError('timeout'));},remaining);})]);}
  catch(error){if(error instanceof MusePublicShareError)throw error;if(controller.signal.aborted||Date.now()>=deadline)return fail('timeout');return fail('read_unavailable');}
  finally{if(timer!==undefined)clearTimeout(timer);}
 }
 async function request(url:string,headers:Record<string,string>){
  if(++requests>maxRequests)return fail('request_limit');
  return timed(()=>fetcher(url,{method:'GET',credentials:'omit',redirect:'manual',referrerPolicy:'strict-origin-when-cross-origin',headers,signal:controller.signal}));
 }
 function cancel(response:Response){
  // Cleanup must never extend the read deadline, including hostile stream sinks.
  try{void response.body?.cancel().catch(()=>{});}catch{/* Best-effort cleanup only. */}
 }
 async function bytes(response:Response,max:number):Promise<Uint8Array>{
  const length=response.headers.get('Content-Length');
  if(length&&/^\d+$/.test(length)&&Number(length)>max){cancel(response);return fail('body_too_large');}
  const reader=response.body?.getReader();if(!reader)return fail('read_unavailable');
  let size=0;const chunks:Uint8Array[]=[];
  try{
   for(;;){const next=await timed(()=>reader.read());if(next.done)break;size+=next.value.byteLength;total+=next.value.byteLength;if(size>max||total>TOTAL_MAX)return fail('body_too_large');chunks.push(next.value);}
  }catch(error){try{void reader.cancel().catch(()=>{});}catch{/* Best-effort cleanup only. */}throw error;}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}return result;
 }
 function decode(data:Uint8Array){try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{return fail('read_unavailable');}}
 const wrapper=await request(input.url,{Accept:'text/html'});
 if(!wrapper.ok||mime(wrapper)!=='text/html'){cancel(wrapper);return fail('read_unavailable');}
 const data=shareData(decode(await bytes(wrapper,WRAPPER_MAX)),input);
 let cookie:string|undefined;
 const headers=(accept:string,frame=false):Record<string,string>=>({Accept:accept,Referer:'https://muse.ai/',...(frame?{'Sec-Fetch-Dest':'iframe','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'cross-site'}:{}),...(cookie?{Cookie:cookie}:{})});
 let page=await request(data.spaceURL,headers('text/html',true)),count=0;
 for(;;){
  const nextCookie=readCookie(page);if(nextCookie)cookie=nextCookie;
  if(!redirects.has(page.status))break;
  const location=page.headers.get('Location');cancel(page);
  if(++count>2||!location||(location.includes('\\')||[...location].some(char=>char.charCodeAt(0)<=32||char.charCodeAt(0)===127)))return fail('unsafe_redirect');
  let target:URL;try{target=new URL(location,data.origin+'/index.html');}catch{return fail('unsafe_redirect');}
  if(target.href!==data.origin+'/index.html'||!['/index.html',data.origin+'/index.html'].includes(location))return fail('unsafe_redirect');
  page=await request(target.href,headers('text/html',true));
 }
 if(!page.ok||mime(page)!=='text/html'){cancel(page);return fail('read_unavailable');}
 const html=decode(await bytes(page,HTML_MAX));
 async function readAssetPath(path:string){
   if(typeof path!=='string'||path.length>240||!/^(?:\.\/)?(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.png$/.test(path))return fail('invalid_asset_path');
   const response=await request(data.origin+'/'+path.replace(/^\.\//,''),headers('image/png'));
   if(!response.ok||mime(response)!=='image/png'){cancel(response);return fail('invalid_asset');}
   const result=await bytes(response,PNG_MAX);
   if(result.length<8||![137,80,78,71,13,10,26,10].every((byte,i)=>result[i]===byte))return fail('invalid_asset');
   return result;
 }
 return {assetId:data.assetId,async readHtml(){return html;},readAssetPath,async readAsset(kind:'home'|'dream'){if(kind!=='home'&&kind!=='dream')return fail('invalid_asset_path');return readAssetPath('./assets/'+kind+'.png');}};
}
