import type {Database} from './db.ts';
import {createTowerAppearance} from './tower-appearance.ts';
import {createManagerSchedule} from './tower-manager-schedule.ts';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const required=['tower_appearance_state','tower_appearance_audit','tower_appearance_revision','tower_appearance_audit_immutable_update','tower_appearance_audit_immutable_delete','tower_appearance_state_guard','tower_appearance_state_permanent','tower_manager_runs','tower_manager_runs_binding','tower_manager_runs_permanent'];
export function createManagerRoutes(options:{db:Database;origin:string;operator:()=>Promise<boolean>;scheduleAuthorized:()=>Promise<boolean>;now?:()=>Date}){
 const {db,origin,operator,scheduleAuthorized}=options,now=options.now??(()=>new Date()),appearance=createTowerAppearance(db,now),schedule=createManagerSchedule(db,now);
 return {async fetch(request:Request):Promise<Response|null>{
  const url=new URL(request.url),publicRoute=url.pathname==='/api/v1/tower/appearance',appearanceRoute=url.pathname==='/api/v1/operator/manager/appearance',scheduleRoute=url.pathname==='/api/v1/operator/manager/schedule',runRoute=url.pathname==='/api/v1/manager/run-due';
  if(!publicRoute&&!appearanceRoute&&!scheduleRoute&&!runRoute)return null;
  if(url.origin!==origin)return json({error:'origin_rejected'},403);
  if(!publicRoute){
   if(request.headers.has('Cookie')||request.headers.has('Origin')&&request.headers.get('Origin')!==origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'origin_rejected'},403);
   if(!(runRoute?await scheduleAuthorized():await operator()))return json({error:runRoute?'schedule_authorization_required':'operator_required'},401);
  }
  if(publicRoute&&request.method!=='GET'||scheduleRoute&&request.method!=='GET'||runRoute&&request.method!=='POST'||appearanceRoute&&!['GET','POST'].includes(request.method))return json({error:'method_not_allowed'},405);
  try{
   const objects=(await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index')").all<{name:string}>()).results;
   if(!required.every(name=>objects.some(row=>row.name===name)))return json({error:'manager_schema_not_ready'},503);
   if(publicRoute)return json(await appearance.publicState());
   if(scheduleRoute)return json(await schedule.inspect());
   if(appearanceRoute&&request.method==='GET')return json(await appearance.inspect());
   if(Number(request.headers.get('Content-Length')??0)>2048)return json({error:'body_too_large'},413);
   const raw=await request.text();if(new TextEncoder().encode(raw).byteLength>2048)return json({error:'body_too_large'},413);
   let value:unknown;try{value=JSON.parse(raw);}catch{return json({error:'invalid_json'},400);}
   if(runRoute){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='scheduledTime')||!('scheduledTime' in value)||typeof value.scheduledTime!=='string')return json({error:'invalid_schedule_time'},400);
    return json(await schedule.runDue(new Date(value.scheduledTime)));
   }
   return json(await appearance.command(value,'operator'),201);
  }catch(error){
   const code=error instanceof Error?error.message:'';
   if(['revision_conflict','request_key_conflict'].includes(code))return json({error:code},409);
   if(['invalid_command','invalid_theme','invalid_window','expired_theme','not_due','preview_or_revision_missing','invalid_schedule_time'].includes(code))return json({error:code},400);
   return json({error:'manager_unavailable'},503);
  }
 }};
}
