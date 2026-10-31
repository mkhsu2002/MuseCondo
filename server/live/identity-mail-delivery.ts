export const IDENTITY_MAIL_DELIVERY_SCHEMA=["identity_mail_delivery_receipts", "identity_mail_delivery_receipt_binding", "identity_mail_delivery_receipt_immutable", "identity_mail_delivery_receipt_permanent", "identity_mail_delivery_facts", "identity_mail_delivery_fact_binding", "identity_mail_delivery_fact_immutable", "identity_mail_delivery_fact_permanent", "identity_mail_delivery_audit", "identity_mail_delivery_audit_binding", "identity_mail_delivery_audit_immutable", "identity_mail_delivery_audit_permanent"] as const;
import type {Database} from './db.ts';
import {decryptPrivate,hashPrivate,validContactKey,validateGuardianEmail} from './identity-private.ts';
import {senderDomain} from './identity-mail-readiness.ts';

/** Private deployment dependency: deliberately has no API key, fetcher or provider endpoint. */
export interface IdentityMailDeliveryEnvironment {
 db:Database;origin:string;contactKey:string;now?:()=>Date;
 webhookSecret:string|(()=>Promise<string>);
}
type Source='webhook'|'readback';
type Fact='delivered'|'bounced'|'complained'|'failed'|'suppressed';
type Signal=Fact|'accepted';
interface Flags {delivered:boolean;bounced:boolean;complained:boolean;failed:boolean;suppressed:boolean}
export interface IdentityMailDeliveryResult {
 eventId:string;state:string;flags:Flags;deliveryVerified:boolean;observedAt:string;
 suppressionReason:'previous_bounce'|'previous_complaint'|'unknown'|null;
 suppressionType:'Suppressed'|'OnAccountSuppressionList'|'unknown'|null;
}
interface Receipt {event_id:string;payload_hmac:string;result_json:string}
interface Frozen {id:string;kind:string;entity_id:string;dedupe_key:string;recipient_ciphertext:string;recipient_hash:string;payload_ciphertext:string;created_at:string;provider_id:string|null;metadata_ciphertext:string;template_version:string;attachment_refs:string;body_digest:string;body_length:number;lease_id:string;dispatch_created_at:string}
interface Control {row:Frozen;recipient:string;from:string;subject:string}
class DeliveryError extends Error {readonly status:number;constructor(status:number,code:string){super(code);this.status=status;}}
function fail(status:number,code:string):never{throw new DeliveryError(status,code);}
const encoder=new TextEncoder(),maxBytes=65536;
const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const eventId=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const canonicalOrigin=(v:string)=>{try{return v.startsWith('https://')&&new URL(v).origin===v;}catch{return false;}};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const providerTime=(v:unknown):v is string=>typeof v==='string'&&v.length<=64&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
const facts:Fact[]=['delivered','bounced','complained','failed','suppressed'];
function unbase64(v:string,min:number,max:number):Uint8Array<ArrayBuffer>|null {
 if(v.length>Math.ceil(max/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/.test(v))return null;
 try{const bytes=Uint8Array.from(atob(v),c=>c.charCodeAt(0));if(bytes.length<min||bytes.length>max||btoa(String.fromCharCode(...bytes)).replace(/=+$/,'')!==v.replace(/=+$/,''))return null;return bytes;}catch{return null;}
}
function headersValid(headers:Headers):{id:string;timestamp:string;signature:string}|null {
 const id=headers.get('svix-id'),timestamp=headers.get('svix-timestamp'),signature=headers.get('svix-signature');
 return safeId(id)&&typeof timestamp==='string'&&/^[1-9][0-9]{0,10}$/.test(timestamp)&&typeof signature==='string'&&signature.length>0&&signature.length<=4096?{id,timestamp,signature}:null;
}
/** Verifies the unchanged raw bytes with WebCrypto constant-time HMAC verification. */
export async function verifyIdentityMailWebhook(raw:Uint8Array<ArrayBuffer>,headers:Headers,secret:string,now:Date):Promise<boolean>{
 const h=headersValid(headers);if(!h||raw.length>maxBytes||!Number.isFinite(now.getTime())||Math.abs(now.getTime()/1000-Number(h.timestamp))>300||typeof secret!=='string'||!secret.startsWith('whsec_'))return false;
 const key=unbase64(secret.slice(6),1,512);if(!key)return false;
 const prefix=encoder.encode(h.id+'.'+h.timestamp+'.'),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);
 const hmac=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['verify']);
 for(const candidate of h.signature.split(' ')){if(!candidate.startsWith('v1,'))continue;const bytes=unbase64(candidate.slice(3),32,32);if(bytes&&await crypto.subtle.verify('HMAC',hmac,bytes,signed))return true;}
 return false;
}
function mailbox(v:unknown):string|null {
 if(!senderDomain(v))return null;const s=v as string;return (s.match(/ <([^<>]+)>$/)?.[1]??s).toLowerCase();
}
function recipient(v:unknown):string|null {try{const parsed=validateGuardianEmail(v);return parsed.toLowerCase();}catch{return null;}}
function tag(tags:unknown,array:boolean):string|null {
 if(array){if(!Array.isArray(tags)||tags.length>100)return null;const found=tags.filter(v=>object(v)&&v.name==='identity_event');return found.length===1&&eventId(found[0].value)?found[0].value:null;}
 return object(tags)&&eventId(tags.identity_event)?tags.identity_event:null;
}
function parse(raw:Uint8Array<ArrayBuffer>):unknown {
 // ignoreBOM=true preserves the leading BOM as U+FEFF: JSON.parse then rejects it;
 // it never silently changes a signed payload before parsing.
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw),value:unknown=JSON.parse(text),scopes:(Set<string>|null)[]=[];
 for(const token of text.matchAll(/"(?:[^"\\]|\\.)*"|[{}]|\[|\]/g)){
  if(token[0]==='{'){scopes.push(new Set());continue;}if(token[0]==='['){scopes.push(null);continue;}if(token[0]==='}'||token[0]===']'){scopes.pop();continue;}
  let offset=token.index+token[0].length;while(offset<text.length&&/[ \t\r\n]/.test(text[offset]))offset++;
  const names=scopes.at(-1);if(text[offset]===':'&&names){const name=JSON.parse(token[0]) as string;if(names.has(name))throw Error('duplicate');names.add(name);}
 }
 return value;
}
async function rawBody(request:Request):Promise<Uint8Array<ArrayBuffer>> {
 const length=request.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))fail(413,'webhook_body_rejected');
 const reader=request.body?.getReader();if(!reader)fail(400,'webhook_body_rejected');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>maxBytes){await reader.cancel();fail(413,'webhook_body_rejected');}chunks.push(p.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}

