import type {Database} from './db.ts';
import {calendarPeriods} from './tower-manager-schedule.ts';
import {HALLOWEEN_2026} from './tower-appearance.ts';
export const MODEL='muse-spark-1.3',IMAGE='muse-image-1.0',MAX_INPUT=128000,MAX_OUTPUT=8192;
export const MAX_TEXT_RESERVE=Math.ceil((MAX_INPUT*5+MAX_OUTPUT*17)/4);
const safeContractToken=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(value)?value:null;
interface DispatchTask {id:string;step_seq:number;budget_micro:number;lease_until:string|null;plan_json:string|null;day:string;scope_ends_at?:string}
interface ProviderOptions {db:Database;apiKey?:string;transport?:typeof fetch;now?:()=>Date}
export const constraint='You are the private Muse Tower building manager. Use Traditional Chinese for memories. You have no access to private resident content, credentials, identity changes, payments, messaging or permission changes. Only inspect public aggregate health or edit the two existing exterior reference images. Preserve a single isolated foreground tower with no edge borders, original architecture, framing and day/night lighting. No text, people, claims of residents participating, logos or added buildings. All task planning, prompts, model names, audit and memory remain private. A logical task includes all planning, tools, independent audit and repair within the same immutable US$10 cap. Never split tasks, reset budgets or retry unknown provider outcomes.';
async function boundedJSON(response:Response,max=160000){const reader=response.body?.getReader();if(!reader)throw Error('provider_contract');const chunks:Uint8Array[]=[];let length=0;for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw Error('provider_contract');}chunks.push(value);}const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>;}
export function outputJSON(data:Record<string,unknown>){const output=data.output as {type:string;content?:{type:string;text:string}[]}[];const text=output?.filter(v=>v.type==='message').flatMap(v=>v.content??[]).filter(v=>v.type==='output_text').map(v=>v.text).join('');if(!text)throw Error('provider_contract');return JSON.parse(text) as Record<string,unknown>;}
export function managerTextPayload(instructions:string,input:unknown,extra:Record<string,unknown>={}):Record<string,unknown>{return {model:MODEL,store:false,max_output_tokens:MAX_OUTPUT,instructions:constraint+'\n'+instructions,input:typeof input==='string'?input:JSON.stringify(input),...extra};}
export function createAutonomyProvider(options:ProviderOptions){
 const {db}=options,clock=options.now??(()=>new Date()),transport=options.transport??fetch;
 const run=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args).run();
 const event=(cycle:string|null,kind:string,detail:unknown={})=>run('INSERT INTO tower_autonomy_events VALUES(?,?,?,?,?)',crypto.randomUUID(),cycle,kind,JSON.stringify(detail),clock().toISOString());
 return async function provider(c:DispatchTask,purpose:string,payload:Record<string,unknown>,image=false){
  if(!options.apiKey)throw Error('provider_not_configured');
  const stepKey=`${c.id}:${c.step_seq}:${purpose}`,requestBody=JSON.stringify(payload);let counted=0;
  const appearanceAudit=purpose==='independent-task-audit'&&JSON.parse(c.plan_json??'null')?.kind==='appearance';
  const auditScope=appearanceAudit?` AND EXISTS(SELECT 1 FROM tower_autonomy_authorizations a JOIN tower_autonomy_cycles c ON c.id=a.cycle_id JOIN tower_autonomy_task_anchors t ON t.cycle_id=c.id WHERE c.id=? AND c.state='audit' AND c.step_seq=? AND c.lease_until=? AND c.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND a.kind='appearance' AND a.budget_micro=c.budget_micro AND t.anchor='appearance:halloween:2026' AND a.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND a.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`:'';
  const auditArgs=appearanceAudit?[c.id,c.step_seq,c.lease_until]:[];
  if(!image){
   const countId=crypto.randomUUID(),countAt=clock();
   const countClaim=await run(`INSERT INTO tower_autonomy_calls(id,cycle_id,step_key,purpose,model,state,reserved_micro,billing_day,created_at) SELECT ?,?,?,?,?,'dispatching',0,?,? WHERE (SELECT enabled FROM tower_autonomy_mandate WHERE id=1)=1${auditScope}`,countId,c.id,stepKey+':count',purpose+':input-token-count',MODEL,calendarPeriods(countAt).day,countAt.toISOString(),...auditArgs);if(!countClaim.meta.changes)throw Error('audit_scope_expired');
   let countFinished=false;
   try{
    const requestInit:RequestInit={method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json'},body:requestBody,signal:AbortSignal.timeout(30000)};
    const currentDay=calendarPeriods(clock()).day;
    if((c.scope_ends_at&&clock().toISOString()>=c.scope_ends_at)||appearanceAudit&&(clock().toISOString()<HALLOWEEN_2026.startsAt||clock().toISOString()>=HALLOWEEN_2026.endsAt)){await run("UPDATE tower_autonomy_calls SET state='rejected',actual_micro=0,completed_at=? WHERE id=?",clock().toISOString(),countId);countFinished=true;await event(c.id,'unsent-audit-scope-expired',{call:countId,paidDispatched:false});throw Error('audit_scope_expired');}
    if(currentDay!==calendarPeriods(countAt).day){await run("UPDATE tower_autonomy_calls SET state='rejected',actual_micro=0,completed_at=? WHERE id=?",clock().toISOString(),countId);countFinished=true;await event(c.id,'unsent-dispatch-day-changed',{call:countId,purpose:purpose+':input-token-count',billingDay:calendarPeriods(countAt).day,currentDay,paidDispatched:false});throw Error(purpose==='daily-thinking'?'missed_daily_thinking':'dispatch_day_changed');}
    const countResponse=await transport('https://api.meta.ai/v1/responses/input_tokens',requestInit);
    if(!countResponse.ok){await run("UPDATE tower_autonomy_calls SET state='rejected',actual_micro=0,completed_at=? WHERE id=?",clock().toISOString(),countId);countFinished=true;throw Error('token_count_rejected');}
    const count=await boundedJSON(countResponse);if(!Number.isSafeInteger(count.input_tokens)||Number(count.input_tokens)<0||Number(count.input_tokens)>MAX_INPUT)throw Error('token_count_invalid');counted=Number(count.input_tokens);
    await run("UPDATE tower_autonomy_calls SET state='received',actual_micro=0,input_tokens=?,completed_at=? WHERE id=?",counted,clock().toISOString(),countId);countFinished=true;
   }catch(error){if(!countFinished)await run("UPDATE tower_autonomy_calls SET state='unknown',completed_at=? WHERE id=?",clock().toISOString(),countId);throw error;}
  }
  const reserve=image?10000:Math.ceil((counted*5+MAX_OUTPUT*17)/4);
  const dispatchedAt=clock(),time=dispatchedAt.toISOString(),billingDay=calendarPeriods(dispatchedAt).day,call=crypto.randomUUID();
  if(purpose==='daily-thinking'&&c.day!==billingDay)throw Error('missed_daily_thinking');
  const claimed=await run(`INSERT INTO tower_autonomy_calls(id,cycle_id,step_key,purpose,model,state,reserved_micro,billing_day,created_at) SELECT ?,?,?,?,?,'dispatching',?,?,? WHERE
   (SELECT enabled FROM tower_autonomy_mandate WHERE id=1)=1 AND
   (SELECT COALESCE(SUM(COALESCE(actual_micro,reserved_micro)),0) FROM tower_autonomy_calls WHERE cycle_id=?)+?<=? AND
   (SELECT COALESCE(SUM(COALESCE(a.actual_micro,a.reserved_micro)),0) FROM tower_autonomy_calls a WHERE a.billing_day=?)+?<=(SELECT daily_limit_micro FROM tower_autonomy_mandate WHERE id=1)
   ${auditScope} ON CONFLICT(step_key) DO NOTHING`,call,c.id,stepKey,purpose,image?IMAGE:MODEL,reserve,billingDay,time,c.id,reserve,c.budget_micro,billingDay,reserve,...auditArgs);
  if(!claimed.meta.changes)throw Error('budget_or_dispatch_blocked');
  let confirmed=false;
  try{
   const requestInit:RequestInit={method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json'},body:requestBody,signal:AbortSignal.timeout(image?120000:90000)};
   // This is the last synchronous gate after the awaited native claim and serialized body, before HTTP.
   const currentDay=calendarPeriods(clock()).day;
   const toolExpired=!!c.scope_ends_at&&clock().toISOString()>=c.scope_ends_at||(image||purpose==='tool-executor'||appearanceAudit)&&(clock().toISOString()<HALLOWEEN_2026.startsAt||clock().toISOString()>=HALLOWEEN_2026.endsAt);
   if(toolExpired){await run("UPDATE tower_autonomy_calls SET state='rejected',actual_micro=0,completed_at=? WHERE id=?",clock().toISOString(),call);confirmed=true;await event(c.id,'unsent-tool-scope-expired',{call,purpose,paidDispatched:false});throw Error('tool_scope_expired');}
   if(currentDay!==billingDay){await run("UPDATE tower_autonomy_calls SET state='rejected',actual_micro=0,completed_at=? WHERE id=?",clock().toISOString(),call);confirmed=true;await event(c.id,'unsent-dispatch-day-changed',{call,purpose,billingDay,currentDay,paidDispatched:false});throw Error(purpose==='daily-thinking'?'missed_daily_thinking':'dispatch_day_changed');}
   const response=await transport(`https://api.meta.ai/v1/${image?'images/edits':'responses'}`,requestInit);
   if(!response.ok){const rejected=[400,401,403,404,422,429].includes(response.status);let providerCode:string|null=null;try{const body=await boundedJSON(response,8000);const error=body.error as {code?:unknown}|undefined;if(typeof error?.code==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(error.code))providerCode=error.code;}catch{/* Never retain unbounded provider text. */}await event(c.id,'provider-http-error',{call,purpose,httpStatus:response.status,providerCode});await run('UPDATE tower_autonomy_calls SET state=?,actual_micro=?,completed_at=? WHERE id=?',rejected?'rejected':'unknown',rejected?0:null,clock().toISOString(),call);confirmed=true;throw Error(rejected?'provider_rejected':'provider_outcome_unknown');}
   const data=await boundedJSON(response,image?12*1024*1024:160000);const usage=data.usage as {input_tokens?:unknown;output_tokens?:unknown}|undefined;
   if((!Number.isSafeInteger(usage?.input_tokens)||!Number.isSafeInteger(usage?.output_tokens)||Number(usage!.input_tokens)<0||Number(usage!.output_tokens)<0))throw Error('provider_outcome_unknown');
   const actual=image?10000:Math.ceil((Number(usage!.input_tokens)*5+Number(usage!.output_tokens)*17)/4);
   const providerId=typeof data.id==='string'?data.id:response.headers.get('x-request-id');
   await run("UPDATE tower_autonomy_calls SET state='received',actual_micro=?,input_tokens=?,output_tokens=?,provider_id=?,completed_at=? WHERE id=?",actual,usage!.input_tokens,usage!.output_tokens,providerId?.slice(0,200)??null,clock().toISOString(),call);confirmed=true;
   if(!image)await event(c.id,'provider-response-contract',{call,purpose,model:safeContractToken(data.model),status:safeContractToken(data.status),incompleteReason:safeContractToken((data.incomplete_details as {reason?:unknown}|undefined)?.reason),requestedMaxOutputTokens:MAX_OUTPUT,responseMaxOutputTokens:Number.isSafeInteger(data.max_output_tokens)?data.max_output_tokens:null,inputTokens:usage!.input_tokens,outputTokens:usage!.output_tokens,reasoningTokens:Number.isSafeInteger((usage as {output_tokens_details?:{reasoning_tokens?:unknown}})?.output_tokens_details?.reasoning_tokens)?(usage as {output_tokens_details:{reasoning_tokens:number}}).output_tokens_details.reasoning_tokens:null});
   if(!image&&actual<=reserve&&data.model===MODEL&&data.status==='incomplete'&&(data.incomplete_details as {reason?:unknown}|undefined)?.reason==='max_output_tokens'&&Number(usage!.input_tokens)<=MAX_INPUT&&Number(usage!.output_tokens)===MAX_OUTPUT)throw Error('provider_output_incomplete');
   if(actual>reserve||!image&&(data.model!==MODEL||data.status!=='completed'||Number(usage!.input_tokens)>MAX_INPUT||Number(usage!.output_tokens)>MAX_OUTPUT))throw Error('provider_contract');
   await event(c.id,'provider-received',{call,purpose,actualMicro:actual});return {data,call};
  }catch(error){if(!confirmed)await run("UPDATE tower_autonomy_calls SET state='unknown',completed_at=? WHERE id=?",clock().toISOString(),call);throw error;}
 }

}
