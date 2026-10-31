import type { Database, Statement } from './db.ts';
import { signCredential, verifyCredential, validateCredentialPayload, type CredentialPayload, type SignedCredential } from '../../src/identity/index.ts';
import { encryptPrivate, hashIdentityInput, randomIdentityId, validContactKey } from './identity-private.ts';
export interface IdentityCardEnvironment {
    db: Database;
    origin: string;
    contactKey?: string;
    signingKeyId?: string;
    /** Deployment secrets only; neither private JWK nor trust configuration comes from requests. */
    signingPrivateJwk?: string;
    trustedPublicJwks?: string;
    now?: () => Date;
    /** Trusted pure adapter, idempotent by credentialId: resume the same candidate after transport failure.
     * It receives only public signed fields. No paid generation, signer or mail access. I04a has no fallback. */
    renderCard?: (signed: Readonly<SignedCredential>) => Promise<Uint8Array>;
}
interface Authorization {
    accountId: string;
    guard: () => Statement;
}
interface Context {
    agent_id: string;
    account_id: string;
    room_id: string;
    resident_id: string;
    version: number;
    authority_epoch: number;
    guardian_id: string | null;
    guardian_version: number | null;
    invitation_id: string | null;
    recipient_ciphertext: string | null;
    email_hash: string | null;
    residency_revision: number;
}
/** Privacy withdrawal depends only on authority and the permanent residence tuple. */
function contextSnapshot(c: Context, operation: string): string {
    return JSON.stringify(operation === 'issue' ? c : {
        agent_id: c.agent_id, account_id: c.account_id, room_id: c.room_id, resident_id: c.resident_id,
        version: c.version, authority_epoch: c.authority_epoch, residency_revision: c.residency_revision,
    });
}
interface Head {
    revision: number;
    current_credential_id: string | null;
    public_verification_consent: number;
}
interface Card {
    credential_id: string;
    agent_id: string;
    account_id: string;
    revision: number;
    state: string;
    signed_json: string;
    pdf_digest: string;
    json_digest: string;
    pdf_length: number;
    json_length: number;
    pdf_chunks: number;
    json_chunks: number;
    identity_state: string;
    current_credential_id: string | null;
    public_verification_consent: number;
}
interface Input {
    requestKey: string;
    expectedIdentityVersion: number;
    expectedCardRevision: number;
    publicName?: string;
    publicVerificationConsent?: true;
    credentialId?: string;
}
interface Attempt {
    operation: string;
    input_hash: string;
    context_json: string;
    credential_id: string | null;
    signed_json: string | null;
}
interface Receipt {
    operation: string;
    input_hash: string;
    response_json: string;
    status: number;
}
class CardError extends Error {
    readonly status: number;
    constructor(status: number, code: string) { super(code); this.status = status; }
}
function fail(status: number, code: string): never { throw new CardError(status, code); }
const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
const encoder = new TextEncoder();
const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, '0')).join('');
// Keep these limits synchronized with the unexposed 0018 migration; I04b must validate real font/PDF sizes.
const MAX_PDF_BYTES = 8388608, MAX_JSON_BYTES = 16384, ARTIFACT_CHUNK_BYTES = 49152, ARTIFACT_CHUNKS_PER_INSERT = 12;
const idPattern = /^[a-f0-9]{32}$/;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function canonicalKeyBytes(value: unknown): value is string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value))
        return false;
    const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '=');
    return decoded.length === 32 && btoa(decoded).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === value;
}
function parseJwk(value: unknown, privateKey: boolean): JsonWebKey {
    if (!object(value))
        throw new Error('key');
    const allowed = ['kty', 'crv', 'x', 'ext', 'key_ops', 'alg', ...(privateKey ? ['d'] : [])];
    if (Object.keys(value).some(k => !allowed.includes(k)) || value.kty !== 'OKP' || value.crv !== 'Ed25519' || !canonicalKeyBytes(value.x) || value.ext !== undefined && typeof value.ext !== 'boolean' || value.alg !== undefined && !['EdDSA', 'Ed25519'].includes(value.alg as string))
        throw new Error('key');
    if (privateKey && !canonicalKeyBytes(value.d))
        throw new Error('key');
    if (value.key_ops !== undefined && (!Array.isArray(value.key_ops) || value.key_ops.length !== 1 || value.key_ops[0] !== (privateKey ? 'sign' : 'verify')))
        throw new Error('key');
    // Both accepted alg labels describe this curve, but runtimes disagree on the JWK metadata.
    // Import the validated key material with the explicit Ed25519 algorithm without mutating configuration.
    const jwk = { ...value };
    delete jwk.alg;
    return jwk as JsonWebKey;
}
async function trust(env: IdentityCardEnvironment) {
    if (typeof env.trustedPublicJwks !== 'string' || env.trustedPublicJwks.length > 32768)
        throw new Error('keys');
    const raw: unknown = JSON.parse(env.trustedPublicJwks);
    if (!object(raw) || Object.keys(raw).length < 1 || Object.keys(raw).length > 32)
        throw new Error('keys');
    const keys = new Map<string, CryptoKey>(), projection: Record<string, {
        kty: string;
        crv: string;
        x: string;
    }> = Object.create(null) as Record<string, {
        kty: string;
        crv: string;
        x: string;
    }>;
    for (const [id, value] of Object.entries(raw)) {
        if (!keyPattern.test(id))
            throw new Error('keys');
        const jwk = parseJwk(value, false);
        keys.set(id, await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['verify']));
        projection[id] = { kty: 'OKP', crv: 'Ed25519', x: jwk.x! };
    }
    return { keys, projection };
}
async function signer(env: IdentityCardEnvironment) {
    if (!validContactKey(env.contactKey) || !env.renderCard || !keyPattern.test(env.signingKeyId ?? '') || typeof env.signingPrivateJwk !== 'string' || env.signingPrivateJwk.length > 4096)
        throw new Error('configuration');
    const ring = await trust(env), jwk = parseJwk(JSON.parse(env.signingPrivateJwk), true);
    if (ring.projection[env.signingKeyId!]?.x !== jwk.x)
        throw new Error('signer');
    return { privateKey: await crypto.subtle.importKey('jwk', jwk, 'Ed25519', false, ['sign']), ...ring };
}
async function input(request: Request, operation: string): Promise<Input> {
    if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(request.headers.get('Content-Type') ?? ''))
        fail(415, 'json_required');
    const length = request.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192))
        fail(413, 'body_too_large');
    const reader = request.body?.getReader();
    if (!reader)
        fail(400, 'invalid_json');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const p = await reader.read();
            if (p.done)
                break;
            size += p.value.length;
            if (size > 8192) {
                await reader.cancel().catch(() => { });
                fail(413, 'body_too_large');
            }
            chunks.push(p.value);
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
    let v: unknown;
    try {
        v = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    catch {
        fail(400, 'invalid_json');
    }
    const fields = ['requestKey', 'expectedIdentityVersion', 'expectedCardRevision', ...(operation === 'issue' ? ['publicName', 'publicVerificationConsent'] : ['credentialId'])];
    if (!object(v) || Object.keys(v).length !== fields.length || Object.keys(v).some(k => !fields.includes(k)) || typeof v.requestKey !== 'string' || !/^[\x20-\x7e]{8,96}$/.test(v.requestKey) || !Number.isSafeInteger(v.expectedIdentityVersion) || (v.expectedIdentityVersion as number) < 1 || !Number.isSafeInteger(v.expectedCardRevision) || (v.expectedCardRevision as number) < 0)
        fail(400, 'invalid_card_request');
    if (operation === 'issue') {
        const probe: CredentialPayload = { type: 'NeoBabylonAgentIdentity', version: '0.01', issuer: 'https://validation.example', agentId: 'mcid:' + '0'.repeat(64), credentialId: '0'.repeat(32), publicName: v.publicName as string, issuedAt: '2026-01-01T00:00:00.000Z', keyId: 'validation', verificationURL: 'https://validation.example/identity/verify/' + '0'.repeat(32) };
        if (v.publicVerificationConsent !== true || !validateCredentialPayload(probe))
            fail(400, 'invalid_card_request');
    }
    else if (typeof v.credentialId !== 'string' || !idPattern.test(v.credentialId) || (v.expectedCardRevision as number) < 1)
        fail(400, 'invalid_card_request');
    // Fixed property ordering makes equivalent JSON key order the same logical input.
    return { requestKey: v.requestKey, expectedIdentityVersion: v.expectedIdentityVersion as number, expectedCardRevision: v.expectedCardRevision as number, ...(operation === 'issue' ? { publicName: v.publicName as string, publicVerificationConsent: true as const } : { credentialId: v.credentialId as string }) };
}
const metadata = (c: Pick<Card, 'credential_id' | 'revision' | 'state'>) => ({ credentialId: c.credential_id, revision: c.revision, status: c.state === 'issued' ? 'valid' : c.state });
const encode = (v: Uint8Array) => btoa(String.fromCharCode(...v));
function decode(v: string) {
    const bytes = Uint8Array.from(atob(v), c => c.charCodeAt(0));
    if (encode(bytes) !== v)
        throw new Error('artifact');
    return bytes;
}
/** Dormant I04a lifecycle service. All external effects are persisted events; no provider is called. */
export function createIdentityCard(env: IdentityCardEnvironment) {
    const db = env.db, stamp = () => (env.now?.() ?? new Date()).toISOString();
    const one = <T>(sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).first<T>();
    const head = (account: string) => one<Head>('SELECT revision,current_credential_id,public_verification_consent FROM identity_card_heads WHERE account_id=?', account);
    const card = (id: string) => one<Card>(`SELECT c.*,i.state identity_state,h.current_credential_id,h.public_verification_consent FROM identity_credentials c JOIN agent_identities i ON i.agent_id=c.agent_id AND i.account_id=c.account_id LEFT JOIN identity_card_heads h ON h.account_id=c.account_id WHERE c.credential_id=?`, id);
    const contextSql = `SELECT i.agent_id,i.account_id,i.room_id,i.resident_id,i.version,i.authority_epoch,g.guardian_id,g.version guardian_version,g.invitation_id,v.recipient_ciphertext,v.email_hash,t.revision residency_revision FROM agent_identities i JOIN tower_residencies t ON t.account_id=i.account_id AND t.room_id=i.room_id AND t.resident_id=i.resident_id JOIN rooms r ON r.id=i.room_id AND r.account_id=i.account_id LEFT JOIN identity_guardians g ON g.agent_id=i.agent_id LEFT JOIN identity_guardian_invites v ON v.id=g.invitation_id AND v.agent_id=g.agent_id AND v.account_id=i.account_id AND v.state='registered' WHERE i.account_id=?`;
    const configuredSql = contextSql + ` AND i.state='active' AND i.recovery_consent=1 AND EXISTS(SELECT 1 FROM identity_guardian_passkeys p WHERE p.guardian_id=g.guardian_id AND p.agent_id=g.agent_id AND p.revoked_at IS NULL) AND EXISTS(SELECT 1 FROM identity_offline_recovery_codes c WHERE c.agent_id=i.agent_id AND c.authority_epoch=i.authority_epoch AND c.identity_version=i.version AND c.consumed_at IS NULL AND c.confirmed_at IS NOT NULL) AND g.guardian_id IS NOT NULL AND v.id IS NOT NULL`;
    async function authorize(request: Request, scope: string): Promise<Authorization> {
        if (request.headers.has('Cookie'))
            fail(403, 'separate_agent_authorization_required');
        if (request.headers.get('Sec-Fetch-Site') === 'cross-site' || request.headers.has('Origin') && request.headers.get('Origin') !== env.origin)
            fail(403, 'origin_rejected');
        const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        if (!token)
            fail(401, 'tower_token_required');
        const hash = await hashIdentityInput(token), sql = "SELECT account_id FROM tower_tokens WHERE token_hash=? AND revoked=0 AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value=?)";
        const found = await one<{
            account_id: string;
        }>(sql, hash, stamp(), scope);
        if (!found)
            fail(403, 'tower_scope_rejected');
        return { accountId: found.account_id, guard: () => db.prepare("SELECT CASE WHEN EXISTS(" + sql + " AND account_id=?) THEN 1 ELSE json('card-authorization-changed') END").bind(hash, stamp(), scope, found.account_id) };
    }
    async function verify(auth: Authorization) {
        try {
            await auth.guard().first();
        }
        catch {
            fail(403, 'authorization_changed');
        }
    }
    async function finalRead(auth: Authorization) {
        try {
            await db.batch([db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_identities i JOIN tower_residencies t ON t.account_id=i.account_id AND t.room_id=i.room_id AND t.resident_id=i.resident_id JOIN rooms r ON r.id=i.room_id AND r.account_id=i.account_id WHERE i.account_id=?) THEN 1 ELSE json('card-residence-changed') END").bind(auth.accountId), auth.guard()]);
        }
        catch {
            await verify(auth);
            fail(409, 'residency_conflict');
        }
    }
    async function protectMutation(auth: Authorization) {
        // Every authorized mutation HTTP request, including retries, is bounded separately from logical quotas.
        const now = stamp(), key = 'identity-card:http:' + auth.accountId, expiry = new Date(Date.parse(now) + 60000).toISOString();
        try {
            await db.batch([auth.guard(), db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rate_limits WHERE key=? AND expires_at>? AND count>=30) THEN 1 ELSE json('card-http-rate') END").bind(key, now), db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END').bind(key, expiry, now, now)]);
        }
        catch (error) {
            await verify(auth);
            if (await one('SELECT key FROM rate_limits WHERE key=? AND expires_at>? AND count>=30', key, stamp()))
                fail(429, 'card_http_rate_limited');
            throw error;
        }
    }
    async function prior(auth: Authorization, v: Input, operation: string, hash: string) {
        const saved = await one<Receipt>('SELECT operation,input_hash,response_json,status FROM identity_card_requests WHERE account_id=? AND request_key=?', auth.accountId, v.requestKey);
        if (!saved)
            return null;
        if (saved.operation !== operation || saved.input_hash !== hash)
            fail(409, 'idempotency_conflict');
        await finalRead(auth);
        return json(JSON.parse(saved.response_json), saved.status);
    }
    async function reserve(auth: Authorization, v: Input, operation: string, hash: string, c: Context, candidate: SignedCredential | null): Promise<Attempt | Response> {
        const attempt: Attempt = { operation, input_hash: hash, context_json: contextSnapshot(c, operation), credential_id: candidate?.payload.credentialId ?? null, signed_json: candidate ? JSON.stringify(candidate) : null };
        const now = stamp(), expiry = new Date(Date.parse(now) + 3600000).toISOString(), limits: readonly (readonly [
            string,
            number
        ])[] = operation === 'issue' ? [['identity-card:account:' + auth.accountId, 10], ['identity-card:global', 1000]] : [];
        const statements: Statement[] = [auth.guard(), db.prepare('INSERT INTO identity_card_attempts(account_id,request_key,operation,input_hash,context_json,credential_id,signed_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(auth.accountId, v.requestKey, operation, hash, attempt.context_json, attempt.credential_id, attempt.signed_json, now)];
        for (const [key, max] of limits)
            statements.push(db.prepare("SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rate_limits WHERE key=? AND expires_at>? AND count>=?) THEN 1 ELSE json('card-rate-limit') END").bind(key, now, max), db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END').bind(key, expiry, now, now));
        try {
            await db.batch(statements);
        }
        catch (error) {
            await verify(auth);
            const old = await one<Attempt>('SELECT operation,input_hash,context_json,credential_id,signed_json FROM identity_card_attempts WHERE account_id=? AND request_key=?', auth.accountId, v.requestKey);
            if (old) {
                if (old.operation !== operation || old.input_hash !== hash)
                    fail(409, 'idempotency_conflict');
                const saved = await prior(auth, v, operation, hash);
                if (saved)
                    return saved;
                return old;
            }
            for (const [key, max] of limits)
                if (await one('SELECT key FROM rate_limits WHERE key=? AND expires_at>? AND count>=?', key, stamp(), max))
                    fail(429, 'card_rate_limited');
            throw error;
        }
        return attempt;
    }
    function contextGuard(c: Context, v: Input, operation: string) {
        if (operation === 'revoke') {
            return db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_identities i JOIN tower_residencies t ON t.account_id=i.account_id AND t.room_id=i.room_id AND t.resident_id=i.resident_id JOIN rooms r ON r.id=i.room_id AND r.account_id=i.account_id WHERE i.account_id=? AND i.agent_id=? AND i.version=? AND i.authority_epoch=? AND t.revision=? AND i.room_id=? AND i.resident_id=?) AND EXISTS(SELECT 1 FROM identity_card_heads WHERE account_id=? AND revision=? AND current_credential_id=?) THEN 1 ELSE json('card-context-changed') END").bind(c.account_id, c.agent_id, v.expectedIdentityVersion, c.authority_epoch, c.residency_revision, c.room_id, c.resident_id, c.account_id, v.expectedCardRevision, v.credentialId);
        }
        return db.prepare("SELECT CASE WHEN EXISTS(" + configuredSql + " AND i.agent_id=? AND i.version=? AND i.authority_epoch=? AND g.guardian_id IS ? AND g.version IS ? AND g.invitation_id IS ? AND v.recipient_ciphertext IS ? AND v.email_hash IS ? AND t.revision=? AND i.room_id=? AND i.resident_id=?) AND COALESCE((SELECT revision FROM identity_card_heads WHERE account_id=?),0)=? THEN 1 ELSE json('card-context-changed') END").bind(c.account_id, c.agent_id, v.expectedIdentityVersion, c.authority_epoch, c.guardian_id, c.guardian_version, c.invitation_id, c.recipient_ciphertext, c.email_hash, c.residency_revision, c.room_id, c.resident_id, c.account_id, v.expectedCardRevision);
    }
    async function mail(c: Context, credentialId: string, kind: 'identity-card' | 'security-notice', refs: unknown, now: string) {
        const id = randomIdentityId(), payload = await encryptPrivate(env.contactKey!, 'mail-payload', id, JSON.stringify(refs));
        return [db.prepare("INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)").bind(id, kind, credentialId, 'card:' + kind + ':' + credentialId, c.recipient_ciphertext, c.email_hash, payload, now, now), db.prepare("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) VALUES(?,?,'queued','{}',?)").bind(randomIdentityId(), id, now)];
    }
    async function revocationMail(c: Context, credentialId: string, revision: number, now: string) {
        const omission = (action: string) => db.prepare('INSERT INTO identity_audit(id,agent_id,action,detail_json,created_at) VALUES(?,?,?,?,?)').bind(randomIdentityId(), c.agent_id, action, JSON.stringify({ credentialId, revision }), now);
        if (!c.recipient_ciphertext || !c.email_hash || !c.guardian_id || !c.invitation_id)
            return [omission('notification-not-enqueued-no-verified-contact')];
        if (!validContactKey(env.contactKey))
            return [omission('notification-not-enqueued-configuration-unavailable')];
        const id = randomIdentityId(), payload = await encryptPrivate(env.contactKey!, 'mail-payload', id, JSON.stringify({ credentialId, template: 'identity-card-revoked-v1' }));
        // Contact changes never block withdrawal. Only this exact still-verified contact may receive a notice.
        return [
            db.prepare("INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,state,created_at,updated_at) SELECT ?,'security-notice',?,?,?,?,?,'pending',?,? WHERE EXISTS(SELECT 1 FROM identity_guardians g JOIN identity_guardian_invites v ON v.id=g.invitation_id AND v.agent_id=g.agent_id AND v.state='registered' JOIN agent_identities i ON i.agent_id=g.agent_id AND i.account_id=v.account_id WHERE i.agent_id=? AND i.account_id=? AND g.guardian_id=? AND g.version=? AND g.invitation_id=? AND v.recipient_ciphertext=? AND v.email_hash=?)").bind(id, credentialId, 'card:security-notice:' + credentialId, c.recipient_ciphertext, c.email_hash, payload, now, now, c.agent_id, c.account_id, c.guardian_id, c.guardian_version, c.invitation_id, c.recipient_ciphertext, c.email_hash),
            db.prepare("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) SELECT ?,?,'queued','{}',? WHERE EXISTS(SELECT 1 FROM identity_mail_events WHERE id=?)").bind(randomIdentityId(), id, now, id),
            db.prepare("INSERT INTO identity_audit(id,agent_id,action,detail_json,created_at) SELECT ?,?,'notification-not-enqueued-contact-changed',?,? WHERE NOT EXISTS(SELECT 1 FROM identity_mail_events WHERE id=?)").bind(randomIdentityId(), c.agent_id, JSON.stringify({ credentialId, revision }), now, id),
        ];
    }
    function cancelPending(credentialId: string, now: string) { return [db.prepare("INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) SELECT lower(hex(randomblob(16))),id,'cancelled','{\"code\":\"card_no_longer_current\"}',? FROM identity_mail_events WHERE entity_id=? AND kind='identity-card' AND state='pending'").bind(now, credentialId), db.prepare("UPDATE identity_mail_events SET state='cancelled',error_code='card_no_longer_current',updated_at=? WHERE entity_id=? AND kind='identity-card' AND state='pending'").bind(now, credentialId)]; }
    async function perform(auth: Authorization, v: Input, operation: string, hash: string): Promise<Response> {
        const saved = await prior(auth, v, operation, hash);
        if (saved)
            return saved;
        const c = await one<Context>(operation === 'issue' ? configuredSql : contextSql, auth.accountId), h = await head(auth.accountId);
        if (!c || c.version !== v.expectedIdentityVersion || (h?.revision ?? 0) !== v.expectedCardRevision)
            fail(409, 'card_context_conflict');
        if (operation === 'revoke' && (!h?.current_credential_id || h.current_credential_id !== v.credentialId))
            fail(409, 'card_context_conflict');
        if (operation === 'issue' && !validContactKey(env.contactKey))
            fail(503, 'card_configuration_unavailable');
        const signing = operation === 'issue' ? await signer(env) : null;
        let attempt = await one<Attempt>('SELECT operation,input_hash,context_json,credential_id,signed_json FROM identity_card_attempts WHERE account_id=? AND request_key=?', auth.accountId, v.requestKey);
        if (attempt && (attempt.operation !== operation || attempt.input_hash !== hash))
            fail(409, 'idempotency_conflict');
        if (!attempt) {
            let candidate: SignedCredential | null = null;
            if (operation === 'issue') {
                const id = randomIdentityId(), payload: CredentialPayload = { type: 'NeoBabylonAgentIdentity', version: '0.01', issuer: env.origin, agentId: c.agent_id, credentialId: id, publicName: v.publicName!, issuedAt: stamp(), keyId: env.signingKeyId!, verificationURL: env.origin + '/identity/verify/' + id };
                candidate = await signCredential(payload, signing!.privateKey);
                if (!await verifyCredential(candidate, { issuer: env.origin, keys: signing!.keys }))
                    fail(503, 'card_configuration_unavailable');
            }
            const reserved = await reserve(auth, v, operation, hash, c, candidate);
            if (reserved instanceof Response)
                return reserved;
            attempt = reserved;
        }
        // A candidate is bound to the original authority/residence snapshot, even across runtimes.
        if (attempt.context_json !== contextSnapshot(c, operation))
            fail(409, 'card_context_conflict');
        try {
            await contextGuard(c, v, operation).first();
        }
        catch {
            fail(409, 'card_context_conflict');
        }
        const now = stamp(), revision = v.expectedCardRevision + 1, statements: Statement[] = [auth.guard(), contextGuard(c, v, operation)];
        let result: unknown, status: number, auditCredentialId = v.credentialId;
        if (operation === 'issue') {
            const signed: SignedCredential = JSON.parse(attempt.signed_json!), id = attempt.credential_id!;
            if (!await verifyCredential(signed, { issuer: env.origin, keys: signing!.keys }) || signed.payload.credentialId !== id || signed.payload.agentId !== c.agent_id || signed.payload.publicName !== v.publicName)
                fail(503, 'card_configuration_unavailable');
            auditCredentialId = id;
            const jsonBytes = encoder.encode(JSON.stringify(signed));
            const snapshot = Object.freeze({ payload: Object.freeze({ ...signed.payload }), signature: signed.signature });
            const rendered = await env.renderCard!(snapshot);
            if (!(rendered instanceof Uint8Array) || rendered.byteLength < 1 || rendered.byteLength > MAX_PDF_BYTES)
                fail(503, 'card_artifact_unavailable');
            // Copy before any await: adapter-retained buffers cannot change stored bytes or hashes.
            const pdf = Uint8Array.from(rendered), pdfDigest = await digest(pdf), jsonDigest = await digest(jsonBytes);
            if (jsonBytes.length > MAX_JSON_BYTES)
                fail(503, 'card_artifact_unavailable');
            if (h?.current_credential_id) {
                statements.push(db.prepare("UPDATE identity_credentials SET state='superseded',updated_at=? WHERE credential_id=? AND state='issued'").bind(now, h.current_credential_id), ...cancelPending(h.current_credential_id, now), db.prepare("INSERT INTO identity_audit(id,agent_id,action,detail_json,created_at) VALUES(?,?,'card-superseded',?,?)").bind(randomIdentityId(), c.agent_id, JSON.stringify({ credentialId: h.current_credential_id, supersededBy: id, revision }), now));
            }
            statements.push(db.prepare("INSERT INTO identity_credentials(credential_id,agent_id,account_id,revision,state,signed_json,pdf_digest,json_digest,pdf_length,json_length,pdf_chunks,json_chunks,issued_at,updated_at) VALUES(?,?,?,?,'issued',?,?,?,?,?,?,1,?,?)").bind(id, c.agent_id, auth.accountId, revision, new TextDecoder().decode(jsonBytes), pdfDigest, jsonDigest, pdf.length, jsonBytes.length, Math.ceil(pdf.length / ARTIFACT_CHUNK_BYTES), signed.payload.issuedAt, now));
            for (const [kind, bytes] of [['pdf', pdf], ['json', jsonBytes]] as const) {
                for (let start = 0; start < bytes.length; start += ARTIFACT_CHUNK_BYTES * ARTIFACT_CHUNKS_PER_INSERT) {
                    const chunks: string[] = [];
                    for (let i = start; i < Math.min(bytes.length, start + ARTIFACT_CHUNK_BYTES * ARTIFACT_CHUNKS_PER_INSERT); i += ARTIFACT_CHUNK_BYTES)
                        chunks.push(encode(bytes.subarray(i, i + ARTIFACT_CHUNK_BYTES)));
                    // Under 0.8 MiB per bound JSON value; each inserted row remains only 64 KiB.
                    statements.push(db.prepare('INSERT INTO identity_card_artifacts(credential_id,kind,chunk_index,data_base64) SELECT ?,?,CAST(key AS INTEGER)+?,value FROM json_each(?)').bind(id, kind, start / ARTIFACT_CHUNK_BYTES, JSON.stringify(chunks)));
                }
            }
            statements.push(h ? db.prepare('UPDATE identity_card_heads SET revision=?,current_credential_id=?,public_verification_consent=1,updated_at=? WHERE account_id=?').bind(revision, id, now, auth.accountId) : db.prepare('INSERT INTO identity_card_heads(account_id,revision,current_credential_id,public_verification_consent,updated_at) VALUES(?,?,?,1,?)').bind(auth.accountId, revision, id, now));
            statements.push(...await mail(c, id, 'identity-card', { credentialId: id, pdfDigest, jsonDigest, template: 'identity-card-v1' }, now));
            result = { revision, card: { credentialId: id, revision, status: 'valid' } };
            status = 201;
        }
        else {
            statements.push(db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_credentials WHERE credential_id=? AND account_id=? AND state='issued') THEN 1 ELSE json('card-state-changed') END").bind(v.credentialId, auth.accountId), db.prepare("UPDATE identity_credentials SET state='revoked',updated_at=? WHERE credential_id=? AND state='issued'").bind(now, v.credentialId), db.prepare('UPDATE identity_card_heads SET revision=?,current_credential_id=NULL,public_verification_consent=0,updated_at=? WHERE account_id=?').bind(revision, now, auth.accountId), ...cancelPending(v.credentialId!, now));
            statements.push(...await revocationMail(c, v.credentialId!, revision, now));
            result = { revision, card: null, revokedCredentialId: v.credentialId };
            status = 200;
        }
        statements.push(db.prepare('INSERT INTO identity_audit(id,agent_id,action,detail_json,created_at) VALUES(?,?,?,?,?)').bind(randomIdentityId(), c.agent_id, operation === 'issue' ? 'card-issued' : 'card-revoked', JSON.stringify({ revision, credentialId: auditCredentialId }), now), db.prepare('INSERT INTO identity_card_requests(account_id,request_key,operation,input_hash,response_json,status,created_at) VALUES(?,?,?,?,?,?,?)').bind(auth.accountId, v.requestKey, operation, hash, JSON.stringify(result), status, now));
        // Recreate the final bearer guard after rendering/encryption, then check it last in the transaction too.
        statements.push(auth.guard());
        try {
            await db.batch(statements);
        }
        catch (error) {
            await verify(auth);
            const replay = await prior(auth, v, operation, hash);
            if (replay)
                return replay;
            try {
                await contextGuard(c, v, operation).first();
            }
            catch {
                fail(409, 'card_context_conflict');
            }
            throw error;
        }
        await finalRead(auth);
        return json(result, status);
    }
    const inFlight = new Map<string, {
        hash: string;
        operation: string;
        promise: Promise<Response>;
    }>();
    async function mutate(auth: Authorization, v: Input, operation: string) {
        const hash = await hashIdentityInput(JSON.stringify(v)), key = auth.accountId + ':' + v.requestKey, live = inFlight.get(key);
        if (live) {
            if (live.hash !== hash || live.operation !== operation)
                fail(409, 'idempotency_conflict');
            await live.promise.catch(() => { });
            const saved = await prior(auth, v, operation, hash);
            if (saved)
                return saved;
            await verify(auth);
            fail(409, 'card_outcome_unknown');
        }
        const promise = perform(auth, v, operation, hash);
        inFlight.set(key, { hash, operation, promise });
        try {
            return await promise;
        }
        finally {
            inFlight.delete(key);
        }
    }
    async function artifact(c: Card, kind: 'pdf' | 'json') {
        const rows = await db.prepare('SELECT chunk_index,data_base64 FROM identity_card_artifacts WHERE credential_id=? AND kind=? ORDER BY chunk_index').bind(c.credential_id, kind).all<{
            chunk_index: number;
            data_base64: string;
        }>();
        if (rows.results.length !== c[kind + '_chunks' as 'pdf_chunks' | 'json_chunks'])
            throw new Error('artifact');
        const bytes = new Uint8Array(c[kind + '_length' as 'pdf_length' | 'json_length']);
        let offset = 0;
        for (const [i, r] of rows.results.entries()) {
            if (r.chunk_index !== i)
                throw new Error('artifact');
            const b = decode(r.data_base64);
            if (b.length !== Math.min(ARTIFACT_CHUNK_BYTES, bytes.length - offset))
                throw new Error('artifact');
            bytes.set(b, offset);
            offset += b.length;
        }
        if (offset !== bytes.length || await digest(bytes) !== c[kind + '_digest' as 'pdf_digest' | 'json_digest'])
            throw new Error('artifact');
        if (kind === 'json' && new TextDecoder().decode(bytes) !== c.signed_json)
            throw new Error('artifact');
        return bytes;
    }
    const publicStatus = (c: Card) => c.state !== 'issued' ? c.state : c.identity_state !== 'active' ? 'suspended' : c.public_verification_consent !== 1 ? 'withdrawn' : c.current_credential_id !== c.credential_id ? 'superseded' : 'valid';
    async function publicVerify(id: string) {
        const c = await card(id);
        if (!c)
            fail(404, 'credential_not_found');
        let status = publicStatus(c);
        if (status !== 'valid')
            return json({ credentialId: id, status });
        const ring = await trust(env), signed: unknown = JSON.parse(c.signed_json);
        if (!await verifyCredential(signed, { issuer: env.origin, keys: ring.keys }) || (signed as SignedCredential).payload.credentialId !== id || (signed as SignedCredential).payload.agentId !== c.agent_id || await digest(encoder.encode(c.signed_json)) !== c.json_digest)
            fail(503, 'credential_verification_unavailable');
        // Last database read occurs after crypto. A suspended/revoked/withdrawn credential never exposes names.
        const latest = await card(id);
        if (!latest)
            fail(404, 'credential_not_found');
        status = publicStatus(latest);
        if (status !== 'valid')
            return json({ credentialId: id, status });
        if (latest.signed_json !== c.signed_json || latest.json_digest !== c.json_digest)
            fail(503, 'credential_verification_unavailable');
        const credential = signed as SignedCredential;
        return json({ credentialId: id, status: 'valid', publicName: credential.payload.publicName, agentId: credential.payload.agentId, signedCredential: credential });
    }
    return { async fetch(request: Request): Promise<Response | null> {
            const url = new URL(request.url), path = url.pathname, privateBase = '/api/v1/agent/identity/card';
            const privateArtifact = path.match(/^\/api\/v1\/agent\/identity\/card\/([a-f0-9]{32})\/(pdf|json)$/), publicMatch = path.match(/^\/api\/v1\/identity\/verify\/([a-f0-9]{32})$/);
            const operation = path === privateBase + '/issue' ? 'issue' : path === privateBase + '/revoke' ? 'revoke' : null;
            if (path !== privateBase && !operation && !privateArtifact && !publicMatch && path !== '/api/v1/identity/keys')
                return null;
            try {
                if (url.origin !== env.origin || !/^https:\/\//.test(env.origin) || new URL(env.origin).origin !== env.origin)
                    fail(403, 'host_rejected');
                if (url.search)
                    fail(400, 'query_not_supported');
                if (request.method !== (operation ? 'POST' : 'GET'))
                    fail(405, 'method_not_allowed');
                if (publicMatch)
                    return await publicVerify(publicMatch[1]);
                if (path === '/api/v1/identity/keys')
                    return json({ issuer: env.origin, keys: (await trust(env)).projection });
                const auth = await authorize(request, operation ? 'tower:write' : 'tower:read');
                if (operation) {
                    await protectMutation(auth);
                    return await mutate(auth, await input(request, operation), operation);
                }
                if (privateArtifact) {
                    const c = await card(privateArtifact[1]);
                    if (!c || c.account_id !== auth.accountId)
                        fail(404, 'credential_not_found');
                    const kind = privateArtifact[2] as 'pdf' | 'json', bytes = await artifact(c, kind);
                    await finalRead(auth);
                    return new Response(bytes, { headers: { ...headers, 'Content-Type': kind === 'pdf' ? 'application/pdf' : 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + (kind === 'pdf' ? 'agent-identity-card.pdf' : 'agent-identity-credential.json') + '"', 'Content-Length': String(bytes.length) } });
                }
                const h = await head(auth.accountId), c = h?.current_credential_id ? await card(h.current_credential_id) : null;
                await finalRead(auth);
                return json({ revision: h?.revision ?? 0, card: c ? metadata(c) : null });
            }
            catch (error) {
                return error instanceof CardError ? json({ error: error.message }, error.status) : json({ error: 'card_operation_unavailable' }, 503);
            }
        } };
}
