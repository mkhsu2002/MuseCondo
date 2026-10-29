import { createLiveApp } from './app.ts';
import { databaseJournal } from './meta-home.ts';
import { createFrameworkHomeGenerator } from '../framework/generator.ts';
import type { Database } from './db.ts';
export interface PagesBindings {
 DB?:Database;
 ASSETS?:{fetch(request:Request):Promise<Response>};
 PUBLIC_ORIGIN?:string;
 REGISTRATION_ENABLED?:string;
 META_PAID_CALLS_APPROVED?:string;
 /** Encrypted Pages secret. Never a VITE_* build variable, logged value or public response. */
 meta_muse_api?:string;
}
const requiredTables=['accounts','sessions','rooms','private_profiles','generation_jobs','assets','asset_chunks','posts','interactions','agent_tokens','rate_limits','community_editions','community_current','consent_events','recovery_audit','provider_requests','onboarding_grants','framework_profiles','dream_consent','dreams','asset_reviews'];
const json=(data:unknown,status:number)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const secretPresent=(env:PagesBindings)=>typeof env.meta_muse_api==='string'&&env.meta_muse_api.trim().length>0;
function validOrigin(value:string|undefined){try{return !!value&&new URL(value).origin===value&&value.startsWith('https://');}catch{return false;}}
/** Same-origin Pages runtime. Missing bindings/schema fail closed without leaking database errors. */
export default {async fetch(request:Request,env:PagesBindings):Promise<Response>{
 const url=new URL(request.url);
 if(url.pathname==='/api'||url.pathname.startsWith('/api/')){
  if(!validOrigin(env.PUBLIC_ORIGIN))return json({available:false,error:'public_origin_not_configured'},503);
  if(url.origin!==env.PUBLIC_ORIGIN)return json({available:false,error:'host_rejected'},403);
  const metaSecretConfigured=secretPresent(env),paidCallsApproved=env.META_PAID_CALLS_APPROVED==='true';
  const safe={metaSecretConfigured,paidCallsApproved,registrationEnabled:env.REGISTRATION_ENABLED==='true'};
  if(!env.DB||typeof env.DB.prepare!=='function'||typeof env.DB.batch!=='function')return json({available:false,error:'database_not_bound',runtime:safe},503);
  try{
   const rows=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{name:string}>()).results;
   if(!requiredTables.every(name=>rows.some(row=>row.name===name)))return json({available:false,error:'database_schema_not_ready',runtime:safe},503);
  }catch{return json({available:false,error:'database_unavailable',runtime:safe},503);}
  // Presence alone grants no permission to spend. The separate exact-string gate defaults false.
  const generator=metaSecretConfigured&&paidCallsApproved?createFrameworkHomeGenerator({apiKey:env.meta_muse_api,approvedPaidCalls:true,textModel:'muse-spark-1.3',journal:databaseJournal(env.DB)}):undefined;
  const app=createLiveApp({db:env.DB,origin:env.PUBLIC_ORIGIN!,localTest:false,registrationEnabled:safe.registrationEnabled,generator});
  const response=await app.fetch(request,request.headers.get('CF-Connecting-IP')??'unknown');
  if(url.pathname.replace(/\/$/,'')==='/api/v1/status'&&request.method==='GET')return json({...await response.json(),runtime:{...safe,databaseReady:true,metaConfiguredNotHealthVerified:!!generator}},response.status);
  return response;
 }
 if(!env.ASSETS)return json({available:false,error:'assets_not_bound'},503);
 // Explicit live SPA routes avoid accidental 404 HTML for real resident deep links.
 if(/^\/(move-in|neighbors|home\/[a-f0-9]{16}(\/(inside|dreams))?)\/?$/.test(url.pathname)){
  if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
  const target=new URL('/',url);return env.ASSETS.fetch(new Request(target,request));
 }
 return env.ASSETS.fetch(request);
}};
