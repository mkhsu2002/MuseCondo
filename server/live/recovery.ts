import type { Database } from './db.ts';
/** Offline operator module, deliberately not imported by the HTTP/Worker entrypoints. */
export type ClosureOutcome = 'provider-confirmed-no-output' | 'abandoned-unknown';
interface ClosureInput {jobId:string;expectedUpdatedAt:string;outcome:ClosureOutcome;evidenceRef:string;operatorRef:string;attestEvidenceReviewed:true}
interface Inspection {id:string;room_id:string;state:string;attempts:number;error_code:string|null;updated_at:string;asset_count:number}
const timestamp=(s:string)=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const opaqueRef=(s:string)=>/^[A-Za-z][A-Za-z0-9_.:-]{2,119}$/.test(s)&&!/(?:LLM_|sk-|bearer|password|token|secret)/i.test(s);
export async function inspectRecovery(db:Database,jobId:string){
 if(!/^[a-f0-9]{32}$/.test(jobId))throw new Error('invalid_job_id');
 // No private personality, account identifier, credential, provider key or raw provider response.
 const row=await db.prepare('SELECT j.id,j.room_id,j.state,j.attempts,j.error_code,j.updated_at,(SELECT count(*) FROM assets a WHERE a.room_id=j.room_id) AS asset_count FROM generation_jobs j WHERE j.id=?').bind(jobId).first<Inspection>();
 if(!row)throw new Error('job_not_found');
 return {jobId:row.id,roomId:row.room_id,state:row.state,attempts:row.attempts,errorCode:row.error_code,updatedAt:row.updated_at,assetCount:row.asset_count,closable:row.state==='recovery'&&row.asset_count===0};
}
/** Close an unresolved job, NEVER reissue it, restore it to prepared, publish or charge anything. */
export async function closeRecovery(db:Database,input:ClosureInput,now=new Date()){
 if(!/^[a-f0-9]{32}$/.test(input.jobId)||!timestamp(input.expectedUpdatedAt)||!Number.isFinite(now.getTime()))throw new Error('invalid_closure_identity');
 if(!['provider-confirmed-no-output','abandoned-unknown'].includes(input.outcome)||input.attestEvidenceReviewed!==true||!opaqueRef(input.evidenceRef)||!opaqueRef(input.operatorRef))throw new Error('reviewed_evidence_required');
 const closedAt=now.toISOString();if(closedAt<input.expectedUpdatedAt)throw new Error('closure_time_precedes_job');
 const id=crypto.randomUUID(),state=input.outcome==='provider-confirmed-no-output'?'closed-no-output':'closed-unknown';
 // Insert under state/version/empty-assets guards, then bind every update to THIS inserted audit id.
 // Stale or competing operators cannot change a room or create a misleading success record.
 const results=await db.batch([
  db.prepare("INSERT INTO recovery_audit(id,job_id,expected_updated_at,outcome,evidence_ref,operator_ref,attested,closed_at) SELECT ?,id,?,?,?,?,1,? FROM generation_jobs WHERE id=? AND state='recovery' AND updated_at=? AND NOT EXISTS(SELECT 1 FROM assets WHERE room_id=generation_jobs.room_id) AND NOT EXISTS(SELECT 1 FROM recovery_audit WHERE job_id=generation_jobs.id)").bind(id,input.expectedUpdatedAt,input.outcome,input.evidenceRef,input.operatorRef,closedAt,input.jobId,input.expectedUpdatedAt),
  db.prepare('UPDATE generation_jobs SET state=?,error_code=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM recovery_audit WHERE id=? AND job_id=generation_jobs.id)').bind(state,'operator_closed_without_regeneration',closedAt,input.jobId,id),
  db.prepare('UPDATE rooms SET generation_state=? WHERE id=(SELECT room_id FROM generation_jobs WHERE id=?) AND EXISTS(SELECT 1 FROM recovery_audit WHERE id=?)').bind(state,input.jobId,id),
 ]);
 if(results.some(r=>r.meta.changes!==1))throw new Error('closure_conflict_or_ineligible');
 return {jobId:input.jobId,state,closedAt,auditId:id,providerOutcomeVerifiedBySystem:false,regenerationAllowed:false};
}
