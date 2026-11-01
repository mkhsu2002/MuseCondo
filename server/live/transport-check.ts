import {readRequestBody,RequestBodyError} from './request-body.ts';

/** Credential-free transport acknowledgment. No database, model, case or recovery capability. */
export async function transportCheck(request:Request,origin:string,timeoutMs=10000):Promise<Response|null>{
 const url=new URL(request.url);if(url.pathname!=='/api/v1/transport-check')return null;
 const reply=(value:unknown,status=200,extra:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}});
 if(url.origin!==origin||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==origin)return reply({error:'origin_rejected'},403);
 if(url.search)return reply({error:'query_not_allowed'},400);
 if(!['GET','POST'].includes(request.method))return reply({error:'method_not_allowed'},405,{Allow:'GET, POST'});
 if(['Authorization','Cookie','X-Identity-Candidate-Key','X-Tower-Agent-Key','X-Tower-Operator-Key'].some(name=>request.headers.has(name)))return reply({error:'credentials_not_allowed'},400);
 if(request.method==='POST'){
  if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({error:'json_required'},415);
  const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>256))return reply({error:'body_too_large'},413);
  try{
   const bytes=await readRequestBody(request,256,timeoutMs),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length)return reply({error:'empty_object_required'},400);
  }catch(error){return error instanceof RequestBodyError?reply({error:error.code},error.status):reply({error:'invalid_json'},400);}
 }
 const checkId=crypto.randomUUID();return reply({ok:true,method:request.method,checkId},200,{'X-Tower-Check-Id':checkId});
}
