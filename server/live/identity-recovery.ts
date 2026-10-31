import type { Database, Statement } from "./db.ts";
import {
  authenticationOptions,
  verifyGuardianAssertion,
} from "./identity-webauthn.ts";
import {
  encryptPrivate,
  hashIdentityInput,
  hashPrivate,
  randomIdentityId,
  randomIdentitySecret,
  validContactKey,
} from "./identity-private.ts";
interface Environment {
  db: Database;
  origin: string;
  contactKey?: string;
  now?: () => Date;
}
interface RecoveryRequest {
  id: string;
  agent_id: string;
  candidate_hash: string;
  request_key: string;
  input_hash: string;
  state: string;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}
interface Ready {
  agent_id: string;
  account_id: string;
  room_id: string;
  resident_id: string;
  version: number;
  authority_epoch: number;
  guardian_id: string;
  guardian_version: number;
  invitation_id: string;
  recipient_ciphertext: string;
  email_hash: string;
  code_hash: string;
}
interface Challenge {
  challenge_id: string;
  operation: string;
  request_id: string;
  candidate_hash: string;
  agent_id: string;
  guardian_id: string;
  guardian_version: number;
  identity_version: number;
  authority_epoch: number;
  decision: "continue" | "new";
  rp_id: string;
  origin: string;
  options_json: string;
  request_key: string;
  input_hash: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}
