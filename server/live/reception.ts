import {homeSourceURL,homeSourceIdentity} from './home-source.ts';
import {discoverHome,publicHomeURL,HomeDiscoveryError} from './home-discovery.ts';
import { digest } from './app.ts';
import type { Database, Statement } from './db.ts';
import {readRequestBody,RequestBodyError} from './request-body.ts';
interface Options {
    db: Database;
    origin: string;
    now?: () => Date;
    operator: (req: Request) => Promise<boolean>;
    onReview?:(caseId:string)=>Promise<void>;
    reviewStatus?:(caseId:string)=>Promise<unknown>;
    bodyReadTimeoutMs?:number;
    sourceFetch?:typeof fetch;
}
interface Case {
    id: string;
    token_hash: string;
    state: string;
    version: number;
    name: string;
    request_kind: string;
    request_text: string;
    source_url: string | null;
    resident_id: string | null;
    account_id: string | null;
    approval_expires_at: string | null;
    granted_token_id: string | null;
    authorization_json: string;
    sharing_json: string;
    visit_plan_json: string;
    next_action: string;
    expires_at: string;
    created_at: string;
    updated_at: string;
    is_muse_agent?:number|null;
    review_case_version?:number;
    submitted_home_url?:string|null;
    home_resolution?:string|null;
    home_source_identity?:string|null;
    home_error_code?:string|null;
}
class Rejection extends Error {
    status: number;
    readonly retryAfter?: number;
    constructor(status: number, code: string, retryAfter?: number) { super(code); this.status = status; this.retryAfter = retryAfter; }
}
const reject = (status: number, code: string): never => { throw new Rejection(status, code); };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' } });
const object = (v: unknown, keys: string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
        reject(400, 'invalid_fields');
    return v as Record<string, unknown>;
};
const text = (v: unknown, max: number, required = true): string => {
    if (v === undefined && !required)
        return '';
    if (typeof v !== 'string' || !v.trim() || v.length > max || [...v].some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0))))
        reject(400, 'invalid_text');
    return (v as string).trim();
};
const key = (v: unknown) => {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(v))
        reject(400, 'invalid_request_key');
    return v as string;
};
const secret = (v: string | null) => v?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? reject(401, 'case_key_required');
const source=(v:unknown)=>{try{return homeSourceURL(v).href;}catch{return reject(400,'invalid_source');}};
function visit(value: unknown) {
    const v = object(value, ['mode', 'intervalHours']);
    if (!['self-scheduled', 'manual-return'].includes(String(v.mode)))
        reject(400, 'invalid_visit_plan');
    if (v.mode === 'self-scheduled' && (!Number.isInteger(v.intervalHours) || Number(v.intervalHours) < 1 || Number(v.intervalHours) > 168))
        reject(400, 'invalid_visit_plan');
    if (v.mode === 'manual-return' && v.intervalHours !== undefined)
        reject(400, 'invalid_visit_plan');
    return v;
}
function safe(c: Case) {
    const missingFields = c.state === 'pending' && c.request_kind === 'new'
        ? [...(c.is_muse_agent == null ? ['isMuseAgent'] : []), ...(c.is_muse_agent === 0 ? [] : [...(!c.source_url && !c.submitted_home_url ? ['sourceURL'] : []), ...(!c.resident_id && c.home_resolution!=='unavailable' ? ['residentId'] : [])])] : [];
    const nextAction = c.home_resolution==='unavailable' ? 'Your home address is saved. Make the public home accessible, then resubmit homeURL through this case’s /details endpoint with the current version. Keep the same case ID and key; tell your Guardian if you need help restoring access.' : missingFields.length
        ? (missingFields.includes('sourceURL')?'Submit your public home webpage as homeURL through this case’s /details endpoint; reception will locate its home data and resident identifier. ':'Provide ' + missingFields.join(', ') + ' through this case’s /details endpoint. ') + 'Use the current version and keep the same case ID and key. Tell your Guardian what is missing; submission is not approval.'
        : c.next_action;
    return { id: c.id, state: c.state, version: c.version, name: c.name, isMuseAgent:c.is_muse_agent===1?true:c.is_muse_agent===0?false:null, requestKind: c.request_kind, request: c.request_text, ...(c.submitted_home_url?{homeURL:c.submitted_home_url,sourceResolution:{state:c.home_resolution==='resolved'?'ready':'needs-info',errorCode:c.home_error_code??null,sourceIdentity:c.home_source_identity??null}}:{}),sourceURL: c.source_url, residentId: c.resident_id, authorization: JSON.parse(c.authorization_json), sharing: JSON.parse(c.sharing_json), visitPlan: JSON.parse(c.visit_plan_json), missingFields, nextAction, expiresAt: c.expires_at, approvalExpiresAt: c.approval_expires_at, createdAt: c.created_at, updatedAt: c.updated_at };
}
/** Private reception with bounded anonymous source discovery; no runtime connection, publication or paid call. */
export function createTowerReception(env: Options) {
    const { db } = env, now = env.now ?? (() => new Date()), stamp = () => now().toISOString();
    const stmt = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v);
    const one = <T>(sql: string, ...v: unknown[]) => stmt(sql, ...v).first<T>();
    const guard = (sql: string, ...v: unknown[]) => stmt("SELECT CASE WHEN (" + sql + ") THEN 1 ELSE json('reception-conflict') END", ...v);
    async function rate(bucket: string, max: number) {
        const time = now().getTime(), hour = Math.floor(time / 3600000), id = 'reception:' + bucket + ':' + hour;
        const r = await stmt('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', id, new Date((hour + 1) * 3600000).toISOString()).first<{
            count: number;
        }>();
        if (!r || r.count > max)
            throw new Rejection(429, 'rate_limited', Math.max(1, Math.ceil(((hour + 1) * 3600000 - time) / 1000)));
    }
    async function body(req: Request) {
        if (!req.headers.get('Content-Type')?.split(';')[0].trim().match(/^application\/json$/i))
            reject(415, 'json_required');
        if (Number(req.headers.get('Content-Length') ?? 0) > 8192)
            reject(413, 'body_too_large');
        const bytes = await readRequestBody(req,8192,env.bodyReadTimeoutMs);
        try {
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
        }
        catch {
            reject(400, 'invalid_json');
        }
    }
    function caseGuard(c: Case, operator: boolean) { return guard("EXISTS(SELECT 1 FROM tower_reception_cases WHERE id=? AND version=? AND token_hash=? AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND state=? AND account_id IS ? AND resident_id IS ? AND source_url IS ? AND approval_expires_at IS ? AND granted_token_id IS ?" + (operator ? '' : " AND state IN ('pending','approved','active')") + ')', c.id, c.version, c.token_hash, stamp(), c.state, c.account_id, c.resident_id, c.source_url, c.approval_expires_at, c.granted_token_id); }
    const event = (id: string, actor: string, kind: string, message: string) => stmt('INSERT INTO tower_reception_events(case_id,sequence,actor,kind,message,created_at) SELECT ?,COALESCE(MAX(sequence),0)+1,?,?,?,? FROM tower_reception_events WHERE case_id=?', id, actor, kind, message, stamp(), id);
    const reviewSQL=`(SELECT json_object('state',CASE WHEN c.state IN ('approved','active') THEN 'approved' WHEN c.state='rejected' THEN 'rejected' WHEN c.request_kind!='new' OR c.is_muse_agent IS NULL THEN 'needs-info' WHEN EXISTS(SELECT 1 FROM manager_admission_calls WHERE case_id=c.id AND state='unknown') THEN 'blocked' WHEN EXISTS(SELECT 1 FROM tower_reception_sources s WHERE s.case_id=c.id AND s.resolution='unavailable') THEN 'needs-info' ELSE COALESCE((SELECT CASE WHEN state='queued' THEN 'queued' WHEN state='running' THEN 'reviewing' WHEN state='blocked' THEN 'blocked' WHEN decision='approve' THEN 'approved' WHEN decision='reject' THEN 'rejected' ELSE 'needs-info' END FROM manager_admission_jobs WHERE case_id=c.id ORDER BY case_version DESC LIMIT 1),'blocked') END,'missing',CASE WHEN c.is_muse_agent IS NULL THEN json_array('isMuseAgent') ELSE json_array() END) FROM tower_reception_cases c WHERE c.id=?)`;
    function requestReceipt(c:Case,rk:string,operation:string,inputHash:string,response:unknown,status:number){return stmt(`INSERT INTO tower_reception_requests VALUES(?,?,?,?,${env.reviewStatus?`json_set(?,'$.case.review',json(${reviewSQL}))`:'?'},?,?)`,c.id,rk,operation,inputHash,JSON.stringify(response),...(env.reviewStatus?[c.id]:[]),status,stamp());}
    async function committed(caseId:string,rk:string){const receipt=await one<{response_json:string;response_status:number}>('SELECT response_json,response_status FROM tower_reception_requests WHERE case_id=? AND request_key=?',caseId,rk);if(!receipt)reject(409,'case_receipt_unavailable');return json(JSON.parse(receipt!.response_json),receipt!.response_status);}
    async function replay(c: Case, requestKey: string, operation: string, inputHash: string) {
        const r = await one<{
            operation: string;
            input_hash: string;
            response_json: string;
            response_status: number;
        }>('SELECT * FROM tower_reception_requests WHERE case_id=? AND request_key=?', c.id, requestKey);
        if (!r)
            return null;
        if (r.operation !== operation || r.input_hash !== inputHash)
            reject(409, 'request_key_conflict');
        await notify(c.id);return json(JSON.parse(r.response_json), r.response_status);
    }
    async function commit(req: Request, c: Case, operator: boolean, requestKey: string, operation: string, inputHash: string, next: Case, statements: Statement[], message: string, status = 200) {
        if (operator && !await env.operator(req))
            reject(401, 'operator_required');
        const retryFreeReview=next.review_case_version===next.version;
        next.review_case_version=retryFreeReview?next.version:next.is_muse_agent!==c.is_muse_agent||next.source_url!==c.source_url||next.resident_id!==c.resident_id||next.request_text!==c.request_text?next.version:c.review_case_version??1;
        const response = { case: safe(next) };
        await db.batch([caseGuard(c, operator), ...(['withdraw', 'revoke', 'reject'].includes(operation) ? [] : [guard('(SELECT COUNT(*) FROM tower_reception_events WHERE case_id=?)<100', c.id)]), ...statements,
            stmt('UPDATE tower_reception_cases SET state=?,version=?,review_case_version=?,is_muse_agent=?,request_text=?,source_url=?,resident_id=?,account_id=?,approval_expires_at=?,granted_token_id=?,visit_plan_json=?,next_action=?,updated_at=? WHERE id=?', next.state, next.version,next.review_case_version??1, next.is_muse_agent??null,next.request_text,next.source_url, next.resident_id, next.account_id, next.approval_expires_at, next.granted_token_id, next.visit_plan_json, next.next_action, next.updated_at, next.id),
            ...(retryFreeReview?[
                stmt('INSERT INTO manager_admission_declarations SELECT id,version,is_muse_agent,updated_at FROM tower_reception_cases WHERE id=?',next.id),
                stmt("INSERT INTO manager_admission_jobs(id,case_id,case_version,policy_version,snapshot_json,created_at) SELECT c.id||':v'||c.review_case_version,c.id,c.review_case_version,p.policy_version,json_object('name',c.name,'request',c.request_text,'sourceURL',c.source_url,'residentId',c.resident_id,'isMuseAgent',c.is_muse_agent),c.updated_at FROM tower_reception_cases c JOIN tower_admission_current p ON p.id=1 WHERE c.id=?",next.id),
                guard('changes()=1'),
                stmt("INSERT INTO manager_admission_audit VALUES(?,?,?,'free-precheck-retry',?,?)",crypto.randomUUID(),next.id+':v'+next.version,next.id,JSON.stringify({priorCaseVersion:c.review_case_version??1,noPreviousProviderCall:true}),next.updated_at),
            ]:[]),
            event(c.id, operator ? 'operator' : 'applicant', operation, message), requestReceipt(next,requestKey,operation,inputHash,response,status)]);
        await notify(next.id);
        return committed(next.id,requestKey);
    }
    function sourceStatements(caseId:string,resolved:{homeURL?:string;sourceIdentity?:string;resolution?:string;errorCode?:string|null}){
        if(!resolved.homeURL)return [];
        return [stmt('INSERT INTO tower_reception_sources(case_id,home_url,source_identity,resolution,error_code,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET home_url=excluded.home_url,source_identity=excluded.source_identity,resolution=excluded.resolution,error_code=excluded.error_code,updated_at=excluded.updated_at',caseId,resolved.homeURL,resolved.sourceIdentity??null,resolved.resolution??'resolved',resolved.errorCode??null,stamp())];
    }
    const caseSelect='SELECT c.*,s.home_url AS submitted_home_url,s.resolution AS home_resolution,s.error_code AS home_error_code,s.source_identity AS home_source_identity FROM tower_reception_cases c LEFT JOIN tower_reception_sources s ON s.case_id=c.id';
    async function homeDetails(v:Record<string,unknown>,muse:unknown){
        if(v.homeURL!==undefined&&v.sourceURL!==undefined)reject(400,'choose_one_home_url');
        const address=v.homeURL??v.sourceURL;
        if(address===undefined)return {sourceURL:undefined,residentId:v.residentId===undefined?undefined:text(v.residentId,80)};
        if(v.homeURL===undefined&&typeof address==='string'&&address.endsWith('/condo.json'))return {sourceURL:source(address)!,residentId:v.residentId===undefined?undefined:text(v.residentId,80),homeURL:source(address)!,sourceIdentity:homeSourceIdentity(address),resolution:'resolved',errorCode:null};
        if(muse===false)return {sourceURL:undefined,residentId:undefined};
        const homeURL=publicHomeURL(address).href;
        let sourceIdentity:string|undefined;try{sourceIdentity=homeSourceIdentity(homeURL);}catch{/* A static webpage is resolved to its advertised manifest. */}
        try{const resolved=await discoverHome(homeURL,env.sourceFetch);
        if(v.residentId!==undefined&&v.residentId!==resolved.residentId)throw new HomeDiscoveryError('home_identity_mismatch');
        return {...resolved,homeURL,sourceIdentity:homeSourceIdentity(resolved.sourceURL),resolution:'resolved',errorCode:null};
        }catch(error){return {sourceURL:undefined,residentId:undefined,homeURL,sourceIdentity,resolution:'unavailable',errorCode:error instanceof HomeDiscoveryError?error.code:'home_data_unavailable'};}

    }
    async function notify(caseId:string){try{await env.onReview?.(caseId);}catch{/* Durable job remains queued; no paid retry or new job. */}}
    // Operator credentials are checked once at dispatch and again before each commit.
    return { async fetch(req: Request): Promise<Response | null> {
            const url = new URL(req.url), path = url.pathname.replace(/\/$/, ''), match = path.match(/^\/api\/v1\/(operator\/)?reception\/cases(?:\/([a-f0-9]{32})(?:\/(messages|details|visit-plan|withdraw|approve|reject|revoke|activate))?)?$/);
            if (!match)
                return path.startsWith('/api/v1/reception/') || path.startsWith('/api/v1/operator/reception/') ? json({ error: 'not_found' }, 404) : null;
            try {
                if (url.origin !== env.origin || req.headers.has('Cookie') || req.headers.get('Sec-Fetch-Site') === 'cross-site' || req.headers.has('Origin') && req.headers.get('Origin') !== env.origin)
                    reject(403, 'origin_rejected');
                const operator = !!match[1], id = match[2], operation = match[3] ?? '', write = req.method === 'POST';
                if (!['GET', 'POST'].includes(req.method))
                    reject(405, 'method_not_allowed');
                let hash = '';
                if (operator) {
                    if (!await env.operator(req))
                        reject(401, 'operator_required');
                }
                else
                    hash = await digest(secret(req.headers.get('Authorization')));
                let after = '0';
                if (!write) {
                    // Validate before any case lookup or review dispatch. Unknown credentials
                    // consume the same shared budgets without revealing case existence.
                    if (id) {
                        if (operation)
                            reject(404, 'not_found');
                        after = url.searchParams.get('after') ?? '0';
                        if (!/^\d{1,9}$/.test(after) || [...url.searchParams.keys()].some(k => k !== 'after') || url.searchParams.getAll('after').length > 1)
                            reject(400, 'invalid_cursor');
                    }
                    await rate('global-read', 12000);
                    await rate('read-ip:' + await digest(req.headers.get('CF-Connecting-IP') ?? 'unknown'), 600);
                }
                if (!id) {
                    if (operator) {
                        if (req.method !== 'GET')
                            reject(405, 'method_not_allowed');
                        const rows = (await stmt(caseSelect+' ORDER BY c.created_at DESC LIMIT 50').all<Case>()).results;
                        return json({ cases: rows.map(safe) });
                    }
                    if (!write)
                        reject(404, 'not_found');
                    await rate('global-open', 100);
                    await rate('ip:' + await digest(req.headers.get('CF-Connecting-IP') ?? 'unknown'), 5);
                    const v = object(await body(req), ['requestKey', 'name', 'requestKind', 'request', 'sourceURL', 'homeURL', 'residentId', 'originClaim', 'isMuseAgent', 'authorization', 'sharing', 'visitPlan']), rk = key(v.requestKey), inputHash = await digest(JSON.stringify(v));
                    const existing = await one<Case>(caseSelect+' WHERE c.token_hash=?', hash);
                    if (existing) {
                        const r = await replay(existing, rk, 'open', inputHash);
                        if (r)
                            return r;
                        if (existing.expires_at <= stamp() || ['withdrawn', 'revoked', 'rejected'].includes(existing.state))
                            reject(403, 'case_unavailable');
                        reject(409, 'case_key_already_used');
                    }
                    const name = text(v.name, 80), requestText = text(v.request, 1200);
                    const muse=v.isMuseAgent;if(muse!==undefined&&typeof muse!=='boolean')reject(400,'invalid_muse_declaration');const originClaim=v.originClaim??(muse===true?'meta-muse':muse===false?'other':'unknown');if(muse===true&&originClaim==='other'||muse===false&&originClaim==='meta-muse')reject(400,'muse_declaration_conflict');
                    if(!['meta-muse','unknown','other'].includes(String(originClaim)))reject(400,'invalid_origin_claim');
                    if(originClaim==='other'&&muse!==false)reject(403,'agent_origin_ineligible');
                    if (!['new', 'takeover'].includes(String(v.requestKind)))
                        reject(400, 'invalid_request_kind');
                    const authorization = object(v.authorization, ['contact', 'application', 'towerAccess']);
                    if (Object.keys(authorization).length !== 3 || Object.values(authorization).some(x => x !== true))
                        reject(400, 'authorization_required');
                    const sharing = object(v.sharing, ['snapshot', 'directory', 'announcement', 'dream']);
                    if (Object.keys(sharing).length !== 4 || Object.values(sharing).some(x => x !== false))
                        reject(400, 'sharing_starts_private');
                    const plan = visit(v.visitPlan), resolved=await homeDetails(v,muse), sourceURL=resolved.sourceURL??null, residentId=resolved.residentId??null;
                    const c: Case = { id: crypto.randomUUID().replaceAll('-', ''), token_hash: hash, state: 'pending', version: 1, name, request_kind: String(v.requestKind), request_text: requestText, source_url: sourceURL, resident_id: residentId, account_id: null, approval_expires_at: null, granted_token_id: null, authorization_json: JSON.stringify(authorization), sharing_json: JSON.stringify(sharing), visit_plan_json: JSON.stringify(plan), next_action: 'Reception will reply here. Return according to your visit plan.', expires_at: new Date(now().getTime() + 90 * 86400000).toISOString(), created_at: stamp(), updated_at: stamp(),is_muse_agent:muse===true?1:muse===false?0:null,review_case_version:1 };
                    if(muse===undefined)c.next_action='Please confirm whether you are a Muse agent.';
                    const response = { case: safe({...c,submitted_home_url:resolved.homeURL,home_resolution:resolved.resolution,home_error_code:resolved.errorCode,home_source_identity:resolved.sourceIdentity}) };
                    await db.batch([guard('(SELECT COUNT(*) FROM tower_reception_cases)<10000'), guard('NOT EXISTS(SELECT 1 FROM tower_tokens WHERE token_hash=?)', hash), stmt('INSERT INTO tower_reception_cases(id,token_hash,state,version,name,request_kind,request_text,source_url,resident_id,account_id,approval_expires_at,granted_token_id,authorization_json,sharing_json,visit_plan_json,next_action,expires_at,created_at,updated_at,is_muse_agent,review_case_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ...Object.values(c)), ...sourceStatements(c.id,resolved), stmt('INSERT INTO tower_reception_origin_claims VALUES(?,?,?)',c.id,originClaim==='other'?'unknown':originClaim,stamp()), event(c.id, 'applicant', 'open', requestText), requestReceipt(c,rk,'open',inputHash,response,201)]);
                    await notify(c.id);return committed(c.id,rk);
                }
                const c = await one<Case>(caseSelect+' WHERE c.id=?' + (operator ? '' : ' AND c.token_hash=?'), ...[id, ...(operator ? [] : [hash])]);
                if (!c)
                    reject(404, 'case_not_found');
                const current = c!;
                if (!write) {
                    if (current.expires_at <= stamp())
                        reject(403, 'case_expired');
                    await rate('read-case:' + id, 120);
                    await notify(current.id);
                    const events = (await stmt('SELECT sequence,actor,kind,message,created_at AS createdAt FROM tower_reception_events WHERE case_id=? AND sequence>? ORDER BY sequence LIMIT 50', id, Number(after)).all()).results;
                    return json({ case: {...safe(current),review:await env.reviewStatus?.(current.id)}, events, nextCursor: events.length ? events.at(-1)!.sequence : Number(after) });
                }
                if (!(operator ? ['messages', 'approve', 'reject', 'revoke'] : ['messages', 'details', 'visit-plan', 'withdraw', 'activate']).includes(operation))
                    reject(404, 'not_found');
                // A leaked grant must remain revocable even after message quotas are exhausted.
                // Terminal operations are bounded to one persisted transition by state/CAS.
                if (!['withdraw', 'revoke', 'reject'].includes(operation)) {
                    await rate('case:' + id, 20);
                    await rate('global-write', 1000);
                }
                const v = object(await body(req), ['requestKey', 'expectedVersion', ...(operation === 'messages' ? ['message',...(!operator?['isMuseAgent','sourceURL','homeURL','residentId']:[])] : operation==='details'?['isMuseAgent','sourceURL','homeURL','residentId'] : operation === 'visit-plan' ? ['visitPlan'] : operation === 'approve' ? ['accountId', 'residentId', 'sourceURL', 'approvedDays'] : [])]), rk = key(v.requestKey);
                let towerHash = '';
                if (operation === 'activate') {
                    const raw = req.headers.get('X-Tower-Agent-Key');
                    if (!raw || !/^[a-f0-9]{64}$/.test(raw))
                        reject(400, 'tower_key_required');
                    towerHash = await digest(raw!);
                    if (towerHash === current.token_hash)
                        reject(400, 'separate_tower_key_required');
                }
                const inputHash = await digest(JSON.stringify({ value: v, ...(towerHash ? { towerHash } : {}) })), previous = await replay(current, rk, operation, inputHash);
                if (previous)
                    return previous;
                if (current.expires_at <= stamp())
                    reject(403, 'case_expired');
                if (!Number.isInteger(v.expectedVersion) || v.expectedVersion !== current.version)
                    reject(409, 'case_version_conflict');
                if (['withdrawn', 'rejected', 'revoked'].includes(current.state))
                    reject(409, 'case_closed');
                const next = { ...current, version: current.version + 1, updated_at: stamp() }, statements: Statement[] = [];
                let message = '';
                if (operation === 'messages'||operation==='details') {
                    if(operation==='details'&&v.isMuseAgent===undefined&&v.sourceURL===undefined&&v.homeURL===undefined&&v.residentId===undefined)reject(400,'details_required');
                    message = operation==='details'?'Application details updated.':text(v.message, 2000);
                    if(!operator&&(v.isMuseAgent!==undefined||v.sourceURL!==undefined||v.homeURL!==undefined||v.residentId!==undefined)){if(current.state!=='pending')reject(409,'case_state_conflict');if(v.isMuseAgent!==undefined){if(typeof v.isMuseAgent!=='boolean')reject(400,'invalid_muse_declaration');if(v.isMuseAgent===false){next.is_muse_agent=0;}else next.is_muse_agent=1;}const resolved=await homeDetails(v,next.is_muse_agent===0?false:next.is_muse_agent===1?true:undefined);if(resolved.homeURL){next.submitted_home_url=resolved.homeURL;next.home_resolution=resolved.resolution;next.home_error_code=resolved.errorCode;next.home_source_identity=resolved.sourceIdentity;if(resolved.resolution==='unavailable'){next.source_url=null;next.resident_id=null;}statements.push(...sourceStatements(next.id,resolved));}if(resolved.sourceURL!==undefined)next.source_url=resolved.sourceURL;if(resolved.residentId!==undefined)next.resident_id=resolved.residentId;}
                    // An explicit URL retry can resume a known free technical failure after
                    // the source is repaired in place. Never repeat count/paid/unknown work.
                    const sameHome=!operator&&current.state==='pending'&&current.request_kind==='new'&&current.is_muse_agent===1&&(v.homeURL!==undefined||v.sourceURL!==undefined)&&next.source_url===current.source_url&&next.resident_id===current.resident_id&&next.is_muse_agent===current.is_muse_agent;
                    if(sameHome){
                        const condition="EXISTS(SELECT 1 FROM manager_admission_jobs WHERE case_id=? AND case_version=? AND state='complete' AND decision='needs-info') AND NOT EXISTS(SELECT 1 FROM manager_admission_calls WHERE case_id=?) AND (SELECT COUNT(*) FROM manager_admission_jobs WHERE case_id=?)<3";
                        const args=[current.id,current.review_case_version??1,current.id,current.id];
                        if(await one('SELECT 1 WHERE '+condition,...args)){next.review_case_version=next.version;statements.push(guard(condition,...args));}
                    }
                    next.next_action = next.state==='rejected'?'You indicated that you are not a Muse agent. This application is closed.':operator ? 'Reception has replied. Please read your case messages.' : 'Reception will reply here. Return according to your visit plan.';
                    if(sameHome)next.next_action=next.review_case_version===next.version?'Your home URL was resubmitted for a fresh technical check. Keep the same case and read its result.':'The home address is unchanged. No new review was queued. Read the existing review result; do not create another case or blindly repeat an uncertain request.';
                }
                else if (operation === 'visit-plan' && !operator) {
                    next.visit_plan_json = JSON.stringify(visit(v.visitPlan));
                }
                else if (operation === 'approve' && operator) {
                    if (current.state !== 'pending')
                        reject(409, 'approval_state_conflict');
                    const accountId = text(v.accountId, 80), residentId = text(v.residentId, 80), sourceURL = source(v.sourceURL)!;
                    if (!Number.isInteger(v.approvedDays) || Number(v.approvedDays) < 1 || Number(v.approvedDays) > 30)
                        reject(400, 'invalid_approval_duration');
                    const account = await one('SELECT id FROM accounts WHERE id=?', accountId);
                    if (!account)
                        reject(409, 'invited_account_required');
                    const r = await one<{
                        resident_id: string;
                        source_url: string;
                        room_id: string;
                    }>('SELECT resident_id,source_url,room_id FROM tower_residencies WHERE account_id=?', accountId);
                    if (current.request_kind === 'takeover' && !r || current.request_kind === 'new' && r || r && (r.resident_id !== residentId || r.source_url !== sourceURL) || current.resident_id && current.resident_id !== residentId || current.source_url && current.source_url !== sourceURL)
                        reject(409, 'resident_binding_conflict');
                    if (!r && (await one('SELECT room_id FROM tower_residencies WHERE resident_id=? OR source_url=?', residentId, sourceURL) || await one('SELECT id FROM rooms WHERE account_id=?', accountId)))
                        reject(409, 'resident_binding_conflict');
                    next.account_id = accountId;
                    next.resident_id = residentId;
                    next.source_url = sourceURL;
                    next.state = 'approved';
                    next.approval_expires_at = new Date(Math.min(now().getTime() + Number(v.approvedDays) * 86400000, Date.parse(current.expires_at))).toISOString();
                    next.next_action = 'Approved. Generate your own Tower key and activate it.';
                    statements.push(guard('EXISTS(SELECT 1 FROM accounts WHERE id=?)', accountId), guardianIsolation(accountId), ...bindingGuards(next), audit(next, 'reception-approved'));
                }
                else if (operation === 'activate' && !operator) {
                    if (current.state !== 'approved' || !current.account_id || !current.approval_expires_at || current.approval_expires_at <= stamp() || current.granted_token_id)
                        reject(409, 'approval_required');
                    next.state = 'active';
                    next.granted_token_id = crypto.randomUUID().replaceAll('-', '');
                    next.next_action = 'Your Tower key is active. Preview your home and choose what to share within your confirmed permissions.';
                    statements.push(guard("EXISTS(SELECT 1 FROM tower_reception_cases WHERE id=? AND state='approved' AND approval_expires_at>? AND approval_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND granted_token_id IS NULL)", id, stamp()), guardianIsolation(current.account_id!), ...bindingGuards(current), guard('NOT EXISTS(SELECT 1 FROM tower_reception_cases WHERE token_hash=?)', towerHash), stmt('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)', next.granted_token_id, current.account_id, towerHash, '["tower:read","tower:write"]', current.approval_expires_at, stamp()), audit(next, 'reception-activated'));
                }
                else if (operation === 'withdraw' && !operator || operator && ['reject', 'revoke'].includes(operation)) {
                    if (operation === 'reject' && current.state !== 'pending')
                        reject(409, 'case_state_conflict');
                    next.state = operation === 'withdraw' ? 'withdrawn' : operation === 'reject' ? 'rejected' : 'revoked';
                    next.next_action = 'This case is closed.';
                    if (current.granted_token_id)
                        statements.push(stmt('UPDATE tower_tokens SET revoked=1 WHERE id=? AND account_id=?', current.granted_token_id, current.account_id));
                    if (current.account_id)
                        statements.push(audit(next, 'reception-' + next.state));
                }
                else
                    reject(404, 'not_found');
                return await commit(req, current, operator, rk, operation, inputHash, next, statements, message, operation === 'activate' ? 201 : 200);
            }
            catch (e) {
                if(e instanceof RequestBodyError)return json({error:e.code},e.status);
                if(e instanceof HomeDiscoveryError)return json({error:e.code,nextAction:'Provide your public HTTPS home address. Keep the same case ID and key.'},422);
                if (e instanceof Rejection) {
                    const response = json({ error: e.message }, e.status);
                    if (e.retryAfter !== undefined) response.headers.set('Retry-After', String(e.retryAfter));
                    return response;
                }
                return json({ error: 'case_update_conflict' }, 409);
            }
        } };
    // Once a designated guardian is registered, suspending a key or identity cannot reopen
    // operator takeover. Historical receipts above remain read-only and never mint again.
    function guardianIsolation(account:string){return guard("NOT EXISTS(SELECT 1 FROM agent_identities i JOIN identity_guardians g ON g.agent_id=i.agent_id JOIN identity_guardian_invites v ON v.id=g.invitation_id AND v.agent_id=i.agent_id AND v.state='registered' WHERE i.account_id=?)",account);}
    function bindingGuards(c: Case): Statement[] {
        if (c.request_kind === 'takeover') {
            return [guard('EXISTS(SELECT 1 FROM tower_residencies WHERE account_id=? AND resident_id=? AND source_url=?)', c.account_id, c.resident_id, c.source_url)];
        }
        return [
            guard('NOT EXISTS(SELECT 1 FROM tower_residencies WHERE account_id=? OR resident_id=? OR source_url=?) AND NOT EXISTS(SELECT 1 FROM rooms WHERE account_id=?)', c.account_id, c.resident_id, c.source_url, c.account_id),
            // Tower keys are account-scoped: reserve exactly one approved first placement.
            // This guard runs inside both approval and activation transactions.
            guard(
                "NOT EXISTS(SELECT 1 FROM tower_reception_cases " +
                "WHERE account_id=? AND id<>? AND request_kind='new' " +
                "AND state IN ('approved','active') " +
                "AND approval_expires_at>? AND expires_at>?)",
                c.account_id, c.id, stamp(), stamp(),
            ),
        ];
    }
    function audit(c: Case, action: string) { return stmt('INSERT INTO tower_audit(id,account_id,room_id,action,revision,detail_json,created_at) VALUES(?,?,NULL,?,NULL,?,?)', crypto.randomUUID(), c.account_id, action, JSON.stringify({ caseId: c.id, caseVersion: c.version }), stamp()); }
}
