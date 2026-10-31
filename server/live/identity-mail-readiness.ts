import type {Database} from './db.ts';
import {hashIdentityInput,randomIdentityId} from './identity-private.ts';

interface Environment {
 db:Database;origin:string;from?:string;apiKey?:string;
 operator:(request:Request)=>Promise<boolean>;fetcher?:typeof fetch;now?:()=>Date;
}
interface CheckRow {id:string;input_hash:string;domain:string|null;state:'checking'|'complete';response_status:number;result_json:string|null}
type State='checking'|'ready'|'not_ready'|'unknown';
interface Result {
 checkId:string;state:State;reason:string;domain:string|null;domainVerified:boolean|null;
 sendingEnabled:boolean|null;senderReady:boolean|null;deliveryVerified:false;
 providerHttpStatus:number|null;providerErrorName:string|null;checkedAt:string|null;
}
class Rejection extends Error {readonly status:number;constructor(status:number,code:string){super(code);this.status=status;}}
function fail(status:number,code:string):never{throw new Rejection(status,code);}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
const path='/api/v1/operator/identity/mail-readiness',rateKey='identity-mail-provider:global';
const schema=['identity_mail_provider_checks','identity_mail_provider_audit','identity_mail_provider_check_immutable','identity_mail_provider_check_permanent','identity_mail_provider_audit_immutable','identity_mail_provider_audit_permanent'];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function canonicalOrigin(value:string){try{return value.startsWith('https://')&&new URL(value).origin===value;}catch{return false;}}
function domainName(value:unknown):string|null {
 if(typeof value!=='string'||value.length>253)return null;
 const valueLower=value.toLowerCase(),labels=valueLower.split('.');
 return labels.length>=2&&labels.every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))&&/^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/.test(labels.at(-1)!)?valueLower:null;
}
/** Conservative single dot-atom mailbox, optionally one display name. Never guess a parent domain. */
function senderDomain(value:unknown):string|null {
 if(typeof value!=='string'||value.length>320||value!==value.trim()||Array.from(value).some(c=>c.charCodeAt(0)<=31||c.charCodeAt(0)>=127&&c.charCodeAt(0)<=159)||/[\u202a-\u202e\u2066-\u2069]/.test(value))return null;
 const match=value.match(/^(?:([^<>]+) <([^<>]+)>|([^<>\s]+))$/);if(!match)return null;
 if(match[1]&&(match[1]!==match[1].trim()||Array.from(match[1]).some(c=>'(),:;@"\\[]'.includes(c))))return null;
 const address=match[2]??match[3];if(address.length>254)return null;
 const parts=address.split('@');if(parts.length!==2||parts[0].length>64||! /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+(?:\.[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~]+)*$/.test(parts[0]))return null;
 return domainName(parts[1]);
}
async function boundedText(response:Response,max:number,signal?:AbortSignal):Promise<string> {
 const reader=response.body?.getReader();if(!reader)throw new Error('body');
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 const chunks:Uint8Array[]=[];let size=0;
 try{if(signal?.aborted)throw new Error('aborted');for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max){cancel();throw new RangeError('body_too_large');}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
}
async function input(request:Request):Promise<string> {
 if(!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(request.headers.get('Content-Type')??''))fail(415,'json_required');
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>1024))fail(413,'body_too_large');
 // A one-property JSON grammar rejects duplicate keys, including escaped aliases.
 let raw:string;try{raw=await boundedText(new Response(request.body),1024);}catch(error){if(error instanceof RangeError)fail(413,'body_too_large');fail(400,'invalid_json');}
 const string='"(?:[^"\\\\\\u0000-\\u001f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*"';
 if(!new RegExp('^\\s*\\{\\s*('+string+')\\s*:\\s*('+string+')\\s*\\}\\s*$').test(raw))fail(400,'invalid_readiness_request');
 let v:unknown;try{v=JSON.parse(raw);}catch{fail(400,'invalid_json');}
 if(!object(v)||Object.keys(v).length!==1||typeof v.requestKey!=='string'||!/^[\x20-\x7e]{8,96}$/.test(v.requestKey))fail(400,'invalid_request_key');
 return v.requestKey;
}
// Only documented identifiers survive; provider messages and bodies never leave this service.
const errorNames=new Set(['missing_api_key','restricted_api_key','invalid_permission','suspended_api_key','not_found','method_not_allowed','invalid_parameter','missing_required_parameter','rate_limit_exceeded','application_error','service_unavailable','validation_error']);
const statuses=new Set(['not_started','pending','verified','failed','temporary_failure','partially_verified','partially_failed']);
const safeId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
function providerJson(raw:string):unknown {
 const value:unknown=JSON.parse(raw),scopes:(Set<string>|null)[]=[];
 // JSON.parse validates syntax first; this linear lexical pass rejects duplicate decoded names.
 for(const token of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}]|\[|\]/g)){
  if(token[0]==='{'){scopes.push(new Set());continue;}
  if(token[0]==='['){scopes.push(null);continue;}
  if(token[0]==='}'||token[0]===']'){scopes.pop();continue;}
  let offset=token.index+token[0].length;while(offset<raw.length&&/[ \t\r\n]/.test(raw[offset]))offset++;
  const names=scopes.at(-1);if(raw[offset]!==':'||!names)continue;
  const name=JSON.parse(token[0]) as string;if(names.has(name))throw new Error('duplicate_provider_field');names.add(name);
 }
 return value;
}
class ProviderFailure extends Error {readonly reason:string;readonly http:number|null;readonly providerName:string|null;constructor(reason:string,http:number|null=null,providerName:string|null=null){super(reason);this.reason=reason;this.http=http;this.providerName=providerName;}}
async function inspect(env:Environment,base:Result):Promise<{result:Result;status:number}> {
 if(base.domain===null)return {result:{...base,reason:'sender_not_configured'},status:503};
 if(typeof env.apiKey!=='string'||!env.apiKey.trim())return {result:{...base,reason:'provider_not_configured'},status:503};
 const controller=new AbortController();let timedOut=false;
 let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(new ProviderFailure('provider_timeout'));controller.abort();},15000);});
 let http:number|null=null;
 async function get(url:string):Promise<Record<string,unknown>> {
  if(controller.signal.aborted)throw new ProviderFailure('provider_timeout',http);
  let response:Response;try{response=await (env.fetcher??fetch)(url,{method:'GET',headers:{Authorization:'Bearer '+env.apiKey,Accept:'application/json','User-Agent':'MuseCondo/identity-mail-readiness'},redirect:'error',signal:controller.signal});}catch{throw new ProviderFailure('provider_unavailable');}
  http=response.status;
  let value:unknown;try{value=providerJson(await boundedText(response,response.status===200?131072:4096,controller.signal));}catch{if(response.status!==200)throw new ProviderFailure('provider_rejected',http);throw new ProviderFailure('provider_response_invalid',http);}
  if(response.status!==200)throw new ProviderFailure('provider_rejected',http,object(value)&&typeof value.name==='string'&&errorNames.has(value.name)?value.name:null);
  if(!object(value))throw new ProviderFailure('provider_response_invalid',http);return value;
 }
 async function query():Promise<Result> {
  const seen=new Set<string>();let after:string|null=null;
  for(let page=0;page<10;page++){
   const data=await get('https://api.resend.com/domains?limit=100'+(after?'&after='+encodeURIComponent(after):''));
   if(data.object!=='list'||typeof data.has_more!=='boolean'||!Array.isArray(data.data)||data.data.length>100||data.has_more&&data.data.length===0)throw new ProviderFailure('provider_pagination_invalid',http);
   let id:string|null=null;
   for(const row of data.data){if(!object(row)||!safeId(row.id)||!domainName(row.name)||seen.has(row.id))throw new ProviderFailure('provider_pagination_invalid',http);seen.add(row.id);after=row.id;if(domainName(row.name)===base.domain){if(id)throw new ProviderFailure('provider_response_invalid',http);id=row.id;}}
   if(id){
    const detail=await get('https://api.resend.com/domains/'+encodeURIComponent(id));
    if(detail.object!=='domain'||detail.id!==id||domainName(detail.name)!==base.domain||typeof detail.status!=='string'||!statuses.has(detail.status)||!object(detail.capabilities)||!['enabled','disabled'].includes(String(detail.capabilities.sending))||typeof detail.capabilities.sending!=='string')throw new ProviderFailure('provider_response_invalid',http);
    const domainVerified=detail.status==='verified',sendingEnabled=detail.capabilities.sending==='enabled',senderReady=domainVerified&&sendingEnabled;
    return {...base,state:senderReady?'ready':'not_ready',reason:senderReady?'sender_verified':!domainVerified?'domain_not_verified':'sending_disabled',domainVerified,sendingEnabled,senderReady,providerHttpStatus:http};
   }
   if(!data.has_more)return {...base,state:'not_ready',reason:'domain_missing',senderReady:false,domainVerified:false,providerHttpStatus:http};
  }
  throw new ProviderFailure('provider_pagination_bounded',http);
 }
 try{return {result:await Promise.race([query(),deadline]),status:200};}
 catch(error){const failure=timedOut?new ProviderFailure('provider_timeout',http):error instanceof ProviderFailure?error:new ProviderFailure('provider_unavailable',http);return {result:{...base,reason:failure.reason,providerHttpStatus:failure.http,providerErrorName:failure.providerName},status:502};}
 finally{clearTimeout(timer!);controller.abort();}
}

