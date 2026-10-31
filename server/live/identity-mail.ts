import type {Database} from './db.ts';
import {decryptPrivate,hashPrivate,randomIdentityId,validContactKey,validateGuardianEmail} from './identity-private.ts';
export interface IdentityMailEnvironment {db:Database;origin:string;contactKey?:string;apiKey?:string;from?:string;fetcher?:typeof fetch;now?:()=>Date}
interface MailRow {id:string;kind:string;entity_id:string;recipient_ciphertext:string;recipient_hash:string;payload_ciphertext:string;state:string;provider_id:string|null;attempt_count:number;error_code:string|null}
interface Invitation {agent_id:string;recipient_ciphertext:string;email_hash:string;invite_token_hash:string}
export interface IdentityMailStatus {id:string;state:string;providerId:string|null;attemptCount:number;errorCode:string|null}
function trustedOrigin(value:string){try{return new URL(value).origin===value&&value.startsWith('https://');}catch{return false;}}
function sender(value:unknown):value is string{return typeof value==='string'&&value.length<=320&&value.trim().length>0&&!/[\r\n]/.test(value)&&/^(?:[^<>]+ <)?[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>?$/.test(value);}
// Keep only documented error identifiers; even ASCII provider fields must not reflect secrets.
// https://resend.com/docs/api-reference/errors
const providerErrorNames=new Set(['invalid_idempotency_key','validation_error','missing_api_key','restricted_api_key','email_above_quota','invalid_permission','suspended_api_key','not_found','method_not_allowed','concurrent_idempotent_requests','invalid_idempotent_request','resource_locked','invalid_attachment','invalid_parameter','missing_required_field','missing_required_parameter','daily_quota_exceeded','monthly_quota_exceeded','rate_limit_exceeded','application_error','service_unavailable']);
async function rejectionName(response:Response):Promise<string|null>{
 const reader=response.body?.getReader();if(!reader)return null;const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel().catch(()=>{});return null;}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return data&&typeof data.name==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(data.name)&&providerErrorNames.has(data.name)?data.name:null;
 }catch{return null;}finally{reader.releaseLock();}
}
/** This service only consumes stored events; callers cannot provide recipients or message content. */
export function createIdentityMail(env:IdentityMailEnvironment){
 const db=env.db,stamp=()=> (env.now?.()??new Date()).toISOString();
 const configured=()=>validContactKey(env.contactKey)&&typeof env.apiKey==='string'&&env.apiKey.trim().length>0&&sender(env.from)&&trustedOrigin(env.origin);
 const one=<T>(sql:string,...values:unknown[])=>db.prepare(sql).bind(...values).first<T>();
 async function status(id:string):Promise<IdentityMailStatus|null>{const r=await one<MailRow>('SELECT id,state,provider_id,attempt_count,error_code FROM identity_mail_events WHERE id=?',id);return r?{id:r.id,state:r.state,providerId:r.provider_id,attemptCount:r.attempt_count,errorCode:r.error_code}:null;}
 // Both injected and native clocks are checked after any database queue delay.
 const validSql="SELECT g.agent_id,g.recipient_ciphertext,g.email_hash,g.invite_token_hash FROM identity_guardian_invites g JOIN agent_identities i ON i.agent_id=g.agent_id AND i.account_id=g.account_id JOIN tower_residencies t ON t.account_id=i.account_id AND t.room_id=i.room_id AND t.resident_id=i.resident_id JOIN rooms r ON r.id=i.room_id AND r.account_id=i.account_id WHERE g.id=? AND g.state='accepted' AND i.state='provisional' AND i.recovery_consent=1 AND i.version=g.identity_version AND i.authority_epoch=g.authority_epoch AND strftime('%Y-%m-%dT%H:%M:%fZ',g.created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',g.created_at)=g.created_at AND strftime('%Y-%m-%dT%H:%M:%fZ',g.expires_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',g.expires_at)=g.expires_at AND strftime('%Y-%m-%dT%H:%M:%fZ',g.created_at,'+24 hours') IS NOT NULL AND g.expires_at>g.created_at AND g.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',g.created_at,'+24 hours') AND g.created_at<=? AND g.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.expires_at>? AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.email_hash=? AND g.recipient_ciphertext=?";
 async function finish(id:string,state:string,error:string|null,provider:string|null=null){
  await db.batch([
   db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_mail_events WHERE id=? AND state='sending') THEN 1 ELSE json('mail-lease-changed') END").bind(id),
   db.prepare("UPDATE identity_mail_events SET state=?,error_code=?,provider_id=?,updated_at=? WHERE id=? AND state='sending'").bind(state,error,provider,stamp(),id),
   db.prepare('INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) VALUES(?,?,?, ?,?)').bind(randomIdentityId(),id,state,JSON.stringify(error?{code:error}:{}),stamp()),
  ]);
 }
 async function cancelPending(id:string,code:string){
  try{await db.batch([
   db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_mail_events WHERE id=? AND state='pending') THEN 1 ELSE json('mail-lease-changed') END").bind(id),
   db.prepare("UPDATE identity_mail_events SET state='cancelled',error_code=?,updated_at=? WHERE id=? AND state='pending'").bind(code,stamp(),id),
   db.prepare("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) VALUES(?,?,'cancelled',?,?)").bind(randomIdentityId(),id,JSON.stringify({code}),stamp()),
  ]);}catch{/* A competing worker owns the event; never send from this invocation. */}
 }
 return {configured,status,async processOne(id:string):Promise<IdentityMailStatus|null>{
  if(!/^[a-f0-9]{32}$/.test(id))return null;
  const event=await one<MailRow>('SELECT * FROM identity_mail_events WHERE id=?',id);if(!event)return null;
  if(event.state!=='pending'||!configured())return status(id);
  // Reserved I05 templates stay pending; pending never means notification delivered.
  if(event.kind==='security-notice'||event.kind==='identity-card')return status(id);
  if(event.kind!=='guardian-invitation'){await cancelPending(id,'unsupported_event');return status(id);}
  const invite=await one<Invitation>(validSql,event.entity_id,stamp(),stamp(),event.recipient_hash,event.recipient_ciphertext);
  if(!invite){await cancelPending(id,'invitation_unavailable');return status(id);}
  let email:string,token:string;
  try{
   email=validateGuardianEmail(await decryptPrivate(env.contactKey!,'guardian-recipient',invite.agent_id,event.recipient_ciphertext));
   const payload=JSON.parse(await decryptPrivate(env.contactKey!,'mail-payload',id,event.payload_ciphertext));
   if(!payload||Object.keys(payload).length!==1||typeof payload.token!=='string'||!/^[a-f0-9]{64}$/.test(payload.token))throw new Error('payload');token=payload.token;
   if(await hashPrivate(env.contactKey!,'guardian-email',email)!==event.recipient_hash||await hashPrivate(env.contactKey!,'guardian-confirmation:'+event.entity_id,token)!==invite.invite_token_hash)throw new Error('contact');
  }catch{await cancelPending(id,'private_payload_unavailable');return status(id);}
  try{await db.batch([
   db.prepare("SELECT CASE WHEN EXISTS("+validSql+" AND g.invite_token_hash=?) AND EXISTS(SELECT 1 FROM identity_mail_events WHERE id=? AND state='pending' AND payload_ciphertext=? AND recipient_hash=? AND recipient_ciphertext=? AND kind='guardian-invitation' AND entity_id=?) THEN 1 ELSE json('mail-lease-changed') END").bind(event.entity_id,stamp(),stamp(),event.recipient_hash,event.recipient_ciphertext,invite.invite_token_hash,id,event.payload_ciphertext,event.recipient_hash,event.recipient_ciphertext,event.entity_id),
   db.prepare("UPDATE identity_mail_events SET state='sending',attempt_count=attempt_count+1,lease_started_at=?,updated_at=? WHERE id=? AND state='pending'").bind(stamp(),stamp(),id),
   db.prepare("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) VALUES(?,?,'sending','{}',?)").bind(randomIdentityId(),id,stamp()),
  ]);}catch{if(!await one<Invitation>(validSql+' AND g.invite_token_hash=?',event.entity_id,stamp(),stamp(),event.recipient_hash,event.recipient_ciphertext,invite.invite_token_hash))await cancelPending(id,'invitation_unavailable');return status(id);}
  if(!await one<Invitation>(validSql+' AND g.invite_token_hash=?',event.entity_id,stamp(),stamp(),event.recipient_hash,event.recipient_ciphertext,invite.invite_token_hash)){await finish(id,'cancelled','invitation_unavailable');return status(id);}
  let state='unknown',error:string|null='provider_outcome_unknown',provider:string|null=null;
  try{
   const response=await (env.fetcher??fetch)('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.apiKey,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:env.from,to:[email],subject:'MuseCondo 監護人確認邀請',text:'你收到一份 MuseCondo 監護人邀請。\n\nAgent ID：'+invite.agent_id+'\n\n邀請識別碼：'+event.entity_id+'\n\n短效初次確認碼：'+token+'\n\n請僅在官方入口 '+env.origin+'/identity 分別貼上以上兩組代碼。確認碼最長有效 24 小時，並非長期復原碼。若你未預期收到此邀請，請忽略此信。'}),signal:AbortSignal.timeout(15000),redirect:'error'});
   if(response.ok){const data=await response.json() as {id?:unknown};if(data&&typeof data.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(data.id)){state='accepted';error=null;provider=data.id;}}
   else if(response.status>=400&&response.status<500&&![408,409,425,429].includes(response.status)){state='failed';const name=await rejectionName(response);error='provider_rejected_'+response.status+(name?':'+name:'');}
  }catch{/* Provider response may be ambiguous; do not retain its body or retry automatically. */}
  // A crash after provider acceptance leaves 'sending'; neither sending nor unknown is blindly retried.
  await finish(id,state,error,provider);return status(id);
 }};
}
