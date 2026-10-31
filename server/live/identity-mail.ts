import {identityMailDeliveryReady} from './identity-mail-control.ts';
import type {Database} from './db.ts';
import type {IdentityCardNamespace} from './identity-card-proxy.ts';
import {validContactKey,validateGuardianEmail} from './identity-private.ts';
import {senderDomain} from './identity-mail-readiness.ts';
import {IDENTITY_MAIL_INTERNAL_PREFIX,identityMailSchemaReady,safeIdentityMailProviderError,type IdentityMailFinish} from './identity-mail-contract.ts';
export interface IdentityMailEnvironment {db:Database;origin:string;contactKey?:string;apiKey?:string;from?:string;coordinator?:IdentityCardNamespace;deliveryEnabled?:string;fetcher?:typeof fetch;now?:()=>Date}
export interface IdentityMailStatus {id:string;state:string;providerId:string|null;attemptCount:number;errorCode:string|null}
function trustedOrigin(value:string){try{return new URL(value).origin===value&&value.startsWith('https://');}catch{return false;}}
/** Bound all control/provider reads. The claimed body is never consumed in Pages. */
async function smallJson(response:Response):Promise<Record<string,unknown>>{
 const reader=response.body?.getReader();if(!reader)throw Error('empty');let raw='',size=0;
 try{const decoder=new TextDecoder('utf-8',{fatal:true});for(;;){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>8192){await reader.cancel();throw Error('size');}raw+=decoder.decode(p.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
 const v:unknown=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v))throw Error('shape');return v as Record<string,unknown>;
}
/** Pages dispatches persisted IDs only. Provider keys stay here, outside the private DO. */
export function createIdentityMail(env:IdentityMailEnvironment){
 const db=env.db;
 // This is an execution configuration switch, not delivery/webhook verification (I05c).
 const configured=()=>env.deliveryEnabled==='true'&&!!env.coordinator&&typeof env.coordinator.idFromName==='function'&&typeof env.coordinator.get==='function'&&validContactKey(env.contactKey)&&typeof env.apiKey==='string'&&env.apiKey.trim().length>0&&!!senderDomain(env.from)&&trustedOrigin(env.origin);
 async function status(id:string):Promise<IdentityMailStatus|null>{if(!/^[a-f0-9]{32}$/.test(id))return null;const r=await db.prepare('SELECT id,state,provider_id,attempt_count,error_code FROM identity_mail_events WHERE id=?').bind(id).first<{id:string;state:string;provider_id:string|null;attempt_count:number;error_code:string|null}>();return r?{id:r.id,state:r.state,providerId:r.provider_id,attemptCount:r.attempt_count,errorCode:r.error_code}:null;}
 const rpc=(action:string,payload:unknown,eventId:string)=>env.coordinator!.get(env.coordinator!.idFromName('mail:'+eventId.slice(0,2))).fetch(new Request(env.origin+IDENTITY_MAIL_INTERNAL_PREFIX+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));
 return {configured,status,async processOne(id:string):Promise<IdentityMailStatus|null>{
  const current=await status(id);if(!current||current.state!=='pending'||current.attemptCount!==0||!configured())return current;
  try{
   if(!await identityMailSchemaReady(db)||!await identityMailDeliveryReady(db,env.origin,env.contactKey,env.from,env.now?.()))return current;
   const prepared=await rpc('prepare',{eventId:id},id);if(!prepared.ok)return status(id);
   const m=await smallJson(prepared),d=m.descriptor as Record<string,unknown>|undefined;
   if(!d||d.eventId!==id||typeof d.bodyDigest!=='string'||!/^[a-f0-9]{64}$/.test(d.bodyDigest)||!Number.isSafeInteger(d.bodyLength)||(d.bodyLength as number)<1||(d.bodyLength as number)>12582912||typeof m.recipient!=='string'||validateGuardianEmail(m.recipient)!==m.recipient||!senderDomain(m.from)||m.from!==env.from)return status(id);
   const response=await (env.fetcher??fetch)('https://api.resend.com/suppressions/'+encodeURIComponent(m.recipient),{method:'GET',headers:{Authorization:'Bearer '+env.apiKey},signal:AbortSignal.timeout(15000),redirect:'manual'});
   if(response.status===200){
    const suppression=await smallJson(response);
    // Resend uses origin (bounce/complaint/manual), not a marketing subscription state.
    if(suppression.object==='suppression'&&typeof suppression.id==='string'&&suppression.id.length>0&&suppression.id.length<=128&&typeof suppression.email==='string'&&validateGuardianEmail(suppression.email).toLowerCase()===m.recipient.toLowerCase()&&['bounce','complaint','manual'].includes(String(suppression.origin))&&(suppression.source_id===null||typeof suppression.source_id==='string')&&typeof suppression.created_at==='string'&&Number.isFinite(Date.parse(suppression.created_at))){await rpc('suppress',{eventId:id,bodyDigest:d.bodyDigest,reason:suppression.origin},id);}
    return status(id);
   }
   if(response.status!==404)return status(id);
   const claimed=await rpc('claim',{eventId:id,bodyDigest:d.bodyDigest},id);
   if(!claimed.ok)return status(id);
   const leaseId=claimed.headers.get('X-Identity-Mail-Lease');if(!leaseId||!/^[a-f0-9]{32}$/.test(leaseId)||!claimed.body){await claimed.body?.cancel();return status(id);}
   const result:IdentityMailFinish={eventId:id,leaseId,state:'unknown',providerId:null,errorCode:'provider_outcome_unknown'};
   try{
    const init:RequestInit&{duplex?:'half'}={method:'POST',headers:{Authorization:'Bearer '+env.apiKey,'Content-Type':'application/json','Idempotency-Key':id},body:claimed.body,signal:AbortSignal.timeout(15000),redirect:'manual',duplex:'half'};
    const sent=await (env.fetcher??fetch)('https://api.resend.com/emails',init);
    if(sent.ok){const v=await smallJson(sent);if(typeof v.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v.id)){result.state='accepted';result.providerId=v.id;result.errorCode=null;}}
    else if(sent.status>=400&&sent.status<500&&![408,409,425,429].includes(sent.status)){
     result.state='failed';result.errorCode='provider_rejected_'+sent.status;
     try{const v=await smallJson(sent);if(safeIdentityMailProviderError(v.name))result.errorCode+=':'+v.name;}catch{/* Never retain raw provider errors. */}
    }
   }catch{/* Ambiguous result remains unknown. There is no automatic second POST. */}
   await rpc('finish',result,id);return status(id);
  }catch{/* Pre-claim leaves pending; lost claim ack leaves sending; lost finish ack never reclaims. */return status(id);}
 }};
}