interface Passkey {
  credential_id: string;
  guardian_id: string;
  agent_id: string;
  webauthn_user_id: string;
  public_key: string;
  counter: number;
  device_type: string;
  backed_up: number;
  revoked_at: string | null;
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
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : record(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
function exact(v: Record<string, unknown>, fields: string[]) {
  if (
    Object.keys(v).length !== fields.length ||
    Object.keys(v).some((k) => !fields.includes(k))
  )
    fail(400, "invalid_recovery_request");
}
function string(v: unknown, pattern: RegExp) {
  if (typeof v !== "string" || !pattern.test(v))
    fail(400, "invalid_recovery_request");
  return v as string;
}
const key = (v: unknown) => string(v, /^[\x20-\x7e]{8,96}$/),
  id = (v: unknown) => string(v, /^[a-f0-9]{32}$/),
  secret = (v: unknown) => string(v, /^[a-f0-9]{64}$/);
async function input(request: Request) {
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
      size += part.value.length;
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
  if (!record(value)) fail(400, "invalid_recovery_request");
  return value as Record<string, unknown>;
}
/** Passkey-only backend slice. No offline verifier reset, UI, card issuance or delivery dispatch. */
export function createIdentityRecovery(env: Environment) {
  const db = env.db,
    stamp = () => (env.now?.() ?? new Date()).toISOString();
  const stmt = (sql: string, ...args: unknown[]) =>
      db.prepare(sql).bind(...args),
    one = <T>(sql: string, ...args: unknown[]) => stmt(sql, ...args).first<T>();
  const guard = (sql: string, ...args: unknown[]) =>
    stmt(
      "SELECT CASE WHEN (" +
        sql +
        ") THEN 1 ELSE json('recovery-conflict') END",
      ...args,
    );
  const digest = (v: unknown) =>
    hashPrivate(
      env.contactKey!,
      "identity-recovery-request",
      JSON.stringify(canonical(v)),
    );
  const requestRow = (requestId: string) =>
    one<RecoveryRequest>(
      "SELECT * FROM identity_recovery_requests WHERE id=?",
      requestId,
    );
  const readySQL =
    "SELECT i.*,g.guardian_id,g.version guardian_version,g.invitation_id,v.recipient_ciphertext,v.email_hash,c.code_hash FROM agent_identities i JOIN tower_residencies t ON t.account_id=i.account_id AND t.room_id=i.room_id AND t.resident_id=i.resident_id JOIN rooms room ON room.id=i.room_id AND room.account_id=i.account_id JOIN identity_guardians g ON g.agent_id=i.agent_id JOIN identity_guardian_invites v ON v.id=g.invitation_id AND v.agent_id=g.agent_id AND v.account_id=i.account_id AND v.state='registered' JOIN identity_offline_recovery_codes c ON c.agent_id=i.agent_id AND c.identity_version=i.version AND c.authority_epoch=i.authority_epoch AND c.consumed_at IS NULL AND c.confirmed_at IS NOT NULL WHERE i.agent_id=? AND i.state='active' AND i.recovery_consent=1 AND EXISTS(SELECT 1 FROM identity_guardian_passkeys p WHERE p.guardian_id=g.guardian_id AND p.agent_id=i.agent_id AND p.revoked_at IS NULL)";
  function readyGuard(i: Ready) {
    return guard(
      "EXISTS(" +
        readySQL +
        " AND i.account_id=? AND i.room_id=? AND i.resident_id=? AND i.version=? AND i.authority_epoch=? AND g.guardian_id=? AND g.version=? AND c.code_hash=? AND v.recipient_ciphertext=? AND v.email_hash=?)",
      i.agent_id,
      i.account_id,
      i.room_id,
      i.resident_id,
      i.version,
      i.authority_epoch,
      i.guardian_id,
      i.guardian_version,
      i.code_hash,
      i.recipient_ciphertext,
      i.email_hash,
    );
  }
  function requestGuard(r: RecoveryRequest) {
    return guard(
      "EXISTS(SELECT 1 FROM identity_recovery_requests WHERE id=? AND agent_id=? AND candidate_hash=? AND state='pending' AND created_at<=? AND created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      r.id,
      r.agent_id,
      r.candidate_hash,
      stamp(),
      stamp(),
    );
  }
  function lifetime(created: string, expires: string) {
    return guard(
      "?<=? AND ?<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ?>? AND ?>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      created,
      stamp(),
      created,
      expires,
      stamp(),
      expires,
    );
  }
  function challengeGuard(c: Challenge) {
    return guard(
      "EXISTS(SELECT 1 FROM identity_recovery_challenges WHERE challenge_id=? AND request_id=? AND candidate_hash=? AND agent_id=? AND guardian_id=? AND guardian_version=? AND identity_version=? AND authority_epoch=? AND decision=? AND rp_id=? AND origin=? AND options_json=? AND consumed_at IS NULL AND created_at<=? AND created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      c.challenge_id,
      c.request_id,
      c.candidate_hash,
      c.agent_id,
      c.guardian_id,
      c.guardian_version,
      c.identity_version,
      c.authority_epoch,
      c.decision,
      new URL(env.origin).hostname,
      env.origin,
      c.options_json,
      stamp(),
      stamp(),
    );
  }
  async function check(s: Statement) {
    try {
      await s.first();
    } catch {
      fail(409, "recovery_conflict");
    }
  }
  async function ready(agent: string) {
    const i = await one<Ready>(readySQL, agent);
    if (!i) fail(409, "recovery_unavailable");
    return i!;
  }
  // Digest history is populated and retained by DB triggers for all six credential sources.
  // HMAC compares a supplied raw candidate against every offline-code generation without storing it.
  function candidateGuard(sha: string, hmac: string) {
    return guard(
      "NOT EXISTS(SELECT 1 FROM identity_secret_history WHERE secret_hash=?) AND NOT EXISTS(SELECT 1 FROM identity_offline_recovery_codes WHERE code_hash=?)",
      sha,
      hmac,
    );
  }
  function offlineGuard(sha: string, hmac: string) {
    return guard(
      "NOT EXISTS(SELECT 1 FROM identity_secret_history WHERE secret_hash=?) AND NOT EXISTS(SELECT 1 FROM identity_recovery_requests WHERE candidate_hash=?) AND NOT EXISTS(SELECT 1 FROM identity_offline_recovery_codes WHERE code_hash=?)",
      sha,
      sha,
      hmac,
    );
  }
  function candidateResult(r: RecoveryRequest) {
    return {
      requestId: r.id,
      agentId: r.agent_id,
      state: r.state,
      expiresAt: r.expires_at,
    };
  }
  function context(r: RecoveryRequest) {
    return { ...candidateResult(r), candidateFingerprint: r.candidate_hash };
  }
  function optionsResult(c: Challenge, r: RecoveryRequest) {
    return {
      ...context(r),
      challengeId: c.challenge_id,
      decision: c.decision,
      method: "passkey",
      options: JSON.parse(c.options_json),
      challengeExpiresAt: c.expires_at,
    };
  }
  async function receipt(requestId: string, requestKey: string, hash: string) {
    const saved = await one<{ input_hash: string; response_json: string }>(
      "SELECT input_hash,response_json FROM identity_recovery_receipts WHERE request_id=? AND request_key=?",
      requestId,
      requestKey,
    );
    if (!saved) return null;
    if (saved.input_hash !== hash) fail(409, "idempotency_conflict");
    return json(JSON.parse(saved.response_json));
  }
  async function throttle(request: Request) {
    const supplied = request.headers.get("CF-Connecting-IP"),
      ip = supplied && supplied.length <= 64 ? supplied : "unknown",
      fingerprint = await hashPrivate(
        env.contactKey!,
        "identity-recovery-ip",
        ip,
      );
    const row = await one<{ count: number }>(
      "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,strftime('%Y-%m-%dT%H:%M:%fZ',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'+60 seconds')) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN strftime('%Y-%m-%dT%H:%M:%fZ',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'+60 seconds') ELSE expires_at END RETURNING count",
      "recovery:http-ip:" + fingerprint,
    );
    if (!row) fail(503, "identity_recovery_unavailable");
    if (row!.count > 30) fail(429, "recovery_http_rate_limited");
  }
  function quota(kind: string): Statement[] {
    const bucket = "recovery:global:" + kind;
    return [
      guard(
        "NOT EXISTS(SELECT 1 FROM rate_limits WHERE key=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND count>=1000)",
        bucket,
      ),
      stmt(
        "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,strftime('%Y-%m-%dT%H:%M:%fZ',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'+1 hour')) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN excluded.expires_at ELSE expires_at END",
        bucket,
      ),
      guard(
        "(SELECT COUNT(*) FROM " +
          (kind === "requests"
            ? "identity_recovery_requests"
            : "identity_recovery_challenges") +
          ")<10000",
      ),
    ];
  }
  async function quotaExceeded(kind: "requests" | "challenges") {
    const table =
      kind === "requests"
        ? "identity_recovery_requests"
        : "identity_recovery_challenges";
    return !!(await one(
      "SELECT 1 WHERE EXISTS(SELECT 1 FROM rate_limits WHERE key=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND count>=1000) OR (SELECT COUNT(*) FROM " +
        table +
        ")>=10000",
      "recovery:global:" + kind,
    ));
  }
  return {
    async fetch(request: Request): Promise<Response | null> {
      const url = new URL(request.url),
        path = url.pathname;
      const get = path.match(
          /^\/api\/v1\/identity\/recovery\/requests\/([a-f0-9]{32})$/,
        ),
        create = path === "/api/v1/identity/recovery/requests",
        action = path.match(
          /^\/api\/v1\/identity\/guardian\/recovery\/(context|options|complete)$/,
        )?.[1];
      if (!get && !create && !action) return null;
      let authenticatedRetry:
        | { id: string; key: string; hash: string }
        | undefined;
      try {
        if (url.origin !== env.origin) fail(403, "host_rejected");
        if (url.search) fail(400, "query_not_allowed");
        if (
          request.headers.has("Cookie") ||
          request.headers.has("Authorization") ||
          request.headers.get("Sec-Fetch-Site") === "cross-site" ||
          (request.headers.has("Origin") &&
            request.headers.get("Origin") !== env.origin)
        )
          fail(403, "origin_rejected");
        if (request.method !== (get ? "GET" : "POST"))
          fail(405, "method_not_allowed");
        if (
          !validContactKey(env.contactKey) ||
          new URL(env.origin).origin !== env.origin ||
          new URL(env.origin).protocol !== "https:"
        )
          fail(503, "identity_recovery_not_configured");
        await throttle(request);
        if (get || create) {
          const supplied = request.headers.get("X-Identity-Candidate-Key");
          if (!supplied || !/^[a-f0-9]{64}$/.test(supplied))
            fail(403, "candidate_rejected");
          const sha = await hashIdentityInput(supplied!);
          if (get) {
            const r = await requestRow(get[1]);
            if (!r || r.candidate_hash !== sha) fail(403, "candidate_rejected");
            return json(candidateResult(r!));
          }
          const v = await input(request);
          exact(v, ["requestKey", "agentId"]);
          key(v.requestKey);
          const agent = string(v.agentId, /^mcid:[a-f0-9]{64}$/),
            hash = await digest({
              operation: "recovery-create",
              ...v,
              candidateHash: sha,
            });
          const previous = async () => {
            const r = await one<RecoveryRequest>(
              "SELECT * FROM identity_recovery_requests WHERE candidate_hash=?",
              sha,
            );
            if (!r) return null;
            if (r.request_key !== v.requestKey || r.input_hash !== hash)
              fail(409, "idempotency_conflict");
            return json(candidateResult(r), 201);
          };
          const prior = await previous();
          if (prior) return prior;
          const hmac = await hashPrivate(
              env.contactKey!,
              "identity-offline-recovery",
              supplied!,
            ),
            i = await ready(agent),
            created = stamp(),
            expires = new Date(Date.parse(created) + 3600000).toISOString();
          const r: RecoveryRequest = {
            id: randomIdentityId(),
            agent_id: agent,
            candidate_hash: sha,
            request_key: v.requestKey as string,
            input_hash: hash,
            state: "pending",
            created_at: created,
            expires_at: expires,
            completed_at: null,
          };
          try {
            await db.batch([
              readyGuard(i),
              candidateGuard(sha, hmac),
              lifetime(created, expires),
              ...quota("requests"),
              stmt(
                "INSERT INTO identity_recovery_requests(id,agent_id,candidate_hash,request_key,input_hash,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)",
                r.id,
                r.agent_id,
                r.candidate_hash,
                r.request_key,
                r.input_hash,
                r.state,
                r.created_at,
                r.expires_at,
              ),
            ]);
          } catch {
            const replay = await previous();
            if (replay) return replay;
            if (await quotaExceeded("requests"))
              fail(429, "recovery_rate_limited");
            fail(409, "recovery_conflict");
          }
          return json(candidateResult(r), 201);
        }
        if (request.headers.has("X-Identity-Candidate-Key"))
          fail(403, "separate_guardian_authorization_required");
        const v = await input(request);
        if (action === "context") {
          exact(v, ["requestId"]);
          const r = await requestRow(id(v.requestId));
          if (!r) fail(403, "recovery_rejected");
          return json(context(r!));
        }
        if (action === "options") {
          exact(v, ["requestKey", "requestId", "decision", "method"]);
          key(v.requestKey);
          id(v.requestId);
          if (
            !["continue", "new"].includes(String(v.decision)) ||
            v.method !== "passkey"
          )
            fail(400, "explicit_recovery_decision_required");
          const r = await requestRow(v.requestId as string);
          if (!r) fail(403, "recovery_rejected");
          const hash = await digest({ operation: "recovery-options", ...v }),
            i = await ready(r!.agent_id);
          const previous = async () => {
            const c = await one<Challenge>(
              "SELECT * FROM identity_recovery_challenges WHERE request_id=? AND request_key=?",
              r!.id,
              v.requestKey,
            );
            if (!c) return null;
            if (c.input_hash !== hash) fail(409, "idempotency_conflict");
            await check(requestGuard(r!));
            await check(readyGuard(i));
            await check(challengeGuard(c));
            return json(optionsResult(c, r!));
          };
          const prior = await previous();
          if (prior) return prior;
          await check(requestGuard(r!));
          const options = await authenticationOptions(env.origin),
            created = stamp(),
            expires = new Date(
              Math.min(Date.parse(created) + 300000, Date.parse(r!.expires_at)),
            ).toISOString();
          const c: Challenge = {
            challenge_id: randomIdentityId(),
            operation: "recovery-passkey",
            request_id: r!.id,
            candidate_hash: r!.candidate_hash,
            agent_id: r!.agent_id,
            guardian_id: i.guardian_id,
            guardian_version: i.guardian_version,
            identity_version: i.version,
            authority_epoch: i.authority_epoch,
            decision: v.decision as Challenge["decision"],
            rp_id: new URL(env.origin).hostname,
            origin: env.origin,
            options_json: JSON.stringify(options),
            request_key: v.requestKey as string,
            input_hash: hash,
            created_at: created,
            expires_at: expires,
            consumed_at: null,
          };
          try {
            await db.batch([
              requestGuard(r!),
              readyGuard(i),
              lifetime(created, expires),
              ...quota("challenges"),
              stmt(
                "INSERT INTO identity_recovery_challenges(challenge_id,operation,request_id,candidate_hash,agent_id,guardian_id,guardian_version,identity_version,authority_epoch,decision,rp_id,origin,options_json,request_key,input_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                c.challenge_id,
                c.operation,
                c.request_id,
                c.candidate_hash,
                c.agent_id,
                c.guardian_id,
                c.guardian_version,
                c.identity_version,
                c.authority_epoch,
                c.decision,
                c.rp_id,
                c.origin,
                c.options_json,
                c.request_key,
                c.input_hash,
                c.created_at,
                c.expires_at,
              ),
            ]);
          } catch {
            const replay = await previous();
            if (replay) return replay;
            if (await quotaExceeded("challenges"))
              fail(429, "recovery_rate_limited");
            fail(409, "recovery_conflict");
          }
          return json(optionsResult(c, r!));
        }
        // Proof precedes scoped receipt reads, even when a challenge or credential is now consumed/revoked.
        key(v.requestKey);
        id(v.requestId);
        id(v.challengeId);
        const r = await requestRow(v.requestId as string),
          c = await one<Challenge>(
            "SELECT * FROM identity_recovery_challenges WHERE challenge_id=?",
            v.challengeId,
          );
        if (
          !r ||
          !c ||
          c.request_id !== r.id ||
          c.agent_id !== r.agent_id ||
          c.candidate_hash !== r.candidate_hash ||
          c.origin !== env.origin ||
          c.rp_id !== new URL(env.origin).hostname ||
          !record(v.response) ||
          typeof v.response.id !== "string"
        )
          fail(403, "recovery_proof_rejected");
        exact(v, [
          "requestKey",
          "requestId",
          "challengeId",
          "response",
          ...(c!.decision === "continue"
            ? ["offlineRecoveryCode", "backupConfirmed"]
            : []),
        ]);
        if (c!.decision === "continue") {
          secret(v.offlineRecoveryCode);
          if (v.backupConfirmed !== true)
            fail(400, "backup_confirmation_required");
        }
        const p = await one<Passkey>(
          "SELECT * FROM identity_guardian_passkeys WHERE credential_id=? AND guardian_id=? AND agent_id=?",
          (v.response as Record<string, unknown>).id,
          c!.guardian_id,
          c!.agent_id,
        );
        if (!p) fail(403, "recovery_proof_rejected");
        const expected = (JSON.parse(c!.options_json) as { challenge: string })
          .challenge;
        try {
          await verifyGuardianAssertion(
            v.response,
            expected,
            env.origin,
            c!.rp_id,
            { ...p!, counter: 0 },
          );
        } catch {
          fail(403, "recovery_proof_rejected");
        }
        const hash = await digest({ operation: "recovery-complete", ...v });
        authenticatedRetry = { id: r!.id, key: v.requestKey as string, hash };
        const saved = await receipt(r!.id, v.requestKey as string, hash);
        if (saved) return saved;
        const i = await ready(r!.agent_id);
        if (
          p!.revoked_at !== null ||
          c!.guardian_id !== i.guardian_id ||
          c!.guardian_version !== i.guardian_version ||
          c!.identity_version !== i.version ||
          c!.authority_epoch !== i.authority_epoch
        )
          fail(409, "recovery_conflict");
        let verification: Awaited<ReturnType<typeof verifyGuardianAssertion>>;
        try {
          verification = await verifyGuardianAssertion(
            v.response,
            expected,
            env.origin,
            c!.rp_id,
            p!,
          );
          if (verification.credentialDeviceType !== p!.device_type)
            throw new Error("device-type");
        } catch {
          fail(403, "recovery_proof_rejected");
        }
        const created = stamp(),
          continuing = c!.decision === "continue",
          tokenId = randomIdentityId(),
          instanceId = randomIdentityId(),
          mailId = randomIdentityId();
        const result = continuing
          ? {
              requestId: r!.id,
              agentId: i.agent_id,
              state: "continued",
              authorityEpoch: i.authority_epoch + 1,
              instanceId,
            }
          : {
              requestId: r!.id,
              agentId: i.agent_id,
              state: "new-admission-required",
            };
        const rows: Statement[] = [
          requestGuard(r!),
          readyGuard(i),
          challengeGuard(c!),
          guard(
            "EXISTS(SELECT 1 FROM identity_guardian_passkeys WHERE credential_id=? AND guardian_id=? AND agent_id=? AND counter=? AND public_key=? AND webauthn_user_id=? AND revoked_at IS NULL)",
            p!.credential_id,
            p!.guardian_id,
            p!.agent_id,
            p!.counter,
            p!.public_key,
            p!.webauthn_user_id,
          ),
        ];
        if (continuing) {
          const offlineHash = await hashPrivate(
              env.contactKey!,
              "identity-offline-recovery",
              v.offlineRecoveryCode as string,
            ),
            offlineSha = await hashIdentityInput(
              v.offlineRecoveryCode as string,
            ),
            loginHash = await hashIdentityInput(randomIdentitySecret()),
            expires = new Date(
              Date.parse(created) + 30 * 86400000,
            ).toISOString();
          rows.push(
            offlineGuard(offlineSha, offlineHash),
            guard(
              "NOT EXISTS(SELECT 1 FROM identity_secret_history WHERE secret_hash=?)",
              r!.candidate_hash,
            ),
            stmt(
              "UPDATE identity_offline_recovery_codes SET consumed_at=? WHERE agent_id=? AND consumed_at IS NULL",
              created,
              i.agent_id,
            ),
            stmt(
              "INSERT INTO identity_offline_recovery_codes(agent_id,code_hash,authority_epoch,identity_version,created_at,confirmed_at) VALUES(?,?,?,?,?,?)",
              i.agent_id,
              offlineHash,
              i.authority_epoch + 1,
              i.version + 1,
              created,
              created,
            ),
            stmt(
              "UPDATE agent_identities SET version=version+1,authority_epoch=authority_epoch+1,updated_at=? WHERE agent_id=?",
              created,
              i.agent_id,
            ),
            stmt(
              "UPDATE identity_guardians SET version=version+1 WHERE guardian_id=?",
              i.guardian_id,
            ),
            stmt(
              "UPDATE tower_tokens SET revoked=1 WHERE account_id=?",
              i.account_id,
            ),
            stmt(
              "UPDATE agent_tokens SET revoked=1 WHERE room_id=?",
              i.room_id,
            ),
            stmt(
              "UPDATE onboarding_grants SET revoked=1 WHERE account_id=?",
              i.account_id,
            ),
            stmt("DELETE FROM sessions WHERE account_id=?", i.account_id),
            stmt(
              "UPDATE accounts SET login_hash=? WHERE id=?",
              loginHash,
              i.account_id,
            ),
            stmt(
              "INSERT INTO tower_reception_events(case_id,sequence,actor,kind,message,created_at) SELECT c.id,COALESCE((SELECT MAX(sequence) FROM tower_reception_events WHERE case_id=c.id),0)+1,'system','identity-recovery','本案已結束。',? FROM tower_reception_cases c WHERE c.account_id=? AND c.state IN ('approved','active')",
              created,
              i.account_id,
            ),
            stmt(
              "UPDATE tower_reception_cases SET state='revoked',version=version+1,next_action='本案已結束。',updated_at=? WHERE account_id=? AND state IN ('approved','active')",
              created,
              i.account_id,
            ),
            stmt(
              'INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,\'["tower:read","tower:write"]\',?,?)',
              tokenId,
              i.account_id,
              r!.candidate_hash,
              expires,
              created,
            ),
            stmt(
              "INSERT INTO identity_recovery_instances(instance_id,agent_id,authority_epoch,token_id,request_id,created_at) VALUES(?,?,?,?,?,?)",
              instanceId,
              i.agent_id,
              i.authority_epoch + 1,
              tokenId,
              r!.id,
              created,
            ),
            stmt(
              "INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,created_at,updated_at) VALUES(?,'security-notice',?,?,?,?,?,?,?)",
              mailId,
              r!.id,
              "identity-recovery:" + r!.id,
              i.recipient_ciphertext,
              i.email_hash,
              await encryptPrivate(
                env.contactKey!,
                "mail-payload",
                mailId,
                JSON.stringify({
                  template: "identity-recovery-continued-v1",
                  agentId: i.agent_id,
                  requestId: r!.id,
                  authorityEpoch: i.authority_epoch + 1,
                }),
              ),
              created,
              created,
            ),
            stmt(
              "INSERT INTO identity_mail_audit(id,event_id,action,detail_json,created_at) VALUES(?,?,'pending','{}',?)",
              randomIdentityId(),
              mailId,
              created,
            ),
            stmt(
              "INSERT INTO tower_audit(id,account_id,room_id,action,revision,detail_json,created_at) VALUES(?,?,?,'identity-recovered',NULL,?,?)",
              randomIdentityId(),
              i.account_id,
              i.room_id,
              JSON.stringify({
                requestId: r!.id,
                authorityEpoch: i.authority_epoch + 1,
                instanceId,
              }),
              created,
            ),
          );
        }
        rows.push(
          stmt(
            "UPDATE identity_guardian_passkeys SET counter=?,backed_up=? WHERE credential_id=?",
            verification.newCounter,
            verification.credentialBackedUp ? 1 : 0,
            p!.credential_id,
          ),
          stmt(
            "UPDATE identity_recovery_challenges SET consumed_at=? WHERE challenge_id=?",
            created,
            c!.challenge_id,
          ),
          stmt(
            "UPDATE identity_recovery_requests SET state=?,completed_at=? WHERE id=?",
            result.state,
            created,
            r!.id,
          ),
          stmt(
            "INSERT INTO identity_recovery_receipts(request_id,request_key,input_hash,response_json,created_at) VALUES(?,?,?,?,?)",
            r!.id,
            v.requestKey,
            hash,
            JSON.stringify(result),
            created,
          ),
          stmt(
            "INSERT INTO identity_audit(id,agent_id,action,detail_json,created_at) VALUES(?,?,?,?,?)",
            randomIdentityId(),
            i.agent_id,
            continuing ? "identity-recovered" : "identity-new-requested",
            JSON.stringify({ requestId: r!.id, decision: c!.decision }),
            created,
          ),
        );
        try {
          await db.batch(rows);
        } catch {
          const replay = await receipt(r!.id, v.requestKey as string, hash);
          if (replay) return replay;
          fail(409, "recovery_conflict");
        }
        return json(result);
      } catch (error) {
        if (authenticatedRetry) {
          try {
            const saved = await receipt(
              authenticatedRetry.id,
              authenticatedRetry.key,
              authenticatedRetry.hash,
            );
            if (saved) return saved;
          } catch (replayError) {
            if (replayError instanceof Rejection)
              return json({ error: replayError.message }, replayError.status);
          }
        }
        return error instanceof Rejection
          ? json({ error: error.message }, error.status)
          : json({ error: "identity_recovery_unavailable" }, 503);
      }
    },
  };
}
