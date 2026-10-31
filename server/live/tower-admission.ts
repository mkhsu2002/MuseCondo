import type {Database,Statement} from './db.ts';
import {digest} from './app.ts';
export const TOWER_ADMISSION_SCHEMA=["tower_admission_policies", "tower_admission_current", "tower_admission_decisions", "tower_admission_heads", "tower_admission_requests", "tower_admission_audit", "tower_admission_binding", "tower_admission_policy_insert", "tower_admission_head_insert", "tower_admission_head_update", "tower_admission_existing_review", "tower_admission_continuity_review", "tower_admission_eligible", "admission_tower_tokens_insert", "admission_tower_tokens_update", "admission_onboarding_grants_insert", "admission_onboarding_grants_update", "admission_agent_tokens_insert", "admission_agent_tokens_update", "admission_sessions_insert", "admission_sessions_update", "admission_rooms_insert", "admission_rooms_publish", "admission_tower_claims_insert", "admission_tower_claims_update", "admission_tower_residencies_insert", "admission_tower_residencies_update", "admission_reception_insert", "admission_reception_update", "admission_identity_enroll", "admission_identity_activate", "admission_recovery_instance", "admission_card_issue", "admission_card_attempt", "admission_snapshots_insert", "tower_admission_policies_update", "tower_admission_policies_delete", "tower_admission_decisions_update", "tower_admission_decisions_delete", "tower_admission_requests_update", "tower_admission_requests_delete", "tower_admission_audit_update", "tower_admission_audit_delete", "tower_admission_head_delete", "tower_admission_current_update", "tower_admission_current_delete", "admission_legacy_generation_insert", "admission_legacy_generation_claim"] as const;
interface Environment {db:Database;origin:string;operator:(request:Request)=>Promise<boolean>;now?:()=>Date}
interface Policy {version:number;allowed_agent_origins_json:string;require_operator_review:number}
interface Decision {id:string;policy_version:number;case_id:string|null;account_id:string;resident_id:string;source_url:string;continuity_agent_id:string|null;reviewed_room_id:string|null;state:string;agent_origin:string;evidence_kind:string;evidence_ref:string;operator_class:string;expires_at:string;created_at:string}
class Rejection extends Error {readonly status:number;constructor(status:number,code:string){super(code);this.status=status;}}
function fail(status:number,code:string):never{throw new Rejection(status,code);}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))fail(400,'invalid_admission_input');return value as Record<string,unknown>;}
function str(value:unknown,pattern:RegExp,max=160){if(typeof value!=='string'||value.length>max||!pattern.test(value))fail(400,'invalid_admission_input');return value;}
const id=(v:unknown)=>str(v,/^[a-f0-9]{16,64}$/),integer=(v:unknown,min=0)=>{if(!Number.isSafeInteger(v)||Number(v)<min)fail(400,'invalid_admission_input');return Number(v);};
async function body(req:Request){if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get('Content-Type')??''))fail(415,'json_required');const declared=req.headers.get('Content-Length');if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>16384))fail(413,'body_too_large');const reader=req.body?.getReader();if(!reader)fail(400,'invalid_admission_input');let count=0;const parts:Uint8Array[]=[];try{for(;;){const r=await reader.read();if(r.done)break;count+=r.value.length;if(count>16384){try{await reader.cancel();}catch{/* Preserve rejection. */}fail(413,'body_too_large');}parts.push(r.value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(count);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'invalid_admission_input');}}
function policyPublic(p:Policy){return {version:p.version,allowedAgentOrigins:JSON.parse(p.allowed_agent_origins_json),requireOperatorReview:p.require_operator_review===1};}
/** Only the deployment operator records private reviewed evidence. No applicant origin self-claim grants rights. */
export function createTowerAdmission(env:Environment){
 const db=env.db,stamp=()=>(env.now?.()??new Date()).toISOString();
 const stmt=(s:string,...v:unknown[])=>db.prepare(s).bind(...v),one=<T>(s:string,...v:unknown[])=>stmt(s,...v).first<T>();
 const guard=(s:string,...v:unknown[])=>stmt("SELECT CASE WHEN ("+s+") THEN 1 ELSE json('admission-context-changed') END",...v);
 const policy=()=>one<Policy>('SELECT p.* FROM tower_admission_current c JOIN tower_admission_policies p ON p.version=c.policy_version WHERE c.id=1');
 async function stored(key:string,op:string,hash:string){const r=await one<{operation:string;input_hash:string;response_json:string;status:number}>('SELECT * FROM tower_admission_requests WHERE request_key=?',key);if(!r)return null;if(r.operation!==op||r.input_hash!==hash)fail(409,'admission_request_conflict');return json(JSON.parse(r.response_json),r.status);}
 async function commit(req:Request,key:string,op:string,hash:string,rows:Statement[],result:unknown,status:number,version:number,decision:string|null){
  if(!await env.operator(req))fail(401,'operator_required');
  try{await db.batch([...rows,stmt('INSERT INTO tower_admission_requests VALUES(?,?,?,?,?,?)',key,op,hash,JSON.stringify(result),status,stamp()),stmt('INSERT INTO tower_admission_audit VALUES(?,?,?,?,?,?)',crypto.randomUUID().replaceAll('-',''),op,version,decision,JSON.stringify({operatorCredentialClass:'shared-operator'}),stamp())]);}
  catch{const r=await stored(key,op,hash);if(r)return r;fail(409,'admission_update_conflict');}return json(result,status);
 }
 return {async fetch(req:Request):Promise<Response|null>{
  const url=new URL(req.url),publicRoute=url.pathname==='/api/v1/tower/admission-policy',prefix='/api/v1/operator/tower-admission';
  if(!publicRoute&&url.pathname!==prefix+'/policy'&&url.pathname!==prefix+'/decisions'&&!url.pathname.startsWith(prefix+'/decisions/'))return null;
  try{
   if(url.origin!==env.origin||req.headers.get('Sec-Fetch-Site')==='cross-site'||req.headers.has('Cookie')||req.headers.has('Origin')&&req.headers.get('Origin')!==env.origin)fail(403,'origin_rejected');
   if(url.search||req.headers.has('Authorization'))fail(400,'invalid_admission_input');
   if(!publicRoute&&!await env.operator(req))fail(401,'operator_required');
   const p=await policy();if(!p)fail(503,'admission_unavailable');
   if(req.method==='GET'){
    if(publicRoute||url.pathname.endsWith('/policy'))return json({policy:policyPublic(p!)});
    const decisionId=url.pathname.slice((prefix+'/decisions/').length);if(!/^[a-f0-9]{32}$/.test(decisionId))fail(404,'not_found');
    const d=await one<Decision>('SELECT * FROM tower_admission_decisions WHERE id=?',decisionId);if(!d)fail(404,'not_found');return json({decision:d});
   }
   if(publicRoute||req.method!=='POST')fail(405,'method_not_allowed');
   const v=object(await body(req),url.pathname.endsWith('/policy')?['requestKey','expectedPolicyVersion','allowedAgentOrigins','requireOperatorReview']:['requestKey','expectedPolicyVersion','expectedHeadRevision','caseId','accountId','residentId','sourceURL','continuityAgentId','state','agentOrigin','evidenceKind','evidenceRef','expiresAt','existingResidency']);
   const key=str(v.requestKey,/^[A-Za-z0-9_-]{8,96}$/),hash=await digest(JSON.stringify(v)),op=url.pathname.endsWith('/policy')?'policy':'decision';
   const old=await stored(key,op,hash);if(old)return old;
   const expected=integer(v.expectedPolicyVersion,1);if(expected!==p!.version)fail(409,'admission_policy_conflict');
   const rows:Statement[]=[guard('EXISTS(SELECT 1 FROM tower_admission_current WHERE id=1 AND policy_version=?)',expected)];
   if(op==='policy'){
    if(!Array.isArray(v.allowedAgentOrigins)||v.allowedAgentOrigins.length<1||v.allowedAgentOrigins.length>20||new Set(v.allowedAgentOrigins).size!==v.allowedAgentOrigins.length||typeof v.requireOperatorReview!=='boolean')fail(400,'invalid_admission_input');
    const origins=(v.allowedAgentOrigins as unknown[]).map(o=>str(o,/^(?:[a-z][a-z0-9-]{0,63}|\*)$/));if(origins.includes('*')&&(origins.length!==1||v.requireOperatorReview))fail(400,'invalid_admission_input');
    const next=expected+1;rows.push(stmt('INSERT INTO tower_admission_policies VALUES(?,?,?,?)',next,JSON.stringify(origins),v.requireOperatorReview?1:0,stamp()),stmt('UPDATE tower_admission_current SET policy_version=? WHERE id=1',next));
    return await commit(req,key,op,hash,rows,{policy:{version:next,allowedAgentOrigins:origins,requireOperatorReview:v.requireOperatorReview}},201,next,null);
   }
   const account=id(v.accountId),resident=id(v.residentId),caseId=v.caseId===null?null:id(v.caseId),agent=v.continuityAgentId===null?null:str(v.continuityAgentId,/^mcid:[a-f0-9]{64}$/),headRevision=integer(v.expectedHeadRevision);
   let source:string;try{const u=new URL(String(v.sourceURL));if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.href!==v.sourceURL)throw Error();source=u.href;}catch{fail(400,'invalid_admission_input');}
   const state=str(v.state,/^(pending-evidence|eligible|ineligible)$/),origin=str(v.agentOrigin,/^[a-z][a-z0-9-]{0,63}$/),kind=str(v.evidenceKind,/^(statement|operator-review|existing-resident)$/),evidence=str(v.evidenceRef,/^[A-Za-z0-9][A-Za-z0-9:_/-]{0,159}$/);
   if(state==='eligible'&&(kind==='statement'||!(JSON.parse(p!.allowed_agent_origins_json) as string[]).includes(origin)))fail(400,'admission_review_required');
   const expiry=str(v.expiresAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);if(!Number.isFinite(Date.parse(expiry))||expiry<=stamp()||Date.parse(expiry)>Date.parse(stamp())+366*86400000)fail(400,'invalid_admission_input');
   if(kind==='existing-resident'&&caseId!==null)fail(400,'invalid_admission_input');
   const existing=v.existingResidency===null?null:object(v.existingResidency,['roomId','revision','publicRevision']);
   if((kind==='existing-resident')!==(existing!==null))fail(400,'invalid_admission_input');
   const reviewedRoom=existing?id(existing.roomId):null;
   if(existing){integer(existing.revision,1);if(existing.publicRevision!==null)integer(existing.publicRevision,1);}
   if(caseId)rows.push(guard("EXISTS(SELECT 1 FROM tower_reception_cases WHERE id=? AND state IN ('pending','approved','active') AND (account_id IS NULL OR account_id=?) AND (resident_id IS NULL OR resident_id=?) AND (source_url IS NULL OR source_url=?))",caseId,account,resident,source));
   rows.push(guard('EXISTS(SELECT 1 FROM accounts WHERE id=?)',account));
   if(kind==='existing-resident')rows.push(guard('EXISTS(SELECT 1 FROM tower_residencies t JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id WHERE t.account_id=? AND t.resident_id=? AND t.source_url=? AND t.room_id=? AND t.revision=? AND t.public_revision IS ?)',account,resident,source,reviewedRoom,existing!.revision,existing!.publicRevision));
   const scope=caseId?'case:'+caseId:'account:'+account;
   rows.push(guard('COALESCE((SELECT revision FROM tower_admission_heads WHERE scope_key=?),0)=?',scope,headRevision));
   const d:Decision={id:crypto.randomUUID().replaceAll('-',''),policy_version:expected,case_id:caseId,account_id:account,resident_id:resident,source_url:source,continuity_agent_id:agent,reviewed_room_id:reviewedRoom,state,agent_origin:origin,evidence_kind:kind,evidence_ref:evidence,operator_class:'shared-operator',expires_at:expiry,created_at:stamp()};
   rows.push(stmt('INSERT INTO tower_admission_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',...Object.values(d)),headRevision===0?stmt('INSERT INTO tower_admission_heads VALUES(?,?,1)',scope,d.id):stmt('UPDATE tower_admission_heads SET decision_id=?,revision=revision+1 WHERE scope_key=? AND revision=?',d.id,scope,headRevision));
   return await commit(req,key,op,hash,rows,{decision:d,revision:headRevision+1},201,expected,d.id);
  }catch(error){return error instanceof Rejection?json({error:error.message},error.status):json({error:'admission_unavailable'},503);}
 }};
}
