import type {Database} from './db.ts';
import {createTowerAppearance,APPEARANCE_TIMEZONE} from './tower-appearance.ts';
export function calendarPeriods(at:Date){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:APPEARANCE_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
 const part=(key:string)=>parts.find(p=>p.type===key)!.value,day=`${part('year')}-${part('month')}-${part('day')}`;
 const monday=new Date(day+'T12:00:00.000Z');monday.setUTCDate(monday.getUTCDate()-(monday.getUTCDay()+6)%7);
 return {day,week:monday.toISOString().slice(0,10),month:day.slice(0,7)};
}
export const MANAGER_JOB_REGISTRY=[
 {id:'appearance-calendar',cadence:'day'}, {id:'public-health',cadence:'day'}, {id:'case-summary',cadence:'day'},
 {id:'weekly-recap-draft',cadence:'week'}, {id:'monthly-resource-review',cadence:'month'},
] as const;
type Job=typeof MANAGER_JOB_REGISTRY[number]['id'];
interface Run {run_key:string;attempts:number;state:string;lease_until:string}
/** These handlers are DB-only, idempotent, unpaid and may retry once after failure or an expired lease. */
export function createManagerSchedule(db:Database,now:()=>Date=()=>new Date(),options:{beforeJob?:(job:Job)=>Promise<void>}={}){
 async function work(job:Job){
  if(job==='appearance-calendar')return {expired:await createTowerAppearance(db,now).expire()};
  if(job==='public-health'){
   const row=await db.prepare('SELECT c.edition_id,e.id FROM community_current c LEFT JOIN community_editions e ON e.id=c.edition_id WHERE c.id=1').first<{edition_id:string;id:string|null}>();
   return {projection:!row?'empty':row.id?'available':'needs-review'};
  }
  if(job==='case-summary')return {pendingCases:Number((await db.prepare("SELECT COUNT(*) n FROM tower_reception_cases WHERE state='pending' AND expires_at>?").bind(now().toISOString()).first<{n:number}>())!.n)};
  if(job==='weekly-recap-draft'){
   const row=await db.prepare('SELECT e.events_json FROM community_current c JOIN community_editions e ON e.id=c.edition_id WHERE c.id=1').first<{events_json:string}>();
   const events:unknown=row?JSON.parse(row.events_json):[];
   if(!Array.isArray(events))throw Error('projection_invalid');
   return {draftOnly:true,source:'current-public-edition',eventCount:events.filter(e=>e&&e.visibility==='public'&&e.publicationConsent===true&&e.isFixture===false).length,activityDraft:'optional-neighbor-conversation',publication:'requires-review'};
  }
  const costs=await db.prepare("SELECT COUNT(*) jobs,COALESCE(SUM(actual_micro),0) actualMicro,COALESCE(SUM(CASE WHEN state='unknown' THEN reserved_micro ELSE 0 END),0) unknownReservedMicro FROM manager_jobs").first();
  const tokens=await db.prepare('SELECT COUNT(*) activeTokens FROM tower_tokens WHERE revoked=0 AND expires_at>?').bind(now().toISOString()).first();
  return {draftOnly:true,scope:'lifetime-as-of-run',costs,delegationReview:tokens,authorityChanges:false};
 }
 return {async runDue(at:Date){
  if(!Number.isFinite(at.getTime())||Math.abs(now().getTime()-at.getTime())>36*3600000)throw Error('invalid_schedule_time');
  const periods=calendarPeriods(at);let executed=0;
  for(const job of MANAGER_JOB_REGISTRY){
   const period=periods[job.cadence],key=`${job.id}:${period}`,time=now().toISOString(),lease=new Date(now().getTime()+5*60000).toISOString();
   const claim=await db.prepare("INSERT INTO tower_manager_runs(run_key,job,period,state,attempts,lease_until,created_at) VALUES(?,?,?,'running',1,?,?) ON CONFLICT(run_key) DO UPDATE SET state='running',attempts=attempts+1,lease_until=excluded.lease_until,error_code=NULL WHERE tower_manager_runs.attempts<2 AND (tower_manager_runs.state='failed' OR tower_manager_runs.state='running' AND tower_manager_runs.lease_until<=?)").bind(key,job.id,period,lease,time,time).run();
   if(!claim.meta.changes)continue;
   const run=await db.prepare('SELECT * FROM tower_manager_runs WHERE run_key=?').bind(key).first<Run>();if(!run)throw Error('run_missing');executed++;
   try{
    await options.beforeJob?.(job.id);const result=await work(job.id);
    await db.prepare("UPDATE tower_manager_runs SET state='complete',result_json=?,completed_at=? WHERE run_key=? AND state='running' AND attempts=? AND lease_until=?").bind(JSON.stringify(result),now().toISOString(),key,run.attempts,lease).run();
   }catch{
    await db.prepare("UPDATE tower_manager_runs SET state='failed',error_code='safe_job_failed',completed_at=? WHERE run_key=? AND state='running' AND attempts=? AND lease_until=?").bind(now().toISOString(),key,run.attempts,lease).run();
   }
  }
  await db.prepare("UPDATE tower_manager_runs SET state='abandoned',error_code='retry_limit_reached',completed_at=? WHERE state='running' AND attempts=2 AND lease_until<=?").bind(now().toISOString(),now().toISOString()).run();
  return {executed,periods};
 },async inspect(){return {registry:MANAGER_JOB_REGISTRY,runs:(await db.prepare('SELECT * FROM tower_manager_runs ORDER BY created_at DESC,run_key LIMIT 50').all()).results};}};
}
