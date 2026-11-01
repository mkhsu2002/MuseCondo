import {checkEdgeGuard,type EdgeGuardBinding} from './edge-guard.ts';
import {createTowerLordAuth,isTowerLordPath} from './tower-lord-auth.ts';
import {createTowerLordData,TowerLordQueryError} from './tower-lord-data.ts';
import type {Database} from './db.ts';
export interface TowerLordBindings {EDGE_GUARD?:EdgeGuardBinding;EDGE_GUARD_REQUIRED?:string;DB?:Database;ASSETS?:{fetch(request:Request):Promise<Response>};PUBLIC_ORIGIN?:string;TOWER_LORD_ISSUER?:string;TOWER_LORD_AUDIENCE?:string;TOWER_LORD_STEWARDS?:string;TOWER_LORD_OBSERVERS?:string;TOWER_LORD_ENVIRONMENT?:string}
const privateHeaders={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...privateHeaders,'Content-Type':'application/json; charset=utf-8'}});
/** Dedicated read-only lane: never enters applicant reads, model execution, reconciliation or mail dispatch. */
export async function towerLordRoute(request:Request,env:TowerLordBindings):Promise<Response|null>{
 const url=new URL(request.url);if(!isTowerLordPath(url.pathname))return null;
 if(!env.PUBLIC_ORIGIN||url.origin!==env.PUBLIC_ORIGIN)return json({error:'host_rejected'},403);
 if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);
 if(request.headers.get('Sec-Fetch-Site')==='cross-site'&&(url.pathname.startsWith('/api/')||request.headers.get('Sec-Fetch-Mode')!=='navigate')||request.headers.has('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'origin_rejected'},403);
 if(!env.TOWER_LORD_ISSUER||!env.TOWER_LORD_AUDIENCE)return json({error:'console_not_configured'},503);
 const principal=await createTowerLordAuth({issuer:env.TOWER_LORD_ISSUER,audience:env.TOWER_LORD_AUDIENCE,stewards:env.TOWER_LORD_STEWARDS,observers:env.TOWER_LORD_OBSERVERS})(request);
 if(!principal)return json({error:'console_access_required'},401);
 const limited=await checkEdgeGuard(request,env);if(limited)return limited;
 if(url.pathname.startsWith('/api/')){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  const name=url.pathname.slice('/api/v1/tower-lord/'.length);
  if(name==='session')return json(principal);
  if(!['overview','residents','applications','history','usage'].includes(name))return json({error:'not_found'},404);
  if(!env.DB)return json({error:'database_not_bound'},503);
  try{const data=createTowerLordData({db:env.DB,environment:env.TOWER_LORD_ENVIRONMENT??'unknown',towerOrigin:env.PUBLIC_ORIGIN});return json(await data[name as 'overview'|'residents'|'applications'|'history'|'usage'](url.searchParams));}
  catch(error){return json({error:error instanceof TowerLordQueryError?'invalid_report_query':'console_data_unavailable'},error instanceof TowerLordQueryError?400:503);}
 }
 if(!env.ASSETS)return json({error:'assets_not_bound'},503);
 const asset=url.pathname==='/tower-lord'||url.pathname==='/tower-lord/'?'/tower-lord/':url.pathname;
 if(!['/tower-lord/','/tower-lord/index.html','/tower-lord/console.js','/tower-lord/console.css'].includes(asset))return json({error:'not_found'},404);
 const response=await env.ASSETS.fetch(new Request(new URL(asset,url),request));
 return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...privateHeaders}});
}
