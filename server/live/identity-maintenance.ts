import type {Database} from './db.ts';
import {readRequestBody,RequestBodyError} from './request-body.ts';
import {authenticationOptions,verifyGuardianAssertion} from './identity-webauthn.ts';
import {hashIdentityInput,hashPrivate,randomIdentityId,validContactKey,identityCreationStamp} from './identity-private.ts';
interface Environment {db:Database;origin:string;contactKey?:string;now?:()=>Date;bodyReadTimeoutMs?:number}
interface Ready {agent_id:string;account_id:string;room_id:string;resident_id:string;version:number;authority_epoch:number;guardian_id:string;guardian_version:number;name:string;maintenance_version:number}
interface Pending {id:string;agent_id:string;account_id:string;guardian_id:string;guardian_version:number;identity_version:number;authority_epoch:number;maintenance_version:number;candidate_hash:string;candidate_offline_hash:string;request_key:string;input_hash:string;purpose:string;state:string;token_id:string|null;created_at:string;expires_at:string;approved_at:string|null;credential_expires_at:string|null;completion_key:string|null;completion_hash:string|null}
interface Challenge {id:string;request_id:string;request_key:string;input_hash:string;options_json:string;credential_id:string|null;public_key:string|null;webauthn_user_id:string|null;created_at:string;expires_at:string;consumed_at:string|null}
interface Passkey {credential_id:string;guardian_id:string;agent_id:string;webauthn_user_id:string;public_key:string;counter:number;revoked_at:string|null}
class Rejection extends Error {status:number;constructor(status:number,code:string){super(code);this.status=status;}}
const fail=(status:number,code:string):never=>{throw new Rejection(status,code);};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}});
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))fail(400,'invalid_maintenance_request');}
function field(v:unknown,pattern:RegExp){if(typeof v!=='string'||!pattern.test(v))fail(400,'invalid_maintenance_request');return v as string;}
const id=(v:unknown)=>field(v,/^[a-f0-9]{32}$/),key=(v:unknown)=>field(v,/^[\x20-\x7e]{8,96}$/);
/** Passkey-approved operational handover/renewal. Never changes identity, address, cards or backups. */
export function createIdentityMaintenance(env:Environment){
 const {db}=env,stamp=()=>(env.now?.()??new Date()).toISOString(),stmt=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args),one=<T>(sql:string,...args:unknown[])=>stmt(sql,...args).first<T>();
 const guard=(sql:string,...args:unknown[])=>stmt("SELECT CASE WHEN ("+sql+") THEN 1 ELSE json('maintenance-conflict') END",...args);
 const readySQL="SELECT i.*,g.guardian_id,g.version guardian_version,r.name,COALESCE(m.version,0) maintenance_version FROM agent_identities i JOIN identity_guardians g ON g.agent_id=i.agent_id JOIN identity_guardian_invites v ON v.id=g.invitation_id AND v.agent_id=i.agent_id AND v.state='registered' JOIN tower_residencies t ON t.account_id=i.account_id AND t.room_id=i.room_id AND t.resident_id=i.resident_id JOIN rooms r ON r.id=i.room_id AND r.account_id=i.account_id LEFT JOIN maintenance_authorities m ON m.account_id=i.account_id WHERE i.agent_id=? AND i.state='active' AND EXISTS(SELECT 1 FROM identity_guardian_passkeys p WHERE p.guardian_id=g.guardian_id AND p.agent_id=i.agent_id AND p.revoked_at IS NULL)";
 const ready=async(agent:string)=>{const i=await one<Ready>(readySQL,agent);if(!i)fail(403,'maintenance_not_available');return i!;};
 const get=(requestId:string)=>one<Pending>('SELECT * FROM maintenance_requests WHERE id=?',requestId);
 const digest=(parts:unknown[])=>hashPrivate(env.contactKey!,'maintenance-authorization',JSON.stringify(parts));
 const live=(r:Pending)=>guard("EXISTS(SELECT 1 FROM maintenance_requests WHERE id=? AND state='pending' AND created_at<=? AND expires_at>? AND created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",r.id,stamp(),stamp());
 const binding=(r:Pending)=>guard('EXISTS('+readySQL+' AND i.account_id=? AND i.version=? AND i.authority_epoch=? AND g.guardian_id=? AND g.version=? AND COALESCE(m.version,0)=?)',r.agent_id,r.account_id,r.identity_version,r.authority_epoch,r.guardian_id,r.guardian_version,r.maintenance_version);
 const fresh=(sha:string,offlineHash:string)=>guard("NOT EXISTS(SELECT 1 FROM identity_secret_history WHERE secret_hash=?) AND NOT EXISTS(SELECT 1 FROM identity_recovery_requests WHERE candidate_hash=?) AND NOT EXISTS(SELECT 1 FROM identity_offline_recovery_codes WHERE code_hash=?)",sha,sha,offlineHash);
 const status=async(r:Pending)=>{
  const t=r.token_id?await one<{expires_at:string;revoked:number}>('SELECT expires_at,revoked FROM tower_tokens WHERE id=? AND account_id=?',r.token_id,r.account_id):null;
  return {requestId:r.id,agentId:r.agent_id,purpose:r.purpose,state:r.state==='pending'&&r.expires_at<=stamp()?'expired':r.state,candidateFingerprint:r.candidate_hash,expiresAt:r.expires_at,guardianURL:env.origin+'/identity/maintenance',...(r.state==='approved'?{roomId:(await ready(r.agent_id)).room_id,approvedAt:r.approved_at,credentialExpiresAt:r.credential_expires_at,credentialState:!t||t.revoked?'revoked':t.expires_at<=stamp()?'expired':'active'}:{} )};
 };
 async function input(req:Request){if(!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(req.headers.get('Content-Type')??''))fail(415,'json_required');const bytes=await readRequestBody(req,32768,env.bodyReadTimeoutMs);let v:unknown;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'invalid_json');}if(!record(v))fail(400,'invalid_maintenance_request');return v as Record<string,unknown>;}
 async function throttle(req:Request){const ip=await digest(['ip',req.headers.get('CF-Connecting-IP')??'unknown']);const r=await one<{count:number}>("INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 minute')) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN excluded.expires_at ELSE expires_at END RETURNING count",'maintenance:'+ip);if(!r||r.count>60)fail(429,'maintenance_rate_limited');}
 return {async fetch(req:Request):Promise<Response|null>{
  const url=new URL(req.url),create=url.pathname==='/api/v1/identity/maintenance/requests',read=url.pathname.match(/^\/api\/v1\/identity\/maintenance\/requests\/([a-f0-9]{32})$/),action=url.pathname.match(/^\/api\/v1\/identity\/guardian\/maintenance\/(context|options|complete)$/)?.[1];
  if(!create&&!read&&!action)return null;
  try{
   if(url.origin!==env.origin)fail(403,'host_rejected');if(url.search)fail(400,'query_not_allowed');
   if(req.headers.has('X-Identity-Candidate-Key')||req.headers.has('Cookie')||req.headers.has('Authorization')||req.headers.get('Sec-Fetch-Site')==='cross-site'||(req.headers.has('Origin')&&req.headers.get('Origin')!==env.origin))fail(403,'origin_rejected');
   if(req.method!==(read?'GET':'POST'))fail(405,'method_not_allowed');if(!validContactKey(env.contactKey)||new URL(env.origin).protocol!=='https:')fail(503,'maintenance_not_configured');await throttle(req);
   if(create||read){
    const supplied=req.headers.get('X-Maintenance-Candidate-Key');if(!supplied||!/^[a-f0-9]{64}$/.test(supplied))fail(403,'candidate_rejected');const sha=await hashIdentityInput(supplied!);
    if(read){const r=await get(read[1]);if(!r||r.candidate_hash!==sha)fail(403,'candidate_rejected');return json(await status(r!));}
    const v=await input(req);exact(v,['agentId','requestKey','purpose']);field(v.agentId,/^mcid:[a-f0-9]{64}$/);key(v.requestKey);if(!['handover','renewal'].includes(String(v.purpose)))fail(400,'invalid_maintenance_request');
    const h=await digest(['create',v.agentId,v.requestKey,v.purpose,sha]);
    const previous=async()=>{const r=await one<Pending>('SELECT * FROM maintenance_requests WHERE candidate_hash=?',sha);if(!r)return null;if(r.input_hash!==h||r.request_key!==v.requestKey)fail(409,'idempotency_conflict');return json(await status(r),201);};
    const prior=await previous();if(prior)return prior;
    const i=await ready(v.agentId as string),created=await identityCreationStamp(db,stamp),expires=new Date(Date.parse(created)+3600000).toISOString(),requestId=randomIdentityId();
    const r:Pending={id:requestId,agent_id:i.agent_id,account_id:i.account_id,guardian_id:i.guardian_id,guardian_version:i.guardian_version,identity_version:i.version,authority_epoch:i.authority_epoch,maintenance_version:i.maintenance_version,candidate_hash:sha,candidate_offline_hash:await hashPrivate(env.contactKey!,'identity-offline-recovery',supplied!),request_key:v.requestKey as string,input_hash:h,purpose:v.purpose as string,state:'pending',token_id:null,approved_at:null,credential_expires_at:null,completion_key:null,completion_hash:null,created_at:created,expires_at:expires};
    try{await db.batch([binding(r),fresh(sha,r.candidate_offline_hash),guard("(SELECT COUNT(*) FROM maintenance_requests WHERE agent_id=? AND state='pending' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))<3 AND (SELECT COUNT(*) FROM maintenance_requests WHERE created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))<1000",r.agent_id),stmt('INSERT INTO maintenance_requests(id,agent_id,account_id,guardian_id,guardian_version,identity_version,authority_epoch,maintenance_version,candidate_hash,candidate_offline_hash,request_key,input_hash,purpose,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',r.id,r.agent_id,r.account_id,r.guardian_id,r.guardian_version,r.identity_version,r.authority_epoch,r.maintenance_version,sha,r.candidate_offline_hash,r.request_key,h,r.purpose,created,expires)]);}catch{const retry=await previous();if(retry)return retry;fail(409,'maintenance_conflict');}
    return json(await status(r),201);
   }
   if(req.headers.has('X-Maintenance-Candidate-Key')||req.headers.has('X-Identity-Candidate-Key'))fail(403,'separate_guardian_authorization_required');
   const v=await input(req);id(v.requestId);const r=await get(v.requestId as string);if(!r)fail(403,'maintenance_rejected');
   if(action==='context'){exact(v,['requestId']);const i=await ready(r!.agent_id);return json({...await status(r!),name:i.name,roomId:i.room_id,residentId:i.resident_id,scopes:['tower:read','tower:write'],credentialLifetimeDays:30,replacesPreviousMaintenanceKeys:true});}
   key(v.requestKey);
   if(action==='options'){
    exact(v,['requestId','requestKey']);const h=await digest(['options',r!.id,v.requestKey]);
    const prior=await one<Challenge>('SELECT * FROM maintenance_challenges WHERE request_id=? AND request_key=?',r!.id,v.requestKey);
    await db.batch([live(r!),binding(r!)]);
    if(prior){if(prior.input_hash!==h)fail(409,'idempotency_conflict');if(prior.consumed_at||prior.expires_at<=stamp())fail(409,'maintenance_challenge_expired');return json({challengeId:prior.id,expiresAt:prior.expires_at,options:JSON.parse(prior.options_json)});}
    const opts=await authenticationOptions(env.origin),created=await identityCreationStamp(db,stamp),expires=new Date(Math.min(Date.parse(created)+300000,Date.parse(r!.expires_at))).toISOString(),challengeId=randomIdentityId();
    await db.batch([live(r!),binding(r!),guard('(SELECT COUNT(*) FROM maintenance_challenges WHERE request_id=?)<10',r!.id),stmt('INSERT INTO maintenance_challenges(id,request_id,request_key,input_hash,options_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',challengeId,r!.id,v.requestKey,h,JSON.stringify(opts),created,expires)]);
    return json({challengeId,expiresAt:expires,options:opts});
   }
   exact(v,['requestId','requestKey','challengeId','response']);id(v.challengeId);if(!record(v.response)||typeof v.response.id!=='string')fail(403,'passkey_rejected');
   const c=await one<Challenge>('SELECT * FROM maintenance_challenges WHERE id=? AND request_id=?',v.challengeId,r!.id);if(!c)fail(403,'passkey_rejected');
   const h=await digest(['complete',r!.id,v.requestKey,v.challengeId,JSON.stringify(v.response)]);
   const p=await one<Passkey>('SELECT * FROM identity_guardian_passkeys WHERE credential_id=? AND guardian_id=? AND agent_id=?',(v.response as Record<string,unknown>).id,r!.guardian_id,r!.agent_id);
   if(r!.state==='approved'){
    if(r!.completion_key!==v.requestKey||r!.completion_hash!==h||!c!.consumed_at||!c!.credential_id||!c!.public_key||!c!.webauthn_user_id)fail(409,'idempotency_conflict');
    try{await verifyGuardianAssertion(v.response,JSON.parse(c!.options_json).challenge,env.origin,new URL(env.origin).hostname,{credential_id:c!.credential_id!,public_key:c!.public_key!,webauthn_user_id:c!.webauthn_user_id!,counter:0});}catch{fail(403,'passkey_rejected');}
    return json(await status(r!));
   }
   if(!p||p.revoked_at||c!.consumed_at)fail(403,'passkey_rejected');
   if(c!.expires_at<=stamp()||r!.expires_at<=stamp())fail(409,'maintenance_request_expired');
   let verified;try{verified=await verifyGuardianAssertion(v.response,JSON.parse(c!.options_json).challenge,env.origin,new URL(env.origin).hostname,p!);}catch{fail(403,'passkey_rejected');}
   const approved=await identityCreationStamp(db,stamp),expires=new Date(Date.parse(approved)+30*86400000).toISOString(),tokenId=randomIdentityId();
   await db.batch([
    live(r!),binding(r!),guard("EXISTS(SELECT 1 FROM maintenance_challenges WHERE id=? AND request_id=? AND consumed_at IS NULL AND created_at<=? AND expires_at>? AND created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",c!.id,r!.id,approved,approved),
    guard('EXISTS(SELECT 1 FROM identity_guardian_passkeys WHERE credential_id=? AND guardian_id=? AND agent_id=? AND counter=? AND public_key=? AND revoked_at IS NULL)',p!.credential_id,r!.guardian_id,r!.agent_id,p!.counter,p!.public_key),
    fresh(r!.candidate_hash,r!.candidate_offline_hash),
    stmt('INSERT INTO maintenance_authorities(account_id,version) VALUES(?,1) ON CONFLICT(account_id) DO UPDATE SET version=version+1',r!.account_id),
    stmt('UPDATE tower_tokens SET revoked=1 WHERE account_id=?',r!.account_id),
    stmt('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,\'["tower:read","tower:write"]\',?,?)',tokenId,r!.account_id,r!.candidate_hash,expires,approved),
    stmt('UPDATE identity_guardian_passkeys SET counter=? WHERE credential_id=?',verified!.newCounter,p!.credential_id),
    stmt('UPDATE maintenance_challenges SET consumed_at=?,credential_id=?,public_key=?,webauthn_user_id=? WHERE id=?',approved,p!.credential_id,p!.public_key,p!.webauthn_user_id,c!.id),
    stmt("UPDATE maintenance_requests SET state='approved',token_id=?,approved_at=?,credential_expires_at=?,completion_key=?,completion_hash=? WHERE id=?",tokenId,approved,expires,v.requestKey,h,r!.id),
    stmt("INSERT INTO tower_audit(id,account_id,room_id,action,revision,detail_json,created_at) SELECT ?,account_id,room_id,'maintenance-authorized',NULL,?,? FROM agent_identities WHERE agent_id=?",randomIdentityId(),JSON.stringify({requestId:r!.id,purpose:r!.purpose,tokenId,expiresAt:expires}),approved,r!.agent_id),
    stmt("INSERT INTO identity_audit(id,agent_id,action,detail_json,created_at) VALUES(?,?,'maintenance-authorized',?,?)",randomIdentityId(),r!.agent_id,JSON.stringify({requestId:r!.id,tokenId,expiresAt:expires}),approved),
   ]);
   return json(await status((await get(r!.id))!));
  }catch(error){if(error instanceof Rejection)return json({error:error.message},error.status);if(error instanceof RequestBodyError)return json({error:error.code},error.status);return json({error:'maintenance_conflict'},409);}
 }};
}
