import {createTowerScenes} from './tower-scenes.ts';
import {BASELINE_SHA,SCENES} from './tower-scenes-catalog.ts';
import type {AssetBucket} from './tower-autonomy.ts';
import type {ManagerRuntimeBinding} from './tower-autonomy-routes.ts';
import type {Database} from './db.ts';
import {createTowerWeekly} from './tower-weekly.ts';
import {createPublicationSources} from './tower-publication-sources.ts';
import {createTowerWeeklyMail} from './tower-weekly-mail.ts';
import {calendarPeriods} from './tower-manager-schedule.ts';
import {MANAGER_CALENDAR_POLICY,managerLocalDay} from './tower-calendar.ts';
import {readRequestBody,RequestBodyError} from './request-body.ts';
export interface TowerPublicationBindings {
 TOWER_SCENES_ENABLED?:string;TOWER_WEEKLY_ENABLED?:string;TOWER_PUBLICATION_MAIL_ENABLED?:string;TOWER_PUBLICATION_AGGREGATE_APPROVED?:string;TOWER_PUBLICATION_LORD_RECIPIENT?:string;
}
interface Environment extends TowerPublicationBindings {bucket?:AssetBucket;assets?:{fetch(request:Request):Promise<Response>};runtime?:ManagerRuntimeBinding;trigger?:string;db:Database;origin:string;apiKey?:string;contactKey?:string;mailKey?:string;from?:string;approved?:boolean;budgetMicro?:number;dailyBudgetMicro?:number;monthlyBudgetMicro?:number;waitUntil?:(p:Promise<unknown>)=>void;now?:()=>Date;fetcher?:typeof fetch}
export type PublicationTask={id:string;kind:'scene';sceneKey:string;batchId:string}|{id:string;kind:'inaugural'}|{id:string;kind:'due';scheduledTime:string};
class PublicationWaiting extends Error {wakeAfterMs:number;constructor(lease:string){super('publication_waiting');this.wakeAfterMs=Math.max(1000,Date.parse(lease)-Date.now()+1000);}}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export function createTowerWeeklyServices(env:Environment){
 const now=env.now??(()=>new Date()),db=env.db;
 const scenes=createTowerScenes({db,origin:env.origin,approved:env.TOWER_SCENES_ENABLED==='true'&&env.approved===true,apiKey:env.apiKey,budgetMicro:env.budgetMicro??0,dailyBudgetMicro:env.dailyBudgetMicro??0,monthlyBudgetMicro:env.monthlyBudgetMicro??0,bucket:env.bucket,assets:env.assets,now,fetcher:env.fetcher});
 const sources=createPublicationSources({db,origin:env.origin,aggregateApproved:env.TOWER_PUBLICATION_AGGREGATE_APPROVED==='true'});
 const weekly=createTowerWeekly({db,...sources,publicationGuards:(source,period)=>[...sources.publicationGuards(source),db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_scene_periods p JOIN tower_scenes s ON s.id=p.scene_id WHERE p.period_key=? AND s.state='published' AND s.baseline_sha=?) THEN 1 ELSE json('weekly_scene_not_ready') END").bind(period.periodKey,BASELINE_SHA)],apiKey:env.apiKey,approved:env.approved===true&&env.TOWER_WEEKLY_ENABLED==='true',budgetMicro:env.budgetMicro??0,dailyBudgetMicro:env.dailyBudgetMicro??0,monthlyBudgetMicro:env.monthlyBudgetMicro??0,now,fetcher:env.fetcher});
 const mail=createTowerWeeklyMail({db,origin:env.origin,contactKey:env.contactKey??'',apiKey:env.mailKey,from:env.from,recipient:env.TOWER_PUBLICATION_LORD_RECIPIENT,enabled:env.TOWER_PUBLICATION_MAIL_ENABLED==='true',now,fetcher:env.fetcher});
 async function publish(periodKey:string,cutoffAt:string,inaugural:boolean){
  if(!weekly.configured()||!env.contactKey||!env.TOWER_PUBLICATION_LORD_RECIPIENT)throw Error('weekly_not_configured');
  const inFlight=await db.prepare('SELECT j.state,w.lease_until FROM tower_weekly_jobs w JOIN manager_jobs j ON j.id=w.id WHERE w.period_key=?').bind(periodKey).first<{state:string;lease_until:string|null}>();
  if(inFlight?.state==='running'){if(inFlight.lease_until&&inFlight.lease_until>now().toISOString())throw new PublicationWaiting(inFlight.lease_until);await weekly.processOne(periodKey);return null;}
  if(inFlight?.state==='complete')return readIssue('tower-weekly-'+periodKey);
  if(inFlight&&inFlight.state!=='pending')return null;
  if(!inaugural){const drawing=await scenes.getInternal('weekly-'+periodKey);if(drawing?.state==='running'){if(drawing.leaseUntil&&drawing.leaseUntil>now().toISOString())throw new PublicationWaiting(drawing.leaseUntil);await scenes.recover(drawing.id);const after=await scenes.getInternal(drawing.id);if(after?.state==='running'&&after.leaseUntil)throw new PublicationWaiting(after.leaseUntil);if(after?.state!=='published')return null;}else if(drawing&&['unknown','invalid','blocked'].includes(drawing.state))return null;}
  const prior=(await db.prepare('SELECT issue_json FROM tower_weekly_issues ORDER BY number DESC LIMIT 1').first<{issue_json:string}>());
  const last=prior?JSON.parse(prior.issue_json) as {cutoffAt:string}:null;
  const periodStart=last?.cutoffAt??new Date(Date.parse(cutoffAt)-7*86400000).toISOString();
  if(last&&inaugural)return readIssue('tower-weekly-inaugural');
  if(periodStart>=cutoffAt)return null;
  if(inaugural&&(await db.prepare("SELECT count(*) n FROM tower_scenes WHERE batch_id IS NOT NULL AND state='published'").first<{n:number}>())?.n!==10)return null;
  if(!await scenes.ensureWeekly(periodKey,inaugural))return null;
  await weekly.enqueue({periodKey,periodStart,cutoffAt,recipientHash:await mail.recipientHash(),inaugural});await weekly.processOne(periodKey);
  const issue=await weekly.get('tower-weekly-'+periodKey);
  if(issue){const work=mail.processOne(issue.id+':lord');if(env.waitUntil)env.waitUntil(work.then(()=>{}));else await work;}
  return issue;
 }
 async function readIssue(id:string){const saved=await weekly.get(id);if(!saved)return null;const scene=await scenes.getForPeriod(saved.periodKey);return scene?{...saved,scene}:null;}
 async function list(){const saved=await weekly.list();const found=await Promise.all(saved.map(i=>readIssue(i.id)));return found.filter((i):i is NonNullable<typeof i>=>i!==null);}
 async function runDue(at:Date){
  if(!Number.isFinite(at.getTime())||Math.abs(now().getTime()-at.getTime())>36*3600000)throw Error('invalid_schedule_time');
  if(env.TOWER_WEEKLY_ENABLED!=='true')return {weekly:'disabled'};
  const day=managerLocalDay(at),isMonday=new Date(day+'T12:00:00.000Z').getUTCDay()===1;
  // Existing canonical policy is versioned; UTC cron remains a deployment setting.
  const localHour=(at.getUTCHours()+MANAGER_CALENDAR_POLICY.offsetHours+24)%24;
  const existing=await db.prepare('SELECT id FROM tower_weekly_issues LIMIT 1').first();let issue=null;const attempted=!!existing&&isMonday&&localHour>=9;
  if(existing&&isMonday&&localHour>=9)issue=await publish('week-'+calendarPeriods(at).week,at.toISOString(),false);
  const recovery=mail.recover();if(env.waitUntil)env.waitUntil(recovery.then(()=>{}));else await recovery;
  return {weekly:issue?'published':attempted?'blocked':'not-due',state:issue?'published':attempted?'blocked':'complete',issueId:issue?.id??null};
 }
 async function sceneStatus(){return (await db.prepare('SELECT id,scene_key,state,error_code,lease_until FROM tower_scenes ORDER BY created_at,id LIMIT 100').all()).results;}
 async function inspect(){const jobs=(await db.prepare('SELECT w.period_key,j.state,j.actual_micro,j.error_code FROM tower_weekly_jobs w JOIN manager_jobs j ON j.id=w.id ORDER BY w.created_at DESC LIMIT 10').all()).results;const notices=(await db.prepare('SELECT id,state,error_code FROM tower_weekly_outbox ORDER BY created_at DESC LIMIT 10').all()).results;return {enabled:env.TOWER_WEEKLY_ENABLED==='true',configured:weekly.configured(),recipientConfigured:!!env.TOWER_PUBLICATION_LORD_RECIPIENT,mailEnabled:env.TOWER_PUBLICATION_MAIL_ENABLED==='true',jobs,notices};}
 async function queue(tasks:PublicationTask[]){if(!env.runtime||!env.trigger)throw Error('publication_runtime_unavailable');const response=await env.runtime.fetch(new Request('https://manager.internal/publications/wake',{method:'POST',headers:{'Content-Type':'application/json','X-Manager-Schedule-Key':env.trigger},body:JSON.stringify({tasks})}));if(!response.ok)throw Error('publication_wake_failed');return {queued:true,tasks:tasks.map(t=>t.id)};}
 async function seedBatch(batch:number){if(!await db.prepare('SELECT id FROM tower_scene_style_approval WHERE id=1').first())throw Error('scene_style_approval_required');if(![1,2].includes(batch)||env.TOWER_SCENES_ENABLED!=='true')throw Error('invalid_seed_batch');if(batch===2){const first=await db.prepare("SELECT count(*) n FROM tower_scenes WHERE batch_id='initial-v1-1' AND state='published'").first<{n:number}>();if(first?.n!==5)throw Error('previous_batch_not_published');}return queue(Object.keys(SCENES).slice((batch-1)*5,batch*5).map((sceneKey,index)=>({id:'seed-v1-'+String((batch-1)*5+index+1).padStart(2,'0'),kind:'scene' as const,sceneKey,batchId:'initial-v1-'+batch})));}
 async function step(task:PublicationTask){try{
  if(task.kind==='scene'){
   const match=task.id.match(/^seed-v1-(0[1-9]|10)$/),index=match?Number(match[1])-1:-1;
   if(index<0||Object.keys(SCENES)[index]!==task.sceneKey||task.batchId!=='initial-v1-'+(Math.floor(index/5)+1))throw Error('invalid_scene_task');
   if(![0,1,4].includes(index)&&!await db.prepare('SELECT id FROM tower_scene_style_approval WHERE id=1').first())throw Error('scene_style_approval_required');
   if(index>=5){const prior=await db.prepare("SELECT count(*) n FROM tower_scenes WHERE batch_id='initial-v1-1' AND state='published'").first<{n:number}>();if(prior?.n!==5)throw Error('previous_batch_not_published');}
   const old=await scenes.getInternal(task.id);
   if(old?.state==='running'){if(old.leaseUntil&&old.leaseUntil>now().toISOString())throw new PublicationWaiting(old.leaseUntil);await scenes.recover(task.id);}else if(!old||old.state==='pending')await scenes.generate(task.id,task.sceneKey,{batchId:task.batchId});
   const state=await scenes.getInternal(task.id);if(state?.state==='running'&&state.leaseUntil)throw new PublicationWaiting(state.leaseUntil);return {pending:false,state:state?.state??'missing'};
  }
  if(task.kind==='inaugural'){const published=await publish('inaugural',now().toISOString(),true);return {pending:false,state:published?'published':'blocked'};}
  if(task.kind==='due')return {pending:false,...await runDue(new Date(task.scheduledTime))};
  throw Error('invalid_publication_task');
 }catch(error){if(error instanceof PublicationWaiting)return {pending:true,state:'running',wakeAfterMs:error.wakeAfterMs};throw error;}}
 async function previewScenes(){return queue([0,1,4].map(i=>({id:'seed-v1-'+String(i+1).padStart(2,'0'),kind:'scene' as const,sceneKey:Object.keys(SCENES)[i],batchId:'initial-v1-1'})));}
 async function approveStyle(){await db.prepare("INSERT INTO tower_scene_style_approval VALUES(1,?,'tower-v1',?,?)").bind(BASELINE_SHA,now().toISOString(),JSON.stringify({source:'explicit-maintainer-confirmation',previewIds:['seed-v1-01','seed-v1-02','seed-v1-05']})).run();return {approved:true};}
 const schedule=(at:Date)=>env.TOWER_WEEKLY_ENABLED!=='true'?Promise.resolve({queued:false}):queue([{id:'due-'+managerLocalDay(at),kind:'due',scheduledTime:at.toISOString()}]);
 return {weekly:{...weekly,get:readIssue,list},mail,scenes,runDue,inspect,queue,seedBatch,step,schedule,sceneStatus,previewScenes,approveStyle,inaugural:()=>publish('inaugural',now().toISOString(),true)};
}
export function createTowerWeeklyRoutes(options:{origin:string;services:ReturnType<typeof createTowerWeeklyServices>;operator:()=>Promise<boolean>;scheduled:()=>Promise<boolean>}){
 return async(request:Request):Promise<Response|null>=>{
  const url=new URL(request.url),path=url.pathname,publicMatch=path.match(/^\/api\/v1\/public\/tower-weekly(?:\/(tower-weekly-[a-zA-Z0-9_-]{1,80}))?$/),operator=path==='/api/v1/operator/tower-weekly',reconcile=path==='/api/v1/operator/tower-weekly/reconcile',scheduled=path==='/api/v1/manager/publications/run-due'||path==='/api/v1/manager/publications/step',sceneAdmin=path==='/api/v1/operator/tower-scenes',preview=path.match(/^\/api\/v1\/operator\/tower-scenes\/(seed-v1-[0-9]{2})\.png$/),scenePublic=path==='/api/v1/public/tower-scenes',sceneAsset=path.match(/^\/api\/v1\/tower\/scenes\/([a-zA-Z0-9_-]{1,80})\.png$/);
  if(!publicMatch&&!operator&&!reconcile&&!scheduled&&!sceneAdmin&&!preview&&!scenePublic&&!sceneAsset)return null;
  if(url.origin!==options.origin)return json({error:'origin_rejected'},403);
  if(!publicMatch&&!scenePublic&&!sceneAsset){if(request.headers.has('Cookie')||request.headers.has('Origin')&&request.headers.get('Origin')!==options.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'origin_rejected'},403);if(!await(scheduled?options.scheduled():options.operator()))return json({error:'operator_required'},401);}
  if((sceneAdmin&&!['GET','POST'].includes(request.method))||publicMatch&&!['GET','HEAD'].includes(request.method)||operator&&!['GET','POST'].includes(request.method)||(scheduled||reconcile)&&request.method!=='POST')return json({error:'method_not_allowed'},405);
  try{
   if(scenePublic){if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);return json({scenes:await options.services.scenes.list()});}
   if(preview||sceneAsset){if(!['GET','HEAD'].includes(request.method))return json({error:'method_not_allowed'},405);const image=preview?await options.services.scenes.previewAsset(preview[1]):await options.services.scenes.asset(sceneAsset![1]);if(!image)return json({error:'not_found'},404);const headers={'Content-Type':'image/png','Cache-Control':preview?'no-store':'public, max-age=3600, immutable','X-Content-Type-Options':'nosniff',...(preview?{'X-Robots-Tag':'noindex, nofollow'}:{})};return new Response(request.method==='HEAD'?null:await image.arrayBuffer(),{headers});}
   if(sceneAdmin&&request.method==='GET'){const rows=(await options.services.scenes.list());return json({scenes:rows,jobs:await options.services.sceneStatus()});}
   if(publicMatch){const issue=publicMatch[1]?await options.services.weekly.get(publicMatch[1]):null;const response=publicMatch[1]?(issue?json({issue}):json({error:'not_found'},404)):json({issues:await options.services.weekly.list()});return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;}
   if(operator&&request.method==='GET')return json(await options.services.inspect());
   if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')??''))return json({error:'json_required'},415);
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(await readRequestBody(request,1024));const value=JSON.parse(raw) as Record<string,unknown>;
   if(!value||typeof value!=='object'||Array.isArray(value)||(path!=='/api/v1/manager/publications/step'&&Object.keys(value).length!==1))return json({error:'invalid_request'},400);
   if(path==='/api/v1/manager/publications/step')return json(await options.services.step(validatePublicationTask(value)));
   if(sceneAdmin&&value.preview===true)return json(await options.services.previewScenes(),202);
   if(sceneAdmin&&value.style==='approved')return json(await options.services.approveStyle());
   if(sceneAdmin&&Number.isSafeInteger(value.batch))return json(await options.services.seedBatch(Number(value.batch)),202);
   if(sceneAdmin&&Number.isSafeInteger(value.approve)){const batch=Number(value.approve);if(![1,2].includes(batch))return json({error:'invalid_batch'},400);await options.services.scenes.approve(Array.from({length:5},(_,i)=>'seed-v1-'+String((batch-1)*5+i+1).padStart(2,'0')));return json({approved:true});}
   if(scheduled&&typeof value.scheduledTime==='string')return json(await options.services.runDue(new Date(value.scheduledTime)));
   if(reconcile&&typeof value.outboxId==='string'&&/^tower-weekly-[a-zA-Z0-9_-]{1,80}:lord$/.test(value.outboxId))return json(await options.services.mail.reconcile(value.outboxId));
   if(operator&&value.action==='inaugural'){if(!(await options.services.inspect()).configured)return json({error:'weekly_not_configured'},503);return json(await options.services.queue([{id:'inaugural',kind:'inaugural'}]),202);}
   return json({error:'invalid_request'},400);
  }catch(error){if(error instanceof RequestBodyError)return json({error:error.code},error.status);if(error instanceof SyntaxError||error instanceof TypeError)return json({error:'invalid_request'},400);return json({error:'weekly_unavailable'},503);}
 };
}

export function validatePublicationTask(v:Record<string,unknown>):PublicationTask{if(typeof v.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(v.id))throw Error('invalid_task');if(v.kind==='inaugural'&&Object.keys(v).length===2&&v.id==='inaugural')return {id:v.id,kind:v.kind};if(v.kind==='due'&&Object.keys(v).length===3&&typeof v.scheduledTime==='string')return {id:v.id,kind:v.kind,scheduledTime:v.scheduledTime};if(v.kind==='scene'&&Object.keys(v).length===4&&typeof v.sceneKey==='string'&&typeof v.batchId==='string')return {id:v.id,kind:v.kind,sceneKey:v.sceneKey,batchId:v.batchId};throw Error('invalid_task');}
