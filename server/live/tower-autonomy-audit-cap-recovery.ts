import type {Database} from './db.ts';
import {MANAGER_CALENDAR_POLICY,managerLocalDaySQL} from './tower-calendar.ts';
import {MAX_TEXT_RESERVE,MAX_OUTPUT,MODEL,IMAGE} from './tower-autonomy-provider.ts';
import {HALLOWEEN_APPEARANCE_POLICY_V1} from './tower-autonomy-policy.ts';
interface RecoveryCycle {id:string;repair:number;step_seq:number;error_code:string|null;budget_micro:number}
export const auditOutputCapResumeId=(id:string)=>`audit-output-cap-resume:${id}:r0`;
/** Historical Halloween audit-cap recovery only. Never retries unknown provider outcomes,
 * never regenerates assets, and never extends the original authorization or budget.
 * The immutable receipt and state transition remain a single rollback-safe native batch. */
export function createHistoricalAuditCapRecovery<C extends RecoveryCycle,A>(options:{db:Database;clock:()=>Date;bucket?:unknown;assetFetch?:unknown;apiKey?:string;assets:(cycle:C)=>Promise<{results:A[]}>;readAsset:(asset:A)=>Promise<unknown>}){
 const {db,clock,assets,readAsset}=options,resumeId=auditOutputCapResumeId;
 // Reopen only a known, settled audit-cap failure, never an unknown call or a new image task.

 const nativeResumeScope=`EXISTS(SELECT 1 FROM tower_autonomy_authorizations a JOIN tower_autonomy_task_anchors t ON t.cycle_id=a.cycle_id WHERE a.cycle_id=c.id AND a.kind='appearance' AND a.budget_micro=c.budget_micro AND a.day=c.day AND a.calendar_policy='${MANAGER_CALENDAR_POLICY.id}' AND t.anchor='${HALLOWEEN_APPEARANCE_POLICY_V1.id}' AND a.day=${managerLocalDaySQL('native_now')} AND a.starts_at<=native_now AND a.ends_at>native_now)
  AND (SELECT enabled FROM tower_autonomy_mandate WHERE id=1)=1
  AND (SELECT COALESCE(SUM(COALESCE(actual_micro,reserved_micro)),0) FROM tower_autonomy_calls WHERE cycle_id=c.id)+${2*MAX_TEXT_RESERVE}<=c.budget_micro
  AND (SELECT COALESCE(SUM(COALESCE(actual_micro,reserved_micro)),0) FROM tower_autonomy_calls WHERE billing_day=${managerLocalDaySQL('native_now')})+${2*MAX_TEXT_RESERVE}<=(SELECT daily_limit_micro FROM tower_autonomy_mandate WHERE id=1)
  AND NOT EXISTS(SELECT 1 FROM tower_autonomy_calls WHERE cycle_id=c.id AND state IN ('unknown','dispatching'))
  AND c.repair=0 AND c.audit_json IS NULL AND json_extract(c.plan_json,'$.kind')='appearance'
  AND json_extract(c.evidence_json,'$.verified')=1 AND json_extract(c.evidence_json,'$.generation')=c.id||'-r0'
  AND EXISTS(SELECT 1 FROM json_each(c.permissions_json) WHERE value='activate-reviewed-exterior')
  AND EXISTS(SELECT 1 FROM json_each(c.permissions_json) WHERE value='edit-exterior-images')
  AND NOT EXISTS(SELECT 1 FROM tower_autonomy_current WHERE cycle_id=c.id)
  AND NOT EXISTS(SELECT 1 FROM tower_autonomy_events WHERE cycle_id=c.id AND kind='task-audit')
  AND (SELECT count(*) FROM tower_autonomy_assets WHERE cycle_id=c.id)=2
  AND (SELECT count(*) FROM tower_autonomy_calls WHERE cycle_id=c.id AND model='${IMAGE}')=2
  AND (SELECT count(*) FROM tower_autonomy_assets s JOIN tower_autonomy_calls p ON p.id=s.provider_call_id WHERE s.cycle_id=c.id AND s.generation_id=c.id||'-r0' AND p.state='received' AND p.model='${IMAGE}' AND p.actual_micro=10000 AND p.purpose='image-'||s.scene||'-r0' AND EXISTS(SELECT 1 FROM json_each(c.evidence_json,'$.assets') e WHERE json_extract(e.value,'$.scene')=s.scene AND json_extract(e.value,'$.sha256')=s.sha256 AND json_extract(e.value,'$.bytes')=s.bytes AND json_extract(e.value,'$.provider_call_id')=s.provider_call_id))=2`;
 const knownAuditFailure=`(SELECT count(*) FROM tower_autonomy_calls WHERE cycle_id=c.id AND purpose='independent-task-audit')=1 AND EXISTS(SELECT 1 FROM tower_autonomy_calls p WHERE p.cycle_id=c.id AND p.purpose='independent-task-audit' AND p.model='${MODEL}' AND p.state='received' AND p.provider_id IS NOT NULL AND p.actual_micro>0 AND p.actual_micro<=p.reserved_micro AND p.completed_at IS NOT NULL AND (
  (c.error_code='provider_output_incomplete' AND p.output_tokens=${MAX_OUTPUT} AND EXISTS(SELECT 1 FROM tower_autonomy_events e WHERE e.cycle_id=c.id AND e.kind='provider-response-contract' AND json_extract(e.detail_json,'$.call')=p.id AND json_extract(e.detail_json,'$.model')='${MODEL}' AND json_extract(e.detail_json,'$.status')='incomplete' AND json_extract(e.detail_json,'$.incompleteReason')='max_output_tokens' AND json_extract(e.detail_json,'$.requestedMaxOutputTokens')=${MAX_OUTPUT}))
  OR (c.id='manager-2026-10-31' AND c.step_seq=8 AND c.error_code='provider_contract' AND p.step_key=c.id||':6:independent-task-audit' AND p.input_tokens=11220 AND p.output_tokens=2400 AND p.actual_micro=24225 AND p.reserved_micro=24924 AND NOT EXISTS(SELECT 1 FROM tower_autonomy_events e WHERE e.cycle_id=c.id AND e.kind='provider-response-contract' AND json_extract(e.detail_json,'$.call')=p.id))
 ))`;
 const resumeEligibility=`c.state='blocked' AND c.outcome='blocked' AND c.review_json IS NOT NULL AND (c.lease_until IS NULL OR c.lease_until<=native_now) AND NOT EXISTS(SELECT 1 FROM tower_autonomy_events WHERE id='audit-output-cap-resume:'||c.id||':r0') AND ${nativeResumeScope} AND ${knownAuditFailure}`;
 const nativeNow="(SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') native_now)";
 async function resume(){
  if(!options.bucket||!options.assetFetch||!options.apiKey)return false;
  const c=await db.prepare(`SELECT c.*,(SELECT id FROM tower_autonomy_calls WHERE cycle_id=c.id AND purpose='independent-task-audit') AS resume_source_call FROM tower_autonomy_cycles c,${nativeNow} WHERE ${resumeEligibility} LIMIT 1`).first<C&{resume_source_call:string}>();if(!c)return false;
  try{
   const pair=(await assets(c)).results;if(pair.length!==2)return false;for(const asset of pair)await readAsset(asset);
   const at=clock().toISOString(),id=resumeId(c.id),detail=JSON.stringify({from:'blocked',to:'audit',generation:`${c.id}-r0`,previousError:c.error_code,sourceAuditCallId:c.resume_source_call,budgetMicro:c.budget_micro,source:c.error_code==='provider_contract'?'legacy-cap-reached-inferred':'received-incomplete-max-output',maxOutputTokens:MAX_OUTPUT,attempt:1});
   await db.batch([
    db.prepare(`UPDATE tower_autonomy_cycles AS c SET state='audit',outcome='pending',error_code=NULL,step_seq=step_seq+1,lease_until=NULL,updated_at=? WHERE c.id=? AND c.step_seq=? AND EXISTS(SELECT 1 FROM ${nativeNow} WHERE ${resumeEligibility})`).bind(at,c.id,c.step_seq),
    db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_autonomy_cycles WHERE id=? AND state='audit' AND step_seq=? AND updated_at=?) THEN 1 ELSE json('audit-resume-claim-lost') END").bind(c.id,c.step_seq+1,at),
    db.prepare('INSERT INTO tower_autonomy_events VALUES(?,?,?,?,?)').bind(id,c.id,'audit-output-cap-resumed',detail,at),
    db.prepare('INSERT INTO tower_autonomy_events VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),c.id,'state-transition',detail,at),
    // A clock/mandate/budget change at any SQL boundary rolls back the entire one-time receipt and state.
    db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_autonomy_cycles c,${nativeNow} WHERE c.id=? AND c.state='audit' AND c.step_seq=? AND c.updated_at=? AND c.lease_until IS NULL AND EXISTS(SELECT 1 FROM tower_autonomy_events WHERE id=? AND cycle_id=c.id) AND ${nativeResumeScope}) THEN 1 ELSE json('audit-resume-authority-expired') END`).bind(c.id,c.step_seq+1,at,id),
   ]);return true;
  }catch{return false;}
 }
 return {resume,eligibilitySQL:resumeEligibility,nativeNowSQL:nativeNow};
}
