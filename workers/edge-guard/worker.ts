interface Limiter {limit(input:{key:string}):Promise<{success:boolean}>}
export interface EdgeBindings { BURST:Limiter; READ_IP:Limiter; WRITE_IP:Limiter; OPEN_IP:Limiter; READ_KEY:Limiter; WRITE_KEY:Limiter; GLOBAL:Limiter }
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const fail=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers:{...headers,'Retry-After':status===429?'60':'10'}});
/** Private service only. No database, provider, credentials, body forwarding or network calls. */
export default {async fetch(request:Request,env:EdgeBindings):Promise<Response>{
 if(request.method!=='POST'||new URL(request.url).pathname!=='/check')return fail(404,'not_found');
 const raw=await request.text();if(raw.length>256)return fail(413,'body_too_large');
 let v:{kind:string;ipHash:string;credentialHash:string|null};
 try{v=JSON.parse(raw);if(!v||Object.keys(v).sort().join(',')!=='credentialHash,ipHash,kind'||!['read','write','open'].includes(v.kind)||!/^[a-f0-9]{64}$/.test(v.ipHash)||v.credentialHash!==null&&!/^[a-f0-9]{64}$/.test(v.credentialHash))return fail(400,'invalid_fields');}catch{return fail(400,'invalid_fields');}
 try{
  const checks:[Limiter,string][]=[[env.GLOBAL,'all'],[env.BURST,v.ipHash],[v.kind==='open'?env.OPEN_IP:v.kind==='read'?env.READ_IP:env.WRITE_IP,v.ipHash]];
  if(v.credentialHash)checks.push([v.kind==='read'?env.READ_KEY:env.WRITE_KEY,v.credentialHash]);
  for(const [limiter,key]of checks)if(!(await limiter.limit({key})).success)return fail(429,'rate_limited');
  return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
 }catch{return fail(503,'service_temporarily_unavailable');}
}};
