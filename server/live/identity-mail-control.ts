export const IDENTITY_MAIL_CONTROL_SCHEMA=["identity_mail_webhook_setups", "identity_mail_control_requests", "identity_mail_control_results", "identity_mail_control_audit", "identity_mail_handler_probes", "identity_mail_webhook_binding", "identity_mail_webhook_permanent", "identity_mail_control_request_immutable", "identity_mail_control_request_permanent", "identity_mail_control_result_immutable", "identity_mail_control_result_permanent", "identity_mail_control_audit_immutable", "identity_mail_control_audit_permanent", "identity_mail_probe_binding", "identity_mail_probe_permanent", "identity_mail_webhook_setups_insert_once", "identity_mail_control_requests_insert_once", "identity_mail_control_results_insert_once", "identity_mail_control_audit_insert_once", "identity_mail_handler_probes_insert_once"] as const;
import type {Database} from './db.ts';
import {encryptPrivate,decryptPrivate,hashPrivate,validContactKey,randomIdentityId} from './identity-private.ts';
import {createIdentityMailDelivery} from './identity-mail-delivery.ts';
export const IDENTITY_MAIL_WEBHOOK_PATH='/api/v1/identity/mail/webhook';
export const IDENTITY_MAIL_CONTROL_PREFIX='/api/v1/operator/identity/mail-delivery/';
export const IDENTITY_MAIL_WEBHOOK_EVENTS=['email.delivered','email.bounced','email.complained','email.failed','email.suppressed'];
interface Environment {db:Database;origin:string;contactKey?:string;apiKey?:string;operator:(r:Request)=>Promise<boolean>;fetcher?:typeof fetch;now?:()=>Date}
interface Setup {origin:string;endpoint:string;setup_request_key:string;lease_id:string;state:string;provider_id:string|null;secret_ciphertext:string|null;handler_probe_at:string|null;error_code:string|null;created_at:string;updated_at:string}
class ControlError extends Error {readonly status:number;constructor(status:number,code:string){super(code);this.status=status;}}
function fail(status:number,code:string):never{throw new ControlError(status,code);}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const safeId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function validSecret(v:unknown):v is string{if(typeof v!=='string'||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(v)||v.length>700)return false;try{return atob(v.slice(6)).length>=16;}catch{return false;}}
async function raw(request:Request,limit=4096){const declared=request.headers.get('Content-Length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))fail(413,'body_too_large');const reader=request.body?.getReader();if(!reader)fail(400,'invalid_mail_control');const parts:Uint8Array[]=[];let total=0;try{for(;;){const p=await reader.read();if(p.done)break;total+=p.value.length;if(total>limit){try{await reader.cancel();}catch{/* Preserve error. */}fail(413,'body_too_large');}parts.push(p.value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(total);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return bytes;}
async function providerJSON(response:Response){const bytes=await raw(new Request('https://control.invalid',{method:'POST',body:response.body,duplex:'half'} as RequestInit),65536);const v:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!object(v))throw Error('shape');return v;}
export async function identityMailDeliveryReady(db:Database,origin:string,key?:string){try{if(!validContactKey(key))return false;const row=await db.prepare("SELECT secret_ciphertext FROM identity_mail_webhook_setups WHERE origin=? AND endpoint=? AND state='ready' AND secret_ciphertext IS NOT NULL AND provider_id IS NOT NULL AND handler_probe_at IS NOT NULL").bind(origin,origin+IDENTITY_MAIL_WEBHOOK_PATH).first<{secret_ciphertext:string}>();return !!row&&validSecret(await decryptPrivate(key,'mail-webhook-secret',origin,row.secret_ciphertext));}catch{return false;}}
/** Pages-only control plane. Its fetcher never follows redirects or accepts user-chosen URLs. */
export function createIdentityMailControl(env:Environment){
 const db=env.db,stamp=()=>(env.now?.()??new Date()).toISOString(),endpoint=env.origin+IDENTITY_MAIL_WEBHOOK_PATH;
 const stmt=(s:string,...v:unknown[])=>db.prepare(s).bind(...v),one=<T>(s:string,...v:unknown[])=>stmt(s,...v).first<T>();
 const current=()=>one<Setup>('SELECT * FROM identity_mail_webhook_setups WHERE origin=?',env.origin);
 function configured(){try{if(!env.origin.startsWith('https://')||new URL(env.origin).origin!==env.origin||!validContactKey(env.contactKey)||!env.apiKey?.trim())fail(503,'mail_control_not_configured');}catch{fail(503,'mail_control_not_configured');}}
 const requestProvider=async(path:string,init:RequestInit={})=>{const r=await (env.fetcher??fetch)('https://api.resend.com'+path,{...init,headers:{Authorization:'Bearer '+env.apiKey,...init.headers},redirect:'manual',signal:AbortSignal.timeout(15000)});if(!r.ok){try{await r.body?.cancel();}catch{/* No provider text retained. */}throw Error('provider_http_'+r.status);}return providerJSON(r);};
 async function receipt(key:string){const r=await one<{result_json:string;status:number}>('SELECT * FROM identity_mail_control_results WHERE request_key=?',key);return r?json(JSON.parse(r.result_json),r.status):null;}
 async function finish(key:string,value:unknown,status=200){try{await db.batch([stmt('INSERT INTO identity_mail_control_results VALUES(?,?,?,?)',key,JSON.stringify(value),status,stamp()),stmt('INSERT INTO identity_mail_control_audit VALUES(?,?,?,?,?)',randomIdentityId(),key,'completed',JSON.stringify(value),stamp())]);}catch{const prior=await receipt(key);if(prior)return prior;fail(503,'mail_control_unavailable');}return json(value,status);}
 const safeSetup=(s:Setup|null)=>({configured:s?.state==='ready',handlerVerified:!!s?.handler_probe_at,state:s?.state??'not-configured',providerId:s?.provider_id??null,deliveryVerified:false,errorCode:s?.error_code??null});
 async function secret(){const s=await current();if(!s||s.state!=='ready'||!s.secret_ciphertext||s.endpoint!==endpoint||!validContactKey(env.contactKey))fail(503,'webhook_not_configured');const value=await decryptPrivate(env.contactKey,'mail-webhook-secret',env.origin,s.secret_ciphertext);if(!validSecret(value))fail(503,'webhook_not_configured');return value;}
 const delivery=()=>createIdentityMailDelivery({db,origin:env.origin,contactKey:env.contactKey!,now:env.now,webhookSecret:secret});
 function hookValid(v:Record<string,unknown>){return v.object==='webhook'&&safeId(v.id)&&v.endpoint===endpoint&&v.status==='enabled'&&Array.isArray(v.events)&&v.events.length===5&&new Set(v.events).size===5&&IDENTITY_MAIL_WEBHOOK_EVENTS.every(e=>(v.events as unknown[]).includes(e))&&validSecret(v.signing_secret);}
 async function ownHook(){let after='',matches:Record<string,unknown>[]=[];const seen=new Set<string>();for(let page=0;page<3;page++){const value=await requestProvider('/webhooks?limit=100'+(after?'&after='+encodeURIComponent(after):''));if(value.object!=='list'||!Array.isArray(value.data)||typeof value.has_more!=='boolean'||value.data.length>100||!value.data.every(object))throw Error('invalid_list');matches=matches.concat((value.data as Record<string,unknown>[]).filter(v=>v.endpoint===endpoint));if(matches.length>1)throw Error('ambiguous_hooks');if(!value.has_more)return matches[0]??null;const id=(value.data.at(-1) as Record<string,unknown>|undefined)?.id;if(!safeId(id)||seen.has(id))throw Error('invalid_cursor');seen.add(id);after=id;}throw Error('list_bound');}
 async function configure(req:Request,key:string,operation:string){
  let s=await current();if(!s){if(operation!=='setup')return safeSetup(null);const lease=randomIdentityId();try{await db.batch([stmt("INSERT INTO identity_mail_webhook_setups VALUES(?,?,?,?,'intent',NULL,NULL,NULL,NULL,?,?)",env.origin,endpoint,key,lease,stamp(),stamp()),stmt('INSERT INTO identity_mail_control_audit VALUES(?,?,?,?,?)',randomIdentityId(),key,'setup-intent','{}',stamp())]);}catch{/* Another request owns the durable setup lease. */}s=await current();}
  if(!s||s.endpoint!==endpoint)fail(503,'mail_control_unavailable');
  if(s.state==='ready'&&operation==='setup')return safeSetup(s);
  try{
   let hook:Record<string,unknown>|null=null;
   if(s.provider_id)hook=await requestProvider('/webhooks/'+encodeURIComponent(s.provider_id));
   else{
    const listed=await ownHook();
    if(listed){if(!safeId(listed.id))throw Error('invalid_id');hook=await requestProvider('/webhooks/'+encodeURIComponent(listed.id));}
    else if(s.state==='intent'&&s.setup_request_key===key&&operation==='setup'){
     if(!await env.operator(req))fail(401,'operator_required');
     const creatingAt=stamp();
     try{await db.batch([stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_mail_webhook_setups WHERE origin=? AND state='intent' AND setup_request_key=? AND lease_id=?) THEN 1 ELSE json('setup-lease-changed') END",env.origin,key,s.lease_id),stmt("UPDATE identity_mail_webhook_setups SET state='creating',updated_at=? WHERE origin=? AND state='intent' AND setup_request_key=? AND lease_id=?",creatingAt,env.origin,key,s.lease_id),stmt('INSERT INTO identity_mail_control_audit VALUES(?,?,?,?,?)',randomIdentityId(),key,'create-leased','{}',stamp())]);}catch{return safeSetup(await current());}
     s={...s,state:'creating',updated_at:creatingAt};
     const created=await requestProvider('/webhooks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint,events:IDENTITY_MAIL_WEBHOOK_EVENTS})});
     if(!safeId(created.id))throw Error('invalid_create');
     const providerAt=stamp(),bound=await stmt('UPDATE identity_mail_webhook_setups SET provider_id=?,updated_at=? WHERE origin=? AND lease_id=? AND provider_id IS NULL',created.id,providerAt,env.origin,s.lease_id).run();
     if(bound.meta.changes===1)s={...s,provider_id:created.id as string,updated_at:providerAt};
     hook=await requestProvider('/webhooks/'+encodeURIComponent(created.id));
    }
   }
   if(!hook){await stmt("UPDATE identity_mail_webhook_setups SET state=CASE WHEN state='intent' THEN state ELSE 'unknown' END,error_code='setup_outcome_unknown',updated_at=? WHERE origin=? AND state!='ready'",stamp(),env.origin).run();return safeSetup(await current());}
   if(!hookValid(hook))throw Error('hook_contract_mismatch');
   s=(await current())!;if(s.provider_id&&s.provider_id!==hook.id)throw Error('hook_id_mismatch');
   const ciphertext=s.secret_ciphertext??await encryptPrivate(env.contactKey!,'mail-webhook-secret',env.origin,hook.signing_secret as string);
   if(s.secret_ciphertext&&await decryptPrivate(env.contactKey!,'mail-webhook-secret',env.origin,s.secret_ciphertext)!==hook.signing_secret)throw Error('hook_secret_changed');
   // Adopt only the setup snapshot that was decrypted/validated. A concurrent winner
   // owns its immutable ciphertext; losing this CAS must not demote that winner.
   await db.batch([stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_mail_webhook_setups WHERE origin=? AND lease_id=? AND state=? AND provider_id IS ? AND secret_ciphertext IS ? AND handler_probe_at IS ? AND updated_at=?) THEN 1 ELSE json('setup-adoption-changed') END",env.origin,s.lease_id,s.state,s.provider_id,s.secret_ciphertext,s.handler_probe_at,s.updated_at),stmt("UPDATE identity_mail_webhook_setups SET state='ready',provider_id=?,secret_ciphertext=?,error_code=NULL,updated_at=? WHERE origin=? AND lease_id=?",hook.id,ciphertext,stamp(),env.origin,s.lease_id),stmt('INSERT INTO identity_mail_control_audit VALUES(?,?,?,?,?)',randomIdentityId(),key,'webhook-configured',JSON.stringify({providerId:hook.id}),stamp())]);
  }catch(error){if(error instanceof ControlError)throw error;await stmt("UPDATE identity_mail_webhook_setups SET state='unknown',handler_probe_at=NULL,error_code=?,updated_at=? WHERE origin=? AND lease_id=? AND state=? AND provider_id IS ? AND secret_ciphertext IS ? AND handler_probe_at IS ? AND updated_at=?",error instanceof Error&&/^provider_http_[0-9]{3}$/.test(error.message)?error.message:'setup_outcome_unknown',stamp(),env.origin,s.lease_id,s.state,s.provider_id,s.secret_ciphertext,s.handler_probe_at,s.updated_at).run();}
  return safeSetup(await current());
 }
 async function reconcileEvent(key:string,id:string){
  const core=delivery(),saved=await core.receipt('readback',key);if(saved)return {delivery:saved};
  const c=await core.control(id);if(!c)fail(404,'mail_event_not_reconcilable');
  const project=(v:Record<string,unknown>)=>({id:v.id,from:v.from,to:v.to,subject:v.subject,tags:v.tags,last_event:v.last_event,...v.suppressed?{suppressed:v.suppressed}:{}});
  const mailbox=(v:unknown)=>typeof v==='string'?(v.match(/ <([^<>]+)>$/)?.[1]??v).toLowerCase():null;
  const match=(v:Record<string,unknown>)=>mailbox(v.from)===mailbox(c.from)&&Array.isArray(v.to)&&v.to.length===1&&mailbox(v.to[0])===mailbox(c.recipient)&&v.subject===c.subject;
  try{
   if(c.providerId){const v=await requestProvider('/emails/'+encodeURIComponent(c.providerId));if(v.id!==c.providerId||!match(v))return {unknown:true,deliveryVerified:false};return {delivery:await core.applyReadback(key,project(v))};}
   let after='';const ids=new Set<string>(),matches:Record<string,unknown>[]=[];
   for(let page=0;page<3;page++){
    const v=await requestProvider('/emails?limit=100'+(after?'&after='+encodeURIComponent(after):''));
    if(v.object!=='list'||!Array.isArray(v.data)||v.data.length>100||typeof v.has_more!=='boolean'||!v.data.every(object))return {unknown:true,deliveryVerified:false};
    const candidates=(v.data as Record<string,unknown>[]).filter(row=>match(row)&&typeof row.created_at==='string'&&Number.isFinite(Date.parse(row.created_at))&&Date.parse(row.created_at)>=Date.parse(c.createdAt)-300000&&Date.parse(row.created_at)<=Date.parse(c.createdAt)+86400000);
    if(candidates.length>10)return {unknown:true,deliveryVerified:false};
    for(const row of candidates){if(!safeId(row.id)||ids.has(row.id))continue;ids.add(row.id);const full=await requestProvider('/emails/'+encodeURIComponent(row.id));if(full.id===row.id&&match(full)&&Array.isArray(full.tags)&&full.tags.filter(t=>object(t)&&t.name==='identity_event'&&t.value===id).length===1)matches.push(full);if(matches.length>1)return {unknown:true,deliveryVerified:false};}
    if(!v.has_more){if(matches.length!==1)return {unknown:true,deliveryVerified:false};return {delivery:await core.applyReadback(key,project(matches[0]))};}
    const cursor=(v.data.at(-1) as Record<string,unknown>|undefined)?.id;if(!safeId(cursor)||cursor===after)return {unknown:true,deliveryVerified:false};after=cursor;
   }
  }catch(error){if(error instanceof ControlError)throw error;return {unknown:true,deliveryVerified:false};}
  return {unknown:true,deliveryVerified:false};
 }
 async function handlerCallback(req:Request){
  const probe=req.headers.get('X-Identity-Mail-Handler-Probe'),copy=probe?req.clone():null;
  const response=await delivery().handleWebhook(req);if(!response.ok||!probe||!copy||!/^[a-f0-9]{32}$/.test(probe))return response;
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await raw(copy)));}catch{return response;}
  if(!object(value)||value.type!=='identity.handler_probe'||!object(value.data)||value.data.nonce!==probe)return response;
  const old=await one<{request_key:string;consumed_at:string|null}>('SELECT request_key,consumed_at FROM identity_mail_handler_probes WHERE nonce=? AND origin=?',probe,env.origin);if(!old)return response;
  if(!old.consumed_at)try{await db.batch([
   stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_mail_handler_probes WHERE nonce=? AND origin=? AND consumed_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND EXISTS(SELECT 1 FROM identity_mail_webhook_setups WHERE origin=? AND state='ready' AND secret_ciphertext IS NOT NULL) THEN 1 ELSE json('handler-probe-changed') END",probe,env.origin,env.origin),
   stmt('UPDATE identity_mail_handler_probes SET consumed_at=? WHERE nonce=? AND consumed_at IS NULL',stamp(),probe),
   stmt("UPDATE identity_mail_webhook_setups SET handler_probe_at=?,updated_at=? WHERE origin=? AND state='ready'",stamp(),stamp(),env.origin),
   stmt('INSERT INTO identity_mail_control_audit VALUES(?,?,?,?,?)',randomIdentityId(),old.request_key,'handler-probe-verified',JSON.stringify({handlerVerified:true,deliveryVerified:false}),stamp()),
  ]);}catch{return json({error:'handler_probe_unavailable'},503);}
  return json({handlerVerified:true,deliveryVerified:false});
 }
 async function probeHandler(key:string){
  const prior=await one<{nonce:string;consumed_at:string|null;expires_at:string}>('SELECT * FROM identity_mail_handler_probes WHERE request_key=? AND origin=?',key,env.origin);
  if(prior?.consumed_at)return {handlerVerified:true,deliveryVerified:false};
  const nonce=prior?.nonce??randomIdentityId(),expires=new Date(Date.parse(stamp())+60000).toISOString();
  if(!prior)await db.batch([stmt('INSERT INTO identity_mail_handler_probes VALUES(?,?,?,?,NULL,?)',nonce,env.origin,key,expires,stamp()),stmt('INSERT INTO identity_mail_control_audit VALUES(?,?,?,?,?)',randomIdentityId(),key,'handler-probe-intent','{}',stamp())]);
  const whsec=await secret(),id='handler_'+nonce,timestamp=String(Math.floor(Date.parse(stamp())/1000)),payload=JSON.stringify({type:'identity.handler_probe',data:{nonce},created_at:stamp()});
  const hmac=await crypto.subtle.importKey('raw',Uint8Array.from(atob(whsec.slice(6)),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',hmac,new TextEncoder().encode(id+'.'+timestamp+'.'+payload)))));
  try{const r=await (env.fetcher??fetch)(endpoint,{method:'POST',headers:{'Content-Type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature,'X-Identity-Mail-Handler-Probe':nonce},body:payload,redirect:'manual',signal:AbortSignal.timeout(15000)});try{await r.body?.cancel();}catch{/* Readiness comes from the permanent handler receipt. */}}catch{/* Never interpret timeout as a failed email. */}
  const confirmed=await one('SELECT 1 FROM identity_mail_handler_probes WHERE nonce=? AND consumed_at IS NOT NULL',nonce);
  return {handlerVerified:!!confirmed,deliveryVerified:false};
 }
 return {async fetch(req:Request):Promise<Response|null>{
  const url=new URL(req.url),callback=url.pathname===IDENTITY_MAIL_WEBHOOK_PATH;if(!callback&&!url.pathname.startsWith(IDENTITY_MAIL_CONTROL_PREFIX))return null;
  try{
   if(url.origin!==env.origin||url.search)fail(403,'host_rejected');
   if(callback)return await handlerCallback(req);
   if(req.headers.has('Cookie')||req.headers.has('Authorization')||req.headers.get('Sec-Fetch-Site')==='cross-site'||req.headers.has('Origin')&&req.headers.get('Origin')!==env.origin)fail(403,'origin_rejected');
   if(!await env.operator(req))fail(401,'operator_required');
   const action=url.pathname.slice(IDENTITY_MAIL_CONTROL_PREFIX.length);
   if(action==='status'){if(req.method!=='GET')fail(405,'method_not_allowed');return json({webhook:safeSetup(await current())});}
   if(req.method!=='POST')fail(405,'method_not_allowed');
   if(!['setup','reconcile','probe','event-reconcile'].includes(action))fail(404,'not_found');
   configured();if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get('Content-Type')??''))fail(415,'json_required');
   let v:unknown;try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await raw(req)));}catch(error){if(error instanceof ControlError)throw error;fail(400,'invalid_mail_control');}
   if(!object(v)||Object.keys(v).length!==(action==='event-reconcile'?2:1)||Object.keys(v).some(k=>!['requestKey',...(action==='event-reconcile'?['eventId']:[])].includes(k))||typeof v.requestKey!=='string'||!/^[A-Za-z0-9_-]{8,96}$/.test(v.requestKey))fail(400,'invalid_mail_control');
   if(action==='event-reconcile'&&(typeof v.eventId!=='string'||!/^[a-f0-9]{32}$/.test(v.eventId)))fail(400,'invalid_mail_control');
   const key=v.requestKey,hash=await hashPrivate(env.contactKey!,'mail-control:'+env.origin,JSON.stringify({action,value:v}));
   const old=await one<{input_hmac:string;operation:string;origin:string}>('SELECT * FROM identity_mail_control_requests WHERE request_key=?',key);
   if(old){if(old.origin!==env.origin||old.input_hmac!==hash||old.operation!==action)fail(409,'mail_control_request_conflict');const r=await receipt(key);if(r)return r;}
   else try{await db.batch([stmt('INSERT INTO identity_mail_control_requests VALUES(?,?,?,?,?,?)',key,env.origin,action,action==='event-reconcile'?v.eventId:null,hash,stamp()),stmt('INSERT INTO identity_mail_control_audit VALUES(?,?,?,?,?)',randomIdentityId(),key,'intent','{}',stamp())]);}catch{fail(409,'mail_control_request_conflict');}
   if(action==='event-reconcile')return await finish(key,await reconcileEvent(key,v.eventId as string));
   return action==='probe'?await finish(key,await probeHandler(key)):await finish(key,{webhook:await configure(req,key,action)});
  }catch(error){return error instanceof ControlError?json({error:error.message},error.status):json({error:'mail_control_unavailable'},503);}
 }};
}
