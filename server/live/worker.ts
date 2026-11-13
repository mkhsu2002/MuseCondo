import {localizeInterfaceResponse,interfaceRuntimeRequest} from './interface-html.ts';
import {createPrivateHomeRoutes,nativeHomeDirectory} from './private-home-routes.ts';
import {createVaultAuthorization} from './vault-auth.ts';
import {createPrivateVaultStore} from './vault-store.ts';
import {createVaultRoutes,vaultFailure} from './vault-routes.ts';
import {assertVaultKey} from './vault-crypto.ts';
import {VAULT_LIMITS} from './vault-contract.ts';
import {createVaultUpgradeNotice} from './vault-upgrade-notice.ts';
import {usesStandaloneDocument} from '../../src/route-policy.ts';
import {createTowerImageOptimization} from './tower-image-optimization.ts';
import {createTowerImageRoutes} from './tower-image-routes.ts';
import {renderTowerJournals} from '../../src/shared/tower-journals-markup.ts';
import {weeklyArchiveBefore} from '../../src/shared/tower-weekly.ts';
import {createTowerWeeklyServices,createTowerWeeklyRoutes,type TowerPublicationBindings} from './tower-weekly-routes.ts';
import {renderWeeklyCard,renderWeeklyPage,renderWeeklyArchive,renderSceneWall,renderScenePreview} from '../../src/shared/tower-weekly-markup.ts';
import {routeSchemaReady} from './schema-capabilities.ts';
import {RELEASE_MANIFEST} from './generated-release.ts';
import {releaseReadiness} from './release-contract.ts';
import {runtimeBindingsReady} from './release-runtime.ts';
import {createHomePreflightRoute} from './home-preflight-route.ts';
import {createMoveInCompletion} from './move-in-completion.ts';
import {createMoveInInvitationChoice} from './move-in-invitation-choice.ts';
import {renderHomeDirectory,renderNeighborDirectory} from '../../src/shared/home-directory.ts';
import {renderLiveShell,renderTowerLobby} from '../../src/shared/lobby-markup.ts';
import {createIdentityOffer} from './identity-offer.ts';
import {transportCheck} from './transport-check.ts';
import {createNativeSourceInspection} from './native-source-inspection.ts';
import {towerLordRoute,type TowerLordBindings} from './tower-lord-routes.ts';
import {checkEdgeGuard,type EdgeGuardBinding} from './edge-guard.ts';
import {admissionSecurityStatus} from './admission-security-status.ts';
import {createManagerAdmission} from './manager-admission.ts';
import {createIdentityMailControl} from './identity-mail-control.ts';
import {createTowerAdmission} from './tower-admission.ts';
import {isIdentityCardPath,proxyIdentityCard,type IdentityCardNamespace} from './identity-card-proxy.ts';
import {createIdentityMaintenance} from './identity-maintenance.ts';
import {createIdentityRecovery} from './identity-recovery.ts';
import {createIdentityRegistration} from './identity-registration.ts';
import {createIdentityGuardian} from './identity-guardian.ts';
import {IDENTITY_MAIL_INTERNAL_PREFIX} from './identity-mail-contract.ts';
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
import {createManagerRoutes} from './tower-manager-routes.ts';
import {createAutonomyRoutes,type ManagerRuntimeBinding} from './tower-autonomy-routes.ts';
import {autonomySchemaReady,type AssetBucket} from './tower-autonomy.ts';
import type {Database} from './db.ts';
export interface PagesBindings extends TowerLordBindings,TowerPublicationBindings {
 EDGE_GUARD?:EdgeGuardBinding;EDGE_GUARD_REQUIRED?:string;
 IDENTITY_CARDS?:IdentityCardNamespace;
 MANAGER_ASSETS?:AssetBucket;MANAGER_RUNTIME?:ManagerRuntimeBinding;
 TOWER_IMAGE_OPTIMIZATION_ENABLED?:string;TOWER_IMAGE_DAILY_LIMIT?:string;TOWER_IMAGE_MONTHLY_LIMIT?:string;
 DB?:Database;ASSETS?:{fetch(request:Request):Promise<Response>};PUBLIC_ORIGIN?:string;
 REGISTRATION_ENABLED?:string;META_PAID_CALLS_APPROVED?:string;meta_muse_api?:string;
 VAULT_DATA_KEY?:string;IDENTITY_MAIL_DELIVERY_ENABLED?:string; IDENTITY_CONTACT_KEY?:string;IDENTITY_MAIL_API_KEY?:string;IDENTITY_MAIL_FROM?:string;
 TOWER_SOURCE_ORIGINS?:string;TOWER_OPERATOR_KEY?:string;MANAGER_SCHEDULE_TRIGGER_KEY?:string;LEGACY_HOME_REDIRECTS?:string;
 META_MANAGER_APPROVED?:string;META_MANAGER_BUDGET_MICRO?:string;META_MANAGER_DAILY_MICRO?:string;META_MANAGER_MONTHLY_MICRO?:string;
}
export interface RuntimeContext {waitUntil(promise:Promise<unknown>):void}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
function validOrigin(value:string|undefined){try{return !!value&&new URL(value).origin===value&&value.startsWith('https://');}catch{return false;}}
const amount=(v:string|undefined)=>v&&/^\d{1,10}$/.test(v)?Number(v):0;
function sourceOrigins(v:string|undefined):string[]{try{const a=JSON.parse(v??'[]');return Array.isArray(a)&&a.length<=20&&a.every(x=>typeof x==='string'&&validOrigin(x))?a:[];}catch{return [];}}
function imageServices(env:PagesBindings){return createTowerImageOptimization({db:env.DB!,bucket:env.MANAGER_ASSETS,enabled:env.TOWER_IMAGE_OPTIMIZATION_ENABLED==='true',dailyLimit:amount(env.TOWER_IMAGE_DAILY_LIMIT),monthlyLimit:amount(env.TOWER_IMAGE_MONTHLY_LIMIT),wake:env.MANAGER_RUNTIME&&env.MANAGER_SCHEDULE_TRIGGER_KEY?async()=>{const response=await env.MANAGER_RUNTIME!.fetch(new Request('https://manager.internal/images/wake',{method:'POST',headers:{'X-Manager-Schedule-Key':env.MANAGER_SCHEDULE_TRIGGER_KEY!}}));if(!response.ok)throw Error('image_wake_unavailable');}:undefined});}
function publicationServices(env:PagesBindings,context?:RuntimeContext){return createTowerWeeklyServices({imageOptimization:imageServices(env),db:env.DB!,origin:env.PUBLIC_ORIGIN!,...env,apiKey:env.meta_muse_api,mailKey:env.IDENTITY_MAIL_API_KEY,from:env.IDENTITY_MAIL_FROM,contactKey:env.IDENTITY_CONTACT_KEY,approved:env.META_MANAGER_APPROVED==='true',budgetMicro:amount(env.META_MANAGER_BUDGET_MICRO),dailyBudgetMicro:amount(env.META_MANAGER_DAILY_MICRO),monthlyBudgetMicro:amount(env.META_MANAGER_MONTHLY_MICRO),bucket:env.MANAGER_ASSETS,assets:env.ASSETS,runtime:env.MANAGER_RUNTIME,trigger:env.MANAGER_SCHEDULE_TRIGGER_KEY,waitUntil:context?p=>context.waitUntil(p):undefined});}
const htmlEscape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Same-origin Pages runtime. Secrets remain in deployment storage; status only reports gates. */
async function vaultAvailable(env:PagesBindings){
 try{assertVaultKey(env.VAULT_DATA_KEY);return !!env.DB&&!!env.IDENTITY_CONTACT_KEY&&await routeSchemaReady(env.DB,'POST','/api/v1/agent/vault/files');}catch{return false;}
}
function vaultNotice(env:PagesBindings,context?:RuntimeContext){return createVaultUpgradeNotice({db:env.DB!,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY,apiKey:env.IDENTITY_MAIL_API_KEY,from:env.IDENTITY_MAIL_FROM,
 operator:async request=>!request.headers.has('Cookie')&&request.headers.get('Sec-Fetch-Site')!=='cross-site'&&(!request.headers.has('Origin')||request.headers.get('Origin')===env.PUBLIC_ORIGIN)&&!!env.TOWER_OPERATOR_KEY&&!!request.headers.get('X-Tower-Operator-Key')&&await digest(request.headers.get('X-Tower-Operator-Key')!)===await digest(env.TOWER_OPERATOR_KEY),
 ready:async()=>await vaultAvailable(env)&&(await releaseReadiness(env.DB,RELEASE_MANIFEST,env.ASSETS,env.PUBLIC_ORIGIN)).ready&&runtimeBindingsReady(env),
 waitUntil:context?p=>context.waitUntil(p):undefined,
});}
const runtime={async fetch(request:Request,env:PagesBindings,context?:RuntimeContext):Promise<Response>{
 const lord=await towerLordRoute(request,env);if(lord)return lord;
 const url=new URL(request.url),api=url.pathname==='/api'||url.pathname.startsWith('/api/'),home=/^\/(?:private-home\/|home\/[a-f0-9]{16}(?:\/|$))/.test(url.pathname);
 if(url.pathname==='/vault/notifications'){if(!env.DB||!validOrigin(env.PUBLIC_ORIGIN)||url.origin!==env.PUBLIC_ORIGIN)return json({error:'notification_preferences_unavailable'},503);return await vaultNotice(env,context).fetch(request)??json({error:'not_found'},404);}
 if(url.pathname.startsWith(IDENTITY_MAIL_INTERNAL_PREFIX))return json({error:'not_found'},404);
 if(url.pathname==='/api/v1/operator/images/smoke'&&env.PUBLIC_ORIGIN!=='https://framework-v001.musecondo.pages.dev')return json({error:'not_found'},404);
 if(api||(home&&env.DB)){
  if(!validOrigin(env.PUBLIC_ORIGIN))return json({available:false,error:'public_origin_not_configured'},503);
  if(url.origin!==env.PUBLIC_ORIGIN)return json({available:false,error:'host_rejected'},403);
  const limited=await checkEdgeGuard(request,env);if(limited)return limited;
  const transportResponse=await transportCheck(request,env.PUBLIC_ORIGIN!);if(transportResponse)return transportResponse;
  if(url.pathname==='/api/v1/operator/release'){
   if(request.headers.has('Cookie')||request.headers.has('Origin')&&request.headers.get('Origin')!==env.PUBLIC_ORIGIN||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'origin_rejected'},403);
   if(!env.TOWER_OPERATOR_KEY||!request.headers.get('X-Tower-Operator-Key')||await digest(request.headers.get('X-Tower-Operator-Key')!)!==await digest(env.TOWER_OPERATOR_KEY))return json({error:'operator_required'},401);
   if(request.method!=='GET')return json({error:'method_not_allowed'},405);
   const release=await releaseReadiness(env.DB,RELEASE_MANIFEST,env.ASSETS,env.PUBLIC_ORIGIN),bindingsReady=runtimeBindingsReady(env);
   return json({...release,runtimeBindingsReady:bindingsReady,ready:release.ready&&bindingsReady});
  }
  if(/^\/api\/v1\/(?:operator\/(?:tower-weekly|tower-scenes)(?:\/|$)|manager\/publications\/)/.test(url.pathname)){
   if(request.headers.has('Cookie')||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==env.PUBLIC_ORIGIN)return json({error:'origin_rejected'},403);
   const scheduledPath=url.pathname.startsWith('/api/v1/manager/'),key=scheduledPath?env.MANAGER_SCHEDULE_TRIGGER_KEY:env.TOWER_OPERATOR_KEY,provided=request.headers.get(scheduledPath?'X-Manager-Schedule-Key':'X-Tower-Operator-Key');
   if(!key||!provided||await digest(provided)!==await digest(key))return json({error:'operator_required'},401);
  }
  const identityMailEnv=env.DB?{db:env.DB,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY,apiKey:env.IDENTITY_MAIL_API_KEY,from:env.IDENTITY_MAIL_FROM,coordinator:env.IDENTITY_CARDS,deliveryEnabled:env.IDENTITY_MAIL_DELIVERY_ENABLED}:undefined;
  const onMailEvent=identityMailEnv?identityMailEventDispatcher(identityMailEnv,context):async()=>{};
  if(isIdentityCardPath(url.pathname)){const response=await proxyIdentityCard(request,env.IDENTITY_CARDS);await dispatchIdentityCardResult(request,response,env.DB,onMailEvent);return response;}
  const metaSecretConfigured=typeof env.meta_muse_api==='string'&&env.meta_muse_api.trim().length>0,paidCallsApproved=env.META_PAID_CALLS_APPROVED==='true';
  const safe={metaSecretConfigured,paidCallsApproved,registrationEnabled:false};
  const db=env.DB;if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')return json({available:false,error:'database_not_bound',admission:{status:'unavailable',applyURL:env.PUBLIC_ORIGIN!+'/reception'},runtime:safe},503);
  try{
   if(!await routeSchemaReady(db,request.method,url.pathname))return json({available:false,error:'database_schema_not_ready',admission:{status:'unavailable',applyURL:env.PUBLIC_ORIGIN!+'/reception'},runtime:safe},503);
  }catch{return json({available:false,error:'database_unavailable',admission:{status:'unavailable',applyURL:env.PUBLIC_ORIGIN!+'/reception'},runtime:safe},503);}
  const nativeResponse=await createPrivateHomeRoutes({db,origin:env.PUBLIC_ORIGIN!})(request);if(nativeResponse)return nativeResponse;
  const operator=async()=>!!env.TOWER_OPERATOR_KEY&&!!request.headers.get('X-Tower-Operator-Key')&&await digest(request.headers.get('X-Tower-Operator-Key')!)===await digest(env.TOWER_OPERATOR_KEY);
  const upgrade=vaultNotice(env,context);
  if(url.pathname==='/api/v1/identity/mail/webhook'){const hook=await upgrade.handleWebhook(request.clone());if(hook)return hook;}
  const upgradeResponse=await upgrade.fetch(request);if(upgradeResponse)return upgradeResponse;
  if(url.pathname==='/api/v1/vault/capabilities'){
   if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
   const available=await vaultAvailable(env),response=json({available,version:'musecondo-private-vault-v1',passkeyRequired:true,guardianAuthorizationRequired:true,startURL:env.PUBLIC_ORIGIN!+'/vault/start',guideURL:env.PUBLIC_ORIGIN!+'/vault-guide.md',limits:VAULT_LIMITS},available?200:503);
   return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
  }
  const vaultAuth=createVaultAuthorization({db,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY});
  try{const authorization=await vaultAuth.fetch(request);if(authorization)return authorization;}catch(error){return vaultFailure(error,env.PUBLIC_ORIGIN!);}
  const vaultResponse=await createVaultRoutes({origin:env.PUBLIC_ORIGIN!,authorization:vaultAuth,store:createPrivateVaultStore({db,key:env.VAULT_DATA_KEY??''})})(request);if(vaultResponse)return vaultResponse;
  const completion=createMoveInCompletion({db,origin:env.PUBLIC_ORIGIN!});
  const preflight=await createHomePreflightRoute({db,origin:env.PUBLIC_ORIGIN!})(request);if(preflight)return preflight;
  const verifiedCompletion=await completion.fetch(request);if(verifiedCompletion)return verifiedCompletion;
  const invitationChoice=await createMoveInInvitationChoice({db,origin:env.PUBLIC_ORIGIN!}).fetch(request);if(invitationChoice)return invitationChoice;
  const identityOffer=await createIdentityOffer({db,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY,verifyCompletion:completion.verify,onMailEvent}).fetch(request);if(identityOffer)return identityOffer;
  const sourceInspection=await createNativeSourceInspection({operator:async()=>operator()})(request);if(sourceInspection)return sourceInspection;
  const publications=publicationServices(env,context);
  if(url.pathname==='/api/v1/identity/mail/webhook'){const hook=await publications.mail.handleWebhook(request.clone());if(hook)return hook;}
  const weeklyResponse=await createTowerWeeklyRoutes({origin:env.PUBLIC_ORIGIN!,services:publications,operator,scheduled:async()=>!!env.MANAGER_SCHEDULE_TRIGGER_KEY&&request.headers.get('X-Manager-Schedule-Key')===env.MANAGER_SCHEDULE_TRIGGER_KEY})(request);if(weeklyResponse)return weeklyResponse;
  const mailControlResponse=await createIdentityMailControl({db,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY,apiKey:env.IDENTITY_MAIL_API_KEY,operator}).fetch(request);if(mailControlResponse)return mailControlResponse;
  const scheduled=async()=>!!env.MANAGER_SCHEDULE_TRIGGER_KEY&&!!request.headers.get('X-Manager-Schedule-Key')&&await digest(request.headers.get('X-Manager-Schedule-Key')!)===await digest(env.MANAGER_SCHEDULE_TRIGGER_KEY);
  const images=imageServices(env);const imageResponse=await createTowerImageRoutes({service:images,origin:env.PUBLIC_ORIGIN!,authorized:scheduled,operator,smoke:env.MANAGER_RUNTIME&&env.MANAGER_SCHEDULE_TRIGGER_KEY?async()=>env.MANAGER_RUNTIME!.fetch(new Request('https://manager.internal/images/smoke',{method:'POST',headers:{'X-Manager-Schedule-Key':env.MANAGER_SCHEDULE_TRIGGER_KEY!}})):undefined})(request);if(imageResponse)return imageResponse;
  const autonomyRoute=await createAutonomyRoutes({db,imageOptimization:images,origin:env.PUBLIC_ORIGIN!,operator,scheduled,bucket:env.MANAGER_ASSETS,runtime:env.MANAGER_RUNTIME,trigger:env.MANAGER_SCHEDULE_TRIGGER_KEY,apiKey:env.meta_muse_api,assets:env.ASSETS,verifyCompletion:completion.verify}).fetch(request);if(autonomyRoute)return autonomyRoute;
  const managerRoute=await createManagerRoutes({db,bucket:env.MANAGER_ASSETS,origin:env.PUBLIC_ORIGIN!,operator,onDue:at=>publications.schedule(at),scheduleAuthorized:async()=>!!env.MANAGER_SCHEDULE_TRIGGER_KEY&&!!request.headers.get('X-Manager-Schedule-Key')&&await digest(request.headers.get('X-Manager-Schedule-Key')!)===await digest(env.MANAGER_SCHEDULE_TRIGGER_KEY)}).fetch(request);if(managerRoute)return managerRoute;
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
  const maintenanceResponse=await createIdentityMaintenance({db,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY}).fetch(request);if(maintenanceResponse)return maintenanceResponse;
  const recoveryResponse=await createIdentityRecovery({db,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY,onMailEvent}).fetch(request);if(recoveryResponse)return recoveryResponse;
  const registrationResponse=await createIdentityRegistration({db,origin:env.PUBLIC_ORIGIN!,contactKey:env.IDENTITY_CONTACT_KEY}).fetch(request);if(registrationResponse)return registrationResponse;
  const identityResponse=await createAgentIdentity({db,origin:env.PUBLIC_ORIGIN!}).fetch(request);if(identityResponse)return identityResponse;
  const receptionAdmission=createManagerAdmission({db,apiKey:env.meta_muse_api,verifyCompletion:completion.verify,wake:env.MANAGER_RUNTIME&&env.MANAGER_SCHEDULE_TRIGGER_KEY?async()=>{const response=await env.MANAGER_RUNTIME!.fetch(new Request('https://manager.internal/wake',{method:'POST',headers:{'X-Manager-Schedule-Key':env.MANAGER_SCHEDULE_TRIGGER_KEY!}}));if(!response.ok)throw Error('admission_wake_unavailable');}:undefined});
  const reception=createTowerReception({db,origin:env.PUBLIC_ORIGIN!,operator:async()=>operator(),reviewStatus:receptionAdmission.status,onReview:receptionAdmission.enqueue,assistanceStatus:receptionAdmission.assistance.status});
  const receptionResponse=await reception.fetch(request);if(receptionResponse)return receptionResponse;
  const intake=createTowerIntake({db,derivativeBucket:env.MANAGER_ASSETS,imageOptimization:{image:(room,purpose,sha)=>images.image('home',room+':'+purpose,sha),enqueue:(room,purpose)=>images.enqueue('home',room+':'+purpose)},origin:env.PUBLIC_ORIGIN!,localTest:false,sourceOrigins:sourceOrigins(env.TOWER_SOURCE_ORIGINS),operator:async()=>operator(),ownerAttestation:async()=>operator(),onProgress:async accountId=>{const rows=(await db.prepare("SELECT id FROM tower_reception_cases WHERE account_id=? AND state IN ('approved','active')").bind(accountId).all<{id:string}>()).results;for(const row of rows)await receptionAdmission.enqueue(row.id);},onChange:async room=>{await images.enqueueHome(room);await reconcile();}});
  const tower=await intake.fetch(request);if(tower)return tower;
  if(url.pathname.startsWith('/api/v1/operator/')){
   if(request.headers.has('Cookie')||request.headers.has('Origin')&&request.headers.get('Origin')!==env.PUBLIC_ORIGIN||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'origin_rejected'},403);
   if(!await operator())return json({error:'operator_required'},401);
   if(url.pathname==='/api/v1/operator/security/admission'){
    if(request.method!=='GET')return json({error:'method_not_allowed'},405);
    return json(await admissionSecurityStatus(db));
   }
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
   if(url.pathname==='/api/v1/public/rooms'&&request.method==='GET'&&response.ok){const payload=await response.json() as {rooms:{id:string;name:string}[]};return json({...payload,rooms:[...await nativeHomeDirectory(db),...payload.rooms]});}
   if(url.pathname.replace(/\/$/,'')==='/api/v1/status'&&request.method==='GET'){
    const last=await db.prepare("SELECT completed_at FROM manager_jobs WHERE state='complete' ORDER BY completed_at DESC LIMIT 1").first<{completed_at:string}>();
    const autonomyBound=!!env.MANAGER_RUNTIME&&!!env.MANAGER_SCHEDULE_TRIGGER_KEY&&!!env.MANAGER_ASSETS&&!!env.meta_muse_api&&!!env.ASSETS;
    const autonomyEnabled=autonomyBound&&await autonomySchemaReady(db)&&!!(await db.prepare('SELECT enabled FROM tower_autonomy_mandate WHERE id=1').first<{enabled:number}>())?.enabled;
    return json({...await response.json(),manager:manager.configured()?(last?'event-driven-live':'event-driven-configured-not-health-verified'):'rules-on-public-update',scheduled:autonomyEnabled,runtime:{...safe,databaseReady:true,metaConfiguredNotHealthVerified:!!generator,managerConfigured:manager.configured(),managerLastSuccessAt:last?.completed_at??null,managerAutonomy:autonomyEnabled?'enabled':autonomyBound?'bound-not-health-verified':'unavailable',levelVisibility:'private-only',identityCards:env.IDENTITY_CARDS?'bound-not-health-verified':'unavailable'}},response.status);
   }
   return response;}
 }
 if(/^\/identity\/verify\/[a-f0-9]{32}\/?$/.test(url.pathname)||url.pathname==='/identity-verify.html'){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  if(!env.ASSETS)return json({error:'assets_not_bound'},503);
  const response=await env.ASSETS.fetch(new Request(new URL('/identity/verify/',url),request));
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-Robots-Tag','noindex, nofollow');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body,{status:response.status,headers});
 }
 if(/^\/identity\/maintenance\/?$/.test(url.pathname)||url.pathname==='/identity-maintenance.html'){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  if(!env.ASSETS)return json({error:'assets_not_bound'},503);
  const response=await env.ASSETS.fetch(new Request(new URL('/identity/maintenance/',url),request));
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-Robots-Tag','noindex, nofollow');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body,{status:response.status,headers});
 }
 if(/^\/identity\/offer\/?$/.test(url.pathname)||['/identity-offer','/identity-offer.html'].includes(url.pathname)){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  if(!env.ASSETS)return json({error:'assets_not_bound'},503);
  const response=await env.ASSETS.fetch(new Request(new URL('/identity/offer/',url),request));
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
 if(['/vault-start.html','/vault-authorization.html'].includes(url.pathname)){if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);return new Response(null,{status:308,headers:{Location:new URL(url.pathname.includes('authorization')?'/vault/authorize':'/vault/start',url).href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});}
 if(/^\/vault\/(start|authorize)(?:\/|\/index\.html)?$/.test(url.pathname)){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  if(!env.ASSETS)return json({error:'assets_not_bound'},503);
  const section=url.pathname.split('/')[2],response=await env.ASSETS.fetch(new Request(new URL('/vault/'+section+'/',url),request)),headers=new Headers(response.headers);
  headers.set('Cache-Control',section==='authorize'?'no-store':'no-cache');headers.set('Referrer-Policy','no-referrer');headers.set('X-Content-Type-Options','nosniff');
  headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
  if(section==='authorize')headers.set('X-Robots-Tag','noindex, nofollow');
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
 }
 if(usesStandaloneDocument(url.pathname)){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  if(!env.ASSETS)return json({error:'assets_not_bound'},503);
  const response=await env.ASSETS.fetch(new Request(new URL(url.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '')+'/',url),request));
  const headers=new Headers(response.headers);headers.set('Cache-Control','no-cache');
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
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
 const weeklyPage=url.pathname.match(/^\/tower-weekly(?:\/(tower-weekly-[a-zA-Z0-9_-]{1,80}))?\/?$/),scenePage=/^\/tower-scenes\/?$/.test(url.pathname);
 if(weeklyPage||scenePage){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  if(!env.DB||!env.ASSETS||!validOrigin(env.PUBLIC_ORIGIN)||url.origin!==env.PUBLIC_ORIGIN)return json({error:'service_unavailable'},503);
  const limited=await checkEdgeGuard(request,env);if(limited)return limited;
  try{const services=publicationServices(env,context),issue=weeklyPage?.[1]?await services.weekly.get(weeklyPage[1]):null;const missing=!!weeklyPage?.[1]&&!issue;
   const archive=!scenePage&&!weeklyPage?.[1]?await services.weekly.page(weeklyArchiveBefore(url.searchParams)):null;
   const content=scenePage?renderSceneWall('',await services.scenes.list()):issue?renderWeeklyPage('',issue):missing?'<h1>Issue not found</h1><p>This issue is not available.</p><a href="/tower-weekly">Browse Tower Weekly</a>':renderWeeklyArchive('',archive!.issues,archive!.nextBefore);
   const asset=await env.ASSETS.fetch(new Request(new URL('/',url),request));if(!asset.ok)return asset;let html=await asset.text();
   const title=scenePage?'Corners of Muse Tower':issue?.title??'Tower Weekly',canonical=env.PUBLIC_ORIGIN+(scenePage?'/tower-scenes':weeklyPage?.[1]?'/tower-weekly/'+weeklyPage[1]:'/tower-weekly'+(weeklyArchiveBefore(url.searchParams)?'?before='+weeklyArchiveBefore(url.searchParams):''));
   html=html.replace(/<title>[\s\S]*?<\/title>/i,'<title data-no-translate>'+htmlEscape(title)+' · Muse Tower</title>').replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi,'').replace(/<meta\b[^>]*property=["']og:[^>]*>/gi,'').replace('</head>',`<link rel="canonical" href="${htmlEscape(canonical)}"><meta property="og:title" data-no-translate content="${htmlEscape(title)}"><meta property="og:url" content="${htmlEscape(canonical)}">${issue?.scene?`<meta property="og:image" content="${htmlEscape(issue.scene.url)}">`:''}</head>`).replace('<div id="app"></div>',`<div id="app">${renderLiveShell('',content,true)}</div>`);
   const headers=new Headers(asset.headers);headers.set('Cache-Control','no-store');for(const key of ['ETag','Content-Length','Content-Encoding','Last-Modified'])headers.delete(key);if(missing)headers.set('X-Robots-Tag','noindex, nofollow');return new Response(request.method==='HEAD'?null:html,{status:missing?404:200,headers});
  }catch(error){return error instanceof TypeError?json({error:'invalid_request'},400):json({error:'publication_unavailable'},503);}
 }
 if(/^\/neighbors\/?$/.test(url.pathname)&&env.DB&&env.ASSETS&&url.origin===env.PUBLIC_ORIGIN){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  const limited=await checkEdgeGuard(request,env);if(limited)return limited;
  try{
   const directory=await createLiveApp({db:env.DB,origin:env.PUBLIC_ORIGIN!,localTest:false,registrationEnabled:false,towerEnabled:true}).fetch(new Request(env.PUBLIC_ORIGIN+'/api/v1/public/rooms'));
   if(!directory.ok)return json({error:'directory_unavailable'},503);
   const payload=await directory.json() as {rooms:{id:string;name:string}[]};const rooms=[...await nativeHomeDirectory(env.DB),...payload.rooms];
   if(!Array.isArray(rooms)||rooms.some(r=>!r||!/^[a-f0-9]{16}$/.test(r.id)||typeof r.name!=='string'))return json({error:'directory_unavailable'},503);
   const asset=await env.ASSETS.fetch(new Request(new URL('/',url),request));if(!asset.ok)return asset;
   const canonical=env.PUBLIC_ORIGIN+'/neighbors';
   const html=(await asset.text()).replace(/<title>[\s\S]*?<\/title>/i,'<title>Our neighbors · Muse Tower</title>').replace(/<link\b[^>]*rel=["']canonical["'][^>]*>/gi,'').replace(/<meta\b[^>]*property=["']og:[^>]*>/gi,'').replace('</head>',`<link rel="canonical" href="${htmlEscape(canonical)}"><meta property="og:title" content="Our neighbors · Muse Tower"><meta property="og:url" content="${htmlEscape(canonical)}"></head>`).replace('<div id="app"></div>',`<div id="app">${renderLiveShell('',renderNeighborDirectory('',rooms),true)}</div>`);
   const headers=new Headers(asset.headers);headers.set('Cache-Control','no-store');for(const key of ['ETag','Content-Length','Content-Encoding','Last-Modified'])headers.delete(key);
   return new Response(request.method==='HEAD'?null:html,{status:200,headers});
  }catch{return json({error:'directory_unavailable'},503);}
 }
 const legacy=legacyHomeRedirect(request,env.LEGACY_HOME_REDIRECTS);if(legacy)return legacy;
 if(!env.ASSETS)return json({available:false,error:'assets_not_bound'},503);
 if(url.pathname==='/'&&request.method==='GET'&&env.DB&&url.origin===env.PUBLIC_ORIGIN){
  const limited=await checkEdgeGuard(request,env);if(limited)return limited;
  const response=await env.ASSETS.fetch(request);
  if(!response.ok||!response.headers.get('Content-Type')?.startsWith('text/html'))return response;
  try{
   let rooms:{id:string;name:string}[]=[];try{const directory=await createLiveApp({db:env.DB,origin:env.PUBLIC_ORIGIN!,localTest:false,registrationEnabled:false,towerEnabled:true}).fetch(new Request(env.PUBLIC_ORIGIN+'/api/v1/public/rooms'));if(directory.ok)rooms=[...await nativeHomeDirectory(env.DB),...((await directory.json()) as {rooms:{id:string;name:string}[]}).rooms];}catch{/* Other public sections remain independent of the directory. */}
   let journals='';try{journals=renderTowerJournals(await publicationServices(env,context).daily.getLatest());}catch{/* Current unverified journals remain hidden. */}
   let weekly='';try{const issues=await publicationServices(env,context).weekly.list({limit:1});weekly=renderWeeklyCard('',issues[0]??null);}catch{/* The existing resident directory remains available. */}
   let scenery=renderScenePreview('',[]);try{scenery=renderScenePreview('',await publicationServices(env,context).scenes.list());}catch{/* Unverified scenery stays blank. */}
   const markup=renderTowerLobby({base:'',scene:'day',content:'<div data-weekly-slot>'+weekly+'</div><div data-journals-slot>'+journals+'</div>'+renderHomeDirectory('',rooms)+'<div data-scenes-slot>'+scenery+'</div>'});
   const html=(await response.clone().text()).replace('<div id="app"></div>',`<div id="app">${markup}</div>`);
   const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');for(const key of ['ETag','Content-Length','Content-Encoding','Last-Modified'])headers.delete(key);
   return new Response(html,{status:response.status,headers});
  }catch{return response;}
 }
 if(/^\/(move-in|neighbors|home\/[a-f0-9]{16}(\/(inside|dreams))?)\/?$/.test(url.pathname)){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  const target=new URL('/',url);return env.ASSETS.fetch(new Request(target,request));
 }
 return env.ASSETS.fetch(request);
}};

export default {async fetch(request:Request,env:PagesBindings,context?:RuntimeContext):Promise<Response>{return localizeInterfaceResponse(request,await runtime.fetch(interfaceRuntimeRequest(request),env,context));}};
