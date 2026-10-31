import { digest } from './app.ts';
import type { Database, Statement } from './db.ts';
interface Options {
    db: Database;
    origin: string;
    now?: () => Date;
    operator: (req: Request) => Promise<boolean>;
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
}
class Rejection extends Error {
    status: number;
    constructor(status: number, code: string) { super(code); this.status = status; }
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
const source = (v: unknown) => {
    const s = text(v, 2048);
    try {
        const u = new URL(s);
        if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !u.pathname.endsWith('/condo.json'))
            reject(400, 'invalid_source');
        return u.href;
    }
    catch {
        reject(400, 'invalid_source');
    }
};
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
function safe(c: Case) { return { id: c.id, state: c.state, version: c.version, name: c.name, requestKind: c.request_kind, request: c.request_text, sourceURL: c.source_url, residentId: c.resident_id, authorization: JSON.parse(c.authorization_json), sharing: JSON.parse(c.sharing_json), visitPlan: JSON.parse(c.visit_plan_json), nextAction: c.next_action, expiresAt: c.expires_at, approvalExpiresAt: c.approval_expires_at, createdAt: c.created_at, updatedAt: c.updated_at }; }
/** Private reception. No source fetch, runtime connection, publication, scheduler or paid call. */
export function createTowerReception(env: Options) {
    const { db } = env, now = env.now ?? (() => new Date()), stamp = () => now().toISOString();
    const stmt = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v);
    const one = <T>(sql: string, ...v: unknown[]) => stmt(sql, ...v).first<T>();
    const guard = (sql: string, ...v: unknown[]) => stmt("SELECT CASE WHEN (" + sql + ") THEN 1 ELSE json('reception-conflict') END", ...v);
    async function rate(bucket: string, max: number) {
        const hour = Math.floor(now().getTime() / 3600000), id = 'reception:' + bucket + ':' + hour;
        const r = await stmt('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', id, new Date((hour + 1) * 3600000).toISOString()).first<{
            count: number;
        }>();
        if (!r || r.count > max)
            reject(429, 'rate_limited');
    }
    async function body(req: Request) {
        if (!req.headers.get('Content-Type')?.split(';')[0].trim().match(/^application\/json$/i))
            reject(415, 'json_required');
        if (Number(req.headers.get('Content-Length') ?? 0) > 8192)
            reject(413, 'body_too_large');
        const reader = req.body?.getReader();
        if (!reader)
            reject(400, 'invalid_json');
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
            const p = await reader!.read();
            if (p.done)
                break;
            size += p.value.length;
            if (size > 8192) {
                await reader!.cancel().catch(() => { });
                reject(413, 'body_too_large');
            }
            chunks.push(p.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const c of chunks) {
            bytes.set(c, offset);
            offset += c.length;
        }
        try {
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
        }
        catch {
            reject(400, 'invalid_json');
        }
    }
    function caseGuard(c: Case, operator: boolean) { return guard('EXISTS(SELECT 1 FROM tower_reception_cases WHERE id=? AND version=? AND token_hash=? AND expires_at>? AND state=? AND account_id IS ? AND resident_id IS ? AND source_url IS ? AND approval_expires_at IS ? AND granted_token_id IS ?' + (operator ? '' : " AND state IN ('pending','approved','active')") + ')', c.id, c.version, c.token_hash, stamp(), c.state, c.account_id, c.resident_id, c.source_url, c.approval_expires_at, c.granted_token_id); }
    const event = (id: string, actor: string, kind: string, message: string) => stmt('INSERT INTO tower_reception_events(case_id,sequence,actor,kind,message,created_at) SELECT ?,COALESCE(MAX(sequence),0)+1,?,?,?,? FROM tower_reception_events WHERE case_id=?', id, actor, kind, message, stamp(), id);
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
        return json(JSON.parse(r.response_json), r.response_status);
    }
    async function commit(req: Request, c: Case, operator: boolean, requestKey: string, operation: string, inputHash: string, next: Case, statements: Statement[], message: string, status = 200) {
        if (operator && !await env.operator(req))
            reject(401, 'operator_required');
        const response = { case: safe(next) };
        await db.batch([caseGuard(c, operator), ...(['withdraw', 'revoke', 'reject'].includes(operation) ? [] : [guard('(SELECT COUNT(*) FROM tower_reception_events WHERE case_id=?)<100', c.id)]), ...statements,
            stmt('UPDATE tower_reception_cases SET state=?,version=?,source_url=?,resident_id=?,account_id=?,approval_expires_at=?,granted_token_id=?,visit_plan_json=?,next_action=?,updated_at=? WHERE id=?', next.state, next.version, next.source_url, next.resident_id, next.account_id, next.approval_expires_at, next.granted_token_id, next.visit_plan_json, next.next_action, next.updated_at, next.id),
            event(c.id, operator ? 'operator' : 'applicant', operation, message), stmt('INSERT INTO tower_reception_requests VALUES(?,?,?,?,?,?,?)', c.id, requestKey, operation, inputHash, JSON.stringify(response), status, stamp())]);
        return json(response, status);
    }
    // Operator credentials are checked once at dispatch and again before each commit.
    return { async fetch(req: Request): Promise<Response | null> {
            const url = new URL(req.url), path = url.pathname.replace(/\/$/, ''), match = path.match(/^\/api\/v1\/(operator\/)?reception\/cases(?:\/([a-f0-9]{32})(?:\/(messages|visit-plan|withdraw|approve|reject|revoke|activate))?)?$/);
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
                if (!id) {
                    if (operator) {
                        if (req.method !== 'GET')
                            reject(405, 'method_not_allowed');
                        const rows = (await stmt('SELECT * FROM tower_reception_cases ORDER BY created_at DESC LIMIT 50').all<Case>()).results;
                        return json({ cases: rows.map(safe) });
                    }
                    if (!write)
                        reject(404, 'not_found');
                    await rate('global-open', 100);
                    await rate('ip:' + await digest(req.headers.get('CF-Connecting-IP') ?? 'unknown'), 5);
                    const v = object(await body(req), ['requestKey', 'name', 'requestKind', 'request', 'sourceURL', 'residentId', 'authorization', 'sharing', 'visitPlan']), rk = key(v.requestKey), inputHash = await digest(JSON.stringify(v));
                    const existing = await one<Case>('SELECT * FROM tower_reception_cases WHERE token_hash=?', hash);
                    if (existing) {
                        if (existing.expires_at <= stamp() || ['withdrawn', 'revoked', 'rejected'].includes(existing.state))
                            reject(403, 'case_unavailable');
                        const r = await replay(existing, rk, 'open', inputHash);
                        if (r)
                            return r;
                        reject(409, 'case_key_already_used');
                    }
                    const name = text(v.name, 80), requestText = text(v.request, 1200);
                    if (!['new', 'takeover'].includes(String(v.requestKind)))
                        reject(400, 'invalid_request_kind');
                    const authorization = object(v.authorization, ['contact', 'application', 'towerAccess']);
                    if (Object.keys(authorization).length !== 3 || Object.values(authorization).some(x => x !== true))
                        reject(400, 'authorization_required');
                    const sharing = object(v.sharing, ['snapshot', 'directory', 'announcement', 'dream']);
                    if (Object.keys(sharing).length !== 4 || Object.values(sharing).some(x => x !== false))
                        reject(400, 'sharing_starts_private');
                    const plan = visit(v.visitPlan), sourceURL = v.sourceURL === undefined ? null : source(v.sourceURL)!, residentId = v.residentId === undefined ? null : text(v.residentId, 80);
                    const c: Case = { id: crypto.randomUUID().replaceAll('-', ''), token_hash: hash, state: 'pending', version: 1, name, request_kind: String(v.requestKind), request_text: requestText, source_url: sourceURL, resident_id: residentId, account_id: null, approval_expires_at: null, granted_token_id: null, authorization_json: JSON.stringify(authorization), sharing_json: JSON.stringify(sharing), visit_plan_json: JSON.stringify(plan), next_action: '等待接待回覆，依自己的回訪約定查看本案。', expires_at: new Date(now().getTime() + 90 * 86400000).toISOString(), created_at: stamp(), updated_at: stamp() };
                    const response = { case: safe(c) };
                    await db.batch([guard('(SELECT COUNT(*) FROM tower_reception_cases)<10000'), guard('NOT EXISTS(SELECT 1 FROM tower_tokens WHERE token_hash=?)', hash), stmt('INSERT INTO tower_reception_cases(id,token_hash,state,version,name,request_kind,request_text,source_url,resident_id,account_id,approval_expires_at,granted_token_id,authorization_json,sharing_json,visit_plan_json,next_action,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ...Object.values(c)), event(c.id, 'applicant', 'open', requestText), stmt('INSERT INTO tower_reception_requests VALUES(?,?,?,?,?,?,?)', c.id, rk, 'open', inputHash, JSON.stringify(response), 201, stamp())]);
                    return json(response, 201);
                }
                const c = await one<Case>('SELECT * FROM tower_reception_cases WHERE id=?' + (operator ? '' : ' AND token_hash=?'), ...[id, ...(operator ? [] : [hash])]);
                if (!c)
                    reject(404, 'case_not_found');
                const current = c!;
                if (current.expires_at <= stamp())
                    reject(403, 'case_expired');
                if (!write) {
                    if (operation)
                        reject(404, 'not_found');
                    const after = url.searchParams.get('after') ?? '0';
                    if (!/^\d{1,9}$/.test(after) || [...url.searchParams.keys()].some(k => k !== 'after'))
                        reject(400, 'invalid_cursor');
                    const events = (await stmt('SELECT sequence,actor,kind,message,created_at AS createdAt FROM tower_reception_events WHERE case_id=? AND sequence>? ORDER BY sequence LIMIT 50', id, Number(after)).all()).results;
                    return json({ case: safe(current), events, nextCursor: events.length ? events.at(-1)!.sequence : Number(after) });
                }
                if (!(operator ? ['messages', 'approve', 'reject', 'revoke'] : ['messages', 'visit-plan', 'withdraw', 'activate']).includes(operation))
                    reject(404, 'not_found');
                // A leaked grant must remain revocable even after message quotas are exhausted.
                // Terminal operations are bounded to one persisted transition by state/CAS.
                if (!['withdraw', 'revoke', 'reject'].includes(operation)) {
                    await rate('case:' + id, 20);
                    await rate('global-write', 1000);
                }
                const v = object(await body(req), ['requestKey', 'expectedVersion', ...(operation === 'messages' ? ['message'] : operation === 'visit-plan' ? ['visitPlan'] : operation === 'approve' ? ['accountId', 'residentId', 'sourceURL', 'approvedDays'] : [])]), rk = key(v.requestKey);
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
                if (!Number.isInteger(v.expectedVersion) || v.expectedVersion !== current.version)
                    reject(409, 'case_version_conflict');
                if (['withdrawn', 'rejected', 'revoked'].includes(current.state))
                    reject(409, 'case_closed');
                const next = { ...current, version: current.version + 1, updated_at: stamp() }, statements: Statement[] = [];
                let message = '';
                if (operation === 'messages') {
                    message = text(v.message, 2000);
                    next.next_action = operator ? '接待已有回覆，請查看本案訊息。' : '等待接待回覆，依自己的回訪約定查看本案。';
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
                    next.next_action = '已獲准。請建立自己的住所鑰匙並啟用。';
                    statements.push(guard('EXISTS(SELECT 1 FROM accounts WHERE id=?)', accountId), ...bindingGuards(next), audit(next, 'reception-approved'));
                }
                else if (operation === 'activate' && !operator) {
                    if (current.state !== 'approved' || !current.account_id || !current.approval_expires_at || current.approval_expires_at <= stamp() || current.granted_token_id)
                        reject(409, 'approval_required');
                    next.state = 'active';
                    next.granted_token_id = crypto.randomUUID().replaceAll('-', '');
                    next.next_action = '住所鑰匙已啟用，請依入住指南預覽並另行確認公開。';
                    statements.push(guard("EXISTS(SELECT 1 FROM tower_reception_cases WHERE id=? AND state='approved' AND approval_expires_at>? AND granted_token_id IS NULL)", id, stamp()), ...bindingGuards(current), guard('NOT EXISTS(SELECT 1 FROM tower_reception_cases WHERE token_hash=?)', towerHash), stmt('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)', next.granted_token_id, current.account_id, towerHash, '["tower:read","tower:write"]', current.approval_expires_at, stamp()), audit(next, 'reception-activated'));
                }
                else if (operation === 'withdraw' && !operator || operator && ['reject', 'revoke'].includes(operation)) {
                    if (operation === 'reject' && current.state !== 'pending')
                        reject(409, 'case_state_conflict');
                    next.state = operation === 'withdraw' ? 'withdrawn' : operation === 'reject' ? 'rejected' : 'revoked';
                    next.next_action = '本案已結束。';
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
                if (e instanceof Rejection)
                    return json({ error: e.message }, e.status);
                return json({ error: 'case_update_conflict' }, 409);
            }
        } };
    function bindingGuards(c: Case): Statement[] { return c.request_kind === 'takeover' ? [guard('EXISTS(SELECT 1 FROM tower_residencies WHERE account_id=? AND resident_id=? AND source_url=?)', c.account_id, c.resident_id, c.source_url)] : [guard('NOT EXISTS(SELECT 1 FROM tower_residencies WHERE account_id=? OR resident_id=? OR source_url=?) AND NOT EXISTS(SELECT 1 FROM rooms WHERE account_id=?)', c.account_id, c.resident_id, c.source_url, c.account_id)]; }
    function audit(c: Case, action: string) { return stmt('INSERT INTO tower_audit(id,account_id,room_id,action,revision,detail_json,created_at) VALUES(?,?,NULL,?,NULL,?,?)', crypto.randomUUID(), c.account_id, action, JSON.stringify({ caseId: c.id, caseVersion: c.version }), stamp()); }
}
