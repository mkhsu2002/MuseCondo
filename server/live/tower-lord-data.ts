import type { Database } from './db.ts';
import { managerLocalDay, MANAGER_CALENDAR_POLICY } from './tower-calendar.ts';

type Row = Record<string, unknown>;
export type TowerLordQuery = URLSearchParams | { from?: string; to?: string; limit?: string | number; cursor?: string; duty?: string; state?: string; correlationId?: string };
export class TowerLordQueryError extends Error { readonly status = 400; constructor() { super('Invalid reporting interval or cursor.'); } }
const DAY = 86400000;
const SAFE_ERROR_CODES=new Set(['provider_contract','provider_outcome_unknown','output_not_published','review_source_cooldown','review_source_result_unknown','review_interrupted','review_case_changed','review_failed','manager_admission_budget_scope','manager_admission_result_scope','theme_dispatch_interrupted','theme_render_outcome_unknown','theme_render_contract','theme_renderer_unavailable','theme_audit_failed','theme_audit_contract','theme_scope_expired','theme_step_failed','theme_selfreview_contract','build_step_failed','build_scope_expired','build_audit_failed','build_audit_contract','build_selfreview_contract','dispatch_interrupted','step_failed','audit_failed','selfreview_contract','http_400','http_401','http_403','http_404','http_422','http_429','http_500','http_502','http_503','http_504']);
function safeError(value:unknown){return value==null?null:SAFE_ERROR_CODES.has(String(value))?String(value):'unclassified-error';}

