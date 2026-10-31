import {identityMailDeliveryReady,IDENTITY_MAIL_WEBHOOK_PATH} from './identity-mail-control.ts';
import {createIdentityMailEnvelope,type IdentityMailEnvelopeEnvironment,IdentityMailEnvelopeError} from './identity-mail-envelope.ts';
import {decryptPrivate,validateGuardianEmail,hashPrivate,randomIdentityId} from './identity-private.ts';
import {IDENTITY_MAIL_INTERNAL_PREFIX,identityMailSchemaReady,safeIdentityMailProviderError,type SuppressionReason,type IdentityMailFinish} from './identity-mail-contract.ts';
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const providerId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
function fail(code:string):never{throw new IdentityMailEnvelopeError(code);}
function validFinish(v:IdentityMailFinish){
 if(!id(v.eventId)||!id(v.leaseId))return false;
 if(v.state==='accepted')return providerId(v.providerId)&&v.errorCode===null;
 if(v.state==='unknown')return v.providerId===null&&v.errorCode==='provider_outcome_unknown';
 if(v.state!=='failed'||v.providerId!==null||typeof v.errorCode!=='string')return false;
 const match=v.errorCode.match(/^provider_rejected_(4\d\d)(?::([a-z_]+))?$/);
 return !!match&&![408,409,425,429].includes(Number(match[1]))&&(!match[2]||safeIdentityMailProviderError(match[2]));
}
/** Only a private DO binding owns this service. Never expose these control responses publicly. */
export function createIdentityMailCoordinator(env:IdentityMailEnvelopeEnvironment){
 const db=env.db,envelope=createIdentityMailEnvelope(env),stamp=()=>(env.now?.()??new Date()).toISOString();
 const stmt=(sql:string,...v:unknown[])=>db.prepare(sql).bind(...v);
 const one=<T>(sql:string,...v:unknown[])=>stmt(sql,...v).first<T>();
 const suppressionKey=(recipient:string)=>hashPrivate(env.contactKey,'mail-suppression',recipient.toLowerCase());
 async function prepare(eventId:string){
  await envelope.prepare(eventId);const m=await envelope.metadata(eventId);
  if(await one('SELECT 1 FROM identity_mail_suppressions WHERE recipient_hash=?',await suppressionKey(m.recipient)))fail('recipient_suppressed');
  return m;
 }
 async function claim(eventId:string,bodyDigest:string){
  if(!id(eventId)||!digest(bodyDigest))fail('invalid_mail_control');
  if(!await identityMailDeliveryReady(db,env.origin,env.contactKey))fail('delivery_handler_not_ready');
  const materialized=await envelope.materialize(eventId,bodyDigest),key=await suppressionKey(materialized.recipient),leaseId=randomIdentityId(),time=stamp();
  // Construct the final clock guard immediately before the single native transaction;
  // no await, provider request or separate transaction may split guards and lease.
  const guards=materialized.guards();
  guards.push(stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_mail_webhook_setups WHERE origin=? AND endpoint=? AND state='ready' AND secret_ciphertext IS NOT NULL AND provider_id IS NOT NULL AND handler_probe_at IS NOT NULL) THEN 1 ELSE json('delivery-handler-not-ready') END",env.origin,env.origin+IDENTITY_MAIL_WEBHOOK_PATH));
  await db.batch([...guards,
   stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_mail_events WHERE id=? AND state='pending' AND attempt_count=0) AND NOT EXISTS(SELECT 1 FROM identity_mail_dispatches WHERE event_id=?) AND NOT EXISTS(SELECT 1 FROM identity_mail_suppressions WHERE recipient_hash=?) THEN 1 ELSE json('mail-claim-blocked') END",eventId,eventId,key),
   stmt('INSERT INTO identity_mail_dispatches(event_id,lease_id,body_digest,body_length,created_at) VALUES(?,?,?,?,?)',eventId,leaseId,bodyDigest,materialized.descriptor.bodyLength,time),
   stmt("UPDATE identity_mail_events SET state='sending',attempt_count=1,lease_started_at=?,updated_at=? WHERE id=? AND state='pending' AND attempt_count=0",time,time,eventId),
   stmt("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) VALUES(?,?,'sending',?,?)",randomIdentityId(),eventId,JSON.stringify({bodyDigest,bodyLength:materialized.descriptor.bodyLength}),time),
  ]);
  // The only lease delivery: a lost acknowledgement must leave sending; never reconstruct it.
  return new Response(materialized.body,{headers:{...headers,'X-Identity-Mail-Lease':leaseId}});
 }
 async function suppress(eventId:string,bodyDigest:string,reason:SuppressionReason){
  if(!id(eventId)||!digest(bodyDigest)||!['bounce','complaint','manual'].includes(reason))fail('invalid_mail_control');
  // A negative policy result is still authoritative if another shard has claimed
  // or cancelled this event since preflight. Read only its immutable sealed
  // recipient; this path never authorizes sending or returns a body/recipient.
  const frozen=await one<{body_digest:string;metadata_ciphertext:string}>('SELECT body_digest,metadata_ciphertext FROM identity_mail_envelopes WHERE event_id=?',eventId);
  if(!frozen||frozen.body_digest!==bodyDigest)fail('envelope_expected_digest_mismatch');
  let recipient:string;try{const m=JSON.parse(await decryptPrivate(env.contactKey,'mail-envelope',eventId,frozen.metadata_ciphertext)) as {version?:unknown;origin?:unknown;to?:unknown};if(m.version!==1||m.origin!==env.origin)fail('envelope_context_blocked');recipient=validateGuardianEmail(m.to);if(recipient!==m.to)fail('recipient_unavailable');}catch{fail('recipient_unavailable');}
  const key=await suppressionKey(recipient),time=stamp();
  await db.batch([
   stmt('INSERT INTO identity_mail_suppressions(recipient_hash,reason,created_at) VALUES(?,?,?) ON CONFLICT(recipient_hash) DO NOTHING',key,reason,time),
   stmt("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) VALUES(?,?,'suppressed',?,?) ON CONFLICT DO NOTHING",randomIdentityId(),eventId,JSON.stringify({recipientHash:key,reason}),time),
  ]);
 }
 async function finish(v:IdentityMailFinish){
  if(!validFinish(v))fail('invalid_mail_control');
  const payload=JSON.stringify({eventId:v.eventId,leaseId:v.leaseId,state:v.state,providerId:v.providerId,errorCode:v.errorCode});
  const prior=await one<{payload_json:string}>('SELECT payload_json FROM identity_mail_finish_receipts WHERE event_id=?',v.eventId);
  if(prior){if(prior.payload_json!==payload)fail('mail_finish_conflict');return;}
  const time=stamp();
  try{await db.batch([
   stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_mail_dispatches d JOIN identity_mail_events e ON e.id=d.event_id WHERE d.event_id=? AND d.lease_id=? AND (? IS NULL OR e.provider_id IS NULL OR e.provider_id=?)) AND NOT EXISTS(SELECT 1 FROM identity_mail_finish_receipts WHERE event_id=?) THEN 1 ELSE json('mail-finish-conflict') END",v.eventId,v.leaseId,v.providerId,v.providerId,v.eventId),
   stmt('INSERT INTO identity_mail_finish_receipts(event_id,lease_id,payload_json,created_at) VALUES(?,?,?,?)',v.eventId,v.leaseId,payload,time),
   // Webhooks/reconcile may have beaten the HTTP response. Preserve any terminal or
   // positive state and bind the provider ID only when no different ID was stored.
   stmt("UPDATE identity_mail_events SET state=CASE WHEN state='sending' OR state='unknown' AND ?!='unknown' THEN ? ELSE state END,error_code=CASE WHEN state='sending' OR state='unknown' AND ?!='unknown' THEN ? ELSE error_code END,provider_id=COALESCE(provider_id,?),updated_at=? WHERE id=?",v.state,v.state,v.state,v.errorCode,v.providerId,time,v.eventId),
   stmt("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) VALUES(?,?,'dispatch-finished',?,?)",randomIdentityId(),v.eventId,JSON.stringify({state:v.state,providerId:v.providerId,errorCode:v.errorCode}),time),
  ]);}catch{
   const saved=await one<{payload_json:string}>('SELECT payload_json FROM identity_mail_finish_receipts WHERE event_id=?',v.eventId);
   if(saved?.payload_json!==payload)fail('mail_finish_conflict');
  }
 }
 return {prepare,claim,suppress,finish,async fetch(request:Request){
  const url=new URL(request.url);if(!url.pathname.startsWith(IDENTITY_MAIL_INTERNAL_PREFIX))return json({error:'not_found'},404);
  if(url.origin!==env.origin)return json({error:'host_rejected'},403);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  try{
   if(!await identityMailSchemaReady(db))return json({error:'identity_mail_schema_not_ready'},503);
   if(!/^application\/json(?:; charset=utf-8)?$/i.test(request.headers.get('Content-Type')??''))return json({error:'invalid_mail_control'},400);
   const reader=request.body?.getReader();if(!reader)return json({error:'invalid_mail_control'},400);
   let raw='';try{const decoder=new TextDecoder('utf-8',{fatal:true});let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2048){await reader.cancel();return json({error:'invalid_mail_control'},400);}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
   const v:unknown=JSON.parse(raw),action=url.pathname.slice(IDENTITY_MAIL_INTERNAL_PREFIX.length);
   if(action==='prepare'&&exact(v,['eventId'])&&id(v.eventId))return json(await prepare(v.eventId));
   if(action==='claim'&&exact(v,['eventId','bodyDigest'])&&id(v.eventId)&&digest(v.bodyDigest))return await claim(v.eventId,v.bodyDigest);
   if(action==='suppress'&&exact(v,['eventId','bodyDigest','reason'])&&id(v.eventId)&&digest(v.bodyDigest)&&['bounce','complaint','manual'].includes(String(v.reason))){await suppress(v.eventId,v.bodyDigest,v.reason as SuppressionReason);return json({recorded:true});}
   if(action==='finish'&&exact(v,['eventId','leaseId','state','providerId','errorCode'])){await finish(v as unknown as IdentityMailFinish);return json({recorded:true});}
   return json({error:'invalid_mail_control'},400);
  }catch(e){return json({error:e instanceof IdentityMailEnvelopeError?e.code:'mail_operation_unavailable'},e instanceof IdentityMailEnvelopeError&&e.code==='mail_finish_conflict'?409:e instanceof IdentityMailEnvelopeError&&e.code==='invalid_mail_control'?400:503);}
 }};
}
