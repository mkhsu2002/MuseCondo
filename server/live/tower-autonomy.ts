import {readManagerMemory,readBlockedThemeSummary} from './tower-manager-memory.ts';
import {themePresentation} from './tower-theme.ts';
import {createAutonomyProvider,managerTextPayload as textPayload,outputJSON,IMAGE,constraint} from './tower-autonomy-provider.ts';
import type {Database} from './db.ts';
import {validatePNG} from './png.ts';
import {sanitizePublicPNG} from '../framework/png-public.ts';
import {calendarPeriods} from './tower-manager-schedule.ts';
import {MANAGER_CALENDAR_POLICY,managerLocalDaySQL} from './tower-calendar.ts';
import {CURRENT_AUTONOMY_TASK_POLICY as taskPolicy,policyAllowsAppearance} from './tower-autonomy-policy.ts';
import {createHistoricalAuditCapRecovery,auditOutputCapResumeId} from './tower-autonomy-audit-cap-recovery.ts';
export interface AssetBucket {put(key:string,bytes:Uint8Array,options?:{httpMetadata?:{contentType:string}}):Promise<unknown>;get(key:string):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>}
export const AUTONOMY_SCHEMA_OBJECTS=['tower_autonomy_mandate','tower_autonomy_cycles','tower_autonomy_calls','tower_autonomy_call_binding','tower_autonomy_call_permanent','tower_autonomy_events','tower_autonomy_events_update','tower_autonomy_events_delete','tower_autonomy_assets','tower_autonomy_assets_update','tower_autonomy_assets_delete','tower_autonomy_current','tower_autonomy_current_guard','tower_autonomy_current_update_guard','tower_autonomy_task_anchors','tower_autonomy_anchor_update','tower_autonomy_anchor_delete','tower_autonomy_anchor_replace','tower_autonomy_cycle_binding','tower_autonomy_cycle_replace','tower_autonomy_cycle_delete','tower_autonomy_call_replace','tower_autonomy_events_replace','tower_autonomy_assets_replace','tower_autonomy_assets_provenance','tower_autonomy_current_native_clock','tower_autonomy_current_update_clock','tower_autonomy_current_permanent','tower_autonomy_calls_billing_day','tower_autonomy_call_billing_guard','tower_autonomy_authorizations','tower_autonomy_authorization_update','tower_autonomy_authorization_delete','tower_autonomy_authorization_replace','tower_autonomy_action_audit','tower_autonomy_initial_action_guard','tower_autonomy_authorization_guard','tower_autonomy_anchor_scope','tower_autonomy_action_audit_guard','tower_autonomy_action_transition_guard','tower_autonomy_paid_tool_scope'] as const;
const AUTONOMY_POLICY_GUARDS=[
 ['tower_autonomy_call_billing_guard',['NEW.created_at','native_now']],
 ['tower_autonomy_initial_action_guard',['NEW.updated_at','native_now']],
 ['tower_autonomy_authorization_guard',['NEW.created_at','native_now']],
 ['tower_autonomy_anchor_scope',['native_now']],['tower_autonomy_action_audit_guard',['native_now']],
 ['tower_autonomy_action_transition_guard',['native_now']],['tower_autonomy_paid_tool_scope',['native_now']],
] as const;
export async function autonomySchemaReady(db:Database){
 const names=AUTONOMY_POLICY_GUARDS.map(([name])=>`'${name}'`).join(',');
 const rows=(await db.prepare(`SELECT name,CASE WHEN name IN (${names}) THEN sql END AS policy_sql FROM sqlite_master WHERE type IN ('table','trigger','index')`).all<{name:string;policy_sql:string|null}>()).results;
 return AUTONOMY_SCHEMA_OBJECTS.every(name=>rows.some(row=>row.name===name))&&AUTONOMY_POLICY_GUARDS.every(([name,inputs])=>inputs.every(input=>rows.find(row=>row.name===name)?.policy_sql?.includes(managerLocalDaySQL(input))===true));
}

