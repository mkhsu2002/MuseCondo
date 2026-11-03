import type { Database } from './db.ts';
import type { Identity } from './tower-intake-types.ts';
import { fail } from './tower-contract.ts';
import { hash } from './tower-crypto.ts';
interface AuthorizationEnvironment {
    db: Database;
    origin: string;
    stamp: () => string;
    onProgress?: (accountId: string) => Promise<void>;
}
/** Authorization guard and all command statements share one atomic batch. */
export function createTowerIntakeAuthorization(env: AuthorizationEnvironment) {
    const { db, stamp } = env;
    const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).first<T>();
    async function authenticate(req: Request, delegated: boolean, mutate: boolean, previewSource = false): Promise<Identity> {
        if (req.headers.get("Sec-Fetch-Site") === "cross-site" ||
            (req.headers.has("Origin") && req.headers.get("Origin") !== env.origin))
            fail(403, "origin_rejected");
        if (delegated) {
            if (req.headers.has("Cookie"))
                fail(403, "use_separate_agent_authorization");
            const token = req.headers
                .get("Authorization")
                ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
            if (!token)
                fail(401, "tower_token_required");
            const digest = await hash(token!);
            const sql = "SELECT account_id FROM tower_tokens WHERE token_hash=? AND revoked=0 AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE " + (previewSource ? "value IN (?,'tower:write')" : "value=?") + ")", scope = previewSource ? "tower:read" : mutate ? "tower:write" : "tower:read";
            const row = await one<{
                account_id: string;
            }>(sql, digest, stamp(), scope);
            if (!row)
                fail(403, "tower_scope_rejected");
            return {
                accountId: row!.account_id,
                delegated: true,
                guard: async () => db
                    .prepare("SELECT CASE WHEN EXISTS(" +
                    sql +
                    " AND account_id=?) THEN 1 ELSE json('tower-auth-revoked') END")
                    .bind(digest, stamp(), scope, row!.account_id),
            };
        }
        const cookie = req.headers
            .get("Cookie")
            ?.split(";")
            .map((x) => x.trim())
            .find((x) => x.startsWith("muse_session="))
            ?.slice(13);
        if (!cookie || !/^[a-f0-9]{64}$/.test(cookie))
            fail(401, "sign_in_required");
        const digest = await hash(cookie!), session = await one<{
            account_id: string;
            csrf: string;
        }>("SELECT account_id,csrf FROM sessions WHERE token_hash=? AND expires_at>?", digest, stamp());
        if (!session)
            fail(401, "sign_in_required");
        // The independent operator header is checked only by the server callback. Generic account/agent bearers never mix with cookies.
        if (req.headers.has("Authorization"))
            fail(403, "use_explicit_agent_route");
        if (mutate) {
            if (req.headers.get("Origin") !== env.origin)
                fail(403, "origin_rejected");
            if (req.headers.get("X-CSRF-Token") !== session!.csrf)
                fail(403, "csrf_rejected");
        }
        return {
            accountId: session!.account_id,
            delegated: false,
            guard: async () => db
                .prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND account_id=? AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 ELSE json('tower-session-expired') END")
                .bind(digest, session!.account_id, stamp()),
        };
    }
    async function write(identity: Identity, statements: import("./db.ts").Statement[]) {
        try {
            await db.batch([await identity.guard(), ...statements]);
        }
        catch (error) {
            try {
                await (await identity.guard()).first();
            }
            catch {
                fail(403, "authorization_changed");
            }
            throw error;
        }
        try {
            await env.onProgress?.(identity.accountId);
        }
        catch { /* Committed progress remains dirty for bounded recovery. */
        }
    }
    return { authenticate, write };
}
