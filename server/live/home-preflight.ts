import type {PublicCondoSite} from '../../src/framework/condo.ts';
import {discoverHome,HomeDiscoveryError,publicHomeURL} from './home-discovery.ts';
import {assertHomeVisible,HomeSourceError,homeSourceMapping,isMuseShareURL,readNativeHome,validateHomeSnapshot,type HomeSourceMapping} from './home-source.ts';
import {MusePublicShareError} from './muse-public-share.ts';
import {validatePNG} from './png.ts';

export interface HomePreflightIssue {
 stage:'source-read'|'home-data'|'visible-content'|'images';
 path:string;
 code:string;
 expected:string;
}
export interface HomePreflightResult {
 ready:boolean;
 sourceURL?:string;
 residentId?:string;
 sourceDigest?:string;
 /** Internal validated public projection; HTTP diagnostics should omit the content. */
 site?:PublicCondoSite;
 normalization?:HomeSourceMapping;
 images?:{purpose:'home'|'dream';digest:string;width:number;height:number;bytes:number}[];
 issues:HomePreflightIssue[];
}
const expected={
 'source-read':'An anonymously readable supported HTTPS home without external redirects.',
 'home-data':'A complete public muse-condo-1 snapshot with a stable 16-character lowercase hexadecimal home.id and no unsupported or private fields.',
 'visible-content':'All three declared public views must visibly contain their complete corresponding content and artwork.',
 images:'Readable complete PNG artwork: a 16:9 home scene and a square dream scene when shared.',
} as const;
async function sha(value:string|Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(typeof value==='string'?new TextEncoder().encode(value):value))),b=>b.toString(16).padStart(2,'0')).join('');}
/** Pure inspection: bounded anonymous GETs only. No database, paid model, mail or publication capability. */
export async function inspectHomePreflight(homeURL:unknown,fetcher:typeof fetch=fetch):Promise<HomePreflightResult>{
 let stage:HomePreflightIssue['stage']='source-read',path='source',requests=0,total=0;
 const deadline=Date.now()+12000,controller=new AbortController();
 async function timed<T>(operation:()=>Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{const remaining=deadline-Date.now();if(remaining<=0)throw new HomeSourceError('source_timeout');return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new HomeSourceError('source_timeout'));},remaining);})]);}
  finally{if(timer!==undefined)clearTimeout(timer);}
 }
 const boundedFetcher:typeof fetch=async(input,init)=>{
  if(++requests>12)throw new HomeSourceError('source_request_limit');
  const response=await timed(()=>fetcher(input,{...init,method:'GET',credentials:'omit',redirect:'manual',signal:controller.signal}));
  const reader=response.body?.getReader();if(!reader)return response;
  const accept=new Headers(init?.headers).get('Accept'),max=accept==='image/png'?8*1024*1024:accept==='application/json'?128000:2*1024*1024;
  let size=0;
  const stream=new ReadableStream<Uint8Array>({async pull(out){try{const next=await timed(()=>reader.read());if(next.done){out.close();return;}size+=next.value.length;total+=next.value.length;if(size>max||total>20*1024*1024)throw new HomeSourceError('source_body_too_large');out.enqueue(next.value);}catch(error){void reader.cancel().catch(()=>{});out.error(error);}},cancel(){void reader.cancel().catch(()=>{});}});
  return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
 async function read(url:string,mime:string){
  const response=await boundedFetcher(url,{headers:{Accept:mime,'User-Agent':'MuseCondo-HomePreflight/1.0'}});
  if(!response.ok||response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!==mime){void response.body?.cancel().catch(()=>{});throw new HomeSourceError(stage==='images'?'invalid_source_image':stage==='visible-content'?'source_view_unavailable':'home_data_unavailable',path);}
  return new Uint8Array(await response.arrayBuffer());
 }
 try{
  const input=publicHomeURL(homeURL);let sourceURL:string,site:PublicCondoSite,normalization:HomeSourceMapping,readAsset:(purpose:'home'|'dream')=>Promise<Uint8Array>;
  if(isMuseShareURL(input.href)){
   stage='home-data';const source=await readNativeHome(input.href,boundedFetcher);sourceURL=input.href;site=source.site;normalization=source.normalization;readAsset=source.readAsset;
  }else{
   sourceURL=input.pathname.endsWith('/condo.json')?input.href:(await discoverHome(input.href,boundedFetcher)).sourceURL;
   stage='home-data';path='snapshot';let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read(sourceURL,'application/json')));}catch(error){if(error instanceof HomeSourceError)throw error;throw new HomeSourceError('invalid_public_snapshot');}
   const residentId=(value as PublicCondoSite)?.home?.id;
   if(typeof residentId!=='string'||!/^[a-f0-9]{16}$/.test(residentId))throw new HomeSourceError('invalid_identity','snapshot.home.id');
   site=validateHomeSnapshot(value,residentId);normalization=homeSourceMapping(value);
   stage='visible-content';const pages={} as Record<'home'|'inside'|'dreams',string>;
   for(const name of ['home','inside','dreams'] as const){path='views.'+name;pages[name]=new TextDecoder('utf-8',{fatal:true}).decode(await read(new URL(normalization.routes[name],sourceURL).href,'text/html'));}
   Object.assign(normalization,assertHomeVisible(pages,site,normalization.assets));
   readAsset=purpose=>read(new URL(normalization.assets[purpose]!,sourceURL).href,'image/png');
  }
  const images:NonNullable<HomePreflightResult['images']>=[];let imageBytes=0;
  for(const purpose of (site.dream?['home','dream']:['home']) as ('home'|'dream')[]){
   stage='images';path='assets.'+purpose;const bytes=await readAsset(purpose);let dimensions:{width:number;height:number};
   try{dimensions=await validatePNG(bytes);}catch{throw new HomeSourceError('invalid_source_image',path);}
   if(purpose==='home'?Math.abs(dimensions.width/dimensions.height-16/9)/(16/9)>=0.01:dimensions.width!==dimensions.height)throw new HomeSourceError('image_ratio_rejected',path);
   imageBytes+=bytes.length;if(imageBytes>12*1024*1024)throw new HomeSourceError('source_images_too_large',path);
   images.push({purpose,...dimensions,bytes:bytes.length,digest:await sha(bytes)});
  }
  const sourceDigest=await sha(JSON.stringify({site,normalization,images:images.map(({purpose,digest})=>({purpose,digest}))}));
  return {ready:true,sourceURL,residentId:site.home.id,sourceDigest,site,normalization,images,issues:[]};
 }catch(error){
  let code='source_read_unavailable';
  if(error instanceof HomeSourceError){code=error.code;path=error.path==='snapshot'?path:error.path;if(code==='source_visible_mismatch'||code==='unmapped_visible_content')stage='visible-content';}
  else if(error instanceof HomeDiscoveryError)code=error.code;
  else if(error instanceof MusePublicShareError){code='native_'+error.code;if(['read_unavailable','timeout','unsafe_redirect','invalid_share_url'].includes(error.code))stage='source-read';}
  return {ready:false,issues:[{stage,path,code,expected:code==='unmapped_visible_content'?'Map this complete public block, including all collection, journal, prose and artwork content, into supported fields in an inert application/json script#musecondo-home. Do not delete resident content or label it as interface decoration.':code==='date_timezone_required'?'Supply the actual source datetime with its explicit timezone (Z or UTC offset); date-only precision cannot be imported as an instant.':expected[stage]}]};
 }
}