/** Metadata only. Provider credentials are used exclusively inside the deployed Function. */
export function createIdentityMailReadiness(env:Environment){
 const db=env.db,stamp=()=> (env.now?.()??new Date()).toISOString();
 const stmt=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
 const one=<T>(sql:string,...args:unknown[])=>stmt(sql,...args).first<T>();
 const lookup=(key:string)=>one<CheckRow>('SELECT id,input_hash,domain,state,response_status,result_json FROM identity_mail_provider_checks WHERE request_key_hash=?',key);
 const base=(id:string,domain:string|null):Result=>({checkId:id,state:'unknown',reason:'check_incomplete',domain,domainVerified:null,sendingEnabled:null,senderReady:null,deliveryVerified:false,providerHttpStatus:null,providerErrorName:null,checkedAt:null});
 function replay(row:CheckRow,inputHash:string):Response {
  if(row.input_hash!==inputHash)return json({error:'request_key_conflict'},409);
  return row.state==='checking'?json({...base(row.id,row.domain),state:'checking'},202):json(JSON.parse(row.result_json!),row.response_status);
 }
 return {async fetch(request:Request):Promise<Response|null>{
  const url=new URL(request.url);if(url.pathname!==path)return null;
  try{
   if(!canonicalOrigin(env.origin))fail(503,'public_origin_not_configured');
   if(url.origin!==env.origin)fail(403,'host_rejected');
   if(request.headers.has('Cookie')||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==env.origin)fail(403,'origin_rejected');
   if(request.method!=='POST')fail(405,'method_not_allowed');
   if(request.url.includes('?'))fail(400,'query_rejected');
   if(!await env.operator(request))fail(401,'operator_required');
   const requestKey=await input(request),keyHash=await hashIdentityInput(JSON.stringify(['identity-mail-provider:request',requestKey]));
   const inputHash=await hashIdentityInput(JSON.stringify(['identity-mail-provider:input',env.from??null,env.origin]));
   const objects=(await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").all<{name:string}>()).results;
   if(!schema.every(name=>objects.some(row=>row.name===name)))fail(503,'mail_readiness_unavailable');
   const old=await lookup(keyHash);if(old)return replay(old,inputHash);
   const id=randomIdentityId(),domain=senderDomain(env.from),now=stamp(),expires=new Date(Date.parse(now)+3600000).toISOString();
   try{await db.batch([
    stmt("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rate_limits WHERE key=? AND expires_at>? AND count>=10) THEN 1 ELSE json('mail-provider-quota') END",rateKey,now),
    stmt('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END',rateKey,expires,now,now),
    stmt("INSERT INTO identity_mail_provider_checks(id,request_key_hash,input_hash,domain,state,response_status,created_at) VALUES(?,?,?,?,'checking',202,?)",id,keyHash,inputHash,domain,now),
    stmt("INSERT INTO identity_mail_provider_audit(id,check_id,action,detail_json,created_at) VALUES(?,?,'intent','{}',?)",randomIdentityId(),id,now),
   ]);}catch{
    const existing=await lookup(keyHash);if(existing)return replay(existing,inputHash);
    if(await one('SELECT key FROM rate_limits WHERE key=? AND expires_at>? AND count>=10',rateKey,stamp()))fail(429,'mail_readiness_rate_limited');
    fail(503,'mail_readiness_unavailable');
   }
   const outcome=await inspect(env,base(id,domain)),result={...outcome.result,checkedAt:stamp()},encoded=JSON.stringify(result);
   try{await db.batch([
    stmt("UPDATE identity_mail_provider_checks SET state='complete',response_status=?,result_json=?,completed_at=? WHERE id=? AND state='checking'",outcome.status,encoded,result.checkedAt,id),
    stmt("INSERT INTO identity_mail_provider_audit(id,check_id,action,detail_json,created_at) VALUES(?,?,'completed',?,?)",randomIdentityId(),id,encoded,result.checkedAt),
   ]);}catch{return json({...base(id,domain),reason:'audit_unavailable'},503);}
   return json(result,outcome.status);
  }catch(error){return error instanceof Rejection?json({error:error.message},error.status):json({error:'mail_readiness_unavailable'},503);}
 }};
}
