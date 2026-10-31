import type { Database, Statement } from "./db.ts";
import {
  hashIdentityInput,
  hashPrivate,
  randomIdentityId,
  validContactKey,
} from "./identity-private.ts";
import {
  registrationOptions,
  verifyGuardianRegistration,
} from "./identity-webauthn.ts";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
interface Environment {
  db: Database;
  origin: string;
  contactKey?: string;
  now?: () => Date;
}
interface Invite {
  id: string;
  agent_id: string;
  account_id: string;
  version: number;
  identity_version: number;
  authority_epoch: number;
  invite_token_hash: string;
  state: string;
  created_at: string;
  expires_at: string;
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
  home_name: string;
}
interface Challenge {
  challenge_id: string;
  operation: string;
  invitation_id: string;
  agent_id: string;
  invitation_version: number;
  identity_version: number;
  authority_epoch: number;
  invite_token_hash: string;
  rp_id: string;
  origin: string;
  options_json: string;
  request_key: string;
  input_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}
class Rejection extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}
function fail(status: number, code: string): never {
  throw new Rejection(status, code);
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
const ordered = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(ordered)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, ordered(x)]),
        )
      : v;
async function input(request: Request, complete: boolean) {
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
      request.headers.get("Content-Type") ?? "",
    )
  )
    fail(415, "json_required");
  const length = request.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 32768))
    fail(413, "body_too_large");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "invalid_json");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 32768) {
        await reader.cancel().catch(() => {});
        fail(413, "body_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
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
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(400, "invalid_json");
  }
  const keys = [
    "requestKey",
    "invitationId",
    "confirmationCode",
    ...(complete
      ? ["challengeId", "response", "offlineRecoveryCode", "backupConfirmed"]
      : []),
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    fail(400, "invalid_registration_request");
  const v = value as Record<string, unknown>;
  if (
    typeof v.requestKey !== "string" ||
    !/^[\x20-\x7e]{8,96}$/.test(v.requestKey) ||
    typeof v.invitationId !== "string" ||
    !/^[a-f0-9]{32}$/.test(v.invitationId) ||
    typeof v.confirmationCode !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.confirmationCode)
  )
    fail(400, "invalid_registration_request");
  if (
    complete &&
    (typeof v.challengeId !== "string" ||
      !/^[a-f0-9]{32}$/.test(v.challengeId) ||
      typeof v.offlineRecoveryCode !== "string" ||
      !/^[a-f0-9]{64}$/.test(v.offlineRecoveryCode) ||
      v.backupConfirmed !== true ||
      !v.response ||
      typeof v.response !== "object" ||
      Array.isArray(v.response))
  )
    fail(400, "invalid_registration_request");
  return v as {
    requestKey: string;
    invitationId: string;
    confirmationCode: string;
    challengeId: string;
    offlineRecoveryCode: string;
    backupConfirmed: true;
    response: unknown;
  };
}
/** Confirmation codes only bootstrap the designated first guardian. No Tower/session authority. */
export function createIdentityRegistration(env: Environment) {
  const db = env.db,
    stamp = () => (env.now?.() ?? new Date()).toISOString();
  const stmt = (sql: string, ...args: unknown[]) =>
      db.prepare(sql).bind(...args),
    one = <T>(sql: string, ...args: unknown[]) => stmt(sql, ...args).first<T>();
  const challenge = (id: string) =>
    one<Challenge>(
      "SELECT * FROM identity_guardian_challenges WHERE challenge_id=?",
      id,
    );
  const scope = (g: Invite) => "registration:" + g.id;
  async function digest(value: unknown) {
    return hashPrivate(
      env.contactKey!,
      "guardian-registration-request",
      JSON.stringify(ordered(value)),
    );
  }
  /** Shared HTTP protection before parsing or confirmation checks. Cloudflare supplies the
   * production IP header; this bounded per-IP bucket is not distributed DoS protection. */
  async function throttle(request: Request) {
    const supplied = request.headers.get("CF-Connecting-IP"),
      ip = supplied && supplied.length <= 64 ? supplied : "unknown",
      fingerprint = await hashPrivate(env.contactKey!, "registration-ip", ip);
    // One fixed private bucket per IP, with the native clock evaluated in the atomic UPSERT.
    // The outer strftime preserves native calendar arithmetic in injected-clock tests too.
    const bucket = await one<{ count: number }>(
      "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,strftime('%Y-%m-%dT%H:%M:%fZ',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'+60 seconds')) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN strftime('%Y-%m-%dT%H:%M:%fZ',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'+60 seconds') ELSE expires_at END RETURNING count",
      "registration:http-ip:" + fingerprint,
    );
    if (!bucket || !Number.isSafeInteger(bucket.count))
      fail(503, "identity_registration_unavailable");
    if (bucket.count > 30) fail(429, "registration_http_rate_limited");
  }
  function inviteGuard(g: Invite, i: Identity): Statement {
    return stmt(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_guardian_invites g JOIN agent_identities i ON i.agent_id=g.agent_id AND i.account_id=g.account_id JOIN tower_residencies t ON t.account_id=i.account_id AND t.room_id=i.room_id AND t.resident_id=i.resident_id JOIN rooms r ON r.id=i.room_id AND r.account_id=i.account_id WHERE g.id=? AND g.agent_id=? AND g.account_id=? AND g.version=? AND g.identity_version=? AND g.authority_epoch=? AND g.invite_token_hash=? AND g.state='accepted' AND i.version=g.identity_version AND i.authority_epoch=g.authority_epoch AND i.version=? AND i.authority_epoch=? AND i.room_id=? AND i.resident_id=? AND i.state='provisional' AND i.recovery_consent=1 AND g.created_at<=? AND g.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.expires_at>? AND g.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND g.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',g.created_at,'+24 hours') AND NOT EXISTS(SELECT 1 FROM identity_guardians WHERE agent_id=i.agent_id)) THEN 1 ELSE json('registration-invitation-changed') END",
      g.id,
      g.agent_id,
      g.account_id,
      g.version,
      g.identity_version,
      g.authority_epoch,
      g.invite_token_hash,
      i.version,
      i.authority_epoch,
      i.room_id,
      i.resident_id,
      stamp(),
      stamp(),
    );
  }
  function lifetimeGuard(created: string, expires: string) {
    return stmt(
      "SELECT CASE WHEN ?<=? AND ?<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ?>? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE json('registration-challenge-expired') END",
      created,
      stamp(),
      created,
      expires,
      stamp(),
      expires,
    );
  }
  function challengeGuard(c: Challenge) {
    return stmt(
      "SELECT CASE WHEN EXISTS(SELECT 1 FROM identity_guardian_challenges WHERE challenge_id=? AND operation='registration' AND invitation_id=? AND agent_id=? AND invitation_version=? AND identity_version=? AND authority_epoch=? AND invite_token_hash=? AND rp_id=? AND origin=? AND options_json=? AND consumed_at IS NULL AND created_at<=? AND created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+5 minutes')) THEN 1 ELSE json('registration-challenge-changed') END",
      c.challenge_id,
      c.invitation_id,
      c.agent_id,
      c.invitation_version,
      c.identity_version,
      c.authority_epoch,
      c.invite_token_hash,
      new URL(env.origin).hostname,
      env.origin,
      c.options_json,
      stamp(),
      stamp(),
    );
  }
  async function verifyGuard(s: Statement) {
    try {
      await s.first();
    } catch {
      fail(409, "registration_conflict");
    }
  }
  async function current(g: Invite) {
    const i = await one<Identity>(
      "SELECT i.*,r.name home_name FROM agent_identities i JOIN rooms r ON r.id=i.room_id WHERE i.agent_id=?",
      g.agent_id,
    );
    if (!i) fail(409, "registration_conflict");
    await verifyGuard(inviteGuard(g, i));
    return i;
  }
  async function receipt(invitationId: string, key: string, hash: string) {
    const saved = await one<{ input_hash: string; response_json: string }>(
      "SELECT input_hash,response_json FROM identity_registration_requests WHERE invitation_id=? AND request_key=?",
      invitationId,
      key,
    );
    if (!saved) return null;
    if (saved.input_hash !== hash) fail(409, "idempotency_conflict");
    return json(JSON.parse(saved.response_json));
  }
  function optionsResult(c: Challenge) {
    return {
      challengeId: c.challenge_id,
      options: JSON.parse(c.options_json),
      agentId: c.agent_id,
      expiresAt: c.expires_at,
    };
  }
  async function priorOptions(
    g: Invite,
    i: Identity,
    key: string,
    hash: string,
  ) {
    const c = await one<Challenge>(
      "SELECT * FROM identity_guardian_challenges WHERE invitation_id=? AND request_key=?",
      g.id,
      key,
    );
    if (!c) return null;
    if (c.input_hash !== hash) fail(409, "idempotency_conflict");
    await verifyGuard(inviteGuard(g, i));
    await verifyGuard(challengeGuard(c));
    return json(optionsResult(c));
  }
  // Independent indexed lookups avoid the deployed D1 compound-SELECT term limit.
  // Reuse the same predicate in preflight and the atomic registration guard.
  const collisionSQL =
    "SELECT 1 WHERE EXISTS(SELECT 1 FROM accounts WHERE login_hash=?) OR EXISTS(SELECT 1 FROM tower_tokens WHERE token_hash=?) OR EXISTS(SELECT 1 FROM tower_reception_cases WHERE token_hash=?) OR EXISTS(SELECT 1 FROM onboarding_grants WHERE token_hash=?) OR EXISTS(SELECT 1 FROM agent_tokens WHERE token_hash=?) OR EXISTS(SELECT 1 FROM sessions WHERE token_hash=?) OR EXISTS(SELECT 1 FROM identity_secret_history WHERE secret_hash=?) OR EXISTS(SELECT 1 FROM identity_recovery_requests WHERE candidate_hash=?)";
  const collisionArgs = (hash: string) => Array(8).fill(hash);
  async function offlineSafe(sha: string, hash: string) {
    if (
      (await one(collisionSQL, ...collisionArgs(sha))) ||
      (await one(
        "SELECT 1 FROM identity_offline_recovery_codes WHERE code_hash=?",
        hash,
      ))
    )
      fail(400, "independent_offline_code_required");
  }
  return {
    async fetch(request: Request): Promise<Response | null> {
      const url = new URL(request.url),
        complete =
          url.pathname === "/api/v1/identity/guardian/registration/complete";
      if (
        !complete &&
        url.pathname !== "/api/v1/identity/guardian/registration/options"
      )
        return null;
      let retry: { id: string; key: string; hash: string } | undefined;
      try {
        if (url.origin !== env.origin) fail(403, "host_rejected");
        if (
          request.headers.has("Cookie") ||
          request.headers.has("Authorization") ||
          request.headers.get("Sec-Fetch-Site") === "cross-site" ||
          (request.headers.has("Origin") &&
            request.headers.get("Origin") !== env.origin)
        )
          fail(403, "origin_rejected");
        if (request.method !== "POST") fail(405, "method_not_allowed");
        if (
          !validContactKey(env.contactKey) ||
          new URL(env.origin).protocol !== "https:" ||
          new URL(env.origin).origin !== env.origin
        )
          fail(503, "identity_registration_not_configured");
        await throttle(request);
        const v = await input(request, complete),
          hash = await digest({
            operation: complete
              ? "registration-complete"
              : "registration-options",
            ...v,
          });
        const tokenHash = await hashPrivate(
            env.contactKey,
            "guardian-confirmation:" + v.invitationId,
            v.confirmationCode,
          ),
          g = await one<Invite>(
            "SELECT * FROM identity_guardian_invites WHERE id=?",
            v.invitationId,
          );
        if (!g || g.invite_token_hash !== tokenHash)
          fail(403, "confirmation_rejected");
        // Confirmation possession authenticates historical receipts even after registration or
        // expiry. Fresh authority still requires the accepted/current/unexpired guards below.
        // Set the retry scope only after proof passes so error handling cannot probe wrong-proof keys.
        if (complete) {
          retry = { id: v.invitationId, key: v.requestKey, hash };
          const replay = await receipt(v.invitationId, v.requestKey, hash);
          if (replay) return replay;
        } else {
          const existing = await one<{ input_hash: string }>(
            "SELECT input_hash FROM identity_guardian_challenges WHERE invitation_id=? AND request_key=?",
            v.invitationId,
            v.requestKey,
          );
          if (existing && existing.input_hash !== hash)
            fail(409, "idempotency_conflict");
        }
        const i = await current(g);
        if (!complete) {
          const replay = await priorOptions(g, i, v.requestKey, hash);
          if (replay) return replay;
          const options = await registrationOptions(
              env.origin,
              i.agent_id,
              i.home_name,
            ),
            created = stamp(),
            expires = new Date(
              Math.min(Date.parse(created) + 300000, Date.parse(g.expires_at)),
            ).toISOString();
          const c: Challenge = {
            challenge_id: randomIdentityId(),
            operation: "registration",
            invitation_id: g.id,
            agent_id: i.agent_id,
            invitation_version: g.version,
            identity_version: i.version,
            authority_epoch: i.authority_epoch,
            invite_token_hash: tokenHash,
            rp_id: new URL(env.origin).hostname,
            origin: env.origin,
            options_json: JSON.stringify(options),
            request_key: v.requestKey,
            input_hash: hash,
            created_at: created,
            expires_at: expires,
            consumed_at: null,
          };
          const limits = [
              [scope(g), 20],
              ["registration:global", 1000],
            ] as const,
            rows: Statement[] = [
              inviteGuard(g, i),
              lifetimeGuard(c.created_at, c.expires_at),
            ];
          for (const [bucket, max] of limits)
            rows.push(
              stmt(
                "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM rate_limits WHERE key=? AND expires_at>? AND count>=?) THEN 1 ELSE json('registration-rate-limit') END",
                bucket,
                created,
                max,
              ),
              stmt(
                "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END",
                bucket,
                new Date(Date.parse(created) + 3600000).toISOString(),
                created,
                created,
              ),
            );
          rows.push(
            stmt(
              "INSERT INTO identity_guardian_challenges(challenge_id,operation,invitation_id,agent_id,invitation_version,identity_version,authority_epoch,invite_token_hash,rp_id,origin,options_json,request_key,input_hash,expires_at,created_at) VALUES(?,'registration',?,?,?,?,?,?,?,?,?,?,?,?,?)",
              c.challenge_id,
              c.invitation_id,
              c.agent_id,
              c.invitation_version,
              c.identity_version,
              c.authority_epoch,
              c.invite_token_hash,
              c.rp_id,
              c.origin,
              c.options_json,
              c.request_key,
              c.input_hash,
              c.expires_at,
              c.created_at,
            ),
          );
          try {
            await db.batch(rows);
          } catch (error) {
            const prior = await priorOptions(g, i, v.requestKey, hash);
            if (prior) return prior;
            await verifyGuard(inviteGuard(g, i));
            await verifyGuard(lifetimeGuard(c.created_at, c.expires_at));
            for (const [bucket, max] of limits)
              if (
                await one(
                  "SELECT 1 FROM rate_limits WHERE key=? AND expires_at>? AND count>=?",
                  bucket,
                  stamp(),
                  max,
                )
              )
                fail(429, "registration_rate_limited");
            throw error;
          }
          return json(optionsResult(c));
        }
        const c = await challenge(v.challengeId);
        if (
          !c ||
          c.invitation_id !== g.id ||
          c.agent_id !== i.agent_id ||
          c.invitation_version !== g.version ||
          c.identity_version !== i.version ||
          c.authority_epoch !== i.authority_epoch ||
          c.invite_token_hash !== tokenHash ||
          c.rp_id !== new URL(env.origin).hostname ||
          c.origin !== env.origin
        )
          fail(409, "registration_conflict");
        await verifyGuard(challengeGuard(c));
        if (v.offlineRecoveryCode === v.confirmationCode)
          fail(400, "independent_offline_code_required");
        const offlineHash = await hashPrivate(
            env.contactKey,
            "identity-offline-recovery",
            v.offlineRecoveryCode,
          ),
          offlineSha = await hashIdentityInput(v.offlineRecoveryCode);
        await offlineSafe(offlineSha, offlineHash);
        let verified: Awaited<ReturnType<typeof verifyGuardianRegistration>>;
        try {
          verified = await verifyGuardianRegistration(
            v.response,
            (
              JSON.parse(
                c.options_json,
              ) as PublicKeyCredentialCreationOptionsJSON
            ).challenge,
            env.origin,
            c.rp_id,
          );
        } catch {
          fail(400, "invalid_webauthn_response");
        }
        const created = stamp(),
          guardianId = randomIdentityId(),
          result = {
            agentId: i.agent_id,
            state: "active",
            recoveryConfigured: true,
            issuanceReady: false,
          };
        try {
          await db.batch([
            inviteGuard(g, i),
            challengeGuard(c),
            stmt(
              "SELECT CASE WHEN NOT EXISTS(" +
                collisionSQL +
                ") AND NOT EXISTS(SELECT 1 FROM identity_offline_recovery_codes WHERE code_hash=?) THEN 1 ELSE json('registration-offline-collision') END",
              ...collisionArgs(offlineSha),
              offlineHash,
            ),
            stmt(
              "INSERT INTO identity_guardians(guardian_id,agent_id,invitation_id,version,email_verified_at,created_at) VALUES(?,?,?,1,?,?)",
              guardianId,
              i.agent_id,
              g.id,
              created,
              created,
            ),
            stmt(
              "INSERT INTO identity_guardian_passkeys(credential_id,guardian_id,agent_id,webauthn_user_id,public_key,counter,device_type,backed_up,transports_json,aaguid,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
              verified.credentialId,
              guardianId,
              i.agent_id,
              (
                JSON.parse(
                  c.options_json,
                ) as PublicKeyCredentialCreationOptionsJSON
              ).user.id,
              verified.publicKey,
              verified.counter,
              verified.deviceType,
              verified.backedUp ? 1 : 0,
              JSON.stringify(verified.transports),
              verified.aaguid,
              created,
            ),
            stmt(
              "INSERT INTO identity_offline_recovery_codes(agent_id,code_hash,authority_epoch,identity_version,created_at,confirmed_at) VALUES(?,?,?,?,?,?)",
              i.agent_id,
              offlineHash,
              i.authority_epoch,
              i.version + 1,
              created,
              created,
            ),
            stmt(
              "UPDATE identity_guardian_challenges SET consumed_at=? WHERE challenge_id=? AND consumed_at IS NULL",
              created,
              c.challenge_id,
            ),
            stmt(
              "UPDATE identity_guardian_invites SET state='registered',version=version+1,identity_version=?,updated_at=? WHERE id=?",
              i.version + 1,
              created,
              g.id,
            ),
            stmt(
              "UPDATE agent_identities SET state='active',version=version+1,updated_at=? WHERE agent_id=?",
              created,
              i.agent_id,
            ),
            stmt(
              "INSERT INTO identity_audit(id,agent_id,action,detail_json,created_at) VALUES(?,?,'guardian-registered',?,?)",
              randomIdentityId(),
              i.agent_id,
              JSON.stringify({ invitationId: g.id, guardianId }),
              created,
            ),
            stmt(
              "INSERT INTO identity_registration_requests(invitation_id,request_key,operation,input_hash,response_json,created_at) VALUES(?,?,'registration-complete',?,?,?)",
              g.id,
              v.requestKey,
              hash,
              JSON.stringify(result),
              created,
            ),
          ]);
        } catch (error) {
          const replay = await receipt(g.id, v.requestKey, hash);
          if (replay) return replay;
          await verifyGuard(inviteGuard(g, i));
          await verifyGuard(challengeGuard(c));
          await offlineSafe(offlineSha, offlineHash);
          if (
            await one(
              "SELECT 1 FROM identity_guardian_passkeys WHERE credential_id=?",
              verified.credentialId,
            )
          )
            fail(409, "registration_conflict");
          throw error;
        }
        return json(result);
      } catch (error) {
        if (retry) {
          try {
            const saved = await receipt(retry.id, retry.key, retry.hash);
            if (saved) return saved;
          } catch (replayError) {
            if (replayError instanceof Rejection)
              return json({ error: replayError.message }, replayError.status);
          }
        }
        return error instanceof Rejection
          ? json({ error: error.message }, error.status)
          : json({ error: "identity_registration_unavailable" }, 503);
      }
    },
  };
}
