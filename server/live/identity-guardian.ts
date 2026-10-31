import type { Database, Statement } from './db.ts';
import { createIdentityMail, type IdentityMailEnvironment } from './identity-mail.ts';
import { decryptPrivate, encryptPrivate, hashIdentityInput, hashPrivate, maskGuardianEmail, randomIdentityId, randomIdentitySecret, validContactKey, validateGuardianEmail } from './identity-private.ts';
interface Environment extends IdentityMailEnvironment {
    operator: (request: Request) => Promise<boolean>;
    onMailEvent?: (eventId: string) => void | Promise<void>;
}
interface Identity {
    agent_id: string;
    account_id: string;
    room_id: string;
    resident_id: string;
    version: number;
    authority_epoch: number;
    state: string;
    recovery_consent: number;
}
interface Invitation {
    id: string;
    agent_id: string;
    account_id: string;
    version: number;
    identity_version: number;
    authority_epoch: number;
    state: string;
    recipient_ciphertext: string;
    email_hash: string;
    invite_token_hash: string | null;
    expires_at: string;
    created_at: string;
}
interface Authorization {
    scope: string;
    accountId?: string;
    guard?: () => Statement;
    verify: () => Promise<void>;
}
class Rejection extends Error {
    readonly status: number;
    constructor(status: number, code: string) { super(code); this.status = status; }
}
function fail(status: number, code: string): never { throw new Rejection(status, code); }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } });
async function input(request: Request, keys: string[]): Promise<Record<string, unknown>> {
    if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(request.headers.get('Content-Type') ?? ''))
        fail(415, 'json_required');
    const length = request.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > 16384))
        fail(413, 'body_too_large');
    const reader = request.body?.getReader();
    if (!reader)
        fail(400, 'invalid_json');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const part = await reader.read();
            if (part.done)
                break;
            size += part.value.length;
            if (size > 16384) {
                await reader.cancel().catch(() => { });
                fail(413, 'body_too_large');
            }
            chunks.push(part.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
    }
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    catch {
        fail(400, 'invalid_json');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k)))
        fail(400, 'invalid_guardian_request');
    const v = value as Record<string, unknown>;
    if (keys.includes('requestKey') && (typeof v.requestKey !== 'string' || !/^[\x20-\x7e]{8,96}$/.test(v.requestKey)))
        fail(400, 'invalid_request_key');
    if (keys.includes('expectedVersion') && (!Number.isSafeInteger(v.expectedVersion) || (v.expectedVersion as number) < 1))
        fail(400, 'invalid_expected_version');
    return v;
}
/** Private first-guardian agreement. Email confirmation never grants Tower authority. */
export function createIdentityGuardian(env: Environment) {
    const db: Database = env.db, stamp = () => (env.now?.() ?? new Date()).toISOString(), mail = createIdentityMail(env);
    const stmt = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
    const one = <T>(sql: string, ...args: unknown[]) => stmt(sql, ...args).first<T>();
    function transport(request: Request) { if (new URL(request.url).origin !== env.origin)
        fail(403, 'host_rejected'); if (request.headers.has('Cookie') || request.headers.get('Sec-Fetch-Site') === 'cross-site' || request.headers.has('Origin') && request.headers.get('Origin') !== env.origin)
        fail(403, 'origin_rejected'); }
    async function authorize(request: Request, isOperator: boolean, write: boolean): Promise<Authorization> {
        if (isOperator) {
            const verify = async () => { if (!await env.operator(request))
                fail(401, 'operator_required'); };
            await verify();
            return { scope: 'operator:guardian', verify };
        }
        const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        if (!token)
            fail(401, 'tower_token_required');
        const digest = await hashIdentityInput(token), scope = write ? 'tower:write' : 'tower:read', sql = "SELECT account_id FROM tower_tokens WHERE token_hash=? AND revoked=0 AND expires_at>? AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value=?)";
        const found = await one<{
            account_id: string;
        }>(sql, digest, stamp(), scope);
        if (!found)
            fail(403, 'tower_scope_rejected');
        const guard = () => stmt("SELECT CASE WHEN EXISTS(" + sql + " AND account_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE json('guardian-authorization-changed') END", digest, stamp(), scope, found.account_id);
        const verify = async () => { try {
            await guard().first();
        }
        catch {
            fail(403, 'authorization_changed');
        } };
        return { scope: 'agent:' + found.account_id, accountId: found.account_id, guard, verify };
    }
    async function batch(auth: Authorization, statements: Statement[]) { await auth.verify(); try {
        await db.batch([...(auth.guard ? [auth.guard()] : []), ...statements]);
    }
    catch (error) {
        await auth.verify();
        throw error;
    } }
    // Only committed, scoped results supply the ID. Delivery failure cannot undo the agreement.
    async function dispatch(auth: Authorization, operation: string, status: number, result: { invitation?: { id?: unknown }; mailEvent?: { id?: unknown } }) {
        if (!env.onMailEvent || operation !== 'accept' || status !== 200 || typeof result?.mailEvent?.id !== 'string' || typeof result?.invitation?.id !== 'string') return;
        try {
            const found = await one<{ id: string }>("SELECT e.id FROM identity_mail_events e JOIN identity_guardian_invites g ON g.id=e.entity_id WHERE e.id=? AND e.kind='guardian-invitation' AND g.id=? AND g.account_id=? AND e.dedupe_key='guardian-invitation:'||g.id||':'||g.email_hash LIMIT 1", result.mailEvent.id, result.invitation.id, auth.accountId);
            if (found) await env.onMailEvent(found.id);
        } catch { /* The committed event remains available to protected recovery. */ }
    }
    async function prior(auth: Authorization, key: string, operation: string, digest: string) {
        const receipt = await one<{
            operation: string;
            input_hash: string;
            response_json: string;
            status: number;
        }>('SELECT operation,input_hash,response_json,status FROM guardian_invite_requests WHERE scope=? AND request_key=?', auth.scope, key);
        if (!receipt)
            return null;
        if (receipt.operation !== operation || receipt.input_hash !== digest)
            fail(409, 'idempotency_conflict');
        await auth.verify();
        const result = JSON.parse(receipt.response_json);
        await dispatch(auth, receipt.operation, receipt.status, result);
        return json(result, receipt.status);
    }
    async function rate(auth: Authorization, key: string, digest: string) {
        const now = stamp(), expires = new Date(Date.parse(now) + 3600000).toISOString(), limits = [['guardian:' + auth.scope, 20], ['guardian:global', 1000]] as const;
        const rows: Statement[] = [stmt('INSERT INTO guardian_invite_rate_attempts(scope,request_key,input_hash,created_at) VALUES(?,?,?,?)', auth.scope, key, digest, now)];
        for (const [bucket, max] of limits)
            rows.push(stmt("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rate_limits WHERE key=? AND expires_at>? AND count>=?) THEN 1 ELSE json('guardian-rate-limit') END", bucket, now, max), stmt('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END', bucket, expires, now, now));
        try {
            await batch(auth, rows);
        }
        catch (error) {
            if (error instanceof Rejection)
                throw error;
            const reserved = await one<{
                input_hash: string;
            }>('SELECT input_hash FROM guardian_invite_rate_attempts WHERE scope=? AND request_key=?', auth.scope, key);
            if (reserved) {
                await auth.verify();
                if (reserved.input_hash !== digest)
                    fail(409, 'idempotency_conflict');
                return;
            }
            for (const [bucket, max] of limits)
                if (await one('SELECT 1 FROM rate_limits WHERE key=? AND expires_at>? AND count>=?', bucket, stamp(), max))
                    fail(429, 'guardian_rate_limited');
            throw error;
        }
    }
    const identity = (agent: string) => one<Identity>('SELECT * FROM agent_identities WHERE agent_id=?', agent);
    function identityGuard(i: Identity) { return stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_identities i JOIN tower_residencies t ON t.account_id=i.account_id AND t.room_id=i.room_id AND t.resident_id=i.resident_id JOIN rooms r ON r.id=i.room_id AND r.account_id=i.account_id WHERE i.agent_id=? AND i.account_id=? AND i.room_id=? AND i.resident_id=? AND i.version=? AND i.authority_epoch=? AND i.state='provisional' AND i.recovery_consent=1) THEN 1 ELSE json('guardian-identity-conflict') END", i.agent_id, i.account_id, i.room_id, i.resident_id, i.version, i.authority_epoch); }
    async function checkIdentity(i: Identity) { try {
        await identityGuard(i).first();
    }
    catch {
        fail(409, 'identity_conflict');
    } }
    function inviteGuard(g: Invitation, expires: boolean) { return stmt("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_guardian_invites WHERE id=? AND agent_id=? AND account_id=? AND version=? AND identity_version=? AND authority_epoch=? AND state=?" + (expires ? " AND created_at<=? AND created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')" : '') + ") THEN 1 ELSE json('guardian-invitation-conflict') END", g.id, g.agent_id, g.account_id, g.version, g.identity_version, g.authority_epoch, g.state, ...(expires ? [stamp(), stamp()] : [])); }
    async function metadata(g: Invitation) { const email = validateGuardianEmail(await decryptPrivate(env.contactKey!, 'guardian-recipient', g.agent_id, g.recipient_ciphertext)); if (await hashPrivate(env.contactKey!, 'guardian-email', email) !== g.email_hash)
        fail(503, 'private_contact_unavailable'); return { id: g.id, state: g.state, version: g.version, expectedIdentityVersion: g.identity_version, maskedEmail: maskGuardianEmail(email), expiresAt: g.expires_at }; }
    const receipt = (auth: Authorization, key: string, operation: string, digest: string, result: unknown, status: number) => stmt('INSERT INTO guardian_invite_requests(scope,request_key,operation,input_hash,response_json,status,created_at) VALUES(?,?,?,?,?,?,?)', auth.scope, key, operation, digest, JSON.stringify(result), status, stamp());
    const audit = (agent: string, action: string, id: string) => stmt('INSERT INTO identity_audit(id,agent_id,action,detail_json,created_at) VALUES(?,?,?,?,?)', randomIdentityId(), agent, action, JSON.stringify({ invitationId: id }), stamp());
    const advance = (i: Identity) => stmt('UPDATE agent_identities SET version=version+1,updated_at=? WHERE agent_id=? AND version=?', stamp(), i.agent_id, i.version);
    return { async fetch(request: Request): Promise<Response | null> {
            const path = new URL(request.url).pathname, operator = path.startsWith('/api/v1/operator/'), proposal = path === '/api/v1/operator/identity/guardian-invitations', list = path === '/api/v1/agent/identity/guardian-invitations', accept = path.match(/^\/api\/v1\/agent\/identity\/guardian-invitations\/([a-f0-9]{32})\/accept$/), cancel = path.match(/^\/api\/v1\/operator\/identity\/guardian-invitations\/([a-f0-9]{32})\/cancel$/), mailRoute = path.match(/^\/api\/v1\/operator\/identity\/mail\/([a-f0-9]{32})(\/process)?$/);
            if (!proposal && !list && !accept && !cancel && !mailRoute)
                return null;
            try {
                transport(request);
                const method = list || mailRoute && !mailRoute[2] ? 'GET' : 'POST';
                if (request.method !== method)
                    fail(405, 'method_not_allowed');
                const auth = await authorize(request, operator, method === 'POST');
                if (mailRoute) {
                    if (mailRoute[2] && request.body)
                        await input(request, []);
                    await auth.verify();
                    const status = mailRoute[2] ? await mail.processOne(mailRoute[1]) : await mail.status(mailRoute[1]);
                    if (!status)
                        fail(404, 'mail_event_not_found');
                    return json(status);
                }
                if (list) {
                    const rows = (await stmt('SELECT g.* FROM identity_guardian_invites g JOIN agent_identities i ON i.agent_id=g.agent_id AND i.account_id=g.account_id WHERE g.account_id=? ORDER BY g.created_at DESC,g.id DESC LIMIT 20', auth.accountId).all<Invitation>()).results;
                    const invitations = await Promise.all(rows.map(metadata));
                    await auth.verify();
                    return json({ invitations });
                }
                const v = await input(request, proposal ? ['requestKey', 'agentId', 'expectedVersion', 'email', 'attestGuardianDesignated'] : cancel ? ['requestKey', 'expectedVersion'] : ['requestKey', 'expectedVersion', 'guardianConsent']);
                if (proposal && (typeof v.agentId !== 'string' || !/^mcid:[a-f0-9]{64}$/.test(v.agentId) || v.attestGuardianDesignated !== true) || accept && v.guardianConsent !== true)
                    fail(400, 'invalid_guardian_consent');
                let email: string | undefined;
                if (proposal)
                    try {
                        email = validateGuardianEmail(v.email);
                    }
                    catch {
                        fail(400, 'invalid_guardian_email');
                    }
                if (!validContactKey(env.contactKey))
                    fail(503, 'identity_contact_not_configured');
                const key = v.requestKey as string, operation = proposal ? 'propose' : cancel ? 'cancel' : 'accept', id = accept?.[1] ?? cancel?.[1], digest = await hashPrivate(env.contactKey, 'guardian-request', JSON.stringify({ operation, id: id ?? null, requestKey: v.requestKey, expectedVersion: v.expectedVersion, ...(proposal ? {agentId: v.agentId, email: v.email, attestGuardianDesignated: v.attestGuardianDesignated} : accept ? {guardianConsent: v.guardianConsent} : {}) }));
                const replay = await prior(auth, key, operation, digest);
                if (replay)
                    return replay;
                if (accept && !mail.configured())
                    fail(503, 'identity_mail_not_configured');
                await rate(auth, key, digest);
                if (proposal) {
                    const i = await identity(v.agentId as string);
                    if (!i)
                        fail(404, 'identity_not_found');
                    if (i.version !== v.expectedVersion)
                        fail(409, 'identity_conflict');
                    await checkIdentity(i);
                    if (await one("SELECT 1 FROM identity_guardian_invites WHERE agent_id=? AND state IN ('proposed','accepted','registered')", i.agent_id))
                        fail(409, 'guardian_already_designated');
                    const created = stamp(), g: Invitation = { id: randomIdentityId(), agent_id: i.agent_id, account_id: i.account_id, version: 1, identity_version: i.version + 1, authority_epoch: i.authority_epoch, state: 'proposed', recipient_ciphertext: await encryptPrivate(env.contactKey, 'guardian-recipient', i.agent_id, email!), email_hash: await hashPrivate(env.contactKey, 'guardian-email', email!), invite_token_hash: null, expires_at: new Date(Date.parse(created) + 86400000).toISOString(), created_at: created };
                    const result = { invitation: await metadata(g), identityVersion: g.identity_version };
                    try {
                        await batch(auth, [identityGuard(i), stmt("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM identity_guardian_invites WHERE agent_id=? AND state IN ('proposed','accepted','registered')) THEN 1 ELSE json('guardian-already-designated') END", i.agent_id), advance(i), stmt("INSERT INTO identity_guardian_invites(id,agent_id,account_id,version,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,expires_at,created_at,updated_at) VALUES(?,?,?,1,?,?,'proposed',?,?,?,?,?)", g.id, g.agent_id, g.account_id, g.identity_version, g.authority_epoch, g.recipient_ciphertext, g.email_hash, g.expires_at, created, created), audit(i.agent_id, 'guardian-proposed', g.id), receipt(auth, key, operation, digest, result, 201)]);
                    }
                    catch (error) {
                        if (error instanceof Rejection)
                            throw error;
                        const replay = await prior(auth, key, operation, digest);
                        if (replay)
                            return replay;
                        await checkIdentity(i);
                        if (await one("SELECT 1 FROM identity_guardian_invites WHERE agent_id=? AND state IN ('proposed','accepted','registered')", i.agent_id))
                            fail(409, 'guardian_already_designated');
                        throw error;
                    }
                    return json(result, 201);
                }
                const g = await one<Invitation>('SELECT * FROM identity_guardian_invites WHERE id=?' + (operator ? '' : ' AND account_id=?'), id, ...(operator ? [] : [auth.accountId]));
                if (!g)
                    fail(404, 'invitation_not_found');
                if (g.version !== v.expectedVersion || accept && g.state !== 'proposed' || cancel && !['proposed', 'accepted'].includes(g.state))
                    fail(409, 'invitation_conflict');
                const i = await identity(g.agent_id);
                if (!i || i.account_id !== g.account_id || i.version !== g.identity_version || i.authority_epoch !== g.authority_epoch)
                    fail(409, 'identity_conflict');
                await checkIdentity(i);
                try {
                    await inviteGuard(g, !!accept).first();
                }
                catch {
                    fail(409, 'invitation_conflict');
                }
                const updated = { ...g, version: g.version + 1, identity_version: i.version + 1, state: cancel ? 'cancelled' : 'accepted' }, event = accept ? randomIdentityId() : null, token = accept ? randomIdentitySecret() : null;
                const tokenHash = token ? await hashPrivate(env.contactKey, 'guardian-confirmation:' + g.id, token) : null, payload = event ? await encryptPrivate(env.contactKey, 'mail-payload', event, JSON.stringify({ token })) : null;
                const result = { invitation: await metadata(updated), identityVersion: updated.identity_version, ...(event ? { mailEvent: { id: event, state: 'pending' } } : {}) };
                const rows = [identityGuard(i), inviteGuard(g, !!accept), advance(i), stmt('UPDATE identity_guardian_invites SET state=?,version=version+1,identity_version=?,invite_token_hash=?,updated_at=? WHERE id=? AND version=?', updated.state, updated.identity_version, tokenHash, stamp(), g.id, g.version), audit(i.agent_id, cancel ? 'guardian-cancelled' : 'guardian-accepted', g.id)];
                if (event)
                    rows.push(stmt("INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,state,created_at,updated_at) VALUES(?,'guardian-invitation',?,?,?,?,?,'pending',?,?)", event, g.id, 'guardian-invitation:' + g.id + ':' + g.email_hash, g.recipient_ciphertext, g.email_hash, payload, stamp(), stamp()), stmt("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) VALUES(?,?,'enqueued','{}',?)", randomIdentityId(), event, stamp()));
                else
                    rows.push(stmt("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) SELECT lower(hex(randomblob(16))),id,'cancelled','{}',? FROM identity_mail_events WHERE kind='guardian-invitation' AND entity_id=? AND state='pending'", stamp(), g.id), stmt("UPDATE identity_mail_events SET state='cancelled',error_code='invitation_cancelled',updated_at=? WHERE kind='guardian-invitation' AND entity_id=? AND state='pending'", stamp(), g.id));
                rows.push(receipt(auth, key, operation, digest, result, 200));
                try {
                    await batch(auth, rows);
                }
                catch (error) {
                    if (error instanceof Rejection)
                        throw error;
                    const replay = await prior(auth, key, operation, digest);
                    if (replay)
                        return replay;
                    await checkIdentity(i);
                    try {
                        await inviteGuard(g, !!accept).first();
                    }
                    catch {
                        fail(409, 'invitation_conflict');
                    }
                    throw error;
                }
                await dispatch(auth, operation, 200, result);
                return json(result);
            }
            catch (error) {
                return error instanceof Rejection ? json({ error: error.message }, error.status) : json({ error: 'guardian_operation_unavailable' }, 503);
            }
        } };
}