/** Dormant server-only core. Callers must never expose applyReadback or frozen controls publicly. */
export function createIdentityMailDelivery(env:IdentityMailDeliveryEnvironment){
 const db=env.db,stamp=()=>(env.now?.()??new Date()).toISOString();
 const stmt=(sql:string,...values:unknown[])=>db.prepare(sql).bind(...values);
 const one=<T>(sql:string,...values:unknown[])=>stmt(sql,...values).first<T>();
 function configured(){if(!canonicalOrigin(env.origin)||!validContactKey(env.contactKey))fail(503,'delivery_unavailable');}
 const stored=(source:Source,id:string)=>one<Receipt>('SELECT event_id,payload_hmac,result_json FROM identity_mail_delivery_receipts WHERE source=? AND message_id=? AND origin=?',source,id,env.origin);
 const payloadHmac=(source:Source,id:string,event:string,raw:Uint8Array)=>hashPrivate(env.contactKey,'mail-delivery:'+env.origin+':'+event+':'+source+':'+id,btoa(String.fromCharCode(...raw)));
 async function receipt(source:Source,id:string):Promise<IdentityMailDeliveryResult|null>{configured();if(!['webhook','readback'].includes(source)||!safeId(id))fail(400,'delivery_control_rejected');const old=await stored(source,id);return old?JSON.parse(old.result_json) as IdentityMailDeliveryResult:null;}
 async function historical(id:string):Promise<Control|null>{
  const row=await one<Frozen>('SELECT e.*,v.metadata_ciphertext,v.template_version,v.attachment_refs,v.body_digest,v.body_length,d.lease_id,d.created_at dispatch_created_at FROM identity_mail_events e JOIN identity_mail_envelopes v ON v.event_id=e.id JOIN identity_mail_dispatches d ON d.event_id=e.id AND d.body_digest=v.body_digest AND d.body_length=v.body_length WHERE e.id=?',id);
  if(!row)return null;
  try{
   const m:unknown=JSON.parse(await decryptPrivate(env.contactKey,'mail-envelope',id,row.metadata_ciphertext));
   if(!object(m)||m.version!==1||m.origin!==env.origin||typeof m.binding!=='string'||typeof m.text!=='string'||typeof m.subject!=='string'||m.subject.length>512||!senderDomain(m.from)||!recipient(m.to)||validateGuardianEmail(m.to)!==m.to||typeof m.templateVersion!=='string'||m.templateVersion!==row.template_version||!Array.isArray(m.attachmentRefs)||JSON.stringify(m.attachmentRefs)!==row.attachment_refs)return null;
   const b:unknown=JSON.parse(m.binding);if(!object(b)||!object(b.e)||!object(b.i)||!eventId(row.id))return null;
   for(const k of ['id','kind','entity_id','dedupe_key','recipient_ciphertext','recipient_hash','payload_ciphertext','created_at'] as const)if(b.e[k]!==row[k])return null;
   if(typeof b.i.agent_id!=='string'||typeof b.i.account_id!=='string'||typeof b.i.room_id!=='string'||typeof b.i.resident_id!=='string')return null;
   return {row,recipient:m.to as string,from:m.from as string,subject:m.subject};
  }catch{return null;}
 }
 async function apply(source:Source,id:string,email:Record<string,unknown>,signal:Signal,raw:Uint8Array<ArrayBuffer>,timestamp?:string):Promise<IdentityMailDeliveryResult|{ignored:true}>{
  const old=await stored(source,id);if(old){if(old.payload_hmac!==await payloadHmac(source,id,old.event_id,raw))fail(409,'delivery_receipt_conflict');return JSON.parse(old.result_json) as IdentityMailDeliveryResult;}
  const event=tag(email.tags,source==='readback'),provider=source==='webhook'?email.email_id:email.id;
  if(!event||!safeId(provider))return {ignored:true};
  const c=await historical(event);if(!c||c.row.provider_id!==null&&c.row.provider_id!==provider||mailbox(email.from)!==mailbox(c.from)||!Array.isArray(email.to)||email.to.length!==1||recipient(email.to[0])!==recipient(c.recipient)||email.subject!==c.subject)return {ignored:true};
  if(await one('SELECT 1 FROM identity_mail_events WHERE id!=? AND provider_id=? LIMIT 1',event,provider))return {ignored:true};
  const hmac=await payloadHmac(source,id,event,raw),recipientHash=await hashPrivate(env.contactKey,'mail-suppression',c.recipient.toLowerCase());
  const suppressed=signal==='suppressed',detail=object(email.suppressed)?email.suppressed:null;
  const suppressionReason=suppressed?(detail?.reason==='previous_bounce'?'previous_bounce':detail?.reason==='previous_complaint'?'previous_complaint':'unknown'):null;
  const suppressionType=suppressed?(detail?.type==='Suppressed'?'Suppressed':detail?.type==='OnAccountSuppressionList'?'OnAccountSuppressionList':'unknown'):null;
  const block=signal==='bounced'?'bounce':signal==='complained'?'complaint':suppressed?(suppressionReason==='previous_bounce'?'bounce':suppressionReason==='previous_complaint'?'complaint':'manual'):null;
  const time=stamp();if(timestamp&&Math.abs(Date.parse(time)/1000-Number(timestamp))>300)fail(400,'webhook_verification_failed');
  const resultSql="json_object('eventId',e.id,'state',e.state,'flags',json_object('delivered',json(CASE WHEN EXISTS(SELECT 1 FROM identity_mail_delivery_facts WHERE event_id=e.id AND fact='delivered') THEN 'true' ELSE 'false' END),'bounced',json(CASE WHEN EXISTS(SELECT 1 FROM identity_mail_delivery_facts WHERE event_id=e.id AND fact='bounced') THEN 'true' ELSE 'false' END),'complained',json(CASE WHEN EXISTS(SELECT 1 FROM identity_mail_delivery_facts WHERE event_id=e.id AND fact='complained') THEN 'true' ELSE 'false' END),'failed',json(CASE WHEN EXISTS(SELECT 1 FROM identity_mail_delivery_facts WHERE event_id=e.id AND fact='failed') THEN 'true' ELSE 'false' END),'suppressed',json(CASE WHEN EXISTS(SELECT 1 FROM identity_mail_delivery_facts WHERE event_id=e.id AND fact='suppressed') THEN 'true' ELSE 'false' END)),'deliveryVerified',json(CASE WHEN EXISTS(SELECT 1 FROM identity_mail_delivery_facts WHERE event_id=e.id AND fact='delivered') AND NOT EXISTS(SELECT 1 FROM identity_mail_delivery_facts WHERE event_id=e.id AND fact!='delivered') AND e.state='delivered' THEN 'true' ELSE 'false' END),'observedAt',?,'suppressionReason',?,'suppressionType',?)";
  const commands=[stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_mail_events e JOIN identity_mail_envelopes v ON v.event_id=e.id JOIN identity_mail_dispatches d ON d.event_id=e.id AND d.body_digest=v.body_digest AND d.body_length=v.body_length WHERE e.id=? AND v.metadata_ciphertext=? AND v.body_digest=? AND v.body_length=? AND d.lease_id=? AND (e.provider_id IS NULL OR e.provider_id=?) AND e.kind=? AND e.entity_id=? AND e.dedupe_key=? AND e.recipient_ciphertext=? AND e.recipient_hash=? AND e.payload_ciphertext=? AND e.created_at=?) AND NOT EXISTS(SELECT 1 FROM identity_mail_delivery_receipts WHERE source=? AND message_id=?) AND NOT EXISTS(SELECT 1 FROM identity_mail_events WHERE id!=? AND provider_id=?) AND (? IS NULL OR ABS(ROUND((julianday(strftime('%Y-%m-%dT%H:%M:%fZ','now'))-2440587.5)*86400000)-CAST(? AS INTEGER)*1000)<=300000) THEN 1 ELSE json('mail-delivery-context-changed') END",event,c.row.metadata_ciphertext,c.row.body_digest,c.row.body_length,c.row.lease_id,provider,c.row.kind,c.row.entity_id,c.row.dedupe_key,c.row.recipient_ciphertext,c.row.recipient_hash,c.row.payload_ciphertext,c.row.created_at,source,id,event,provider,timestamp??null,timestamp??null)];
  if(signal!=='accepted')commands.push(stmt('INSERT INTO identity_mail_delivery_facts(event_id,fact,observed_at) VALUES(?,?,?) ON CONFLICT(event_id,fact) DO NOTHING',event,signal,time));
  if(block)commands.push(stmt('INSERT INTO identity_mail_suppressions(recipient_hash,reason,created_at) VALUES(?,?,?) ON CONFLICT(recipient_hash) DO NOTHING',recipientHash,block,time));
  commands.push(stmt("UPDATE identity_mail_events SET provider_id=COALESCE(provider_id,?),state=CASE WHEN state='bounced' OR EXISTS(SELECT 1 FROM identity_mail_delivery_facts WHERE event_id=? AND fact IN ('bounced','complained')) THEN 'bounced' WHEN state='failed' OR EXISTS(SELECT 1 FROM identity_mail_delivery_facts WHERE event_id=? AND fact IN ('failed','suppressed')) THEN 'failed' WHEN state='delivered' OR EXISTS(SELECT 1 FROM identity_mail_delivery_facts WHERE event_id=? AND fact='delivered') THEN 'delivered' WHEN state IN ('sending','unknown') THEN 'accepted' ELSE state END,updated_at=? WHERE id=?",provider,event,event,event,time,event));
  commands.push(stmt('INSERT INTO identity_mail_delivery_receipts(source,origin,message_id,event_id,provider_id,payload_hmac,result_json,observed_at) SELECT ?,?,?,?,?,?, '+resultSql+',? FROM identity_mail_events e WHERE e.id=?',source,env.origin,id,event,provider,hmac,time,suppressionReason,suppressionType,time,event));
  commands.push(stmt('INSERT INTO identity_mail_delivery_audit(source,message_id,event_id,signal,detail_json,observed_at) SELECT source,message_id,event_id,?,result_json,observed_at FROM identity_mail_delivery_receipts WHERE source=? AND message_id=?',signal,source,id));
  try{await db.batch(commands);}catch{
   const saved=await stored(source,id);if(saved){if(saved.payload_hmac!==hmac)fail(409,'delivery_receipt_conflict');return JSON.parse(saved.result_json) as IdentityMailDeliveryResult;}
   fail(503,'delivery_unavailable');
  }
  const saved=await stored(source,id);if(!saved)fail(503,'delivery_unavailable');return JSON.parse(saved.result_json) as IdentityMailDeliveryResult;
 }
 async function status(id:string):Promise<IdentityMailDeliveryResult|null>{
  configured();if(!eventId(id))fail(400,'delivery_control_rejected');if(!await historical(id))return null;
  const e=await one<{state:string;updated_at:string}>('SELECT state,updated_at FROM identity_mail_events WHERE id=?',id);if(!e)return null;
  const rows=(await stmt('SELECT fact,observed_at FROM identity_mail_delivery_facts WHERE event_id=?',id).all<{fact:Fact;observed_at:string}>()).results;
  const flags=Object.fromEntries(facts.map(f=>[f,rows.some(r=>r.fact===f)])) as unknown as Flags;
  return {eventId:id,state:e.state,flags,deliveryVerified:e.state==='delivered'&&flags.delivered&&!rows.some(r=>r.fact!=='delivered'),observedAt:rows.map(r=>r.observed_at).sort().at(-1)??e.updated_at,suppressionReason:null,suppressionType:null};
 }
 async function readback(opId:string,providerEmail:unknown){
  configured();if(!safeId(opId)||!object(providerEmail))fail(400,'delivery_control_rejected');
  let raw:Uint8Array<ArrayBuffer>;try{raw=encoder.encode(JSON.stringify(providerEmail));if(raw.length>maxBytes)fail(400,'delivery_control_rejected');}catch{fail(400,'delivery_control_rejected');}
  const prior=await stored('readback',opId);if(prior){if(prior.payload_hmac!==await payloadHmac('readback',opId,prior.event_id,raw))fail(409,'delivery_receipt_conflict');return JSON.parse(prior.result_json) as IdentityMailDeliveryResult;}
  const last=providerEmail.last_event;if(typeof last!=='string'||!['bounced','canceled','clicked','complained','delivered','delivery_delayed','failed','opened','queued','scheduled','sent','suppressed'].includes(last))fail(400,'delivery_control_rejected');
  return apply('readback',opId,providerEmail,facts.includes(last as Fact)?last as Fact:'accepted',raw);
 }
 async function safe<T>(action:()=>Promise<T>):Promise<T>{try{return await action();}catch(error){if(error instanceof DeliveryError)throw error;fail(503,'delivery_unavailable');}}
 return {control:(id:string)=>safe(async()=>{configured();if(!eventId(id))fail(400,'delivery_control_rejected');const c=await historical(id);return c?{eventId:id,providerId:c.row.provider_id,recipient:c.recipient,from:c.from,subject:c.subject,createdAt:c.row.dispatch_created_at}:null;}),receipt:(source:Source,id:string)=>safe(()=>receipt(source,id)),status:(id:string)=>safe(()=>status(id)),applyReadback:(opId:string,email:unknown)=>safe(()=>readback(opId,email)),async handleWebhook(request:Request):Promise<Response>{
  try{
   configured();if(new URL(request.url).origin!==env.origin)fail(403,'host_rejected');if(request.method!=='POST')fail(405,'method_not_allowed');
   const h=headersValid(request.headers);if(!h)fail(400,'webhook_verification_failed');const raw=await rawBody(request);
   const secret=typeof env.webhookSecret==='function'?await env.webhookSecret():env.webhookSecret;
   if(!await verifyIdentityMailWebhook(raw,request.headers,secret,env.now?.()??new Date()))fail(400,'webhook_verification_failed');
   const native=await one<{time:string}>("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') time");
   if(!native||!Number.isFinite(Date.parse(native.time))||Math.abs(Date.parse(native.time)/1000-Number(h.timestamp))>300)fail(400,'webhook_verification_failed');
   const prior=await stored('webhook',h.id);if(prior){if(prior.payload_hmac!==await payloadHmac('webhook',h.id,prior.event_id,raw))fail(409,'delivery_receipt_conflict');return json(JSON.parse(prior.result_json));}
   let value:unknown;try{value=parse(raw);}catch{fail(400,'webhook_body_rejected');}
   if(!object(value)||typeof value.type!=='string')fail(400,'webhook_body_rejected');
   if(!facts.map(f=>'email.'+f).includes(value.type))return json({ignored:true});
   if(!providerTime(value.created_at)||!object(value.data)||!providerTime(value.data.created_at))fail(400,'webhook_body_rejected');
   return json(await apply('webhook',h.id,value.data,value.type.slice(6) as Fact,raw,h.timestamp));
  }catch(error){return error instanceof DeliveryError?json({error:error.message},error.status):json({error:'delivery_unavailable'},503);}
 }};
}
