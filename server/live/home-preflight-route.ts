import {readAdmissionStatus,admissionRejection} from './admission-status.ts';
import type {Database} from './db.ts';
import {digest} from './app.ts';
import {publicHomeURL} from './home-discovery.ts';
import {inspectHomePreflight} from './home-preflight.ts';
import {readRequestBody} from './request-body.ts';
export function createHomePreflightRoute(env:{db:Database;origin:string;inspect?:typeof inspectHomePreflight;sourceFetch?:typeof fetch;now?:()=>Date}){
 const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
 return async(request:Request):Promise<Response|null>=>{
  const u=new URL(request.url);if(u.pathname!=='/api/v1/reception/preflight')return null;
  if(u.origin!==env.origin||request.headers.has('Cookie')||request.headers.has('Authorization')||request.headers.has('Origin')&&request.headers.get('Origin')!==env.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({error:'preflight_transport_rejected'},403);
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
  if(u.search||request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')return reply({error:'invalid_fields'},400);
  let homeURL:string;
  try{const raw=await readRequestBody(request,2048,10000),v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).join(',')!=='homeURL')throw Error();homeURL=publicHomeURL(v.homeURL).href;}catch{return reply({error:'invalid_fields'},400);}
  const admission=await readAdmissionStatus(env.db,env.origin);if(admission.status!=='accepting')return reply(admissionRejection(admission),503);
  const now=env.now?.()??new Date(),hour=Math.floor(now.getTime()/3600000),expires=new Date((hour+1)*3600000).toISOString(),client=await digest(request.headers.get('CF-Connecting-IP')??'unknown');
  try{await env.db.batch([['ip:'+client,12],['global',120]].flatMap(([scope,max])=>[
   env.db.prepare("INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1").bind('home-preflight:'+scope+':'+hour,expires),
   env.db.prepare("SELECT CASE WHEN (SELECT count FROM rate_limits WHERE key=?)<=? THEN 1 ELSE json('preflight-rate-limit') END").bind('home-preflight:'+scope+':'+hour,max),
  ]));}catch{return reply({error:'preflight_rate_limited'},429);}
  let inspected;try{inspected=await (env.inspect??inspectHomePreflight)(homeURL,env.sourceFetch);}catch{return reply({error:'preflight_unavailable'},503);}
  const {ready,sourceURL,residentId,sourceDigest,issues,normalization,images}=inspected;
  return reply({preflight:{ready,sourceURL,residentId,sourceDigest,issues,normalization,images}});
 };
}
