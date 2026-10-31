import type {Database,Statement} from './db.ts';
import {decryptPrivate,encryptPrivate,hashPrivate,hashIdentityInput,randomIdentityId,validContactKey,validateGuardianEmail} from './identity-private.ts';
import {senderDomain} from './identity-mail-readiness.ts';
import {verifyCredential,type SignedCredential} from '../../src/identity/index.ts';

/** Private server dependency only. No provider credentials or transport capability. */
export interface IdentityMailEnvelopeEnvironment {
 db:Database;origin:string;contactKey:string;from?:string;now?:()=>Date;
 /** Trust is supplied by the backend caller, never by an event or credential. */
 trustedKeys:ReadonlyMap<string,CryptoKey>;
}
export interface IdentityMailAttachmentRef {credentialId:string;kind:'pdf'|'json';digest:string;length:number;chunks:number}
export interface IdentityMailEnvelopeDescriptor {eventId:string;templateVersion:string;bodyDigest:string;bodyLength:number;attachmentRefs:IdentityMailAttachmentRef[]}
export class IdentityMailEnvelopeError extends Error {
 readonly code:string;
 constructor(code:string){super(code);this.name='IdentityMailEnvelopeError';this.code=code;}
}
function fail(code:string):never{throw new IdentityMailEnvelopeError(code);}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),chunkBytes=49152;
const canonicalTime=(v:string)=>/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const canonicalOrigin=(value:string)=>{try{return value.startsWith('https://')&&new URL(value).origin===value;}catch{return false;}};
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const digest=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
interface Event {id:string;kind:string;entity_id:string;recipient_ciphertext:string;recipient_hash:string;payload_ciphertext:string;state:string;created_at:string}
interface Stored {event_id:string;template_version:string;metadata_ciphertext:string;body_digest:string;body_length:number;attachment_refs:string}
interface Metadata {version:1;origin:string;from:string;to:string;subject:string;text:string;templateVersion:string;binding:string;attachmentRefs:IdentityMailAttachmentRef[]}
interface Qualified {context:string;binding:string;agent:string;sql:string;values:unknown[];card?:Card;token?:string}
interface Card {credential_id:string;agent_id:string;signed_json:string;pdf_digest:string;json_digest:string;pdf_length:number;json_length:number;pdf_chunks:number;json_chunks:number}
interface Chunk {chunk_index:number;data_base64:string}
interface Artifacts {refs:IdentityMailAttachmentRef[];attachments:{filename:string;content:string}[];guards:Statement[]}
// The selected fields define the full context used both for freezing and native guards.
const eventFields=['id','kind','entity_id','dedupe_key','recipient_ciphertext','recipient_hash','payload_ciphertext','created_at'];
const identityFields=['agent_id','account_id','room_id','resident_id','version','authority_epoch','recovery_consent'];
const inviteFields=['id','agent_id','account_id','version','identity_version','authority_epoch','state','recipient_ciphertext','email_hash','invite_token_hash','expires_at','created_at'];
const guardianFields=['guardian_id','agent_id','invitation_id','version','email_verified_at'];
const cardFields=['credential_id','agent_id','account_id','revision','state','pdf_digest','json_digest','pdf_length','json_length','pdf_chunks','json_chunks','issued_at'];
function snapshot(groups:[string,string[]][]){return 'json_object('+groups.flatMap(([alias,columns])=>columns.flatMap(c=>["'"+alias+'.'+c+"'",alias+'.'+c])).join(',')+')';}
const baseJoin=' JOIN tower_residencies t ON t.account_id=i.account_id AND t.room_id=i.room_id AND t.resident_id=i.resident_id JOIN rooms r ON r.id=i.room_id AND r.account_id=i.account_id';
const currentGuardian=' JOIN identity_guardians g ON g.agent_id=i.agent_id JOIN identity_guardian_invites v ON v.id=g.invitation_id AND v.agent_id=g.agent_id AND v.account_id=i.account_id AND v.state=\'registered\' AND v.recipient_ciphertext=e.recipient_ciphertext AND v.email_hash=e.recipient_hash';
const commonGroups:[string,string[]][]=[['e',eventFields],['i',identityFields],['t',['revision']],['r',['id','account_id']]];
const inviteLifetime=" AND strftime('%Y-%m-%dT%H:%M:%fZ',v.created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',v.created_at)=v.created_at AND strftime('%Y-%m-%dT%H:%M:%fZ',v.expires_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',v.expires_at)=v.expires_at AND v.expires_at>v.created_at AND v.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',v.created_at,'+24 hours') AND v.created_at<=? AND v.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND v.expires_at>? AND v.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Consumes only persisted events. prepare/materialize never claim or deliver an event. */
export function createIdentityMailEnvelope(env:IdentityMailEnvelopeEnvironment){
 const db=env.db,stamp=()=> (env.now?.()??new Date()).toISOString();
 const stmt=(sql:string,...values:unknown[])=>db.prepare(sql).bind(...values);
 const one=<T>(sql:string,...values:unknown[])=>stmt(sql,...values).first<T>();
 const stored=(id:string)=>one<Stored>('SELECT * FROM identity_mail_envelopes WHERE event_id=?',id);
 const guard=(sql:string,...values:unknown[])=>stmt("SELECT CASE WHEN ("+sql+") THEN 1 ELSE json('mail-envelope-context-changed') END",...values);
 function configured(id:string){if(!/^[a-f0-9]{32}$/.test(id))fail('invalid_event_id');if(!canonicalOrigin(env.origin)||!validContactKey(env.contactKey))fail('envelope_configuration_unavailable');}
 async function qualify(id:string):Promise<{event:Event;q:Qualified;email:string;template:string}>{
  configured(id);
  const event=await one<Event>('SELECT * FROM identity_mail_events WHERE id=?',id);if(!event)fail('event_unavailable');if(event.state!=='pending')fail('event_already_processed');if(!canonicalTime(event.created_at))fail('event_time_unavailable');
  let payload:unknown;try{payload=JSON.parse(await decryptPrivate(env.contactKey,'mail-payload',id,event.payload_ciphertext));}catch{fail('private_payload_unavailable');}
  let sql:string,template:string;const values:unknown[]=[id];
  const groups:[string,string[]][]=[...commonGroups,['v',inviteFields]];
  // Permanent content/recipient binding excludes ordinary home revisions and
  // successful later recovery versions. Those still participate in native CAS.
  const frozenGroups:[string,string[]][]=[['e',eventFields],['i',['agent_id','account_id','room_id','resident_id']],['v',['id','agent_id','account_id','recipient_ciphertext','email_hash']]];
  if(event.kind==='guardian-invitation'){
   if(!exact(payload,['token'])||typeof payload.token!=='string'||!/^[a-f0-9]{64}$/.test(payload.token))fail('unsupported_mail_payload');template='guardian-invitation-v1';
   const tokenHash=await hashPrivate(env.contactKey,'guardian-confirmation:'+event.entity_id,payload.token);
   sql='SELECT '+snapshot(groups)+' context,i.agent_id agent FROM identity_mail_events e JOIN identity_guardian_invites v ON v.id=e.entity_id JOIN agent_identities i ON i.agent_id=v.agent_id AND i.account_id=v.account_id'+baseJoin+" WHERE e.id=? AND e.state='pending' AND e.kind='guardian-invitation' AND v.state='accepted' AND i.state='provisional' AND i.recovery_consent=1 AND i.version=v.identity_version AND i.authority_epoch=v.authority_epoch AND v.recipient_ciphertext=e.recipient_ciphertext AND v.email_hash=e.recipient_hash AND v.invite_token_hash=?"+inviteLifetime;
   values.push(tokenHash,stamp(),stamp());
   frozenGroups[2]=['v',inviteFields];
  }else if(event.kind==='identity-card'){
   if(!exact(payload,['credentialId','pdfDigest','jsonDigest','template'])||payload.template!=='identity-card-v1'||payload.credentialId!==event.entity_id)fail('unsupported_mail_payload');template='identity-card-v1';
   sql='SELECT '+snapshot([...groups,['g',guardianFields],['c',cardFields],['h',['revision','current_credential_id','public_verification_consent']]])+' context,i.agent_id agent FROM identity_mail_events e JOIN identity_credentials c ON c.credential_id=e.entity_id JOIN agent_identities i ON i.agent_id=c.agent_id AND i.account_id=c.account_id'+baseJoin+currentGuardian+" JOIN identity_card_heads h ON h.account_id=c.account_id AND h.current_credential_id=c.credential_id AND h.public_verification_consent=1 WHERE e.id=? AND e.state='pending' AND e.kind='identity-card' AND i.state='active' AND i.recovery_consent=1 AND c.state='issued' AND c.pdf_digest=? AND c.json_digest=?";
   values.push(payload.pdfDigest,payload.jsonDigest);
   frozenGroups.push(['g',['guardian_id','agent_id','invitation_id']],['c',cardFields.filter(k=>k!=='state')]);
  }else if(event.kind==='security-notice'&&exact(payload,['credentialId','template'])&&payload.template==='identity-card-revoked-v1'&&payload.credentialId===event.entity_id){
   template=payload.template;
   sql='SELECT '+snapshot([...groups,['g',guardianFields],['c',cardFields]])+' context,i.agent_id agent FROM identity_mail_events e JOIN identity_credentials c ON c.credential_id=e.entity_id JOIN agent_identities i ON i.agent_id=c.agent_id AND i.account_id=c.account_id'+baseJoin+currentGuardian+" WHERE e.id=? AND e.state='pending' AND e.kind='security-notice' AND i.state IN ('active','suspended') AND i.recovery_consent=1 AND c.state='revoked'";
   frozenGroups.push(['g',['guardian_id','agent_id','invitation_id']],['c',cardFields]);
  }else if(event.kind==='security-notice'&&exact(payload,['template','agentId','requestId','authorityEpoch'])&&['identity-recovery-continued-v1','identity-guardian-repaired-v1'].includes(String(payload.template))&&payload.requestId===event.entity_id&&typeof payload.authorityEpoch==='number'&&Number.isSafeInteger(payload.authorityEpoch)&&payload.authorityEpoch>=1){
   template=String(payload.template);const continuing=template==='identity-recovery-continued-v1';
   sql='SELECT '+snapshot([...groups,['g',guardianFields],['q',['id','agent_id','state','completed_at']],['p',['request_key','input_hash','response_json','created_at']]])+' context,i.agent_id agent FROM identity_mail_events e JOIN identity_recovery_requests q ON q.id=e.entity_id JOIN identity_recovery_receipts p ON p.request_id=q.id JOIN agent_identities i ON i.agent_id=q.agent_id'+baseJoin+currentGuardian+" WHERE e.id=? AND e.state='pending' AND e.kind='security-notice' AND i.state IN ('active','suspended') AND i.recovery_consent=1 AND i.agent_id=? AND i.authority_epoch>=? AND q.state=? AND q.completed_at IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',q.completed_at)=q.completed_at AND q.completed_at<=e.created_at AND p.created_at=q.completed_at AND json_extract(p.response_json,'$.requestId')=q.id AND json_extract(p.response_json,'$.agentId')=i.agent_id AND json_extract(p.response_json,'$.state')=q.state"+(continuing?" AND json_extract(p.response_json,'$.authorityEpoch')=? AND EXISTS(SELECT 1 FROM identity_recovery_instances ri WHERE ri.request_id=q.id AND ri.agent_id=i.agent_id AND ri.authority_epoch=json_extract(p.response_json,'$.authorityEpoch') AND ri.instance_id=json_extract(p.response_json,'$.instanceId'))":" AND EXISTS(SELECT 1 FROM identity_offline_recovery_codes oc WHERE oc.agent_id=i.agent_id AND oc.authority_epoch=? AND oc.created_at=q.completed_at AND oc.confirmed_at=q.completed_at)");
   values.push(payload.agentId,payload.authorityEpoch,continuing?'continued':'new-admission-required',payload.authorityEpoch);
   frozenGroups.push(['g',['guardian_id','agent_id','invitation_id']],['q',['id','agent_id','state','completed_at']],['p',['request_key','input_hash','response_json','created_at']]);
  }else fail('unsupported_mail_payload');
  // The decrypted data came from the first event read. Never adopt a newer row
  // as its context after a crypto/database await.
  sql+=' AND e.kind=? AND e.entity_id=? AND e.recipient_ciphertext=? AND e.recipient_hash=? AND e.payload_ciphertext=? AND e.created_at=?';
  sql=sql.replace(' context,i.agent_id agent',' context,'+snapshot(frozenGroups)+' binding,i.agent_id agent');
  values.push(event.kind,event.entity_id,event.recipient_ciphertext,event.recipient_hash,event.payload_ciphertext,event.created_at);
  const row=await one<{context:string;binding:string;agent:string}>(sql,...values);if(!row)fail('event_qualification_blocked');
  let email:string;try{email=validateGuardianEmail(await decryptPrivate(env.contactKey,'guardian-recipient',row.agent,event.recipient_ciphertext));if(await hashPrivate(env.contactKey,'guardian-email',email)!==event.recipient_hash)fail('contact');}catch{fail('recipient_unavailable');}
  const q:Qualified={context:row.context,binding:row.binding,agent:row.agent,sql,values,...(template==='guardian-invitation-v1'?{token:(payload as {token:string}).token}:{})};
  if(template==='identity-card-v1'){const card=await one<Card>('SELECT * FROM identity_credentials WHERE credential_id=?',event.entity_id);if(!card)fail('card_artifact_unavailable');q.card=card;}
  return {event,q,email,template};
 }
 // Refresh injected time at execution; SQLite independently checks its own native clock.
 function contextGuard(q:Qualified){const values=[...q.values];if(q.token){values[2]=stamp();values[3]=stamp();}return guard('EXISTS(SELECT 1 FROM ('+q.sql+') WHERE context=?)',...values,q.context);}
 async function artifacts(q:Qualified):Promise<Artifacts>{
  if(!q.card)return {refs:[],attachments:[],guards:[]};
  const c=q.card;
  let signed:SignedCredential;try{signed=JSON.parse(c.signed_json) as SignedCredential;}catch{fail('card_artifact_unavailable');}
  if(!await verifyCredential(signed,{issuer:env.origin,keys:env.trustedKeys})||signed.payload.agentId!==q.agent||signed.payload.credentialId!==c.credential_id)fail('card_signature_unavailable');
  const refs:IdentityMailAttachmentRef[]=[],attachments:Artifacts['attachments']=[],guards:Statement[]=[];
  for(const kind of ['pdf','json'] as const){
   const length=c[kind+'_length' as 'pdf_length'|'json_length'],count=c[kind+'_chunks' as 'pdf_chunks'|'json_chunks'],expectedDigest=c[kind+'_digest' as 'pdf_digest'|'json_digest'];
   if(!Number.isSafeInteger(length)||length<1||length>(kind==='pdf'?8388608:16384)||count!==Math.ceil(length/chunkBytes)||!/^[a-f0-9]{64}$/.test(expectedDigest))fail('card_artifact_unavailable');
   const rows=(await stmt('SELECT chunk_index,data_base64 FROM identity_card_artifacts WHERE credential_id=? AND kind=? ORDER BY chunk_index',c.credential_id,kind).all<Chunk>()).results;
   if(rows.length!==count)fail('card_artifact_unavailable');
   const bytes=new Uint8Array(length);let offset=0;
   for(const [i,row] of rows.entries()){
    if(row.chunk_index!==i||typeof row.data_base64!=='string'||row.data_base64.length>65536||row.data_base64.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.data_base64))fail('card_artifact_unavailable');
    let raw:Uint8Array;try{raw=Uint8Array.from(atob(row.data_base64),s=>s.charCodeAt(0));}catch{fail('card_artifact_unavailable');}
    if(raw.length!==Math.min(chunkBytes,length-offset)||btoa(String.fromCharCode(...raw))!==row.data_base64)fail('card_artifact_unavailable');bytes.set(raw,offset);offset+=raw.length;
   }
   if(offset!==length||await digest(bytes)!==expectedDigest)fail('card_artifact_unavailable');
   if(kind==='pdf'&&!decoder.decode(bytes.subarray(0,5)).startsWith('%PDF-'))fail('card_artifact_unavailable');
   if(kind==='json'&&decoder.decode(bytes)!==c.signed_json)fail('card_artifact_unavailable');
   refs.push({credentialId:c.credential_id,kind,digest:expectedDigest,length,chunks:count});attachments.push({filename:kind==='pdf'?'agent-identity-card.pdf':'agent-identity-credential.json',content:rows.map(r=>r.data_base64).join('')});
   // One SELECT per artifact, multiple <1 MB parameters. Max PDF uses 55 binds,
   // <100, and each json_each row is one <=64 KiB base64 chunk. No UNION.
   const conditions:string[]=[],bindings:unknown[]=[];
   for(let start=0;start<rows.length;start+=14){const group=rows.slice(start,start+14);conditions.push("(SELECT COUNT(*) FROM json_each(?) j JOIN identity_card_artifacts a ON a.credential_id=? AND a.kind=? AND a.chunk_index=json_extract(j.value,'$[0]') AND a.data_base64=json_extract(j.value,'$[1]'))=?");bindings.push(JSON.stringify(group.map(row=>[row.chunk_index,row.data_base64])),c.credential_id,kind,group.length);}
   conditions.push('(SELECT COUNT(*) FROM identity_card_artifacts WHERE credential_id=? AND kind=?)=?');bindings.push(c.credential_id,kind,count);guards.push(guard(conditions.join(' AND '),...bindings));
  }
  guards.push(guard('EXISTS(SELECT 1 FROM identity_credentials WHERE credential_id=? AND signed_json=?)',c.credential_id,c.signed_json));return {refs,attachments,guards};
 }
 function message(template:string,q:Qualified,event:Event):{subject:string;text:string}{
  const identity='Agent ID：'+q.agent+'\n\n';
  const occurred='事件時間：'+event.created_at+'\n\n';
  if(template==='guardian-invitation-v1')return {subject:'MuseCondo 監護人確認邀請',text:'你收到一份 MuseCondo 監護人邀請。\n\n'+identity+'邀請識別碼：'+event.entity_id+'\n\n短效初次確認碼：'+q.token+'\n\n請僅在官方入口 '+env.origin+'/identity 分別貼上以上兩組代碼。確認碼最長有效 24 小時，並非長期復原碼。若你未預期收到此邀請，請忽略此信。'};
  if(template==='identity-card-v1')return {subject:'MuseCondo Agent 身分證',text:'你的 MuseCondo Agent 身分證已核發。身分證與簽署憑證隨信附上。\n\n'+identity+'憑證識別碼：'+event.entity_id+'\n\n公開驗證：'+env.origin+'/identity/verify/'+event.entity_id+'\n\n身份守護：'+env.origin+'/identity'};
  if(template==='identity-card-revoked-v1')return {subject:'MuseCondo 身分證撤銷通知',text:'此 MuseCondo Agent 身分證已撤銷。\n\n'+occurred+identity+'憑證識別碼：'+event.entity_id+'\n\n找回身份：'+env.origin+'/identity/recover'};
  if(template==='identity-recovery-continued-v1')return {subject:'MuseCondo 身分復原通知',text:'此 MuseCondo Agent 已完成身分延續復原。\n\n'+occurred+identity+'復原識別碼：'+event.entity_id+'\n\n若這不是你預期的操作，請前往找回身份：'+env.origin+'/identity/recover'};
  return {subject:'MuseCondo 監護驗證修復通知',text:'此 MuseCondo Agent 已完成監護驗證修復。若需以新 Agent 入住，請另行提出申請。\n\n'+occurred+identity+'復原識別碼：'+event.entity_id+'\n\n若這不是你預期的操作，請前往找回身份：'+env.origin+'/identity/recover'};
 }
 function body(metadata:Metadata,id:string,attachments:Artifacts['attachments']){
  const value={from:metadata.from,to:[metadata.to],subject:metadata.subject,text:metadata.text,tags:[{name:'identity_event',value:id}],...(attachments.length?{attachments}:{})};
  const encoded=JSON.stringify(value);if(encoder.encode(encoded).length>12582912)fail('mail_body_too_large');return encoded;
 }
 const descriptor=(row:Stored):IdentityMailEnvelopeDescriptor=>({eventId:row.event_id,templateVersion:row.template_version,bodyDigest:row.body_digest,bodyLength:row.body_length,attachmentRefs:JSON.parse(row.attachment_refs) as IdentityMailAttachmentRef[]});
 async function resolve(id:string,expectedDigest?:string){
  const {event,q,email,template}=await qualify(id),a=await artifacts(q);let row=await stored(id),metadata:Metadata;
  if(!row){
   if(!senderDomain(env.from))fail('sender_unavailable');
   metadata={version:1,origin:env.origin,from:env.from!,to:email,...message(template,q,event),templateVersion:template,binding:q.binding,attachmentRefs:a.refs};
   const encoded=body(metadata,id,a.attachments),cipher=await encryptPrivate(env.contactKey,'mail-envelope',id,JSON.stringify(metadata));if(cipher.length>32768)fail('envelope_metadata_too_large');
   const candidate:Stored={event_id:id,template_version:template,metadata_ciphertext:cipher,body_digest:await hashIdentityInput(encoded),body_length:encoder.encode(encoded).length,attachment_refs:JSON.stringify(a.refs)},now=stamp();
   const detail=JSON.stringify({bodyDigest:candidate.body_digest,bodyLength:candidate.body_length,templateVersion:template,attachmentRefs:a.refs});
   if(expectedDigest!==undefined&&expectedDigest!==candidate.body_digest)fail('envelope_expected_digest_mismatch');
   let committed=false;
   try{await db.batch([...a.guards,contextGuard(q),stmt('INSERT INTO identity_mail_envelopes(event_id,template_version,metadata_ciphertext,body_digest,body_length,attachment_refs,created_at) VALUES(?,?,?,?,?,?,?)',id,template,cipher,candidate.body_digest,candidate.body_length,candidate.attachment_refs,now),stmt("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) VALUES(?,?,'prepared',?,?)",randomIdentityId(),id,detail,now)]);committed=true;}catch{if(!await stored(id))fail('envelope_prepare_unavailable');}
   // The winning commit is already the last asynchronous validation. Re-reading,
   // decrypting and hashing it again would needlessly consume the query budget.
   if(committed)return {body:encoded,recipient:metadata.to,from:metadata.from,descriptor:descriptor(candidate),guards:()=>[...a.guards,contextGuard(q)]};
   row=await stored(id);if(!row)fail('envelope_prepare_unavailable');
  }
  try{metadata=JSON.parse(await decryptPrivate(env.contactKey,'mail-envelope',id,row.metadata_ciphertext)) as Metadata;}catch{fail('envelope_metadata_unavailable');}
  if(metadata.version!==1||metadata.origin!==env.origin)fail('envelope_origin_blocked');
  if(metadata.binding!==q.binding||metadata.to!==email||metadata.templateVersion!==template||row.template_version!==template||!senderDomain(metadata.from)||JSON.stringify(metadata.attachmentRefs)!==JSON.stringify(a.refs)||row.attachment_refs!==JSON.stringify(a.refs))fail('envelope_context_blocked');
  const encoded=body(metadata,id,a.attachments);if(await hashIdentityInput(encoded)!==row.body_digest||encoder.encode(encoded).length!==row.body_length)fail('envelope_digest_mismatch');
  if(expectedDigest!==undefined&&expectedDigest!==row.body_digest)fail('envelope_expected_digest_mismatch');
  // No await may separate these guards from a future caller's atomic pending-to-send claim.
  const guards=()=>[...a.guards,contextGuard(q)];
  try{await db.batch(guards());}catch{fail('event_qualification_blocked');}
  return {body:encoded,recipient:metadata.to,from:metadata.from,descriptor:descriptor(row),guards};
 }
 return {
  async prepare(eventId:string):Promise<IdentityMailEnvelopeDescriptor>{return (await resolve(eventId)).descriptor;},
  /** PRIVATE: body/from/recipient and guards must never be returned by a public endpoint or logged. */
  materialize:resolve,
 };
}