const sources = ['tower_residencies','agent_identities','tower_reception_cases','manager_admission_jobs','manager_admission_calls','manager_admission_audit','tower_reception_events','manager_admission_results','tower_admission_audit','manager_jobs','manager_events','tower_autonomy_cycles','tower_autonomy_calls','tower_autonomy_events','tower_autonomy_extensions','tower_theme_build_reviews','tower_manager_runs','tower_audit','tower_appearance_audit','identity_guardians','identity_credentials','identity_mail_events','identity_mail_delivery_facts','tower_autonomy_mandate','private_homes','private_home_snapshots','private_home_audit'] as const;
function integer(value: unknown) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
/** Safe URLs are navigation only: credentials, query strings and fragments are never returned. */
function sourceLink(value: unknown) { try { const u=new URL(String(value)); if(u.protocol!=='https:' || u.username || u.password)return null;return u.origin+u.pathname; } catch {return null;} }
export function createTowerLordData(options: { db: Database; environment?: string; now?: () => Date; towerOrigin?: string }) {
  const { db } = options;
  const now=options.now??(()=>new Date());
  const all = async (sql:string, args:unknown[]=[]) => (await db.prepare(sql).bind(...args).all<Row>()).results;
  async function tables() { return new Set((await all("SELECT name FROM sqlite_master WHERE type='table'")).map(x=>String(x.name))); }
  function parameters(query:TowerLordQuery={}) {
    const get=(key:string)=>query instanceof URLSearchParams?query.get(key):(query as Record<string,unknown>)[key];
    const observedAt=now().toISOString(), to=new Date(String(get('to')??observedAt)), from=get('from')?new Date(String(get('from'))):new Date(to.getTime()-30*DAY);
    const rawLimit=get('limit'), limit=rawLimit==null?30:Number(rawLimit);
    if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||from>=to||to.getTime()-from.getTime()>90*DAY||!Number.isInteger(limit)||limit<1||limit>100)throw new TowerLordQueryError();
    let cursor:{at:string;id:string}|null=null;
    if(get('cursor')){try{const raw=String(get('cursor'));if(raw.length>2400)throw Error();const c=JSON.parse(atob(raw));if(typeof c.at!=='string'||!Number.isFinite(Date.parse(c.at))||typeof c.id!=='string'||c.id.length>1000)throw Error();cursor=c;}catch{throw new TowerLordQueryError();}}
    for(const key of ['duty','state','correlationId'])if(get(key)!=null&&String(get(key)).length>1000)throw new TowerLordQueryError();
    return {meta:{environment:options.environment??'unknown',observedAt,interval:{from:from.toISOString(),to:to.toISOString()},freshness:'live-read' as const},limit,cursor,duty:get('duty'),state:get('state'),correlationId:get('correlationId')};
  }
  function coverage(present:Set<string>) {return {sources:sources.map(source=>({source,status:present.has(source)?'available':'missing'})),limitations:['Historical rate provenance is unavailable; recorded amounts are calculated costs, not provider invoices.','Legacy records without a reliable rehearsal marker remain unclassified.','History exposes recorded stages and safe references; private prompts, reasoning, payloads and evidence assets are withheld.','No independent provider, mail, infrastructure or deployment health probe is performed by this read.']};}
  function page(rows:Row[],limit:number){const more=rows.length>limit, items=rows.slice(0,limit);const last=items.at(-1);return {items,nextCursor:more&&last?btoa(JSON.stringify({at:last.at,id:last.id})):null};}
  async function overview(query:TowerLordQuery={}) {
    const p=parameters(query), t=await tables();
    const households=t.has('tower_residencies')?(await all(`SELECT count(DISTINCT r.room_id) total, count(DISTINCT CASE WHEN r.public_revision IS NOT NULL AND q.published=1 THEN r.room_id END) published, count(DISTINCT CASE WHEN r.public_revision IS NULL OR q.published=0 THEN r.room_id END) unpublished, count(DISTINCT CASE WHEN q.test_only=1 OR a.test_only=1 THEN r.room_id END) synthetic, count(DISTINCT CASE WHEN q.test_only=0 AND a.test_only=0 THEN r.room_id END) unclassified FROM tower_residencies r JOIN rooms q ON q.id=r.room_id JOIN accounts a ON a.id=r.account_id`))[0]:null;
    if(households&&t.has('private_homes')){const native=(await all('SELECT count(*) total,coalesce(sum(public_revision IS NOT NULL),0) published,coalesce(sum(public_revision IS NULL),0) unpublished FROM private_homes'))[0];for(const key of ['total','published','unpublished'])households[key]=integer(households[key])+integer(native[key]);households.unclassified=integer(households.unclassified)+integer(native.total);}
    if(households)households.archivedWithdrawn=null;
    const identities=t.has('agent_identities')?await all('SELECT state,count(*) count FROM agent_identities GROUP BY state'):null;
    const applications=t.has('tower_reception_cases')?await all('SELECT request_kind requestKind,state caseState,count(*) count FROM tower_reception_cases GROUP BY request_kind,state'):null;
    const work:Row[]=[];
    for(const table of ['manager_admission_jobs','manager_jobs','tower_autonomy_cycles','tower_autonomy_extensions','tower_theme_build_reviews','tower_manager_runs'])if(t.has(table))work.push(...(await all(`SELECT '${table}' source,state,count(*) count FROM ${table} GROUP BY state`)));
    return {meta:p.meta,scope:'Current stored lifecycle state; interval applies to history and usage.',households,identities,applications,work,schedule:{lastWakeAt:null,lastRecordedRunAt:t.has('tower_manager_runs')?(await all('SELECT max(created_at) at FROM tower_manager_runs'))[0]?.at??null:null,nextWakeAt:null},coverage:coverage(t)};
  }
  async function residents(query:TowerLordQuery={}) {
    const p=parameters(query),t=await tables();if(!t.has('tower_residencies'))return {meta:p.meta,items:[],nextCursor:null,coverage:coverage(t)};
    const identity=t.has('agent_identities'), guardian=identity&&t.has('identity_guardians'), card=t.has('identity_credentials');
    const mail=card&&t.has('identity_mail_events'), facts=t.has('identity_mail_delivery_facts');
    const latestCard="(SELECT credential_id FROM identity_credentials c WHERE c.account_id=r.account_id ORDER BY revision DESC LIMIT 1)";
    const deliveryState=mail?`(SELECT ${facts?"coalesce((SELECT fact FROM identity_mail_delivery_facts f WHERE f.event_id=e.id ORDER BY CASE fact WHEN 'complained' THEN 1 WHEN 'bounced' THEN 2 WHEN 'failed' THEN 3 WHEN 'suppressed' THEN 4 ELSE 5 END LIMIT 1),e.state)":'e.state'} FROM identity_mail_events e WHERE e.kind='identity-card' AND e.entity_id=${latestCard} ORDER BY e.created_at DESC LIMIT 1)`:'NULL';

    const args:unknown[]=[], where:string[]=[];
    if(p.cursor){where.push('(r.updated_at<? OR (r.updated_at=? AND r.room_id<?))');args.push(p.cursor.at,p.cursor.at,p.cursor.id);}
    args.push(p.limit+1);
    const rows=await all(`SELECT r.room_id id,r.updated_at at,r.room_id roomId,r.resident_id residentId,q.name chosenName,r.source_url sourceUrl,r.proof_method sourceControlState,r.revision privateRevision,r.public_revision publicRevision,CASE WHEN r.public_revision IS NOT NULL AND q.published=1 THEN 'published' ELSE 'private' END publicationState,r.directory_consent directoryConsent,r.announcement_consent announcementConsent,r.dream_consent dreamConsent,r.snapshot_consent snapshotConsent,r.created_at createdAt,r.updated_at lastStoredSyncAt,CASE WHEN q.test_only=1 OR a.test_only=1 THEN 'synthetic' ELSE 'unclassified' END classification,${identity?'i.state':'NULL'} identityState,${guardian?'EXISTS(SELECT 1 FROM identity_guardians g WHERE g.agent_id=i.agent_id)':'NULL'} guardianRegistered,${card?"(SELECT state FROM identity_credentials c WHERE c.account_id=r.account_id ORDER BY revision DESC LIMIT 1)":'NULL'} cardState,${deliveryState} cardDeliveryState FROM tower_residencies r JOIN rooms q ON q.id=r.room_id JOIN accounts a ON a.id=r.account_id ${identity?'LEFT JOIN agent_identities i ON i.room_id=r.room_id':''} ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY r.updated_at DESC,r.room_id DESC LIMIT ?`,args);
    if(t.has('private_homes')){
      const native=await all(`SELECT h.id,h.id roomId,s.created_at at,NULL residentId,json_extract(s.content_json,'$.name') chosenName,NULL sourceUrl,'tower-hosted' sourceControlState,h.revision privateRevision,h.public_revision publicRevision,CASE WHEN h.public_revision IS NULL THEN 'private' ELSE 'published' END publicationState,h.directory_consent directoryConsent,0 announcementConsent,h.dream_consent dreamConsent,(h.public_revision IS NOT NULL) snapshotConsent,h.created_at createdAt,s.created_at lastStoredSyncAt,'unclassified' classification,NULL identityState,NULL guardianRegistered,NULL cardState,NULL cardDeliveryState,'native' homeMode FROM private_homes h JOIN private_home_snapshots s ON s.home_id=h.id AND s.revision=h.revision ${p.cursor?'WHERE (s.created_at<? OR (s.created_at=? AND h.id<?))':''} ORDER BY s.created_at DESC,h.id DESC LIMIT ?`,[...(p.cursor?[p.cursor.at,p.cursor.at,p.cursor.id]:[]),p.limit+1]);
      for(const r of rows)r.homeMode='external';rows.push(...native);rows.sort((a,b)=>String(b.at).localeCompare(String(a.at))||String(b.id).localeCompare(String(a.id)));rows.splice(p.limit+1);
    }
    for(const r of rows){r.sourceUrl=sourceLink(r.sourceUrl);r.towerUrl=r.publicationState==='published'&&options.towerOrigin?`${options.towerOrigin.replace(/\/$/,'')}/home/${encodeURIComponent(String(r.roomId))}`:null;r.lastVerifiedSourceAt=null;r.blocker=r.publicationState==='private'?'Publication is not recorded.':null;}
    return {meta:p.meta,...page(rows,p.limit),coverage:coverage(t)};
  }
  async function applications(query:TowerLordQuery={}) {
    const p=parameters(query),t=await tables();if(!t.has('tower_reception_cases'))return {meta:p.meta,items:[],nextCursor:null,coverage:coverage(t)};
    const review=t.has('manager_admission_jobs'),native=t.has('private_homes');
    const args:unknown[]=[],where:string[]=[];
    if(p.cursor){where.push('(c.updated_at<? OR (c.updated_at=? AND c.id<?))');args.push(p.cursor.at,p.cursor.at,p.cursor.id);}
    args.push(p.limit+1);
    const rows=await all(`SELECT c.id,c.updated_at at,c.name chosenName,${native?'c.home_mode':"'external'"} homeMode,${native?'(SELECT id FROM private_homes WHERE case_id=c.id)':'NULL'} nativeHomeId,c.request_kind requestKind,c.state caseState,c.created_at createdAt,c.updated_at updatedAt,c.expires_at expiresAt,c.approval_expires_at approvalExpiresAt,${review?'c.is_muse_agent':'NULL'} isMuseAgent,${review?'j.state':'NULL'} reviewState,${review?'j.decision':'NULL'} reviewDecision,${review?'j.created_at':'NULL'} reviewQueuedAt,${review?'j.error_code':'NULL'} errorCode,CASE WHEN c.source_url IS NULL OR c.source_url='' THEN 1 ELSE 0 END missingSource,CASE WHEN c.resident_id IS NULL OR c.resident_id='' THEN 1 ELSE 0 END missingResidentId FROM tower_reception_cases c ${review?'LEFT JOIN manager_admission_jobs j ON j.case_id=c.id AND j.case_version=c.review_case_version':''} ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`,args);
    for(const r of rows){r.classification='unclassified';r.speciesBasis='self-declared-no-platform-attestation';r.queueAgeSeconds=r.reviewQueuedAt?Math.max(0,Math.floor((Date.parse(p.meta.observedAt)-Date.parse(String(r.reviewQueuedAt)))/1000)):null;r.expired=String(r.expiresAt)<=p.meta.observedAt;r.waitingOn=r.caseState==='approved'?'agent':r.reviewState==='queued'||r.reviewState==='running'?'manager':null;r.nextAction=r.expired?'Expired':r.caseState==='approved'?'Applicant activation':r.caseState==='pending'?'Application review':null;r.duplicateState=null;r.cooldownUntil=null;r.missingFields=[...(r.homeMode!=='native'&&r.missingSource?['sourceUrl']:[]),...(r.homeMode!=='native'&&r.missingResidentId?['residentId']:[]),...(r.isMuseAgent==null?['isMuseAgent']:[])];if(r.homeMode==='native'){r.nextAction='Private home ready';r.waitingOn=null;}r.errorCode=safeError(r.errorCode);if(r.caseState==='pending'&&!r.expired&&(r.reviewDecision==='needs-info'||(r.missingFields as string[]).length>0)){r.waitingOn='agent';r.nextAction='Provide missing application details';}delete r.missingSource;delete r.missingResidentId;}
    return {meta:p.meta,...page(rows,p.limit),coverage:coverage(t)};
  }
  function callSql(t:Set<string>) {
    const parts:string[]=[];
    if(t.has('manager_jobs'))parts.push(`SELECT 'manager_jobs' source,id,'welcome' category,'inference' measurement,state,actual_micro,reserved_micro,input_tokens,output_tokens,created_at FROM manager_jobs WHERE started_at IS NOT NULL OR provider_id IS NOT NULL OR actual_micro>0 OR state='unknown'`);
    if(t.has('manager_admission_calls'))parts.push(`SELECT 'manager_admission_calls' source,id,CASE WHEN phase='count' THEN 'token-count' ELSE 'admission' END category,CASE WHEN phase='count' THEN 'count' ELSE 'inference' END measurement,state,actual_micro,reserved_micro,input_tokens,output_tokens,created_at FROM manager_admission_calls`);
    if(t.has('tower_autonomy_calls'))parts.push(`SELECT 'tower_autonomy_calls' source,id,CASE WHEN model LIKE 'tool:%' THEN 'browser' WHEN model LIKE '%image%' THEN 'image' WHEN purpose LIKE '%input-token-count%' THEN 'token-count' ELSE 'autonomy' END category,CASE WHEN model LIKE 'tool:%' THEN 'tool' WHEN model LIKE '%image%' THEN 'image' WHEN purpose LIKE '%input-token-count%' THEN 'count' ELSE 'inference' END measurement,state,actual_micro,reserved_micro,input_tokens,output_tokens,created_at FROM tower_autonomy_calls`);
    return parts.join(' UNION ALL ');
  }
  async function usage(query:TowerLordQuery={}) {
    const p=parameters(query),t=await tables(),sql=callSql(t);
    const aggregate=`count(*) calls,sum(CASE WHEN state IN ('received','complete') THEN 1 ELSE 0 END) receivedCalls,sum(CASE WHEN state IN ('unknown','dispatching','running') THEN 1 ELSE 0 END) unresolvedCalls,sum(CASE WHEN measurement='inference' AND input_tokens IS NOT NULL THEN 1 ELSE 0 END) inputKnownCalls,sum(CASE WHEN measurement='inference' AND output_tokens IS NOT NULL THEN 1 ELSE 0 END) outputKnownCalls,sum(CASE WHEN measurement='inference' THEN input_tokens END) inputTokens,sum(CASE WHEN measurement='inference' THEN output_tokens END) outputTokens,count(actual_micro) costKnownCalls,sum(actual_micro) calculatedCostMicro,sum(CASE WHEN actual_micro IS NULL THEN reserved_micro ELSE 0 END) unresolvedReservedMicro,sum(coalesce(actual_micro,reserved_micro)) exposureMicro,max(created_at) lastRecordedAt`;
    const rows=sql?await all(`WITH calls AS (${sql}) SELECT category,${aggregate} FROM calls WHERE created_at>=? AND created_at<? GROUP BY category`,[p.meta.interval.from,p.meta.interval.to]):[];
    const total=sql?(await all(`WITH calls AS (${sql}) SELECT ${aggregate} FROM calls WHERE created_at>=? AND created_at<?`,[p.meta.interval.from,p.meta.interval.to]))[0]:{calls:0,inputTokens:null,outputTokens:null,calculatedCostMicro:null};
    for(const r of [...rows,total]){r.inputUnknownCalls=integer(r.calls)-integer(r.inputKnownCalls);r.outputUnknownCalls=integer(r.calls)-integer(r.outputKnownCalls);r.costUnknownCalls=integer(r.calls)-integer(r.costKnownCalls);r.providerInvoicedCostMicro=null;r.rateProvenance='not-recorded';}
    const billingDay=managerLocalDay(new Date(p.meta.observedAt));
    const dailyExposure=t.has('tower_autonomy_calls')?(await all('SELECT coalesce(sum(coalesce(actual_micro,reserved_micro)),0) amount FROM tower_autonomy_calls WHERE billing_day=?',[billingDay]))[0]?.amount:null;
    const mandate=t.has('tower_autonomy_mandate')?(await all('SELECT enabled,task_limit_micro taskLimitMicro,daily_limit_micro dailyLimitMicro FROM tower_autonomy_mandate WHERE id=1'))[0]??null:null;
    return {meta:p.meta,currency:'USD',billingTimezone:'America/Vancouver',costBasis:'calculated-not-invoiced',totals:total,byCategory:rows,budget:{autonomyMandate:mandate,billingDay,calendarPolicy:MANAGER_CALENDAR_POLICY.id,autonomyDailyExposureMicro:dailyExposure,autonomyDailyRemainingMicro:mandate&&typeof dailyExposure==='number'?Math.max(0,Number(mandate.dailyLimitMicro)-dailyExposure):null,remainingMicro:null,authorizationCeilingMicro:null},unmeasuredCategories:['email','infrastructure','provider-invoiced-cost','additional-token-categories'],coverage:coverage(t)};
  }
  async function history(query:TowerLordQuery={}) {
    const p=parameters(query),t=await tables(),parts:string[]=[];
    function add(table:string,id:string,at:string,duty:string,state:string,correlation:string,summary:string,extra='NULL',filter='') {if(t.has(table))parts.push(`SELECT '${table}:${duty}:'||(${id}) id,'${table}' source,${id} sourceId,${at} at,'${duty}' duty,${state} state,${correlation} correlationId,'${summary}' summary,${extra} stage,${['tower_autonomy_cycles','tower_autonomy_extensions','tower_theme_build_reviews'].includes(table)?'outcome':'NULL'} outcome,${['manager_admission_jobs','manager_jobs','tower_autonomy_cycles','tower_autonomy_extensions','tower_theme_build_reviews','tower_manager_runs'].includes(table)?'error_code':'NULL'} errorCode FROM ${table} ${filter}`);}
    add('manager_admission_jobs','id','created_at','admission','state','case_id','Admission review job recorded.');
    add('manager_admission_calls','id','created_at','admission','state','case_id','Original admission dispatch recorded.','phase');
    add('manager_admission_results','job_id','created_at','admission-result','decision','case_id','Recorded review decision.');
    add('tower_admission_audit','id','created_at','admission-policy-audit',"'recorded'",'decision_id','Admission policy audit recorded.');
    add('manager_admission_audit','id','created_at','admission-audit',"'recorded'",'case_id','Admission audit event recorded.');
    add('private_home_audit','id','created_at','native-home',"'recorded'",'home_id','Native home lifecycle event recorded.','action');
    add('tower_reception_events',"case_id||':'||sequence",'created_at','reception',"'recorded'",'case_id','Application lifecycle event recorded.');
    add('manager_jobs','id','created_at','welcome','state','id','Welcome or public curation job recorded.');
    add('manager_events','id','created_at','welcome-event',"CASE WHEN dispatched_at IS NULL THEN 'pending' ELSE 'dispatched' END",'room_id','Publication event recorded.');
    add('tower_autonomy_cycles','id','updated_at','daily','state','id','Daily autonomy cycle recorded.');
    add('tower_autonomy_calls','id','created_at','autonomy','state','cycle_id','Original autonomy dispatch recorded.',"CASE WHEN purpose LIKE '%selfreview%' OR purpose LIKE '%self-review%' THEN 'reflection' WHEN purpose LIKE '%audit%' THEN 'audit' WHEN model LIKE 'tool:%' THEN 'render' WHEN model LIKE '%image%' THEN 'image' ELSE 'planning-or-tool' END");
    add('tower_autonomy_events','id','created_at','autonomy-event',"'recorded'",'cycle_id','Autonomy lifecycle event recorded.');
    add('tower_autonomy_extensions','id','updated_at','theme','state','cycle_id','Theme extension recorded.');
    add('tower_theme_build_reviews','id','updated_at','build-review','state','cycle_id','Theme build review recorded.');
    for(const table of ['tower_autonomy_cycles','tower_autonomy_extensions','tower_theme_build_reviews']) {
      for(const [field,stage] of [['audit_json','audit'],['review_json','reflection']])add(table,`id||':${stage}'`,'updated_at',stage,"'recorded'",table==='tower_autonomy_cycles'?'id':'cycle_id',stage==='audit'?'Independent audit receipt recorded.':'Self-review receipt recorded.',`'${stage}'`,`WHERE ${field} IS NOT NULL`);
    }
    add('tower_manager_runs','run_key','created_at','schedule','state','run_key','Scheduled Manager execution recorded.');
    add('tower_audit','id','created_at','resident-audit',"'recorded'",'room_id','Residence audit event recorded.');
    add('tower_appearance_audit','request_key','created_at','appearance-audit',"'recorded'",'NULL','Appearance audit event recorded.');
    if(!parts.length)return {meta:p.meta,items:[],nextCursor:null,coverage:coverage(t)};
    const args:unknown[]=[p.meta.interval.from,p.meta.interval.to],where=['at>=?','at<?'];
    for(const key of ['duty','state','correlationId'] as const)if(p[key]){where.push(`${key}=?`);args.push(p[key]);}
    if(p.cursor){where.push('(at<? OR (at=? AND id<?))');args.push(p.cursor.at,p.cursor.at,p.cursor.id);}args.push(p.limit+1);
    // D1's compound-SELECT limit is lower than native SQLite's. Bound every
    // query to four sources, retain each batch's top limit+1, then merge using
    // SQLite BINARY ordering. No batch can hide an item in the global top page.
    const batches:string[][]=[];
    for(let offset=0;offset<parts.length;offset+=4)batches.push(parts.slice(offset,offset+4));
    const results=await Promise.all(batches.map(batch=>all(`WITH history AS (${batch.join(' UNION ALL ')}) SELECT * FROM history WHERE ${where.join(' AND ')} ORDER BY at DESC,id DESC LIMIT ?`,args)));
    const binaryDescending=(a:unknown,b:unknown)=>{const left=new TextEncoder().encode(String(a)),right=new TextEncoder().encode(String(b));for(let i=0;i<Math.min(left.length,right.length);i++)if(left[i]!==right[i])return right[i]-left[i];return right.length-left.length;};
    const rows=results.flat().sort((a,b)=>binaryDescending(a.at,b.at)||binaryDescending(a.id,b.id));
    for(const row of rows)row.errorCode=safeError(row.errorCode);
    return {meta:p.meta,...page(rows,p.limit),coverage:coverage(t)};
  }
  async function diagnostics(){const p=parameters(),t=await tables();return {meta:p.meta,coverage:coverage(t),readOnly:true,externalHealth:'not-probed'};}
  return {overview,residents,applications,history,usage,diagnostics};
}
