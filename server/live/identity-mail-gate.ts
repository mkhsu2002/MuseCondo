import type {Database} from './db.ts';
import {decryptPrivate,hashIdentityInput,validContactKey} from './identity-private.ts';
import {senderDomain} from './identity-mail-readiness.ts';
/** Sender and handler observations expire after 24 hours; both clocks must agree. */
const format="'%Y-%m-%dT%H:%M:%fZ'",nativeNow='strftime('+format+",'now')";
const canonical=(value:string)=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const fresh=(value:string,clock:string)=>`(${value} IS NOT NULL AND strftime(${format},${value})=${value} AND ${value}<=${clock} AND ${value}>=strftime(${format},${clock},'-24 hours'))`;
export interface IdentityMailDeliveryProof {provider_id:string;secret_ciphertext:string;handler_probe_at:string;check_id:string;completed_at:string;input_hash:string;domain:string}
// Latest attempt for this exact FROM/origin wins: a pending or negative fresh check cannot reuse an older success.
const context=`FROM identity_mail_webhook_setups s JOIN identity_mail_provider_checks c ON c.id=(SELECT id FROM identity_mail_provider_checks WHERE input_hash=? ORDER BY rowid DESC LIMIT 1)
 WHERE s.origin=? AND s.endpoint=? AND s.state='ready' AND s.provider_id IS NOT NULL AND s.secret_ciphertext IS NOT NULL
 AND c.state='complete' AND c.response_status=200 AND c.domain=? AND json_type(c.result_json)='object'
 AND json_extract(c.result_json,'$.checkId')=c.id AND json_extract(c.result_json,'$.state')='ready'
 AND json_extract(c.result_json,'$.reason')='sender_verified' AND json_extract(c.result_json,'$.domain')=c.domain
 AND json_type(c.result_json,'$.domainVerified')='true' AND json_type(c.result_json,'$.sendingEnabled')='true'
 AND json_type(c.result_json,'$.senderReady')='true' AND json_type(c.result_json,'$.deliveryVerified')='false'
 AND json_extract(c.result_json,'$.checkedAt')=c.completed_at
 AND strftime(${format},c.created_at)=c.created_at AND c.created_at<=c.completed_at
 AND ${fresh('s.handler_probe_at',nativeNow)} AND ${fresh('c.completed_at',nativeNow)}`;
/** Internal proof only; never return its ciphertext or private binding to an operator/public response. */
export async function identityMailDeliveryProof(db:Database,origin:string,key:string|undefined,from:string|undefined,now:Date=new Date()):Promise<IdentityMailDeliveryProof|null>{
 try{
  const stamp=now.toISOString(),domain=senderDomain(from);if(!canonical(stamp)||!domain||!validContactKey(key)||new URL(origin).origin!==origin||!origin.startsWith('https://'))return null;
  const inputHash=await hashIdentityInput(JSON.stringify(['identity-mail-provider:input',from??null,origin]));
  const proof=await db.prepare('SELECT s.provider_id,s.secret_ciphertext,s.handler_probe_at,c.id check_id,c.completed_at,c.input_hash,c.domain '+context+' AND '+fresh('s.handler_probe_at','?')+' AND '+fresh('c.completed_at','?')).bind(inputHash,origin,origin+'/api/v1/identity/mail/webhook',domain,stamp,stamp,stamp,stamp).first<IdentityMailDeliveryProof>();
  if(!proof||!/^[-A-Za-z0-9_]{1,128}$/.test(proof.provider_id))return null;
  const secret=await decryptPrivate(key,'mail-webhook-secret',origin,proof.secret_ciphertext);
  if(!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)||secret.length>700||atob(secret.slice(6)).length<16)return null;
  return proof;
 }catch{return null;}
}
export async function identityMailDeliveryReady(db:Database,origin:string,key?:string,from?:string,now?:Date){return !!await identityMailDeliveryProof(db,origin,key,from,now);}
/** Construct immediately before the claim batch; native time and every observed binding are rechecked atomically. */
export function identityMailDeliveryGuard(db:Database,origin:string,proof:IdentityMailDeliveryProof,now:Date=new Date()){
 const stamp=now.toISOString();
 return db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 "+context+' AND s.provider_id=? AND s.secret_ciphertext=? AND s.handler_probe_at=? AND c.id=? AND c.completed_at=? AND '+fresh('s.handler_probe_at','?')+' AND '+fresh('c.completed_at','?')+") THEN 1 ELSE json('delivery-handler-not-ready') END").bind(proof.input_hash,origin,origin+'/api/v1/identity/mail/webhook',proof.domain,proof.provider_id,proof.secret_ciphertext,proof.handler_probe_at,proof.check_id,proof.completed_at,stamp,stamp,stamp,stamp);
}