interface Options {onPublicAppearance?:(generation:string)=>Promise<void>;db:Database;bucket?:AssetBucket;apiKey?:string;transport?:typeof fetch;assetFetch?:(path:string)=>Promise<Response>;wake?:()=>Promise<void>;now?:()=>Date}
interface Plan {kind:'noop'|'health'|'appearance';purpose:string;acceptance:string[];budgetMicro:number;permissions:string[];reason:string;dayPrompt:string;nightPrompt:string}
interface Cycle {id:string;day:string;state:string;outcome:string;error_code:string|null;tool_json:string|null;budget_micro:number;plan_json:string|null;evidence_json:string|null;audit_json:string|null;repair:number;step_seq:number;lease_until:string|null}
interface Asset {generation_id:string;scene:'day'|'night';object_key:string;sha256:string;width:number;height:number;bytes:number;provider_call_id:string}
const LIMIT=taskPolicy.taskLimitMicro;
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const encode=(bytes:Uint8Array)=>{let result='';for(let i=0;i<bytes.length;i+=16384)result+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(result);};
function validPlan(v:Record<string,unknown>):v is Record<string,unknown> & Plan {return ['noop','health','appearance'].includes(String(v.kind))&&typeof v.purpose==='string'&&v.purpose.length>0&&v.purpose.length<=600&&Array.isArray(v.acceptance)&&v.acceptance.length>0&&v.acceptance.length<=8&&v.acceptance.every(x=>typeof x==='string'&&x.length<=400)&&Number.isSafeInteger(v.budgetMicro)&&Number(v.budgetMicro)>0&&Number(v.budgetMicro)<=LIMIT&&Array.isArray(v.permissions)&&v.permissions.every(x=>taskPolicy.permissions.includes(String(x)))&&typeof v.reason==='string'&&v.reason.length<=1200&&typeof v.dayPrompt==='string'&&v.dayPrompt.length<=4000&&typeof v.nightPrompt==='string'&&v.nightPrompt.length<=4000;}
/** Each step owns one durable lease and at most one paid dispatch. No provider credentials leave Pages. */
export function createManagerAutonomy(options:Options){
 const {db}=options,clock=options.now??(()=>new Date());
 const run=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args).run();
 const event=(cycle:string|null,kind:string,detail:unknown={})=>run('INSERT INTO tower_autonomy_events VALUES(?,?,?,?,?)',crypto.randomUUID(),cycle,kind,JSON.stringify(detail),clock().toISOString());
 async function health(){const row=await db.prepare('SELECT c.edition_id,e.id FROM community_current c LEFT JOIN community_editions e ON e.id=c.edition_id WHERE c.id=1').first<{edition_id:string;id:string|null}>();return {publicProjection:!row?'empty':row.id?'available':'broken',appearanceStorage:!!options.bucket,privateResidentDataRead:false};}
 async function obligations(taskDay:string){
  const pointer=await publicState(),blockers:string[]=[];let available=false;
  if(!options.bucket)blockers.push('appearance_storage_not_bound');if(!options.assetFetch)blockers.push('reference_assets_not_bound');
  if(pointer){try{const pair=(await db.prepare('SELECT * FROM tower_autonomy_assets WHERE generation_id=?').bind(pointer.generation).all<Asset>()).results;if(pair.length!==2)throw Error('pair_missing');for(const asset of pair)await readAsset(asset);available=true;}catch{blockers.push('active_pair_unavailable');}}
  const at=clock().toISOString(),currentDay=calendarPeriods(new Date(at)).day,inWindow=policyAllowsAppearance(taskPolicy.id,currentDay,at);
  const globalDue=inWindow&&!available?[{id:taskPolicy.id,purpose:taskPolicy.purpose,acceptance:taskPolicy.acceptance,state:'due'}]:[];
  return {calendarPolicy:MANAGER_CALENDAR_POLICY.id,taskDay,currentDay,asOf:at,currentPublicAppearance:pointer?{generation:pointer.generation,endsAt:pointer.endsAt,artifactReadback:available?'verified':'unavailable'}:null,due:taskDay===currentDay?globalDue:[],globalDue,blockers};
 }
 const provider=createAutonomyProvider(options);
 async function advance(c:Cycle,state:string,values:Record<string,unknown>={}){
  const fields=Object.keys(values),at=clock().toISOString();
  const result=await db.batch([
   db.prepare(`UPDATE tower_autonomy_cycles SET state=?,step_seq=step_seq+1,lease_until=NULL,updated_at=?${fields.map(k=>`,${k}=?`).join('')} WHERE id=? AND step_seq=? AND lease_until=?`).bind(state,at,...fields.map(k=>values[k]),c.id,c.step_seq,c.lease_until),
   db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_autonomy_cycles WHERE id=? AND state=? AND step_seq=? AND updated_at=?) THEN 1 ELSE json('lease-lost') END").bind(c.id,state,c.step_seq+1,at),
   db.prepare('INSERT INTO tower_autonomy_events VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),c.id,'state-transition',JSON.stringify({from:c.state,to:state}),at),
  ]);
  if(result[0].meta.changes!==1)throw Error('lease_lost');
 }
 async function authorizeTask(c:Cycle,plan:Plan,weekly:boolean,monthly:boolean,costs:unknown){
  const at=clock().toISOString(),next=plan.kind==='appearance'?'execute':'verify',periods=calendarPeriods(new Date(at));
  const state=db.prepare("UPDATE tower_autonomy_cycles SET state=?,step_seq=step_seq+1,lease_until=NULL,updated_at=?,plan_json=?,purpose=?,acceptance_json=?,permissions_json=?,budget_micro=? WHERE id=? AND state='thinking' AND step_seq=? AND lease_until=?").bind(next,at,JSON.stringify(plan),plan.purpose,JSON.stringify(plan.acceptance),JSON.stringify(plan.permissions),plan.budgetMicro,c.id,c.step_seq,c.lease_until);
  const statements=[state,
   db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_autonomy_cycles WHERE id=? AND state=? AND step_seq=? AND updated_at=?) THEN 1 ELSE json('authorization-claim-conflict') END").bind(c.id,next,c.step_seq+1,at),
   db.prepare('INSERT INTO tower_autonomy_authorizations VALUES(?,?,?,?,?,?,?,?,?)').bind(c.id,c.day,plan.kind,plan.budgetMicro,c.step_seq+1,plan.kind==='appearance'?taskPolicy.startsAt:null,plan.kind==='appearance'?taskPolicy.endsAt:null,MANAGER_CALENDAR_POLICY.id,at),
   ...(plan.kind==='appearance'?[db.prepare('INSERT INTO tower_autonomy_task_anchors VALUES(?,?,?)').bind(taskPolicy.id,c.id,at)]:[]),
   db.prepare('INSERT INTO tower_autonomy_events VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),c.id,'action-authorized',JSON.stringify({kind:plan.kind,day:c.day,policy:MANAGER_CALENDAR_POLICY.id,grantedSeq:c.step_seq+1,budgetMicro:plan.budgetMicro}),at),
   db.prepare('INSERT INTO tower_autonomy_events VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),c.id,'state-transition',JSON.stringify({from:'thinking',to:next}),at),
   ...(weekly?[db.prepare('INSERT INTO tower_autonomy_events VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),c.id,'weekly-review',JSON.stringify({week:periods.week,decision:plan.reason}),at)]:[]),
   ...(monthly?[db.prepare('INSERT INTO tower_autonomy_events VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),c.id,'monthly-review',JSON.stringify({month:periods.month,decision:plan.reason,costs}),at)]:[]),
   // A final native-clock check also rolls back earlier statements if midnight lands inside the batch.
   db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_autonomy_authorizations a JOIN tower_autonomy_cycles c ON c.id=a.cycle_id,(SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') native_now) WHERE a.cycle_id=? AND a.day=${managerLocalDaySQL('native_now')} AND a.created_at=? AND c.step_seq=a.granted_seq AND c.state=? AND (SELECT enabled FROM tower_autonomy_mandate WHERE id=1)=1 AND (a.kind!='appearance' OR (a.starts_at<=native_now AND a.ends_at>native_now))) THEN 1 ELSE json('authorization-expired') END`).bind(c.id,at,next),
  ];
  await db.batch(statements);
 }
 async function block(c:Cycle,code:string){await advance(c,c.state==='selfreview'?'blocked':'selfreview',{error_code:code,outcome:'blocked'});}
 const assets=(c:Cycle)=>db.prepare('SELECT * FROM tower_autonomy_assets WHERE generation_id=? ORDER BY scene').bind(`${c.id}-r${c.repair}`).all<Asset>();
 async function readAsset(a:Asset){const object=await options.bucket?.get(a.object_key);if(!object)throw Error('artifact_missing');const bytes=new Uint8Array(await object.arrayBuffer());const size=await validatePNG(bytes);if(bytes.length!==a.bytes||await digest(bytes)!==a.sha256||size.width!==a.width||size.height!==a.height||Math.abs(size.width/size.height-16/9)>0.04||size.width<1200||size.height<675)throw Error('artifact_mismatch');return bytes;}
 const recovery=createHistoricalAuditCapRecovery<Cycle,Asset>({...options,clock,assets,readAsset});
 const {eligibilitySQL:resumeEligibility,nativeNowSQL:nativeNow}=recovery;
 async function pending(){return !!await db.prepare(`SELECT 1 FROM tower_autonomy_cycles c,${nativeNow} WHERE (SELECT enabled FROM tower_autonomy_mandate WHERE id=1)=1 AND (c.state NOT IN ('complete','blocked') OR (${resumeEligibility})) LIMIT 1`).first();}
 async function prepareDaily(){const at=clock().toISOString(),day=calendarPeriods(clock()).day;await run("INSERT INTO tower_autonomy_cycles(id,day,state,purpose,budget_micro,created_at,updated_at) SELECT ?,?,'thinking','Daily autonomous care and decisions',task_limit_micro,?,? FROM tower_autonomy_mandate WHERE id=1 AND enabled=1 AND NOT EXISTS(SELECT 1 FROM tower_autonomy_cycles WHERE day=?)",`manager-${day}`,day,at,at,day);}
 async function step(){
  if(!(await db.prepare('SELECT enabled FROM tower_autonomy_mandate WHERE id=1').first<{enabled:number}>())?.enabled)return {pending:false,state:'disabled'};
  if(await recovery.resume())return {pending:true,state:'audit'};
  const now=clock().toISOString(),day=calendarPeriods(clock()).day;
  await prepareDaily();
  const row=await db.prepare("SELECT * FROM tower_autonomy_cycles WHERE state NOT IN ('complete','blocked') ORDER BY created_at LIMIT 1").first<Cycle>();if(!row)return {pending:false,state:'idle'};
  const until=new Date(clock().getTime()+5*60000).toISOString();
  if(row.lease_until&&row.lease_until<=now){
   const inflight=await db.prepare("SELECT id FROM tower_autonomy_calls WHERE cycle_id=? AND state='dispatching'").bind(row.id).first();
   if(inflight){
    const state=row.state==='selfreview'?'blocked':'selfreview';
    const result=await db.batch([
     db.prepare("UPDATE tower_autonomy_calls SET state='unknown',completed_at=? WHERE cycle_id=? AND state='dispatching' AND EXISTS(SELECT 1 FROM tower_autonomy_cycles WHERE id=? AND step_seq=? AND lease_until=?)").bind(now,row.id,row.id,row.step_seq,row.lease_until),
     db.prepare("UPDATE tower_autonomy_cycles SET state=?,outcome='blocked',error_code='dispatch_interrupted',lease_until=NULL,step_seq=step_seq+1,updated_at=? WHERE id=? AND step_seq=? AND lease_until=?").bind(state,now,row.id,row.step_seq,row.lease_until),
    ]);
    if(result[1].meta.changes)await event(row.id,'dispatch-interrupted',{code:'dispatch_interrupted',next:state});
    return {pending:await pending(),state};
   }
  }
  const claim=await run("UPDATE tower_autonomy_cycles SET lease_until=? WHERE id=? AND step_seq=? AND (lease_until IS NULL OR lease_until<=?)",until,row.id,row.step_seq,now);if(!claim.meta.changes)return {pending:true,state:'leased'};
  const c={...row,lease_until:until};
  try{
   if(c.state==='thinking'&&c.day!==day){
    await event(c.id,'missed-daily-thinking',{taskDay:c.day,currentDay:day});await block(c,'missed_daily_thinking');
   }else if(c.state==='thinking'){
    const privateMemories=await readManagerMemory(db),blockedExtensions=await readBlockedThemeSummary(db);
    const periods=calendarPeriods(clock());const weekly=!(await db.prepare("SELECT 1 FROM tower_autonomy_events WHERE kind='weekly-review' AND json_extract(detail_json,'$.week')=? LIMIT 1").bind(periods.week).first()),monthly=!(await db.prepare("SELECT 1 FROM tower_autonomy_events WHERE kind='monthly-review' AND json_extract(detail_json,'$.month')=? LIMIT 1").bind(periods.month).first());
    const costs=await db.prepare('SELECT COALESCE(SUM(COALESCE(actual_micro,reserved_micro)),0) committedMicro FROM tower_autonomy_calls').first();
    const blockedTasks=(await db.prepare("SELECT a.anchor,c.state,c.error_code FROM tower_autonomy_task_anchors a JOIN tower_autonomy_cycles c ON c.id=a.cycle_id WHERE c.state!='complete' ORDER BY c.created_at LIMIT 10").all()).results;
    const themeCapability=!!await db.prepare("SELECT 1 FROM tower_autonomy_events WHERE id='lobby-theme-policy:v1' AND kind='lobby-theme-policy-enabled'").first();
    const {data}=await provider(c,'daily-thinking',textPayload(taskPolicy.thinkingInstructions,{localDay:c.day,calendarPolicy:MANAGER_CALENDAR_POLICY.id,obligations:await obligations(c.day),blockedTasks,appearancePhase:taskPolicy.appearancePhase,timezone:'America/Vancouver',health:await health(),previousPrivateMemory:privateMemories,blockedExtensions,weeklyDue:weekly,monthlyDue:monthly,costs,season:day===taskPolicy.localDay?taskPolicy.season:'ordinary',availableTools:['inspect_public_health','edit_tower_images'],planningBudget:{minimumMicro:{appearance:themeCapability?taskPolicy.minimumMicro.expandedAppearance:taskPolicy.minimumMicro.appearance,health:taskPolicy.minimumMicro.health,noop:taskPolicy.minimumMicro.noop},maximumMicro:LIMIT,currency:'microUSD'},expandedLobbyDuty:themeCapability?'The completed image pair will be followed automatically by the separately authorized whole-homepage theme extension on this SAME cost account; appearance minimum includes 2100000 microUSD additional worst-case reserve, never a new charge or budget.':null,taskLimitMicro:LIMIT,dailyTaskLimit:taskPolicy.dailyTaskLimit}));
    if(c.day!==calendarPeriods(clock()).day)throw Error('missed_daily_thinking');
    const plan=outputJSON(data);if(!validPlan(plan))throw Error('plan_contract');
    if(plan.kind==='appearance'&&(!options.bucket||!options.assetFetch||!taskPolicy.appearancePermissions.every(permission=>plan.permissions.includes(permission))||!policyAllowsAppearance(taskPolicy.id,day,clock().toISOString())||!plan.dayPrompt.trim()||!plan.nightPrompt.trim()))throw Error('permission_or_calendar_blocked');
    await authorizeTask(c,plan,weekly,monthly,costs);
   }else if(c.state==='execute'){
    const plan=JSON.parse(c.plan_json??'null') as Plan;
    const {data}=await provider(c,'tool-executor',textPayload('Execute the approved task by calling edit_tower_images exactly once with the two prompts. Do not assert tool success before receiving evidence. Repair feedback, if present, refers to this same logical task and budget.',{plan,repair:c.repair,previousAudit:c.audit_json},{tools:[{type:'function',name:'edit_tower_images',description:'Edit the existing day and night reference images. The application validates both artifacts and requests an independent audit before activation.',parameters:{type:'object',properties:{dayPrompt:{type:'string'},nightPrompt:{type:'string'}},required:['dayPrompt','nightPrompt'],additionalProperties:false},strict:true}],tool_choice:'auto',parallel_tool_calls:false,include:['reasoning.encrypted_content']}));
    const output=data.output as {type?:string;name?:string;arguments?:string;call_id?:string}[];const calls=output?.filter(v=>v.type==='function_call');if(calls?.length!==1||calls[0].name!=='edit_tower_images'||!calls[0].call_id)throw Error('tool_contract');const args=JSON.parse(calls[0].arguments??'{}');if(Object.keys(args).some(k=>!['dayPrompt','nightPrompt'].includes(k))||!['dayPrompt','nightPrompt'].every(k=>typeof args[k]==='string'&&args[k].length>0&&args[k].length<=4000))throw Error('tool_contract');
    await event(c.id,'tool-dispatch',{name:'edit_tower_images',callId:calls[0].call_id,generation:`${c.id}-r${c.repair}`});await advance(c,'image-day',{plan_json:JSON.stringify({...plan,...args}),tool_json:JSON.stringify({callId:calls[0].call_id,output:data.output})});
   }else if(c.state==='image-day'||c.state==='image-night'){
    const scene=c.state==='image-day'?'day':'night',plan=JSON.parse(c.plan_json??'null') as Plan;
    const reference=await options.assetFetch!(`/tower/muse-tower-${scene}-v2.webp`);if(!reference.ok)throw Error('reference_unavailable');const bytes=new Uint8Array(await reference.arrayBuffer());if(bytes.length<100||bytes.length>8*1024*1024)throw Error('reference_invalid');
    const {data,call}=await provider(c,`image-${scene}-r${c.repair}`,{model:IMAGE,n:1,response_format:'b64_json',output_format:'png',size:'1600x900',reasoning_strength:'low',tool_enablement:{enable_image_search:false,enable_web_search:false,enable_shell:false},prompt:`Edit this existing reference. ${constraint}\nScene: ${scene}. Manager-selected design: ${scene==='day'?plan.dayPrompt:plan.nightPrompt}`,images:[{image_url:`data:image/webp;base64,${encode(bytes)}`}]},true);
    const items=data.data as {b64_json?:string;url?:string}[];if(items?.length!==1||items[0].url||typeof items[0].b64_json!=='string'||items[0].b64_json.length>12*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(items[0].b64_json))throw Error('image_contract');const providerImage=Uint8Array.from(atob(items[0].b64_json),v=>v.charCodeAt(0));const image=await sanitizePublicPNG(providerImage);const size=await validatePNG(image);if(size.width<1200||size.height<675||Math.abs(size.width/size.height-16/9)>0.04)throw Error('image_dimensions');
    const generation=`${c.id}-r${c.repair}`,key=`tower-manager/${generation}/${scene}.png`,sha=await digest(image);await options.bucket!.put(key,image,{httpMetadata:{contentType:'image/png'}});
    await run('INSERT INTO tower_autonomy_assets VALUES(?,?,?,?,?,?,?,?,?,?)',generation,scene,c.id,key,sha,size.width,size.height,image.length,call,clock().toISOString());await advance(c,scene==='day'?'image-night':'verify');
   }else if(c.state==='verify'){
    const plan=JSON.parse(c.plan_json??'null') as Plan,publicHealth=await health();if(publicHealth.publicProjection==='broken')throw Error('public_projection_broken');const found=(await assets(c)).results;
    if(plan.kind==='appearance'){if(found.length!==2||!found.some(a=>a.scene==='day')||!found.some(a=>a.scene==='night'))throw Error('artifact_pair_missing');for(const asset of found)await readAsset(asset);if(found[0].sha256===found[1].sha256)throw Error('artifact_pair_identical');}
    const evidence={verified:true,kind:plan.kind,generation:plan.kind==='appearance'?`${c.id}-r${c.repair}`:null,assets:found,health:publicHealth,checks:plan.kind==='appearance'?['R2-readback','SHA256','PNG-CRC-and-decoded-scanlines','16:9-dimensions','distinct-day-night-pair']:['public-projection-readback','no-mutation'],verifiedAt:clock().toISOString(),obligations:await obligations(c.day)};await event(c.id,'deterministic-verification',evidence);await advance(c,plan.kind==='appearance'?'tool-result':'audit',{evidence_json:JSON.stringify(evidence)});
   }else if(c.state==='tool-result'){
    const tool=JSON.parse(c.tool_json!) as {callId:string;output:Record<string,unknown>[]};
    const replay=tool.output.filter(item=>item.type!=='reasoning'||typeof item.encrypted_content==='string').map(item=>item.type==='reasoning'?{...item,summary:item.summary??[]}:item);
    const {data}=await provider(c,'tool-result-review',textPayload('The requested tool has returned actual deterministic evidence. Acknowledge the output, do not request another tool or declare independent audit passed. Return ONLY JSON {received:true}.',null,{input:[...replay,{type:'function_call_output',call_id:tool.callId,output:c.evidence_json}]}));
    if(outputJSON(data).received!==true)throw Error('tool_result_contract');await event(c.id,'tool-output-acknowledged',{callId:tool.callId});await advance(c,'audit');
   }else if(c.state==='audit'){
    const plan=JSON.parse(c.plan_json??'null') as Plan;const images=[];
    if(plan.kind==='appearance')for(const asset of (await assets(c)).results){const bytes=await readAsset(asset);const original=await options.assetFetch!(`/tower/muse-tower-${asset.scene}-v2.webp`);if(!original.ok)throw Error('reference_unavailable');images.push({type:'input_text',text:`${asset.scene} ORIGINAL reference:`},{type:'input_image',image_url:`data:image/webp;base64,${encode(new Uint8Array(await original.arrayBuffer()))}`},{type:'input_text',text:`${asset.scene} ACTUAL generated R2 readback:`},{type:'input_image',image_url:`data:image/png;base64,${encode(bytes)}`});}
    const payload=textPayload(taskPolicy.auditInstructions,{plan,evidence:JSON.parse(c.evidence_json??'null')});
    if(images.length)payload.input=[{role:'user',content:[{type:'input_text',text:JSON.stringify({plan,evidence:JSON.parse(c.evidence_json??'null')})},...images]}];
    const {data,call:auditCall}=await provider(c,'independent-task-audit',payload);const audit:Record<string,unknown>={...outputJSON(data),callId:auditCall};if(!['PASS','FAIL'].includes(String(audit.verdict))||typeof audit.reason!=='string'||audit.reason.length>2000)throw Error('audit_contract');
    const evidence=JSON.parse(c.evidence_json??'null') as {obligations?:{due?:unknown[]}}|null;
    const unfulfilled=plan.kind!=='appearance'&&(evidence?.obligations?.due?.length??0)>0;
    if(unfulfilled){audit.providerVerdict=audit.verdict;audit.verdict='FAIL';audit.deterministicGate='standing_obligation_unfulfilled';}
    await event(c.id,'task-audit',audit);
    if(audit.verdict==='PASS')await advance(c,plan.kind==='appearance'?'activate':'selfreview',{audit_json:JSON.stringify(audit)});
    else if(plan.kind==='appearance'&&c.repair<taskPolicy.repairLimit&&!await db.prepare('SELECT 1 FROM tower_autonomy_events WHERE id=?').bind(auditOutputCapResumeId(c.id)).first()&&typeof audit.dayPrompt==='string'&&typeof audit.nightPrompt==='string'&&audit.dayPrompt.length<=4000&&audit.nightPrompt.length<=4000){await advance(c,'execute',{repair:c.repair+1,audit_json:JSON.stringify(audit),plan_json:JSON.stringify({...plan,dayPrompt:audit.dayPrompt,nightPrompt:audit.nightPrompt}),evidence_json:null});}
    else await advance(c,'selfreview',{audit_json:JSON.stringify(audit),error_code:unfulfilled?'standing_obligation_unfulfilled':'task_audit_failed',outcome:'blocked'});
   }else if(c.state==='activate'){
    if(JSON.parse(c.audit_json??'null').verdict!=='PASS'||!JSON.parse(c.evidence_json??'null').verified||!policyAllowsAppearance(taskPolicy.id,c.day,clock().toISOString()))throw Error('activation_precondition');for(const asset of (await assets(c)).results)await readAsset(asset);
    const previous=await db.prepare('SELECT revision,generation_id FROM tower_autonomy_current WHERE id=1').first<{revision:number;generation_id:string}>();if(previous?.generation_id===`${c.id}-r${c.repair}`){await advance(c,'selfreview');return {pending:true,state:'selfreview'};}const revision=previous?.revision??0;
    await db.batch([db.prepare('INSERT INTO tower_autonomy_current SELECT 1,?,?,?,?,1 WHERE NOT EXISTS(SELECT 1 FROM tower_autonomy_current WHERE id=1)').bind(`${c.id}-r${c.repair}`,c.id,taskPolicy.startsAt,taskPolicy.endsAt),db.prepare('UPDATE tower_autonomy_current SET generation_id=?,cycle_id=?,starts_at=?,ends_at=?,revision=revision+1 WHERE id=1 AND revision=?').bind(`${c.id}-r${c.repair}`,c.id,taskPolicy.startsAt,taskPolicy.endsAt,revision),db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_autonomy_current WHERE generation_id=? AND cycle_id=?) THEN 1 ELSE json('activation-conflict') END").bind(`${c.id}-r${c.repair}`,c.id),db.prepare('INSERT INTO tower_autonomy_events VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),c.id,'appearance-activated',JSON.stringify({generation:`${c.id}-r${c.repair}`}),clock().toISOString())]);
    const readback=await publicState();if(readback?.generation!==`${c.id}-r${c.repair}`)throw Error('activation_readback');await advance(c,'selfreview');try{await options.onPublicAppearance?.(readback.generation);}catch{/* Optional delivery never changes an approved public activation. */}
   }else if(c.state==='selfreview'){
    const {data}=await provider(c,'daily-selfreview',textPayload('This is a new private daily selfreview, separate from task planning and TaskAudit. Reflect on actual outcomes and audit; retain useful concise working memory and actionable nextTasks. Do not announce publicly or claim unfinished work complete. No private resident data. Return ONLY JSON {memory:string,nextTasks:string[]}.',{day:c.day,taskOutcome:c.outcome,errorCode:c.error_code,obligations:await obligations(c.day),plan:JSON.parse(c.plan_json??'null'),actualEvidence:JSON.parse(c.evidence_json??'null'),independentAudit:JSON.parse(c.audit_json??'null'),publicProjection:await publicState(),cost:(await db.prepare('SELECT COALESCE(SUM(COALESCE(actual_micro,reserved_micro)),0) committedMicro FROM tower_autonomy_calls WHERE cycle_id=?').bind(c.id).first())}));
    const review=outputJSON(data);if(typeof review.memory!=='string'||review.memory.length>2400||!Array.isArray(review.nextTasks)||review.nextTasks.length>8||!review.nextTasks.every(x=>typeof x==='string'&&x.length<=400))throw Error('selfreview_contract');await event(c.id,'daily-private-memory',review);await advance(c,c.outcome==='blocked'?'blocked':'complete',{review_json:JSON.stringify(review),outcome:c.outcome==='blocked'?'blocked':'pass'});
   }
  }catch(error){const code=c.state==='thinking'&&c.day!==calendarPeriods(clock()).day?'missed_daily_thinking':error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'runtime_step_failed';await block(c,code).catch(()=>{});}
  const updated=await db.prepare('SELECT state FROM tower_autonomy_cycles WHERE id=?').bind(c.id).first<{state:string}>();return {pending:await pending(),state:updated!.state};
 }
 async function publicState(){if(!await autonomySchemaReady(db))return null;const pointer=await db.prepare('SELECT * FROM tower_autonomy_current WHERE id=1 AND starts_at<=? AND ends_at>?').bind(clock().toISOString(),clock().toISOString()).first<{generation_id:string;ends_at:string;revision:number}>();if(!pointer||pointer.ends_at<=clock().toISOString())return null;let presentation;try{presentation=await themePresentation(db,pointer.generation_id,pointer.revision,clock);}catch{return null;}if(pointer.ends_at<=clock().toISOString())return null;return {theme:taskPolicy.theme,generation:pointer.generation_id,revision:pointer.revision,endsAt:pointer.ends_at,...(presentation?{presentation}:{}),images:{day:`/api/v1/tower/appearance/assets/${pointer.generation_id}/day.png`,night:`/api/v1/tower/appearance/assets/${pointer.generation_id}/night.png`}};}
 return {step,prepareDaily,pending,publicState,async asset(generation:string,scene:string){if(!/^manager-\d{4}-\d{2}-\d{2}-r[01]$/.test(generation)||!['day','night'].includes(scene))return null;const state=await publicState();if(!state||state.generation!==generation)return null;const row=await db.prepare('SELECT * FROM tower_autonomy_assets WHERE generation_id=? AND scene=?').bind(generation,scene).first<Asset>();if(!row)return null;const bytes=await readAsset(row);return state.endsAt>clock().toISOString()?bytes:null;},async enable(control:{deferWake?:boolean;lobbyThemePolicy?:boolean}={}){const at=clock().toISOString();await db.batch([db.prepare('UPDATE tower_autonomy_mandate SET enabled=1,enabled_at=COALESCE(enabled_at,?),updated_at=? WHERE id=1').bind(at,at),db.prepare('INSERT INTO tower_autonomy_events VALUES(?,NULL,?,?,?)').bind(crypto.randomUUID(),'standing-mandate-enabled','{}',at),...(control.lobbyThemePolicy?[db.prepare("INSERT INTO tower_autonomy_events SELECT 'lobby-theme-policy:v1',NULL,'lobby-theme-policy-enabled',?,? WHERE NOT EXISTS(SELECT 1 FROM tower_autonomy_events WHERE id='lobby-theme-policy:v1')").bind(JSON.stringify({capability:'style-public-lobby-v1',version:1,source:'expanded-standing-mandate'}),at)]:[])]);if(!control.deferWake){if(!options.wake)throw Error('runtime_not_bound');await options.wake();}return {enabled:true};},async wake(){if(!options.wake)throw Error('runtime_not_bound');await options.wake();},async disable(){const at=clock().toISOString();await db.batch([db.prepare('UPDATE tower_autonomy_mandate SET enabled=0,updated_at=? WHERE id=1').bind(at),db.prepare('INSERT INTO tower_autonomy_events VALUES(?,NULL,?,?,?)').bind(crypto.randomUUID(),'standing-mandate-disabled','{}',at)]);return {enabled:false};},async inspect(){return {mandate:await db.prepare('SELECT * FROM tower_autonomy_mandate WHERE id=1').first(),authorizations:(await db.prepare('SELECT * FROM tower_autonomy_authorizations ORDER BY created_at DESC LIMIT 31').all()).results,cycles:(await db.prepare('SELECT * FROM tower_autonomy_cycles ORDER BY day DESC LIMIT 31').all()).results,calls:(await db.prepare('SELECT * FROM tower_autonomy_calls ORDER BY created_at DESC LIMIT 100').all()).results,events:(await db.prepare('SELECT * FROM tower_autonomy_events ORDER BY created_at DESC LIMIT 100').all()).results};}};
}
