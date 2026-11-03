import type {Database} from './db.ts';
import {sha} from './tower-scenes-catalog.ts';
export interface SceneProviderOptions {db:Database;apiKey?:string;budgetMicro:number;dailyBudgetMicro:number;monthlyBudgetMicro:number;fetcher?:typeof fetch;now?:()=>Date;restoreImage?:(sceneId:string)=>Promise<Record<string,unknown>>}
const integer=(n:unknown,max=1000000):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=max;
const price=(i:number,o:number)=>Math.ceil((i*5+o*17)/4);
export class SceneFailure extends Error {readonly outcome:'blocked'|'unknown'|'invalid';constructor(code:string,outcome:'blocked'|'unknown'|'invalid'){super(code);this.outcome=outcome;}}
export async function limitedJSON(response:Response,max=128000){const reader=response.body?.getReader();if(!reader)throw Error('empty_response');const chunks:Uint8Array[]=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('response_limit');}chunks.push(value);}const bytes=new Uint8Array(size);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.length;}return JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>;}
export function sceneProvider(options:SceneProviderOptions){
 const {db}=options,fetcher=options.fetcher??fetch,now=()=>options.now?.()??new Date();
 const run=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args).run();
 return async function call(sceneId:string,purpose:'plan'|'image'|'review',payload:Record<string,unknown>,claimedLease:string){
  const owner=await db.prepare("SELECT id FROM tower_scenes WHERE id=? AND state='running' AND lease_until=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(sceneId,claimedLease).first();if(!owner)throw new SceneFailure('scene_lease_lost','blocked');
  const jobId=`scene:${sceneId}:${purpose}`,existing=await db.prepare('SELECT state FROM manager_jobs WHERE id=?').bind(jobId).first<{state:string}>();
  if(existing){
   if(existing.state==='complete'){
    const saved=await db.prepare('SELECT result_json FROM tower_scene_results WHERE job_id=?').bind(jobId).first<{result_json:string}>();
    if(saved)return JSON.parse(saved.result_json) as Record<string,unknown>;
    if(purpose==='image'&&options.restoreImage)return options.restoreImage(sceneId);
   }
   throw new SceneFailure('scene_call_already_claimed','unknown');
  }
  const headers={Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json'},image=purpose==='image';let reserve=10000;
  if(!image){try{const response=await fetcher('https://api.meta.ai/v1/responses/input_tokens',{method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('count_rejected');const result=await limitedJSON(response);if(!integer(result.input_tokens,120000))throw Error('count_invalid');reserve=price(result.input_tokens,8192);}catch{throw new SceneFailure('token_count_unavailable','blocked');}}
  const at=now().toISOString(),requestSHA=await sha(new TextEncoder().encode(JSON.stringify(payload)));
  let result;try{result=await db.batch([
   db.prepare(`INSERT INTO manager_jobs(id,source_digest,state,reserved_micro,created_at,started_at) SELECT ?,?,'running',?,?,? WHERE NOT EXISTS(SELECT 1 FROM manager_jobs WHERE id=?)
    AND (SELECT COALESCE(SUM(COALESCE(actual_micro,reserved_micro)),0) FROM manager_jobs)+?<=?
    AND (SELECT COALESCE(SUM(COALESCE(actual_micro,reserved_micro)),0) FROM manager_jobs WHERE substr(started_at,1,10)=?)+?<=?
    AND (SELECT COALESCE(SUM(COALESCE(actual_micro,reserved_micro)),0) FROM manager_jobs WHERE substr(started_at,1,7)=?)+?<=?`).bind(jobId,jobId,reserve,at,at,jobId,reserve,options.budgetMicro,at.slice(0,10),reserve,options.dailyBudgetMicro,at.slice(0,7),reserve,options.monthlyBudgetMicro),
   db.prepare('INSERT INTO tower_scene_calls(scene_id,purpose,job_id,model,request_sha,created_at,owner_lease) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM manager_jobs WHERE id=? AND state=\'running\' AND started_at=?) AND NOT EXISTS(SELECT 1 FROM tower_scene_calls WHERE scene_id=? AND purpose=?)').bind(sceneId,purpose,jobId,String(payload.model),requestSHA,at,claimedLease,jobId,at,sceneId,purpose)
  ]);}catch{throw new SceneFailure('scene_dispatch_scope','blocked');}
  if(result[0].meta.changes!==1)throw new SceneFailure('shared_budget_exhausted','blocked');
  let charged=false;
  try{
   const body=JSON.stringify(image?payload:{...payload,store:false,max_output_tokens:8192,reasoning:{effort:'minimal'}});
   const gate=await db.prepare(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') native_now,s.lease_until FROM tower_scenes s JOIN tower_scene_calls c ON c.scene_id=s.id JOIN manager_jobs j ON j.id=c.job_id WHERE s.id=? AND c.job_id=? AND s.lease_until=? AND c.owner_lease=? AND s.state='running' AND j.state='running' AND j.actual_micro IS NULL AND s.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND substr(j.started_at,1,10)=date('now') AND abs(julianday(j.started_at)-julianday('now'))<1.0/1440`).bind(sceneId,jobId,claimedLease,claimedLease).first<{native_now:string;lease_until:string}>();
   // Last synchronous dual-clock gate: there is no awaited operation between this check and HTTP.
   const wall=new Date(),app=now();
   if(!gate||!Number.isFinite(Date.parse(gate.native_now))||Math.abs(wall.getTime()-Date.parse(gate.native_now))>60000||Math.abs(app.getTime()-Date.parse(gate.native_now))>60000||wall.toISOString().slice(0,10)!==at.slice(0,10)||app.toISOString().slice(0,10)!==at.slice(0,10)||wall.toISOString()>=gate.lease_until||app.toISOString()>=gate.lease_until){
    await run("UPDATE manager_jobs SET state='blocked',actual_micro=0,error_code='unsent_dispatch_scope_expired',completed_at=? WHERE id=? AND state='running' AND actual_micro IS NULL",wall.toISOString(),jobId);
    throw new SceneFailure('unsent_dispatch_scope_expired','blocked');
   }
   const response=await fetcher(image?'https://api.meta.ai/v1/images/edits':'https://api.meta.ai/v1/responses',{method:'POST',headers,body,signal:AbortSignal.timeout(image?180000:45000)});
   if(!response.ok){const rejected=[400,401,403,404,422,429].includes(response.status);await run("UPDATE manager_jobs SET state=?,actual_micro=?,error_code=?,completed_at=? WHERE id=? AND state='running'",rejected?'blocked':'unknown',rejected?0:null,`http_${response.status}`,now().toISOString(),jobId);throw new SceneFailure(`http_${response.status}`,rejected?'blocked':'unknown');}
   const data=await limitedJSON(response,image?12*1024*1024:128000);
   if(image){const usage=data.usage as Record<string,unknown>|undefined,headerId=response.headers.get('x-request-id'),providerId=typeof data.id==='string'&&data.id.length>0?data.id:headerId&&headerId.length>0?headerId:null;await run("UPDATE manager_jobs SET actual_micro=10000,provider_id=?,input_tokens=?,output_tokens=? WHERE id=? AND state='running'",providerId,integer(usage?.input_tokens,Number.MAX_SAFE_INTEGER)?usage!.input_tokens:null,integer(usage?.output_tokens,Number.MAX_SAFE_INTEGER)?usage!.output_tokens:null,jobId);charged=true;if(data.model!==undefined&&data.model!=='muse-image-1.0')throw Error('provider_model');}
   else{const usage=data.usage as Record<string,unknown>|undefined;if(!usage||!integer(usage.input_tokens,120000)||!integer(usage.output_tokens,8192)||typeof data.id!=='string'||!data.id||data.id.length>200)throw Error('usage_unconfirmed');const actual=price(usage.input_tokens,usage.output_tokens);await run("UPDATE manager_jobs SET actual_micro=?,input_tokens=?,output_tokens=?,provider_id=? WHERE id=? AND state='running'",actual,usage.input_tokens,usage.output_tokens,data.id,jobId);charged=true;if(actual>reserve||data.model!=='muse-spark-1.3'||data.status!=='completed')throw Error('provider_contract');}
   await db.batch([
    ...(!image?[db.prepare('INSERT INTO tower_scene_results(job_id,result_json) VALUES(?,?)').bind(jobId,JSON.stringify(data))]:[]),
    db.prepare("UPDATE manager_jobs SET state='complete',completed_at=? WHERE id=? AND state='running'").bind(now().toISOString(),jobId)
   ]);return data;
  }catch(error){if(error instanceof SceneFailure)throw error;await run("UPDATE manager_jobs SET state=?,error_code=?,completed_at=? WHERE id=? AND state='running'",charged?'invalid':'unknown',charged?'provider_contract':'provider_outcome_unknown',now().toISOString(),jobId);throw new SceneFailure(charged?'provider_contract':'provider_outcome_unknown',charged?'invalid':'unknown');}
 };
}
export function outputJSON(data:Record<string,unknown>){const output=data.output as {type:string;content?:{type:string;text?:string}[]}[]|undefined;const text=output?.filter(x=>x.type==='message').flatMap(x=>x.content??[]).filter(x=>x.type==='output_text').map(x=>x.text??'').join('');if(!text)throw new SceneFailure('missing_text','invalid');try{return JSON.parse(text) as Record<string,unknown>;}catch{throw new SceneFailure('invalid_json','invalid');}}
