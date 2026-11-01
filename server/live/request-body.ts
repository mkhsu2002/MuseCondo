export class RequestBodyError extends Error {
 readonly status:number;
 readonly code:string;
 constructor(status:number,code:string){super(code);this.name='RequestBodyError';this.status=status;this.code=code;}
}

/** Bound both bytes and total time, including a source that never closes. */
export async function readRequestBody(request:Request,maxBytes:number,timeoutMs=10000):Promise<Uint8Array>{
 const reader=request.body?.getReader();
 if(!reader)throw new RequestBodyError(400,'invalid_json');
 const duration=Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,10000):10000;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new RequestBodyError(408,'body_read_timeout')),duration);});
 const chunks:Uint8Array[]=[];
 let size=0;
 try{
  for(;;){
   const part=await Promise.race([reader.read(),deadline]);
   if(part.done)break;
   size+=part.value.length;
   if(size>maxBytes)throw new RequestBodyError(413,'body_too_large');
   chunks.push(part.value);
  }
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
 }catch(error){
  // Cancellation is best effort: an uncooperative source must not delay the response.
  try{void reader.cancel().catch(()=>{});}catch{/* The reader may already be closed. */}
  throw error;
 }finally{
  clearTimeout(timer);
  try{reader.releaseLock();}catch{/* A pending source read may retain the lock. */}
 }
}
