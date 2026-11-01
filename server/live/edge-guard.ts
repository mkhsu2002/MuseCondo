export interface EdgeGuardBinding { fetch(request: Request): Promise<Response> }
export interface EdgeGuardOptions { EDGE_GUARD?: EdgeGuardBinding; EDGE_GUARD_REQUIRED?: string }
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const unavailable=()=>new Response(JSON.stringify({error:'service_temporarily_unavailable'}),{status:503,headers:{...headers,'Retry-After':'10'}});
async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
/** Called after canonical-origin validation, before any database or identity proxy. */
export async function checkEdgeGuard(request:Request,env:EdgeGuardOptions):Promise<Response|null>{
 if(!env.EDGE_GUARD)return env.EDGE_GUARD_REQUIRED==='true'?unavailable():null;
 const path=new URL(request.url).pathname;
 const kind=request.method==='GET'||request.method==='HEAD'?'read':path.replace(/\/$/,'')==='/api/v1/reception/cases'&&request.method==='POST'?'open':'write';
 const ipHash=await hash(request.headers.get('CF-Connecting-IP')??'unknown');
 const credential=request.headers.get('Authorization')??request.headers.get('X-Identity-Candidate-Key');
 const credentialHash=credential&&credential.length<=200?await hash(credential):null;
 try{
  const response=await env.EDGE_GUARD.fetch(new Request('https://edge-guard.internal/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,ipHash,credentialHash}),signal:AbortSignal.timeout(3000)}));
  if(response.status===204)return null;
  if(response.status===429)return new Response(JSON.stringify({error:'rate_limited'}),{status:429,headers:{...headers,'Retry-After':'60'}});
 }catch{/* No database fallback: binding failures must not expose unbounded backend work. */}
 return unavailable();
}
