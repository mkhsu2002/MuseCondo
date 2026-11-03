/** This private Worker owns the platform Images binding, never publication authority. */
export interface ImageOptimizationBindings {
 PUBLIC_ORIGIN:string;
 MANAGER_SCHEDULE_TRIGGER_KEY:string;
 IMAGES?:{input(stream:ReadableStream<Uint8Array>):{
  transform(options:{width:number;height:number;fit:'scale-down'}):{
   output(options:{format:'image/webp';quality:number;anim:false}):Promise<{response():Response|Promise<Response>}>;
  };
 }};
}
const PROFILE='cf-webp-1920-q85-v1',MAX_INPUT=8*1024*1024,MAX_OUTPUT=2*1024*1024;
const sha=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
async function deadline<T>(operation:Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('image_transform_timeout')),45000);})]);}finally{clearTimeout(timer);}}
async function bounded(response:Response,maximum:number){
 const declared=response.headers.get('Content-Length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maximum))throw Error('image_size');
 const reader=response.body?.getReader();if(!reader)throw Error('image_body');
 const chunks:Uint8Array[]=[],deadline=AbortSignal.timeout(30000);let size=0;
 const timed=async()=>{if(deadline.aborted)throw Error('image_timeout');return await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const fail=()=>reject(Error('image_timeout'));deadline.addEventListener('abort',fail,{once:true});reader.read().then(resolve,reject).finally(()=>deadline.removeEventListener('abort',fail));});};
 try{for(;;){const part=await timed();if(part.done)break;size+=part.value.length;if(size>maximum)throw Error('image_size');chunks.push(part.value);}}
 catch(error){try{void reader.cancel().catch(()=>{});}catch{/* Cancellation cannot change ownership. */}throw error;}
 finally{try{reader.releaseLock();}catch{/* A pending source read may retain the lock. */}}
 if(!size)throw Error('image_empty');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
function explicitRejection(error:unknown){
 if(!error||typeof error!=='object')return false;
 const code=(error as {code?:unknown}).code;
 return (typeof code==='number'&&Number.isInteger(code)||typeof code==='string')&&/^94\d{2}$/.test(String(code));
}
/** One claim can dispatch at most one transform. Upload retries reuse the exact result. */
export async function runImageOptimization(env:ImageOptimizationBindings,fetcher:typeof fetch=fetch):Promise<{pending:boolean;state:string}>{
 if(!env.IMAGES||typeof env.IMAGES.input!=='function')return {pending:false,state:'disabled'};
 let origin:URL;try{origin=new URL(env.PUBLIC_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PUBLIC_ORIGIN||!env.MANAGER_SCHEDULE_TRIGGER_KEY)throw Error('configuration');}catch{return {pending:false,state:'disabled'};}
 const call=(path:string,body:BodyInit,headers:Record<string,string>={})=>fetcher(new URL(path,origin),{method:'POST',redirect:'manual',headers:{'X-Manager-Schedule-Key':env.MANAGER_SCHEDULE_TRIGGER_KEY,...headers},body,signal:AbortSignal.timeout(45000)});
 let claimed:Response;
 try{claimed=await call('/api/v1/manager/images/claim','{}',{'Content-Type':'application/json'});}catch{return {pending:true,state:'claim_unavailable'};}
 if(claimed.status===204)return {pending:false,state:'idle'};
 if(claimed.status!==200){await claimed.body?.cancel();return {pending:claimed.status>=500,state:'claim_rejected'};}
 const id=claimed.headers.get('X-Image-Job-Id')??'',lease=claimed.headers.get('X-Image-Lease')??'',sourceSha=claimed.headers.get('X-Image-Source-Sha')??'',size=claimed.headers.get('X-Image-Source-Size')??'';
 if(!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{32}$/.test(lease)){await claimed.body?.cancel();return {pending:true,state:'claim_invalid'};}
 const failed=async(code:'transform_rejected'|'transform_unknown')=>{try{const response=await call(`/api/v1/manager/images/${id}/failed`,JSON.stringify({code}),{'Content-Type':'application/json','X-Image-Lease':lease});const accepted=response.ok;await response.body?.cancel();return accepted;}catch{return false;}};
 let source:Uint8Array<ArrayBuffer>;
 try{
  if(claimed.headers.get('Content-Type')!=='image/png'||claimed.headers.get('X-Image-Profile')!==PROFILE||!/^[a-f0-9]{64}$/.test(sourceSha)||!/^\d+$/.test(size)||Number(size)<1||Number(size)>MAX_INPUT)throw Error('source_contract');
  source=await bounded(claimed,MAX_INPUT);if(source.length!==Number(size)||await sha(source)!==sourceSha||source.length<8||source.slice(0,8).some((byte,index)=>byte!==[137,80,78,71,13,10,26,10][index]))throw Error('source_contract');
 }catch{await failed('transform_rejected');return {pending:true,state:'source_rejected'};}
 let converted:Response;
 try{
  converted=await deadline((async()=>await(await env.IMAGES!.input(new Response(source).body!).transform({width:1920,height:1920,fit:'scale-down'}).output({format:'image/webp',quality:85,anim:false})).response())());
 }catch(error){const code=explicitRejection(error)?'transform_rejected':'transform_unknown';await failed(code);return {pending:true,state:code==='transform_rejected'?'rejected':'unknown'};}
 let output:Uint8Array<ArrayBuffer>;
 try{if(!converted.ok||converted.headers.get('Content-Type')?.split(';')[0]!=='image/webp')throw Error('output_contract');output=await bounded(converted,MAX_OUTPUT);}catch{await failed('transform_unknown');return {pending:true,state:'unknown'};}
 for(let attempt=0;attempt<3;attempt++){
  try{
   const completed=await call(`/api/v1/manager/images/${id}/complete`,output,{'Content-Type':'image/webp','X-Image-Lease':lease});
   if(completed.ok){await completed.body?.cancel();return {pending:true,state:'complete'};}
   const retry=completed.status>=500;await completed.body?.cancel();if(!retry)return {pending:true,state:'completion_rejected'};
  }catch{/* Only delivery of these same bytes is retried; the transform is never repeated. */}
 }
 await failed('transform_unknown');return {pending:true,state:'unknown'};
}
