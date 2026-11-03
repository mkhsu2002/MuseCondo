import type {ImageOptimizationBindings} from './image-optimizer.ts';
import {cleanTowerWebP} from '../../server/live/tower-image-webp.ts';
const DEV_ORIGIN='https://framework-v001.musecondo.pages.dev',PROFILE='cf-webp-1920-q85-v1';
const SOURCE='iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAYAAABWKLW/AAAAHklEQVR4ARXBAQEAMAjAIKI9ms2nB5EMUVIv5fTNWVzxE7C90JZDAAAAAElFTkSuQmCC';
const SOURCE_SHA='5d3983dd12622dd7fb83eb1785f5d3f242a6394d52f688af5423a1773a8e68e1';
interface Storage {get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>}
interface Receipt {
 state:'dispatched'|'complete'|'unknown';profile:string;sourceSHA:string;grossMicroUsd:number;createdAt:string;
 completedAt?:string;providerCode?:string;outputSHA?:string;bytes?:number;width?:number;height?:number;alpha?:boolean;metadataStripped?:boolean;outputBase64?:string;
}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const sha=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
async function deadline<T>(operation:Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('codec_timeout')),45000);})]);}finally{clearTimeout(timer);}}
async function bounded(response:Response){
 const declared=response.headers.get('Content-Length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>16384))throw Error('codec_size');
 const reader=response.body?.getReader();if(!reader)throw Error('codec_body');const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384)throw Error('codec_size');chunks.push(part.value);}}
 catch(error){try{void reader.cancel().catch(()=>{});}catch{/* Cancellation must not retry the codec. */}throw error;}
 finally{try{reader.releaseLock();}catch{/* Timeout may leave a pending platform read. */}}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}
/** Authentication belongs to the enclosing private Worker. Only its configured dev
 * origin may spend the single durable codec reservation; caller Origin is unused.
 * atomic wraps only the receipt read/claim, never the potentially 45s codec call.
 */
export async function runImageCodecSmoke(env:ImageOptimizationBindings,storage:Storage,atomic:<T>(callback:()=>Promise<T>)=>Promise<T>):Promise<Response>{
 if(env.PUBLIC_ORIGIN!==DEV_ORIGIN)return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 if(!env.IMAGES||typeof env.IMAGES.input!=='function')return json({available:false,state:'disabled'},503);
 const source=Uint8Array.from(atob(SOURCE),value=>value.charCodeAt(0));
 if(await sha(source)!==SOURCE_SHA)return json({available:false,state:'disabled'},503);
 let claim:{owner:boolean;receipt:Receipt};
 try{
  claim=await atomic(async()=>{
   const prior=await storage.get<Receipt>(PROFILE);
   if(prior!==undefined)return {owner:false,receipt:prior};
   const receipt:Receipt={state:'dispatched',profile:PROFILE,sourceSHA:SOURCE_SHA,grossMicroUsd:500,createdAt:new Date().toISOString()};
   await storage.put(PROFILE,receipt);return {owner:true,receipt};
  });
 }catch{return json({profile:PROFILE,sourceSHA:SOURCE_SHA,state:'unknown',grossMicroUsd:500},503);}
 if(!claim.owner)return json(claim.receipt?.state==='dispatched'?{...claim.receipt,state:'unknown'}:claim.receipt);
 const receipt=claim.receipt;
 try{
  const output=await deadline((async()=>{
   const response=await(await env.IMAGES!.input(new Response(source).body!).transform({width:1920,height:1920,fit:'scale-down'}).output({format:'image/webp',quality:85,anim:false})).response();
   if(!response.ok||response.headers.get('Content-Type')?.split(';')[0]!=='image/webp')throw Error('codec_response');
   return cleanTowerWebP(await bounded(response));
  })());
  if(output.width!==3||output.height!==3||!output.alpha)throw Error('codec_dimensions_or_alpha');
  // The shared cleaner rejects animation and retains only VP8X/ALPH/VP8/VP8L chunks.
  const complete:Receipt={...receipt,state:'complete',completedAt:new Date().toISOString(),outputSHA:await sha(output.bytes),bytes:output.bytes.length,width:output.width,height:output.height,alpha:output.alpha,metadataStripped:true,outputBase64:btoa(String.fromCharCode(...output.bytes))};
  await storage.put(PROFILE,complete);return json(complete);
 }catch(error){
  const code=error&&typeof error==='object'?(error as {code?:unknown}).code:undefined;
  const providerCode=(typeof code==='string'||typeof code==='number')&&/^94\d{2}$/.test(String(code))?String(code):undefined;
  const unknown:Receipt={...receipt,state:'unknown',completedAt:new Date().toISOString(),...(providerCode?{providerCode}:{})};
  try{await storage.put(PROFILE,unknown);}catch{/* A dispatched receipt still permanently suppresses another call. */}
  return json(unknown);
 }
}
