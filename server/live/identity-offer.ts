import {readRequestBody,RequestBodyError} from './request-body.ts';
import type {Database,Statement} from './db.ts';
import {encryptPrivate,hashIdentityInput,hashPrivate,randomIdentityId,randomIdentitySecret,validContactKey,validateGuardianEmail,identityCreationStamp} from './identity-private.ts';
export const IDENTITY_OFFER_SCHEMA=['identity_offers','identity_offer_heads','identity_offer_current_publications','identity_offer_renewable','identity_offer_binding','identity_offer_immutable','identity_offer_permanent','identity_offer_insert_once','identity_offer_audit','identity_offer_audit_immutable','identity_offer_audit_permanent','identity_offer_audit_insert_once','identity_offer_audit_binding','identity_offer_acceptance_binding','identity_offer_enrollment_binding','identity_offer_requests','identity_offer_request_binding','identity_offer_request_immutable','identity_offer_request_permanent','identity_offer_request_insert_once','identity_offer_head_insert','identity_offer_head_update','identity_offer_head_permanent','identity_offer_head_insert_once'] as const;
interface Completion {complete:boolean;publicURL?:string;roomId?:string;residentId?:string;revision?:number;publicationEpoch?:number;snapshotDigest?:string;checks:Record<string,boolean>}
export interface IdentityOfferEnvironment {db:Database;origin:string;contactKey?:string;now?:()=>Date;bodyReadTimeoutMs?:number;verifyCompletion(accountId:string):Promise<Completion>;onMailEvent?:(id:string)=>Promise<void>}
interface Offer {id:string;account_id:string;generation:number;room_id:string;resident_id:string;public_revision:number;publication_epoch:number;snapshot_digest:string;offer_digest:string;public_url:string;recipient_hash:string;token_hash:string;mail_event_id:string;state:string;expires_at:string;decided_at:string|null;native_alive?:number;is_current?:number}
class OfferError extends Error {readonly status:number;constructor(status:number,code:string){super(code);this.status=status;}}
function fail(status:number,code:string):never{throw new OfferError(status,code);}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
async function input(request:Request,timeoutMs=10000){
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')??''))fail(415,'json_required');
 let bytes:Uint8Array;try{bytes=await readRequestBody(request,2048,timeoutMs);}catch(error){if(error instanceof RequestBodyError)fail(error.status,error.code);fail(400,'invalid_offer_request');}
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'invalid_offer_request');}if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid_offer_request');return value as Record<string,unknown>;
}
/** Separate optional consent receipt; never enrolls identities, nominates Guardians or sets recovery consent. */
export function createIdentityOffer(env:IdentityOfferEnvironment){
 const db=env.db,stamp=()=>(env.now?.()??new Date()).toISOString();
 const stmt=(sql:string,...v:unknown[])=>db.prepare(sql).bind(...v),one=<T>(sql:string,...v:unknown[])=>stmt(sql,...v).first<T>();
 const find=(account:string)=>one<Offer>('SELECT o.* FROM identity_offers o JOIN identity_offer_heads h ON h.account_id=o.account_id AND h.offer_id=o.id AND h.generation=o.generation WHERE o.account_id=?',account);
 const byId=(id:string)=>one<Offer>('SELECT * FROM identity_offers WHERE id=?',id);
 const currentPublication=(o:Offer)=>stmt('SELECT 1 FROM tower_residencies t JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id JOIN tower_snapshots s ON s.room_id=t.room_id AND s.revision=t.public_revision WHERE t.account_id=? AND t.room_id=? AND t.resident_id=? AND t.public_revision=? AND t.publication_epoch=? AND t.directory_consent=1 AND t.snapshot_consent=1 AND r.published=1 AND s.content_digest=?',o.account_id,o.room_id,o.resident_id,o.public_revision,o.publication_epoch,o.snapshot_digest);
 function configured(){if(!validContactKey(env.contactKey)||!env.origin.startsWith('https://')||new URL(env.origin).origin!==env.origin)fail(503,'identity_offer_unavailable');return env.contactKey;}
 async function view(o:Offer){
  const mail=await one<{state:string}>('SELECT state FROM identity_mail_events WHERE id=?',o.mail_event_id),current=!!await one('SELECT 1 FROM identity_offer_heads WHERE account_id=? AND offer_id=? AND generation=?',o.account_id,o.id,o.generation),renewable=!!await one('SELECT 1 FROM identity_offer_renewable WHERE id=?',o.id);
  const renewalRequired=current&&o.state!=='declined'&&((o.state==='pending'&&o.expires_at<=stamp())||!await currentPublication(o).first());
  const nextAction=!current?'resident-check-current-offer':o.state==='declined'?'none':renewable?'resident-renew-offer':renewalRequired?'resident-check-mail-delivery':o.state==='accepted'?'resident-continue-identity':'human-choice';
  return {mailState:mail?.state??'unavailable',offerId:o.id,generation:o.generation,current,state:o.state,publicURL:o.public_url,verifiedRevision:o.public_revision,expiresAt:o.expires_at,recoveryConsent:false,renewalRequired,renewable,nextAction};
 }
 async function auth(request:Request,write:boolean){
  if(request.headers.has('Cookie'))fail(403,'separate_agent_authorization_required');
  const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)fail(401,'tower_token_required');
  const digest=await hashIdentityInput(token),scope=write?'tower:write':'tower:read',sql="SELECT account_id FROM tower_tokens WHERE token_hash=? AND revoked=0 AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value=?)";
  const row=await one<{account_id:string}>(sql,digest,stamp(),scope);if(!row)fail(403,'tower_scope_rejected');
  return {accountId:row.account_id,guard:()=>stmt("SELECT CASE WHEN EXISTS("+sql+" AND account_id=?) THEN 1 ELSE json('offer-authorization-changed') END",digest,stamp(),scope,row.account_id)};
 }
 async function verifyAuth(a:{guard:()=>Statement}){try{await a.guard().first();}catch{fail(403,'authorization_changed');}}
 async function privateResponse(a:{guard:()=>Statement},o:Offer|null,status=200){const value=o?await view(o):null;await verifyAuth(a);return json({offer:value},status);}
 async function create(request:Request,renew=false){
  const a=await auth(request,true),v=await input(request,env.bodyReadTimeoutMs),key=configured();
  if(!exact(v,renew?['requestKey','expectedOfferId','guardianEmail','guardianDesignated','mailConsent']:['guardianEmail','guardianDesignated','mailConsent'])||v.guardianDesignated!==true||v.mailConsent!==true)fail(400,'explicit_offer_consent_required');
  if(renew&&(typeof v.requestKey!=='string'||!/^[\x20-\x7e]{8,96}$/.test(v.requestKey)||typeof v.expectedOfferId!=='string'||!/^[a-f0-9]{32}$/.test(v.expectedOfferId)))fail(400,'invalid_offer_renewal');
  let email:string;try{email=validateGuardianEmail(v.guardianEmail);}catch{fail(400,'invalid_guardian_email');}
  const recipientHash=await hashPrivate(key,'guardian-email',email),inputHash=renew?await hashIdentityInput(JSON.stringify([v.expectedOfferId,recipientHash,true,true])):null;
  async function priorRenewal(){
   if(!renew)return null;
   const q=await one<{input_hash:string;offer_id:string}>('SELECT input_hash,offer_id FROM identity_offer_requests WHERE account_id=? AND request_key=?',a.accountId,v.requestKey);
   if(!q)return null;if(q.input_hash!==inputHash)fail(409,'idempotency_conflict');
   const o=await byId(q.offer_id);if(!o)fail(503,'identity_offer_unavailable');return privateResponse(a,o);
  }
  const replay=await priorRenewal();if(replay)return replay;
  const old=await find(a.accountId);
  if(!renew&&old){await verifyAuth(a);if(old.recipient_hash!==recipientHash)fail(409,'identity_offer_already_bound');return privateResponse(a,old);}
  if(await one('SELECT 1 FROM agent_identities WHERE account_id=?',a.accountId))fail(409,'identity_already_bound');
  if(renew){
   if(!old||old.id!==v.expectedOfferId)fail(409,'offer_head_changed');
   if(old.recipient_hash!==recipientHash)fail(409,'identity_offer_already_bound');
   if(old.state==='declined')fail(409,'offer_decision_final');
   const e=await one<{state:string;attempt_count:number}>('SELECT state,attempt_count FROM identity_mail_events WHERE id=?',old.mail_event_id);
   if(!e||['sending','unknown'].includes(e.state)||e.state==='pending'&&e.attempt_count!==0)fail(409,'offer_delivery_unresolved');
   if(!await one('SELECT 1 FROM identity_offer_renewable WHERE id=?',old.id))fail(409,'offer_renewal_not_required');
  }
  const completion=await env.verifyCompletion(a.accountId);if(!completion.complete||!completion.publicURL||!completion.roomId||!completion.residentId||!Number.isSafeInteger(completion.revision)||(completion.revision??0)<1||!Number.isSafeInteger(completion.publicationEpoch)||(completion.publicationEpoch??-1)<0||typeof completion.snapshotDigest!=='string'||!/^[a-f0-9]{64}$/.test(completion.snapshotDigest))fail(409,'public_completion_required');
  let home:URL;try{home=new URL(completion.publicURL);}catch{fail(409,'public_completion_required');}
  if(home.origin!==env.origin||home.pathname!=='/home/'+completion.roomId||home.username||home.password||home.search||home.hash)fail(409,'public_completion_required');
  const generation=renew?old!.generation+1:1,id=randomIdentityId(),eventId=randomIdentityId(),token=randomIdentitySecret(),created=await identityCreationStamp(db,stamp),expires=new Date(Date.parse(created)+86400000).toISOString();
  const cipher=await encryptPrivate(key,'identity-offer-recipient',id,email),tokenHash=await hashPrivate(key,'identity-offer-token:'+id,token),payload=await encryptPrivate(key,'mail-payload',eventId,JSON.stringify({template:'identity-application-offer-v1',token}));
  const offerDigest=await hashIdentityInput(JSON.stringify([id,a.accountId,generation,completion.roomId,completion.residentId,completion.revision,completion.publicationEpoch,completion.snapshotDigest,home.href,recipientHash,true,true,created,expires]));
  const commands:Statement[]=[a.guard()];
  if(renew)commands.push(stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_offer_renewable WHERE account_id=? AND id=? AND generation=?) THEN 1 ELSE json('offer-renewal-changed') END",a.accountId,old!.id,old!.generation));
  commands.push(stmt("INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,created_at,updated_at) VALUES(?,'guardian-invitation',?,?,?,?,?,?,?)",eventId,id,'identity-offer:'+id,cipher,recipientHash,payload,created,created),stmt("INSERT INTO identity_offers(id,account_id,generation,room_id,resident_id,public_revision,publication_epoch,snapshot_digest,offer_digest,public_url,guardian_designated,mail_consent,recipient_ciphertext,recipient_hash,token_hash,mail_event_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,1,?,?,?,?,?,?)",id,a.accountId,generation,completion.roomId,completion.residentId,completion.revision,completion.publicationEpoch,completion.snapshotDigest,offerDigest,home.href,cipher,recipientHash,tokenHash,eventId,created,expires),stmt("INSERT INTO identity_offer_audit VALUES(?,?,'offered',?)",randomIdentityId(),id,created));
  if(renew)commands.push(stmt('INSERT INTO identity_offer_requests(account_id,request_key,input_hash,offer_id,created_at) VALUES(?,?,?,?,?)',a.accountId,v.requestKey,inputHash,id,created),stmt('UPDATE identity_offer_heads SET offer_id=?,generation=?,updated_at=? WHERE account_id=? AND offer_id=? AND generation=?',id,generation,created,a.accountId,old!.id,old!.generation));
  else commands.push(stmt('INSERT INTO identity_offer_heads(account_id,offer_id,generation,updated_at) VALUES(?,?,1,?)',a.accountId,id,created));
  try{await db.batch(commands);}catch{await verifyAuth(a);const replay=await priorRenewal();if(replay)return replay;if(!renew){const race=await find(a.accountId);if(race&&race.recipient_hash===recipientHash)return privateResponse(a,race);}fail(409,'identity_offer_context_changed');}
  // The exact committed event is dispatched immediately; failures cannot undo public move-in.
  try{await env.onMailEvent?.(eventId);}catch{/* Durable pending event remains safe for bounded operator recovery. */}
  const saved=await byId(id);if(!saved)fail(503,'identity_offer_unavailable');return privateResponse(a,saved,201);
 }
 async function decide(request:Request,inspect=false){
  const key=configured(),v=await input(request,env.bodyReadTimeoutMs);if(request.headers.has('Authorization')||request.headers.has('Cookie'))fail(403,'offer_token_only');
  if(!exact(v,inspect?['offerId','token']:['offerId','token','decision','expectedOfferDigest'])||typeof v.offerId!=='string'||!/^[a-f0-9]{32}$/.test(v.offerId)||typeof v.token!=='string'||!/^[a-f0-9]{64}$/.test(v.token)||!inspect&&(!['accept','decline'].includes(String(v.decision))||typeof v.expectedOfferDigest!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedOfferDigest)))fail(400,'invalid_offer_request');
  const tokenHash=await hashPrivate(key,'identity-offer-token:'+v.offerId,v.token),o=await one<Offer>("SELECT o.*,CASE WHEN expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END native_alive,EXISTS(SELECT 1 FROM identity_offer_heads h WHERE h.account_id=o.account_id AND h.offer_id=o.id AND h.generation=o.generation) is_current FROM identity_offers o WHERE id=? AND token_hash=?",v.offerId,tokenHash);if(!o)fail(404,'offer_not_found');if(o.is_current!==1)fail(409,'offer_superseded');
  if(inspect){if(o.expires_at<=stamp()||o.native_alive!==1)fail(410,'offer_expired');if(o.state==='pending'&&!await currentPublication(o).first())fail(409,'offer_publication_changed');return json({state:o.state,publicURL:o.public_url,expiresAt:o.expires_at,offerDigest:o.offer_digest});}
  if(v.expectedOfferDigest!==o.offer_digest)fail(409,'offer_digest_changed');
  const next=v.decision==='accept'?'accepted':'declined';if(o.state!=='pending'){if(o.state!==next)fail(409,'offer_decision_already_recorded');return json({state:next,nextAction:'resident-continue'});}
  const now=stamp();if(o.expires_at<=now||o.native_alive!==1)fail(410,'offer_expired');
  const publicationGuard=next==='accepted'?[stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_residencies t JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id JOIN tower_snapshots s ON s.room_id=t.room_id AND s.revision=t.public_revision WHERE t.account_id=? AND t.room_id=? AND t.resident_id=? AND t.public_revision=? AND t.publication_epoch=? AND t.directory_consent=1 AND t.snapshot_consent=1 AND r.published=1 AND s.content_digest=?) THEN 1 ELSE json('offer-publication-changed') END",o.account_id,o.room_id,o.resident_id,o.public_revision,o.publication_epoch,o.snapshot_digest)]:[];
  try{await db.batch([...publicationGuard,stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_offers o JOIN identity_offer_heads h ON h.account_id=o.account_id AND h.offer_id=o.id AND h.generation=o.generation WHERE o.id=? AND token_hash=? AND offer_digest=? AND state='pending' AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE json('offer-decision-changed') END",o.id,tokenHash,o.offer_digest,now),stmt('UPDATE identity_offers SET state=?,decided_at=? WHERE id=? AND state=\'pending\'',next,now,o.id),stmt('INSERT INTO identity_offer_audit VALUES(?,?,?,?)',randomIdentityId(),o.id,next,now)]);}catch{const race=await one<Offer>('SELECT * FROM identity_offers WHERE id=?',o.id);if(race?.state!==next)fail(409,'offer_decision_changed');}
  return json({state:next,nextAction:next==='accepted'?'resident-continue':'none'});
 }
 return {async fetch(request:Request):Promise<Response|null>{
  const u=new URL(request.url);if(!['/api/v1/agent/identity/offer','/api/v1/agent/identity/offer/renew','/api/v1/identity/offer/decision','/api/v1/identity/offer/inspect'].includes(u.pathname))return null;
  try{
   if(u.origin!==env.origin||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==env.origin)fail(403,'origin_rejected');
   if(u.search)fail(400,'invalid_offer_request');
   if(u.pathname.endsWith('/decision')||u.pathname.endsWith('/inspect')){if(request.method!=='POST')fail(405,'method_not_allowed');return await decide(request,u.pathname.endsWith('/inspect'));}
   if(u.pathname.endsWith('/renew')){if(request.method!=='POST')fail(405,'method_not_allowed');return await create(request,true);}
   if(request.method==='POST')return await create(request);if(request.method!=='GET')fail(405,'method_not_allowed');
   const a=await auth(request,false),o=await find(a.accountId);return privateResponse(a,o);
  }catch(error){return error instanceof OfferError?json({error:error.message},error.status):json({error:'identity_offer_unavailable'},503);}
 }};
}
