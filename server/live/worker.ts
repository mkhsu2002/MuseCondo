import {createIdentityMailControl,IDENTITY_MAIL_CONTROL_SCHEMA} from './identity-mail-control.ts';
import {IDENTITY_MAIL_DELIVERY_SCHEMA} from './identity-mail-delivery.ts';
import {createTowerAdmission,TOWER_ADMISSION_SCHEMA} from './tower-admission.ts';
import {isIdentityCardPath,proxyIdentityCard,type IdentityCardNamespace} from './identity-card-proxy.ts';
import {createIdentityRecovery} from './identity-recovery.ts';
import {createIdentityRegistration} from './identity-registration.ts';
import {createIdentityGuardian} from './identity-guardian.ts';
import {IDENTITY_MAIL_INTERNAL_PREFIX,identityMailSchema} from './identity-mail-contract.ts';
import {dispatchIdentityCardResult,identityMailEventDispatcher} from './identity-mail-events.ts';
import {createIdentityMailReadiness} from './identity-mail-readiness.ts';
import {createAgentIdentity} from './identity.ts';
import {createTowerReception} from './reception.ts';
import {legacyHomeRedirect} from './legacy-home-redirect.ts';
import {createLiveApp,digest} from './app.ts';
import {databaseJournal} from './meta-home.ts';
import {createFrameworkHomeGenerator} from '../framework/generator.ts';
import {createTowerIntake} from './tower-intake.ts';
import {createTowerManager,MANAGER_MODEL} from './tower-manager.ts';
import type {Database} from './db.ts';
export interface PagesBindings {
 IDENTITY_CARDS?:IdentityCardNamespace;
 DB?:Database;ASSETS?:{fetch(request:Request):Promise<Response>};PUBLIC_ORIGIN?:string;
 REGISTRATION_ENABLED?:string;META_PAID_CALLS_APPROVED?:string;meta_muse_api?:string;
 IDENTITY_MAIL_DELIVERY_ENABLED?:string; IDENTITY_CONTACT_KEY?:string;IDENTITY_MAIL_API_KEY?:string;IDENTITY_MAIL_FROM?:string;
 TOWER_SOURCE_ORIGINS?:string;TOWER_OPERATOR_KEY?:string;LEGACY_HOME_REDIRECTS?:string;
 META_MANAGER_APPROVED?:string;META_MANAGER_BUDGET_MICRO?:string;META_MANAGER_DAILY_MICRO?:string;META_MANAGER_MONTHLY_MICRO?:string;
}
export interface RuntimeContext {waitUntil(promise:Promise<unknown>):void}
const requiredTables=['accounts','sessions','rooms','private_profiles','generation_jobs','assets','asset_chunks','posts','interactions','agent_tokens','rate_limits','community_editions','community_current','consent_events','recovery_audit','provider_requests','onboarding_grants','framework_profiles','dream_consent','dreams','asset_reviews','tower_residencies','tower_snapshots','tower_asset_chunks','tower_claims','tower_tokens','tower_requests','tower_audit','manager_jobs','manager_events','tower_reception_cases','tower_reception_events','tower_reception_requests','tower_visits','tower_activities','tower_activity_participation','tower_activity_operator_requests','tower_activity_audit','agent_identities','identity_requests','identity_audit','identity_rate_attempts','identity_guardian_invites','guardian_invite_requests','guardian_invite_rate_attempts','identity_mail_events','identity_mail_audit','identity_guardians','identity_guardian_passkeys','identity_offline_recovery_codes','identity_guardian_challenges','identity_registration_requests','identity_secret_history','identity_recovery_requests','identity_recovery_challenges','identity_recovery_receipts','identity_recovery_instances','identity_offline_recovery_challenges'];
const requiredTriggers=['tower_reception_first_claim','tower_reception_first_home','agent_identity_immutable_binding','identity_guardian_account_binding','identity_guardian_immutable_binding','identity_guardian_credential_binding','identity_passkey_immutable_binding','identity_challenge_immutable_binding','identity_history_accounts_insert','identity_history_accounts_update','identity_history_sessions','identity_history_tower_tokens','identity_history_agent_tokens','identity_history_onboarding','identity_history_cases','identity_history_immutable_update','identity_history_immutable_delete','identity_recovery_request_binding','identity_recovery_challenge_binding','identity_recovery_challenge_immutable','identity_recovery_receipt_immutable','identity_recovery_receipt_permanent','identity_recovery_request_prune_guard','identity_recovery_challenge_prune_guard','identity_offline_history_permanent','identity_offline_history_immutable','identity_offline_recovery_challenge_binding','identity_offline_recovery_challenge_immutable','identity_offline_recovery_challenge_prune_guard','identity_passkey_permanent','identity_recovery_instance_immutable','identity_recovery_instance_permanent'];
const requiredIndexes=['identity_recovery_request_pending_expiry','identity_recovery_challenge_pending_expiry','identity_offline_recovery_challenge_pending_expiry','identity_recovery_challenge_request','identity_offline_recovery_challenge_request','identity_mail_entity'];
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
function validOrigin(value:string|undefined){try{return !!value&&new URL(value).origin===value&&value.startsWith('https://');}catch{return false;}}
const amount=(v:string|undefined)=>v&&/^\d{1,10}$/.test(v)?Number(v):0;
function sourceOrigins(v:string|undefined):string[]{try{const a=JSON.parse(v??'[]');return Array.isArray(a)&&a.length<=20&&a.every(x=>typeof x==='string'&&validOrigin(x))?a:[];}catch{return [];}}
/** Same-origin Pages runtime. Secrets remain in deployment storage; status only reports gates. */
export default {async fetch(request:Request,env:PagesBindings,context?:RuntimeContext):Promise<Response>{
 const url=new URL(request.url),api=url.pathname==='/api'||url.pathname.startsWith('/api/'),home=/^\/home\/[a-f0-9]{16}(\/(inside|dreams))?\/?$/.test(url.pathname);
 if(url.pathname.startsWith(IDENTITY_MAIL_INTERNAL_PREFIX))return json({error:'not_found'},404);
 if(api||(home&&env.DB)){
  if(!validOrigin(env.PUBLIC_ORIGIN))return json({available:false,error:'public_origin_not_configured'},503);
  if(url.origin!==env.PUBLIC_ORIGIN)return json({available:false,error:'host_rejected'},403);
  const identityMailEnv=env.DB?{db:env.DB,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY,apiKey:env.IDENTITY_MAIL_API_KEY,from:env.IDENTITY_MAIL_FROM,coordinator:env.IDENTITY_CARDS,deliveryEnabled:env.IDENTITY_MAIL_DELIVERY_ENABLED}:undefined;
  const onMailEvent=identityMailEnv?identityMailEventDispatcher(identityMailEnv,context):async()=>{};
  if(isIdentityCardPath(url.pathname)){const response=await proxyIdentityCard(request,env.IDENTITY_CARDS);await dispatchIdentityCardResult(request,response,env.DB,onMailEvent);return response;}
  const metaSecretConfigured=typeof env.meta_muse_api==='string'&&env.meta_muse_api.trim().length>0,paidCallsApproved=env.META_PAID_CALLS_APPROVED==='true';
  const safe={metaSecretConfigured,paidCallsApproved,registrationEnabled:env.REGISTRATION_ENABLED==='true'};
  const db=env.DB;if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')return json({available:false,error:'database_not_bound',runtime:safe},503);
  try{
   const rows=(await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index','view')").all<{name:string}>()).results;
   if(![...requiredTables,...requiredTriggers,...requiredIndexes,...TOWER_ADMISSION_SCHEMA,...identityMailSchema,...IDENTITY_MAIL_CONTROL_SCHEMA,...IDENTITY_MAIL_DELIVERY_SCHEMA].every(name=>rows.some(row=>row.name===name)))return json({available:false,error:'database_schema_not_ready',runtime:safe},503);
  }catch{return json({available:false,error:'database_unavailable',runtime:safe},503);}
  const operator=async()=>!!env.TOWER_OPERATOR_KEY&&!!request.headers.get('X-Tower-Operator-Key')&&await digest(request.headers.get('X-Tower-Operator-Key')!)===await digest(env.TOWER_OPERATOR_KEY);
  const mailControlResponse=await createIdentityMailControl({db,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY,apiKey:env.IDENTITY_MAIL_API_KEY,operator}).fetch(request);if(mailControlResponse)return mailControlResponse;
  if(url.pathname==='/api/v1/operator/identity/mail-readiness')return (await createIdentityMailReadiness({db,origin:env.PUBLIC_ORIGIN!,from:env.IDENTITY_MAIL_FROM,apiKey:env.IDENTITY_MAIL_API_KEY,operator}).fetch(request))!;
  const admissionResponse=await createTowerAdmission({db,origin:env.PUBLIC_ORIGIN!,operator}).fetch(request);if(admissionResponse)return admissionResponse;
  const generator=metaSecretConfigured&&paidCallsApproved?createFrameworkHomeGenerator({apiKey:env.meta_muse_api,approvedPaidCalls:true,textModel:MANAGER_MODEL,journal:databaseJournal(db)}):undefined;
  const app=createLiveApp({db,origin:env.PUBLIC_ORIGIN!,localTest:false,registrationEnabled:safe.registrationEnabled,generator,towerEnabled:true,onCommunityChanged:async snapshot=>{
   await manager.enqueue(snapshot);if(context)context.waitUntil(manager.processOne());else await manager.processOne();
  }});
  const manager=createTowerManager({db,apiKey:env.meta_muse_api,approved:env.META_MANAGER_APPROVED==='true',budgetMicro:amount(env.META_MANAGER_BUDGET_MICRO),dailyBudgetMicro:amount(env.META_MANAGER_DAILY_MICRO),monthlyBudgetMicro:amount(env.META_MANAGER_MONTHLY_MICRO),readPublic:async()=>{
   const current=await app.editBuilding(false);return {events:current.events,residentIds:current.events.map(e=>e.residentId),sourceDigest:current.edition.sourceDigest,asOf:current.edition.asOf};
  }});
  async function reconcile(){
   const pending=(await db!.prepare('SELECT id FROM manager_events WHERE dispatched_at IS NULL ORDER BY created_at LIMIT 50').all<{id:string}>()).results;
   const current=await app.editBuilding(true);await manager.enqueue({events:current.events,residentIds:current.events.map(e=>e.residentId),sourceDigest:current.edition.sourceDigest,asOf:current.edition.asOf});
   if(pending.length)await db!.batch(pending.map(e=>db!.prepare('UPDATE manager_events SET dispatched_at=? WHERE id=? AND dispatched_at IS NULL').bind(new Date().toISOString(),e.id)));
  }
  const guardianResponse=await createIdentityGuardian({...identityMailEnv!,operator:async()=>operator(),onMailEvent}).fetch(request);if(guardianResponse)return guardianResponse;
  const recoveryResponse=await createIdentityRecovery({db,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY,onMailEvent}).fetch(request);if(recoveryResponse)return recoveryResponse;
  const registrationResponse=await createIdentityRegistration({db,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY}).fetch(request);if(registrationResponse)return registrationResponse;
  const identityResponse=await createAgentIdentity({db,origin:env.PUBLIC_ORIGIN!}).fetch(request);if(identityResponse)return identityResponse;
  const reception=createTowerReception({db,origin:env.PUBLIC_ORIGIN!,operator:async()=>operator()});
  const receptionResponse=await reception.fetch(request);if(receptionResponse)return receptionResponse;
  const intake=createTowerIntake({db,origin:env.PUBLIC_ORIGIN!,localTest:false,sourceOrigins:sourceOrigins(env.TOWER_SOURCE_ORIGINS),operator:async()=>operator(),ownerAttestation:async()=>operator(),onChange:async()=>{await reconcile();}});
  const tower=await intake.fetch(request);if(tower)return tower;
  if(url.pathname.startsWith('/api/v1/operator/')){
   if(request.headers.has('Cookie')||request.headers.has('Origin')&&request.headers.get('Origin')!==env.PUBLIC_ORIGIN||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'origin_rejected'},403);
   if(!await operator())return json({error:'operator_required'},401);
   if(url.pathname==='/api/v1/operator/tower/accounts'&&request.method==='POST'){
    let value:Record<string,unknown>;try{if(Number(request.headers.get('Content-Length')??0)>1024)return json({error:'body_too_large'},413);const raw=await request.text();if(raw.length>1024)return json({error:'body_too_large'},413);value=JSON.parse(raw);}catch{return json({error:'invalid_json'},400);}
    if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.credential!=='string'||!/^[a-f0-9]{64}$/.test(value.credential)||Object.keys(value).some(k=>k!=='credential'))return json({error:'invalid_credential'},400);
    const hashed=await digest(value.credential),id=crypto.randomUUID().replaceAll('-',''),time=new Date().toISOString();
    await db.prepare('INSERT INTO accounts(id,login_hash,created_at,test_only) VALUES(?,?,?,0) ON CONFLICT(login_hash) DO NOTHING').bind(id,hashed,time).run();
    const account=await db.prepare('SELECT id FROM accounts WHERE login_hash=?').bind(hashed).first<{id:string}>();await db.prepare("INSERT INTO tower_audit(id,account_id,room_id,action,revision,detail_json,created_at) VALUES(?,?,NULL,'operator-account-authorized',NULL,'{}',?)").bind(crypto.randomUUID(),account!.id,time).run();return json({accountId:account!.id},201);
   }
   if(url.pathname==='/api/v1/operator/manager/models'&&request.method==='GET'){
    if(!metaSecretConfigured)return json({error:'provider_not_configured'},503);
    try{const r=await fetch('https://api.meta.ai/v1/models',{headers:{Authorization:`Bearer ${env.meta_muse_api}`},signal:AbortSignal.timeout(15000)});if(!r.ok)return json({available:false,httpStatus:r.status},502);const d=await r.json() as {data?:{id:string}[]};return json({available:!!d.data?.some(x=>x.id===MANAGER_MODEL),model:MANAGER_MODEL});}catch{return json({error:'provider_unavailable'},502);}
   }
   if(url.pathname==='/api/v1/operator/manager/process'&&request.method==='POST'){await reconcile();await manager.processOne();return json({processed:true});}
   if(url.pathname==='/api/v1/operator/manager'&&request.method==='GET')return json({configured:manager.configured(),jobs:(await db.prepare('SELECT id,source_digest,state,reserved_micro,actual_micro,input_tokens,output_tokens,provider_id,error_code,created_at,completed_at FROM manager_jobs ORDER BY created_at DESC LIMIT 30').all()).results});
   return json({error:'not_found'},404);
  }

  if(api){const response=await app.fetch(request,request.headers.get('CF-Connecting-IP')??'unknown');
   if(url.pathname.replace(/\/$/,'')==='/api/v1/status'&&request.method==='GET'){const last=await db.prepare("SELECT completed_at FROM manager_jobs WHERE state='complete' ORDER BY completed_at DESC LIMIT 1").first<{completed_at:string}>();return json({...await response.json(),manager:manager.configured()?(last?'event-driven-live':'event-driven-configured-not-health-verified'):'rules-on-public-update',scheduled:false,runtime:{...safe,databaseReady:true,metaConfiguredNotHealthVerified:!!generator,managerConfigured:manager.configured(),managerLastSuccessAt:last?.completed_at??null,levelVisibility:'private-only',identityCards:env.IDENTITY_CARDS?'bound-not-health-verified':'unavailable'}},response.status);}
   return response;}
 }
 if(/^\/identity\/verify\/[a-f0-9]{32}\/?$/.test(url.pathname)||url.pathname==='/identity-verify.html'){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  if(!env.ASSETS)return json({error:'assets_not_bound'},503);
  const response=await env.ASSETS.fetch(new Request(new URL('/identity/verify/',url),request));
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-Robots-Tag','noindex, nofollow');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body,{status:response.status,headers});
 }
 if(/^\/identity\/recover\/?$/.test(url.pathname)||url.pathname==='/identity-recovery.html'){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  if(!env.ASSETS)return json({error:'assets_not_bound'},503);
  const response=url.pathname==='/identity-recovery.html'?new Response(null,{status:308,headers:{Location:new URL('/identity/recover',url).href}}):await env.ASSETS.fetch(new Request(new URL('/identity/recover/',url),request));
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-Robots-Tag','noindex, nofollow');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body,{status:response.status,headers});
 }
 if(/^\/(reception|activities|identity)\/?$/.test(url.pathname)){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  if(!env.ASSETS)return json({error:'assets_not_bound'},503);
  return env.ASSETS.fetch(new Request(new URL('/'+url.pathname.split('/')[1]+'/',url),request));
 }
 if(url.pathname==='/identity.html'){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  if(!env.ASSETS)return json({error:'assets_not_bound'},503);
  return env.ASSETS.fetch(request);
 }
 const legacy=legacyHomeRedirect(request,env.LEGACY_HOME_REDIRECTS);if(legacy)return legacy;
 if(!env.ASSETS)return json({available:false,error:'assets_not_bound'},503);
 if(/^\/(move-in|neighbors|home\/[a-f0-9]{16}(\/(inside|dreams))?)\/?$/.test(url.pathname)){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  const target=new URL('/',url);return env.ASSETS.fetch(new Request(target,request));
 }
 return env.ASSETS.fetch(request);
}};
