import type {Database,Statement} from './db.ts';
import {createAgentId,type IdentityRecord} from '../../src/identity/index.ts';
interface Environment {db:Database;origin:string;now?:()=>Date}
interface IdentityRow {recovery_configured?:number;agent_id:string;state:string;version:number;authority_epoch:number;resident_id:string;room_id:string;created_at:string;updated_at:string}
interface Residency {account_id:string;room_id:string;resident_id:string;revision:number}
interface Authorization {accountId:string;guard:()=>Statement}
class IdentityError extends Error {
 readonly status:number;
 constructor(status:number,code:string){super(code);this.status=status;}
}
function fail(status:number,code:string):never{throw new IdentityError(status,code);}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
function metadata(row:IdentityRow){return {agentId:row.agent_id,state:row.state,version:row.version,authorityEpoch:row.authority_epoch,residentId:row.resident_id,roomId:row.room_id,createdAt:row.created_at,updatedAt:row.updated_at,recoveryConfigured:row.state==='active'&&row.recovery_configured===1,issuanceReady:false};}
async function input(request:Request){
 if(!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(request.headers.get('Content-Type')??''))fail(415,'json_required');
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>8192))fail(413,'body_too_large');
 const reader=request.body?.getReader();if(!reader)fail(400,'invalid_json');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel().catch(()=>{});fail(413,'body_too_large');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'invalid_json');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid_identity_request');
 const v=value as Record<string,unknown>,keys=['requestKey','expectedResidencyRevision','residentId','recoveryConsent'];
 if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k))||typeof v.requestKey!=='string'||!/^[\x20-\x7e]{8,96}$/.test(v.requestKey)||!Number.isSafeInteger(v.expectedResidencyRevision)||(v.expectedResidencyRevision as number)<1||typeof v.residentId!=='string'||!/^[a-f0-9]{16}$/.test(v.residentId)||v.recoveryConsent!==true)fail(400,'invalid_identity_request');
 return {requestKey:v.requestKey,expectedResidencyRevision:v.expectedResidencyRevision as number,residentId:v.residentId,recoveryConsent:true};
}
/** Only the current household's scoped Tower bearer authorizes these private endpoints. */
export function createAgentIdentity(env:Environment){
 const db=env.db,stamp=()=> (env.now?.()??new Date()).toISOString();
 const one=<T>(sql:string,...values:unknown[])=>db.prepare(sql).bind(...values).first<T>();
 const row=(account:string)=>one<IdentityRow>(`SELECT i.*,CASE WHEN i.state='active' AND EXISTS(SELECT 1 FROM identity_guardians g JOIN identity_guardian_invites v ON v.id=g.invitation_id AND v.agent_id=g.agent_id AND v.state='registered' JOIN identity_guardian_passkeys p ON p.guardian_id=g.guardian_id AND p.agent_id=g.agent_id AND p.revoked_at IS NULL JOIN identity_offline_recovery_codes c ON c.agent_id=g.agent_id AND c.consumed_at IS NULL AND c.authority_epoch=i.authority_epoch AND c.identity_version=i.version WHERE g.agent_id=i.agent_id) THEN 1 ELSE 0 END recovery_configured FROM agent_identities i WHERE i.account_id=?`,account);
 const residence=(account:string)=>one<Residency>('SELECT t.account_id,t.room_id,t.resident_id,t.revision FROM tower_residencies t JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id WHERE t.account_id=?',account);
 async function authorize(request:Request,scope:string):Promise<Authorization>{
  if(request.headers.has('Cookie'))fail(403,'separate_agent_authorization_required');
  if(request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==env.origin)fail(403,'origin_rejected');
  const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)fail(401,'tower_token_required');
  const digest=await hash(token),sql="SELECT account_id FROM tower_tokens WHERE token_hash=? AND revoked=0 AND expires_at>? AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value=?)";
  const found=await one<{account_id:string}>(sql,digest,stamp(),scope);if(!found)fail(403,'tower_scope_rejected');
  // SQL evaluates the live clock after any D1 queue delay; the bound clock also preserves injected-clock checks.
  return {accountId:found.account_id,guard:()=>db.prepare("SELECT CASE WHEN EXISTS("+sql+" AND account_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE json('identity-authorization-changed') END").bind(digest,stamp(),scope,found.account_id)};
 }
 async function verify(auth:Authorization){try{await auth.guard().first();}catch{fail(403,'authorization_changed');}}
 async function batch(auth:Authorization,statements:Statement[]){
  try{await db.batch([auth.guard(),...statements]);}catch(error){try{await auth.guard().first();}catch{fail(403,'authorization_changed');}throw error;}
 }
 async function prior(auth:Authorization,key:string,digest:string){
  const saved=await one<{operation:string;input_hash:string;response_json:string;status:number}>('SELECT operation,input_hash,response_json,status FROM identity_requests WHERE account_id=? AND request_key=?',auth.accountId,key);
  if(!saved)return null;
  if(saved.operation!=='enroll'||saved.input_hash!==digest)fail(409,'idempotency_conflict');
  await verify(auth);return json(JSON.parse(saved.response_json),saved.status);
 }
 async function rate(auth:Authorization,key:string,digest:string){
  const now=stamp(),expiry=new Date(Date.parse(now)+3600000).toISOString(),limits=[['identity:account:'+auth.accountId,20],['identity:global',1000]] as const;
  // The reservation and both counters commit together. A duplicate insert rolls the whole batch back.
  const statements:Statement[]=[db.prepare('INSERT INTO identity_rate_attempts(account_id,request_key,input_hash,created_at) VALUES(?,?,?,?)').bind(auth.accountId,key,digest,now)];
  for(const [key,max] of limits){statements.push(db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rate_limits WHERE key=? AND expires_at>? AND count>=?) THEN 1 ELSE json('identity-rate-limit') END").bind(key,now,max),db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END').bind(key,expiry,now,now));}
  try{await batch(auth,statements);}catch(error){
   if(error instanceof IdentityError)throw error;
   const reserved=await one<{input_hash:string}>('SELECT input_hash FROM identity_rate_attempts WHERE account_id=? AND request_key=?',auth.accountId,key);
   if(reserved){await verify(auth);if(reserved.input_hash!==digest)fail(409,'idempotency_conflict');return;}
   for(const [key,max] of limits)if(await one('SELECT key FROM rate_limits WHERE key=? AND expires_at>? AND count>=?',key,stamp(),max))fail(429,'identity_rate_limited');
   throw error;
  }
 }
 return {async fetch(request:Request):Promise<Response|null>{
  const url=new URL(request.url),route=url.pathname;
  if(!['/api/v1/agent/identity','/api/v1/agent/identity/record','/api/v1/agent/identity/enroll'].includes(route))return null;
  try{
   if(url.origin!==env.origin)fail(403,'host_rejected');
   const enroll=route.endsWith('/enroll');if(request.method!==(enroll?'POST':'GET'))fail(405,'method_not_allowed');
   const auth=await authorize(request,enroll?'tower:write':'tower:read');
   if(!enroll){const identity=await row(auth.accountId);await verify(auth);if(route.endsWith('/record')){if(!identity)fail(404,'identity_not_found');const record:IdentityRecord={version:'0.01',agentId:identity.agent_id,createdAt:identity.created_at};return json(record);}return json({identity:identity?metadata(identity):null});}
   const v=await input(request),digest=await hash(JSON.stringify(v)),replay=await prior(auth,v.requestKey,digest);if(replay)return replay;
   await rate(auth,v.requestKey,digest);
   if(await row(auth.accountId)){const replay=await prior(auth,v.requestKey,digest);if(replay)return replay;fail(409,'identity_already_bound');}
   const residency=await residence(auth.accountId);if(!residency||residency.resident_id!==v.residentId||residency.revision!==v.expectedResidencyRevision)fail(409,'residency_conflict');
   const createdAt=stamp(),identity:IdentityRow={agent_id:createAgentId(),state:'provisional',version:1,authority_epoch:1,resident_id:residency.resident_id,room_id:residency.room_id,created_at:createdAt,updated_at:createdAt},result={identity:metadata(identity)};
   try{await batch(auth,[
    db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_residencies t JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id WHERE t.account_id=? AND t.room_id=? AND t.resident_id=? AND t.revision=?) AND NOT EXISTS(SELECT 1 FROM agent_identities WHERE account_id=?) AND (SELECT COUNT(*) FROM agent_identities)<10000 THEN 1 ELSE json('identity-binding-conflict') END").bind(auth.accountId,residency.room_id,v.residentId,v.expectedResidencyRevision,auth.accountId),
    db.prepare("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,version,authority_epoch,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,1,1,'provisional',1,?,?)").bind(identity.agent_id,auth.accountId,identity.room_id,identity.resident_id,createdAt,createdAt),
    db.prepare("INSERT INTO identity_audit(id,agent_id,action,detail_json,created_at) VALUES(?,?,'enrolled','{}',?)").bind(crypto.randomUUID(),identity.agent_id,createdAt),
    db.prepare("INSERT INTO identity_requests(account_id,request_key,operation,input_hash,response_json,status,created_at) VALUES(?,?,'enroll',?,?,201,?)").bind(auth.accountId,v.requestKey,digest,JSON.stringify(result),createdAt),
   ]);}catch(error){
    if(error instanceof IdentityError)throw error;
    const replay=await prior(auth,v.requestKey,digest);if(replay)return replay;
    if(await row(auth.accountId))fail(409,'identity_already_bound');
    const latest=await residence(auth.accountId);if(!latest||latest.room_id!==residency.room_id||latest.resident_id!==v.residentId||latest.revision!==v.expectedResidencyRevision)fail(409,'residency_conflict');
    if(await one('SELECT 1 FROM agent_identities LIMIT 1 OFFSET 9999'))fail(409,'identity_capacity_reached');
    throw error;
   }
   return json(result,201);
  }catch(error){return error instanceof IdentityError?json({error:error.message},error.status):json({error:'identity_operation_unavailable'},503);}
 }};
}
