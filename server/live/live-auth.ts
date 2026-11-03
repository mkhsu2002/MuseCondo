import type { Database, Statement } from './db.ts';
import type { OnboardingGrant, Session, Room } from './live-types.ts';
import { fail, random, digest } from './live-contract.ts';
/** No route knowledge: HTTP composition supplies the explicit onboarding scope. */
export function createLiveAuthorization(env: {
    db: Database;
    origin: string;
    localTest: boolean;
    now: () => Date;
    stamp: () => string;
}) {
    const { db, now, stamp } = env;
    const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).first<T>();
    function sameOrigin(req: Request) {
        if (req.headers.get('Origin') !== env.origin || req.headers.get('Sec-Fetch-Site') === 'cross-site')
            fail(403, 'origin_rejected');
    }
    async function session(req: Request, required = true): Promise<Session | null> {
        const cookie = req.headers.get('Cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith('muse_session='))?.slice(13);
        const s = cookie && /^[a-f0-9]{64}$/.test(cookie) ? await one<Session>('SELECT account_id,csrf,token_hash FROM sessions WHERE token_hash=? AND expires_at>?', await digest(cookie), stamp()) : null;
        if (!s && required)
            fail(401, 'sign_in_required');
        return s || null;
    }
    async function onboardingAgent(req: Request, scope: string) {
        if (req.headers.has('Cookie'))
            fail(403, 'use_separate_agent_authorization');
        if (req.headers.has('Origin') && req.headers.get('Origin') !== env.origin)
            fail(403, 'origin_rejected');
        if (req.headers.get('Sec-Fetch-Site') === 'cross-site')
            fail(403, 'origin_rejected');
        const token = req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        if (!token)
            fail(401, 'onboarding_grant_required');
        const grant = await one<OnboardingGrant>('SELECT id,account_id,scopes,expires_at,revoked FROM onboarding_grants WHERE token_hash=? AND revoked=0 AND expires_at>?', await digest(token!), stamp());
        if (!grant || !JSON.parse(grant.scopes).includes(scope))
            fail(403, 'onboarding_scope_rejected');
        return grant!;
    }
    // SQLite/D1 batch is transactional: a revoked/expired grant aborts every write in this batch.
    async function grantGuard(req: Request, scope: string) {
        const token = req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        if (!token)
            fail(401, 'onboarding_grant_required');
        return db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM onboarding_grants WHERE token_hash=? AND revoked=0 AND expires_at>? AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value=?)) THEN 1 ELSE json('revoked-or-expired-onboarding-grant') END AS authorized").bind(await digest(token!), stamp(), scope);
    }
    async function owner(req: Request, mutate = false, onboardingScope?: string) {
        if (onboardingScope) {
            const grant = await onboardingAgent(req, onboardingScope);
            return {
                account_id: grant.account_id, csrf: '', token_hash: ''
            };
        }
        const s = (await session(req))!;
        if (req.headers.has('Authorization'))
            fail(403, 'use_explicit_agent_route');
        if (mutate) {
            sameOrigin(req);
            if (req.headers.get('X-CSRF-Token') !== s.csrf)
                fail(403, 'csrf_rejected');
        }
        return s;
    }
    async function newSession(accountId: string, expectedLoginHash: string) {
        const token = random(), csrf = random();
        try {
            await db.batch([db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM accounts WHERE id=? AND login_hash=?) THEN 1 ELSE json('account-credential-changed') END").bind(accountId, expectedLoginHash), db.prepare('INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)').bind(await digest(token), accountId, csrf, new Date(now().getTime() + 86400000).toISOString())]);
        }
        catch {
            fail(401, 'invalid_login');
        }
        return { csrf, cookie: `muse_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${env.localTest ? '' : '; Secure'}` };
    }
    function ownerMintGuard(s: Session) {
        return db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND account_id=? AND csrf=? AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE json('owner-session-changed') END").bind(s.token_hash, s.account_id, s.csrf, stamp());
    }
    async function ownerMint(s: Session, rows: Statement[]) {
        try {
            await db.batch([ownerMintGuard(s), ...rows]);
        }
        catch {
            fail(403, 'authorization_changed');
        }
    }
    async function agent(req: Request, roomId: string, scope: string) {
        if (req.headers.has('Cookie'))
            fail(403, 'use_separate_agent_authorization');
        if (req.headers.get('Sec-Fetch-Site') === 'cross-site')
            fail(403, 'origin_rejected');
        const token = req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        if (!token)
            fail(401, 'agent_token_required');
        if (req.headers.has('Origin') && req.headers.get('Origin') !== env.origin)
            fail(403, 'origin_rejected');
        const row = await one<{
            id: string;
            room_id: string;
            scopes: string;
        }>('SELECT id,room_id,scopes FROM agent_tokens WHERE token_hash=? AND revoked=0 AND expires_at>?', await digest(token!), stamp());
        if (!row || row.room_id !== roomId || !JSON.parse(row.scopes).includes(scope))
            fail(403, 'agent_scope_rejected');
        return row!;
    }
    async function roomAgentGuard(req: Request, roomId: string, scope: string) {
        const token = req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
        if (!token)
            fail(401, 'agent_token_required');
        return db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_tokens WHERE token_hash=? AND room_id=? AND revoked=0 AND expires_at>? AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value=?)) THEN 1 ELSE json('revoked-or-expired-room-token') END AS authorized").bind(await digest(token!), roomId, stamp(), scope);
    }
    async function roomWrite(room: Room, statements: Statement[], req?: Request, scopes: string[] = []) {
        try {
            return await db.batch([...(req ? await Promise.all(scopes.map(scope => roomAgentGuard(req, room.id, scope))) : []), ...statements]);
        }
        catch (error) {
            if (req)
                for (const scope of scopes)
                    await agent(req, room.id, scope);
            throw error;
        }
    }
    return {
        sameOrigin, session, onboardingAgent, grantGuard, owner, newSession, ownerMint, agent, roomWrite
    };
}
