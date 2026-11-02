import {isMuseShareURL,homeSourceURL,readNativeHome,HomeSourceError} from './home-source.ts';
import {MusePublicShareError} from './muse-public-share.ts';
import {towerSourceURL} from './tower-source-url.ts';
export class HomeDiscoveryError extends Error {
 readonly code:'invalid_home_url'|'home_page_unavailable'|'home_data_unavailable'|'home_identity_mismatch'|'native_public_data_required'|'native_share_unavailable'|'native_share_timeout'|'native_share_rejected'|'invalid_identity'|'invalid_public_snapshot'|'unsupported_native_journal'|'source_visible_mismatch'|'source_identity_changed';
 constructor(code:HomeDiscoveryError['code']){super(code);this.code=code;}
}
export const NATIVE_HOME_GUIDE='https://raw.githubusercontent.com/mkhsu2002/MuseCondo/main/docs/NATIVE-MUSE-HOMES.md';
/** Only local contract labels are returned; never echo upstream HTML, errors or instructions. */
export function homeResolutionDiagnostic(code:string|null|undefined,homeURL:string){
 const native=isMuseShareURL(homeURL),access=code==='home_page_unavailable'||code==='native_share_unavailable'||code==='native_share_timeout'||code==='native_share_rejected';
 const path=code==='native_public_data_required'?'script#musecondo-home':code==='invalid_identity'||code==='home_identity_mismatch'?'home.id':code==='unsupported_native_journal'?'home.daily':code==='source_visible_mismatch'?'view-home / view-inside / view-dreams':null;
 return {stage:access?'source-read':code==='source_visible_mismatch'?'visible-content':'home-data',path,reason:code??'home_data_unavailable',expected:native?'One supported three-view native home with an inert application/json PublicCondoSite block (musecondo-home), or the recognized historical layout.':'A same-origin application/json condo.json manifest with templateVersion muse-condo-1 and a 16-character lowercase hexadecimal home.id.',guide:native?NATIVE_HOME_GUIDE:'https://raw.githubusercontent.com/mkhsu2002/MuseCondo/main/BUILD-MY-HOME.md',nextStep:access?'check-home-access':'repair-home-data'};
}
export function publicHomeURL(value:unknown):URL {
 try {
  if(typeof value!=='string'||value.length>1000)throw Error();
  if(isMuseShareURL(value))return homeSourceURL(value);
  const u=new URL(value);
  towerSourceURL(u.origin+'/condo.json');
  if(u.username||u.password||u.port||u.search||!/^\/[A-Za-z0-9_./~-]*$/.test(u.pathname)||u.pathname.split('/').includes('..'))throw Error();
  u.hash='';return u;
 } catch {throw new HomeDiscoveryError('invalid_home_url');}
}
async function bounded(response:Response,max:number):Promise<string>{
 const reader=response.body?.getReader();if(!reader)throw Error();let length=0;const chunks:Uint8Array[]=[];
 try {for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>max)throw Error();chunks.push(r.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 const bytes=new Uint8Array(length);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
/** Resolve a public homepage to the existing source contract. Never run scripts, follow frames or forward credentials. */
export async function discoverHome(value:unknown,fetcher:typeof fetch=fetch):Promise<{sourceURL:string;residentId:string}>{
 if(isMuseShareURL(value)){try{const native=await readNativeHome(String(value),fetcher);return {sourceURL:homeSourceURL(value).href,residentId:native.site.home.id};}catch(error){
  if(error instanceof HomeSourceError&&['native_public_data_required','invalid_identity','invalid_public_snapshot','unsupported_native_journal','source_visible_mismatch','source_identity_changed'].includes(error.code))throw new HomeDiscoveryError(error.code as HomeDiscoveryError['code']);
  if(error instanceof MusePublicShareError)throw new HomeDiscoveryError(error.code==='read_unavailable'?'native_share_unavailable':error.code==='timeout'?'native_share_timeout':'native_share_rejected');
  throw new HomeDiscoveryError('home_data_unavailable');
 }}
 let page=publicHomeURL(value);const origin=page.origin,signal=AbortSignal.timeout(12000);let requests=0;
 async function read(url:URL,accept:string){if(++requests>4||url.origin!==origin)throw Error();publicHomeURL(url.href);return fetcher(url.href,{redirect:'manual',headers:{Accept:accept,'User-Agent':'MuseCondo-HomeDiscovery/1.0'},signal});}
 async function manifest(url:URL){towerSourceURL(url.href);if(url.origin!==origin)throw Error();const r=await read(url,'application/json');if(!r.ok||r.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json'){await r.body?.cancel().catch(()=>{});throw Error();}const data=JSON.parse(await bounded(r,128000)) as {templateVersion?:unknown;home?:{id?:unknown}};if(data.templateVersion!=='muse-condo-1'||typeof data.home?.id!=='string'||!/^[a-f0-9]{16}$/.test(data.home.id))throw Error();return {sourceURL:url.href,residentId:data.home.id};}
 if(page.pathname.endsWith('/condo.json')){try{return await manifest(page);}catch{throw new HomeDiscoveryError('home_data_unavailable');}}
 let html:string;
 try {
  let response=await read(page,'text/html');
  if([301,302,307,308].includes(response.status)){
   const location=response.headers.get('Location');await response.body?.cancel();if(!location)throw Error();const target=publicHomeURL(new URL(location,page).href);if(target.origin!==origin||target.href===page.href)throw Error();page=target;response=await read(page,'text/html');
  }
  if(!response.ok||response.headers.get('Content-Type')?.split(';')[0].trim()!=='text/html'){await response.body?.cancel().catch(()=>{});throw Error();}html=await bounded(response,256000);
 }catch{throw new HomeDiscoveryError('home_page_unavailable');}
 const candidates:URL[]=[];
 for(const tag of html.match(/<link\b[^>]{0,2048}>/gi)??[]){
  const attr=(name:string)=>tag.match(new RegExp('\\b'+name+'\\s*=\\s*(?:"([^"<>]*)"|\'([^\'<>]*)\'|([^\\s<>]+))','i'))?.slice(1).find(v=>v!==undefined);
  if(!/^(?:application\/json)$/i.test(attr('type')??'')||!/(?:^|\s)(?:alternate|musecondo)(?:\s|$)/i.test(attr('rel')??''))continue;
  const href=attr('href');if(!href||href.includes('&'))continue;
  try{const u=new URL(href,page);towerSourceURL(u.href);if(u.origin===origin)candidates.push(u);}catch{/* Untrusted links are not fetch instructions. */}
 }
 // A path without a trailing slash is ambiguous: only a redirect or explicit link identifies its directory.
 if(page.pathname.endsWith('/')||page.pathname.endsWith('/index.html'))candidates.push(new URL('./condo.json',page));
 const unique=[...new Map(candidates.map(u=>[u.href,u])).values()].slice(0,2);
 for(const candidate of unique){try{return await manifest(candidate);}catch{/* A bounded second advertised candidate may be usable. */}}
 throw new HomeDiscoveryError('home_data_unavailable');
}
