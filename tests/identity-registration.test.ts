import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { LocalDatabase } from "../server/live/local-db.ts";
import type { Statement } from "../server/live/db.ts";
import {
  hashIdentityInput,
  hashPrivate,
  encryptPrivate,
} from "../server/live/identity-private.ts";
import { isoCBOR, isoBase64URL } from "@simplewebauthn/server/helpers";
import { identityAuthenticator } from "./helpers/identity-authenticator.ts";
const origin = "https://identity.example",
  time = "2026-10-31T00:00:00.000Z",
  contactKey = "9".repeat(64),
  base = "/api/v1/identity/guardian/registration";
const native = new LocalDatabase(":memory:");
test.after(() => native.close());
async function fixture() {
  const db = new LocalDatabase(":memory:");
  for (const f of readdirSync(new URL("../migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.sqlite.exec(
      readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8"),
    );
  let appNow = time,
    dbNow = time;
  db.sqlite.function("strftime", { varargs: true }, (...args) =>
    args[1] === "now"
      ? dbNow
      : native.sqlite
          .prepare(
            "SELECT strftime(" + args.map(() => "?").join(",") + ") value",
          )
          .get(...args)!.value,
  );
  const codes = { a: "c".repeat(64), b: "d".repeat(64) };
  for (const x of ["a", "b"] as const) {
    const account = x.repeat(16),
      agent = "mcid:" + x.repeat(64),
      id = x.repeat(32);
    db.sqlite
      .prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)")
      .run(account, await hashIdentityInput(x.repeat(64)), time);
    db.sqlite
      .prepare(
        "INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Test Home','Test','resident','external-ready',?)",
      )
      .run(account, account, time);
    db.sqlite
      .prepare(
        "INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)",
      )
      .run(
        account,
        account,
        account,
        "https://source.example/" + x,
        time,
        time,
      );
    db.sqlite
      .prepare(
        "INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,version,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,3,1,?,?)",
      )
      .run(agent, account, account, account, time, time);
    db.sqlite
      .prepare(
        "INSERT INTO identity_guardian_invites(id,agent_id,account_id,version,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,invite_token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,2,3,1,'accepted',?,?,?,?,?,?)",
      )
      .run(
        id,
        agent,
        account,
        await encryptPrivate(
          contactKey,
          "guardian-recipient",
          agent,
          "private@example.com",
        ),
        await hashPrivate(contactKey, "guardian-email", "private@example.com"),
        await hashPrivate(contactKey, "guardian-confirmation:" + id, codes[x]),
        "2026-11-01T00:00:00.000Z",
        time,
        time,
      );
  }
  assert(
    existsSync(
      new URL("../server/live/identity-registration.ts", import.meta.url),
    ),
    "guardian Passkey registration handler is implemented",
  );
  const { createIdentityRegistration } =
    await import("../server/live/identity-registration.ts");
  const handler = createIdentityRegistration({
    db,
    origin,
    contactKey,
    now: () => new Date(appNow),
  });
  const input = {
    requestKey: "options-0001",
    invitationId: "a".repeat(32),
    confirmationCode: codes.a,
  };
  const send = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    (await handler.fetch(
      new Request(origin + base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ))!;
  const options = async (
    body: unknown = input,
    headers: Record<string, string> = {},
  ) => send("/options", body, headers);
  const begin = async (body: unknown = input) => {
    const r = await options(body);
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  const authenticator = await identityAuthenticator();
  const complete = async (
    start: Awaited<ReturnType<typeof begin>>,
    extra: Record<string, unknown> = {},
  ) => {
    const body = {
      ...input,
      requestKey: "complete-0001",
      challengeId: start.challengeId,
      response: await authenticator.registration(start.options, origin),
      offlineRecoveryCode: "e".repeat(64),
      backupConfirmed: true,
      ...extra,
    };
    return { body, response: await send("/complete", body) };
  };
  const count = (table: string) =>
    Number(db.sqlite.prepare("SELECT COUNT(*) n FROM " + table).get()!.n);
  return {
    db,
    handler,
    input,
    send,
    options,
    begin,
    authenticator,
    complete,
    count,
    setTime: (app: string, sql = app) => {
      appNow = app;
      dbNow = sql;
    },
  };
}
test("official WebAuthn registration options bind a random user handle and can only activate with Passkey plus independent confirmed offline code", async () => {
  const f = await fixture();
  try {
    const unchanged = [
      "rooms",
      "tower_residencies",
      "tower_tokens",
      "sessions",
      "agent_tokens",
      "tower_claims",
      "consent_events",
      "manager_jobs",
      "assets",
    ].map((t) => [t, f.db.sqlite.prepare("SELECT * FROM " + t).all()] as const);
    const start = await f.begin();
    assert.equal(start.agentId, "mcid:" + "a".repeat(64));
    assert.equal(start.options.rp.id, "identity.example");
    assert.equal(Buffer.from(start.options.user.id, "base64url").length, 32);
    assert.equal(start.options.user.displayName, "Test Home 的監護人");
    assert.deepEqual(start.options.pubKeyCredParams, [
      { alg: -7, type: "public-key" },
    ]);
    assert.equal(start.options.attestation, "none");
    assert.equal(start.options.authenticatorSelection.residentKey, "required");
    assert.equal(
      start.options.authenticatorSelection.userVerification,
      "required",
    );
    assert.equal(start.expiresAt, "2026-10-31T00:05:00.000Z");
    assert.equal(f.count("identity_guardians"), 0);
    assert.deepEqual(await (await f.options()).json(), start);
    assert.equal(f.count("identity_guardian_challenges"), 1);
    const { response } = await f.complete(start);
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), {
      agentId: start.agentId,
      state: "active",
      recoveryConfigured: true,
      issuanceReady: false,
    });
    assert.equal(f.count("identity_guardians"), 1);
    assert.equal(f.count("identity_guardian_passkeys"), 1);
    assert.equal(f.count("identity_offline_recovery_codes"), 1);
    assert.equal(f.count("identity_audit"), 1);
    const identity = f.db.sqlite
      .prepare("SELECT * FROM agent_identities WHERE agent_id=?")
      .get(start.agentId)!;
    assert.equal(identity.state, "active");
    assert.equal(identity.version, 4);
    assert.equal(identity.authority_epoch, 1);
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT state,version FROM identity_guardian_invites WHERE id=?",
        )
        .get(f.input.invitationId)!.version,
      3,
    );
    for (const [table, before] of unchanged)
      assert.deepEqual(
        f.db.sqlite.prepare("SELECT * FROM " + table).all(),
        before,
        table,
      );
  } finally {
    f.db.close();
  }
});
test("official verifier rejects wrong origin/RP/challenge/type, missing UP/UV, cross-site clients, malformed attestation and credential mismatches", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    for (const overrides of [
      { origin: "https://evil.example" },
      { rpID: "evil.example" },
      { challenge: "wrongchallenge" },
      { flags: 0x41 },
      { flags: 0x44 },
      { client: { crossOrigin: true } },
      { client: { topOrigin: "https://evil.example" } },
      { client: { crossOrigin: "false" } },
      { client: { type: "webauthn.get" } },
      { fmt: "packed" },
      { attStmt: new Map([["sig", "invalid-signature-format"]]) },
      { publicKey: new Uint8Array([0xff]) },
    ]) {
      const response = await f.authenticator.registration(
        start.options,
        origin,
        overrides,
      );
      const r = await f.complete(start, { response });
      assert.equal(r.response.status, 400, JSON.stringify(overrides));
      assert.equal(f.count("identity_guardians"), 0);
    }
    for (const mutate of [
      (r: Record<string, unknown>) => {
        r.rawId = "other";
      },
      (r: Record<string, unknown>) => {
        r.id += "=";
        r.rawId = r.id;
      },
      (r: Record<string, unknown>) => {
        r.id = "z".repeat(43);
        r.rawId = r.id;
      },
    ]) {
      const response = await f.authenticator.registration(
        start.options,
        origin,
      );
      mutate(response as unknown as Record<string, unknown>);
      assert.equal(
        (await f.complete(start, { response })).response.status,
        400,
      );
    }
    assert.equal(
      f.db.sqlite
        .prepare("SELECT consumed_at FROM identity_guardian_challenges")
        .get()!.consumed_at,
      null,
    );
  } finally {
    f.db.close();
  }
});
test("strict credential-free transport and bounded UTF-8 JSON reject unauthorized, oversized and unknown input", async () => {
  const f = await fixture();
  try {
    for (const h of [
      { Cookie: "session=x" },
      { Authorization: "Bearer " + "a".repeat(64) },
      { Origin: "https://evil.example" },
      { "Sec-Fetch-Site": "cross-site" },
    ] as Record<string, string>[])
      assert.equal((await f.options(f.input, h)).status, 403);
    for (const body of [
      { ...f.input, extra: true },
      { ...f.input, requestKey: "short" },
      { ...f.input, invitationId: "Z".repeat(32) },
      { ...f.input, confirmationCode: "x" },
      { ...f.input, rpID: "evil.example" },
    ])
      assert.equal((await f.options(body)).status, 400);
    assert.equal(
      (await f.send("/options", f.input, { "Content-Type": "text/plain" }))
        .status,
      415,
    );
    const raw = (body: BodyInit, headers: Record<string, string> = {}) =>
      f.handler.fetch(
        new Request(origin + base + "/options", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body,
          duplex: "half",
        } as RequestInit),
      );
    assert.equal((await raw(" ".repeat(32769)))!.status, 413);
    assert.equal((await raw(new Uint8Array([0xff])))!.status, 400);
    const stream = new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(32769));
      },
      cancel() {
        throw new Error("synthetic cancellation failure");
      },
    });
    assert.equal((await raw(stream))!.status, 413);
    assert.equal(
      (await f.handler.fetch(
        new Request("https://evil.example" + base + "/options", {
          method: "POST",
        }),
      ))!.status,
      403,
    );
    assert.equal(
      (await f.options({ ...f.input, confirmationCode: "f".repeat(64) }))
        .status,
      403,
    );
    assert.deepEqual(
      await (
        await f.options({ ...f.input, invitationId: "f".repeat(32) })
      ).json(),
      await (
        await f.options({ ...f.input, confirmationCode: "f".repeat(64) })
      ).json(),
    );
  } finally {
    f.db.close();
  }
});
test("backup acknowledgment and independent high-entropy offline code are mandatory before activation", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    for (const extra of [
      { backupConfirmed: false },
      { offlineRecoveryCode: f.input.confirmationCode },
      { offlineRecoveryCode: "short" },
      { offlineRecoveryCode: "a".repeat(64) },
    ])
      assert.equal((await f.complete(start, extra)).response.status, 400);
    assert.equal(f.count("identity_guardians"), 0);
    assert.equal(f.count("identity_offline_recovery_codes"), 0);
  } finally {
    f.db.close();
  }
});
test("options request keys are permanent, changed input conflicts, and consumed/expired challenges never revive", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    assert.equal(
      (await f.options({ ...f.input, confirmationCode: "d".repeat(64) }))
        .status,
      403,
    );
    const { body, response } = await f.complete(start);
    assert.equal(response.status, 200);
    const expected = await response.json();
    f.setTime("2026-11-04T00:00:00.000Z");
    f.db.sqlite.exec("UPDATE rate_limits SET count=10000");
    assert.deepEqual(await (await f.send("/complete", body)).json(), expected);
    assert.equal(f.count("identity_audit"), 1);
    assert.equal(
      (
        await f.send("/complete", {
          ...body,
          offlineRecoveryCode: "f".repeat(64),
        })
      ).status,
      409,
    );
    assert.equal((await f.options()).status, 409);
    assert.equal(
      (await f.send("/complete", { ...body, requestKey: "another-key" }))
        .status,
      409,
    );
  } finally {
    f.db.close();
  }
  const expired = await fixture();
  try {
    const start = await expired.begin();
    expired.setTime(start.expiresAt);
    assert.equal((await expired.options()).status, 409);
    assert.equal((await expired.complete(start)).response.status, 409);
    assert.equal(expired.count("identity_guardians"), 0);
  } finally {
    expired.db.close();
  }
});
test("registration binds the original household, invitation, epoch and confirmation hash at atomic native-clock commit", async () => {
  const mutations = [
    "UPDATE identity_guardian_invites SET state='cancelled' WHERE id='" +
      "a".repeat(32) +
      "'",
    "UPDATE identity_guardian_invites SET version=version+1 WHERE id='" +
      "a".repeat(32) +
      "'",
    "UPDATE identity_guardian_invites SET invite_token_hash='" +
      "f".repeat(64) +
      "' WHERE id='" +
      "a".repeat(32) +
      "'",
    "UPDATE agent_identities SET version=version+1 WHERE agent_id='mcid:" +
      "a".repeat(64) +
      "'",
    "UPDATE agent_identities SET authority_epoch=2 WHERE agent_id='mcid:" +
      "a".repeat(64) +
      "'",
    "UPDATE agent_identities SET state='suspended' WHERE agent_id='mcid:" +
      "a".repeat(64) +
      "'",
    "UPDATE tower_residencies SET resident_id='" +
      "e".repeat(16) +
      "' WHERE account_id='" +
      "a".repeat(16) +
      "'",
    "UPDATE rooms SET account_id='" +
      "f".repeat(16) +
      "' WHERE id='" +
      "a".repeat(16) +
      "'",
  ];
  for (const mutation of [...mutations, "native-expiry"]) {
    const f = await fixture();
    try {
      const start = await f.begin();
      const batch = f.db.batch.bind(f.db);
      f.db.batch = async (statements: Statement[]) => {
        if (
          statements.some((s) =>
            (s as unknown as { sql: string }).sql.startsWith(
              "INSERT INTO identity_guardians",
            ),
          )
        ) {
          if (mutation === "native-expiry") f.setTime(time, start.expiresAt);
          else if (mutation.startsWith("UPDATE rooms")) {
            f.db.sqlite
              .prepare(
                "INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)",
              )
              .run("f".repeat(16), "extra", time);
            f.db.sqlite.exec(mutation);
          } else f.db.sqlite.exec(mutation);
        }
        return batch(statements);
      };
      assert.equal((await f.complete(start)).response.status, 409, mutation);
      assert.equal(f.count("identity_guardians"), 0);
      assert.equal(f.count("identity_guardian_passkeys"), 0);
      assert.equal(f.count("identity_offline_recovery_codes"), 0);
      assert.equal(f.count("identity_audit"), 0);
      assert.equal(
        f.db.sqlite
          .prepare("SELECT consumed_at FROM identity_guardian_challenges")
          .get()!.consumed_at,
        null,
      );
    } finally {
      f.db.close();
    }
  }
  const f = await fixture();
  try {
    const start = await f.begin();
    assert.equal(
      (
        await f.complete(start, {
          invitationId: "b".repeat(32),
          confirmationCode: "d".repeat(64),
        })
      ).response.status,
      409,
    );
  } finally {
    f.db.close();
  }
});
test("two officially verified synthetic completions race atomically; exact retry returns one receipt and independent competition loses", async () => {
  for (const same of [true, false]) {
    const f = await fixture();
    try {
      const start = await f.begin(),
        response = await f.authenticator.registration(start.options, origin),
        body = {
          ...f.input,
          requestKey: "complete-race",
          challengeId: start.challengeId,
          response,
          offlineRecoveryCode: "e".repeat(64),
          backupConfirmed: true,
        };
      const results = await Promise.all([
        f.send("/complete", body),
        f.send("/complete", {
          ...body,
          requestKey: same ? body.requestKey : "competing-key",
        }),
      ]);
      assert.deepEqual(
        results.map((r) => r.status).sort(),
        same ? [200, 200] : [200, 409],
      );
      assert.equal(f.count("identity_guardians"), 1);
      assert.equal(f.count("identity_guardian_passkeys"), 1);
      assert.equal(f.count("identity_offline_recovery_codes"), 1);
      assert.equal(f.count("identity_audit"), 1);
    } finally {
      f.db.close();
    }
  }
});
test("audit failure rolls back all registration state, and offline collision appearing at commit is rejected", async () => {
  for (const collision of [false, true]) {
    const f = await fixture();
    try {
      const start = await f.begin();
      if (!collision)
        f.db.sqlite.exec(
          "CREATE TRIGGER fail_registration BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT,'synthetic'); END",
        );
      else {
        const batch = f.db.batch.bind(f.db);
        f.db.batch = async (statements) => {
          if (
            statements.some((s) =>
              (s as unknown as { sql: string }).sql.startsWith(
                "INSERT INTO identity_guardians",
              ),
            )
          )
            f.db.sqlite
              .prepare("UPDATE accounts SET login_hash=? WHERE id=?")
              .run(await hashIdentityInput("e".repeat(64)), "a".repeat(16));
          return batch(statements);
        };
      }
      assert.equal(
        (await f.complete(start)).response.status,
        collision ? 400 : 503,
      );
      assert.equal(f.count("identity_guardians"), 0);
      assert.equal(
        f.db.sqlite.prepare("SELECT state FROM agent_identities LIMIT 1").get()!
          .state,
        "provisional",
      );
      assert.equal(
        f.db.sqlite
          .prepare("SELECT consumed_at FROM identity_guardian_challenges")
          .get()!.consumed_at,
        null,
      );
    } finally {
      f.db.close();
    }
  }
});
test("only public key material and purpose-bound hashes persist; confirmation alone cannot access Tower private authority", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    const { response } = await f.complete(start);
    assert.equal(response.status, 200);
    const tables = [
      "identity_guardians",
      "identity_guardian_passkeys",
      "identity_offline_recovery_codes",
      "identity_guardian_challenges",
      "identity_registration_requests",
      "identity_audit",
    ];
    const stored = tables
      .map((t) =>
        JSON.stringify(f.db.sqlite.prepare("SELECT * FROM " + t).all()),
      )
      .join("");
    for (const secret of [
      f.input.confirmationCode,
      "e".repeat(64),
      "private@example.com",
      '"d":',
      "BEGIN PRIVATE",
    ])
      assert(!stored.includes(secret), secret);
    assert.equal(f.count("sessions"), 0);
    assert.equal(f.count("tower_tokens"), 0);
    assert.equal(f.count("agent_tokens"), 0);
    const runtime = (await import("../server/live/worker.ts")).default;
    const denied = await runtime.fetch(
      new Request(origin + "/api/v1/agent/identity", {
        headers: { Authorization: "Bearer " + f.input.confirmationCode },
      }),
      { DB: f.db, PUBLIC_ORIGIN: origin },
    );
    assert.equal(denied.status, 403);
  } finally {
    f.db.close();
  }
});
test("options quotas count at most twenty distinct challenges per invite/hour; exact live retries do not charge again", async () => {
  const f = await fixture();
  try {
    const first = await f.begin();
    for (let n = 1; n < 20; n++)
      assert.equal(
        (
          await f.options({
            ...f.input,
            requestKey: "distinct-options-" + String(n).padStart(4, "0"),
          })
        ).status,
        200,
      );
    assert.equal(f.count("identity_guardian_challenges"), 20);
    assert.equal(
      (await f.options({ ...f.input, requestKey: "quota-overflow" })).status,
      429,
    );
    assert.deepEqual(await (await f.options()).json(), first);
    assert.equal(f.count("identity_guardian_challenges"), 20);
  } finally {
    f.db.close();
  }
});

test("Pages dispatches registration, gates every 0014 table/trigger, and derives recovery metadata from current persisted credentials", async () => {
  const f = await fixture();
  try {
    const runtime = (await import("../server/live/worker.ts")).default,
      env = {
        DB: f.db,
        PUBLIC_ORIGIN: origin,
        IDENTITY_CONTACT_KEY: contactKey,
      };
    // Runtime uses the real clock, so its fixture needs live-valid timestamps.
    const live = new Date().toISOString(),
      expiry = new Date(Date.now() + 86400000).toISOString();
    const bindingSQL = f.db.sqlite
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name='identity_guardian_immutable_binding'",
      )
      .get()!.sql;
    f.db.sqlite.exec("DROP TRIGGER identity_guardian_immutable_binding");
    f.db.sqlite
      .prepare("UPDATE identity_guardian_invites SET created_at=?,expires_at=?")
      .run(live, expiry);
    f.db.sqlite.exec(String(bindingSQL));
    f.setTime(live);
    f.db.sqlite.function(
      "strftime",
      { varargs: true },
      (...args) =>
        native.sqlite
          .prepare(
            "SELECT strftime(" + args.map(() => "?").join(",") + ") value",
          )
          .get(...args)!.value,
    );
    const req = () =>
      new Request(origin + base + "/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f.input),
      });
    const r = await runtime.fetch(req(), env);
    assert.equal(r.status, 200, await r.clone().text());
    const start = await r.json();
    f.setTime(new Date().toISOString());
    assert.equal((await f.complete(start)).response.status, 200);
    f.db.sqlite
      .prepare(
        "INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        "agent",
        "a".repeat(16),
        await hashIdentityInput("a".repeat(64)),
        JSON.stringify(["tower:read"]),
        "2099-01-01T00:00:00.000Z",
        live,
      );
    const metadata = async () =>
      runtime.fetch(
        new Request(origin + "/api/v1/agent/identity", {
          headers: { Authorization: "Bearer " + "a".repeat(64) },
        }),
        env,
      );
    assert.equal(
      (await (await metadata()).json()).identity.recoveryConfigured,
      true,
    );
    f.db.sqlite.exec(
      "UPDATE identity_guardian_passkeys SET revoked_at=created_at",
    );
    assert.equal(
      (await (await metadata()).json()).identity.recoveryConfigured,
      false,
    );
    f.db.sqlite.exec(
      "UPDATE identity_offline_recovery_codes SET consumed_at=created_at",
    );
    assert.equal(
      (await (await metadata()).json()).identity.recoveryConfigured,
      false,
    );
  } finally {
    f.db.close();
  }
});

test("an exact completion delayed behind the winning commit reads its permanent historical receipt", async () => {
  const f = await fixture();
  try {
    const start = await f.begin(),
      body = {
        ...f.input,
        requestKey: "delayed-complete",
        challengeId: start.challengeId,
        response: await f.authenticator.registration(start.options, origin),
        offlineRecoveryCode: "e".repeat(64),
        backupConfirmed: true,
      };
    const prepare = f.db.prepare.bind(f.db);
    let calls = 0,
      release!: () => void;
    const winner = new Promise<void>((r) => {
      release = r;
    });
    f.db.prepare = (sql: string) => {
      const statement = prepare(sql),
        bind = statement.bind.bind(statement);
      if (sql.startsWith("SELECT i.*,r.name")) {
        statement.bind = (...args: unknown[]) => {
          const bound = bind(...args),
            first = bound.first.bind(bound);
          bound.first = async <T>() => {
            if (++calls === 2) await winner;
            return first<T>();
          };
          return bound;
        };
      }
      return statement;
    };
    const a = f.send("/complete", body),
      b = f.send("/complete", body);
    const first = await a;
    release();
    assert.equal(first.status, 200);
    assert.equal((await b).status, 200);
    assert.equal(f.count("identity_audit"), 1);
  } finally {
    f.db.close();
  }
});
test("SQL clock expires queued options without charging logical challenge quota", async () => {
  const f = await fixture();
  try {
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async (statements) => {
      if (
        statements.some((s) =>
          (s as unknown as { sql: string }).sql.startsWith(
            "INSERT INTO identity_guardian_challenges",
          ),
        )
      )
        f.setTime(time, "2026-10-31T00:05:00.000Z");
      return batch(statements);
    };
    assert.equal((await f.options()).status, 409);
    assert.equal(f.count("identity_guardian_challenges"), 0);
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT count(*) n FROM rate_limits WHERE key NOT LIKE 'registration:http-ip:%'",
        )
        .get()!.n,
      0,
    );
  } finally {
    f.db.close();
  }
});

test("Pages refuses every missing 0014 credential table and immutable-binding trigger", async () => {
  const f = await fixture();
  try {
    const runtime = (await import("../server/live/worker.ts")).default,
      env = { DB: f.db, PUBLIC_ORIGIN: origin };
    for (const name of [
      "identity_guardians",
      "identity_guardian_passkeys",
      "identity_offline_recovery_codes",
      "identity_guardian_challenges",
      "identity_registration_requests",
    ]) {
      f.db.sqlite.exec("ALTER TABLE " + name + " RENAME TO hidden_" + name);
      const res = await runtime.fetch(
        new Request(origin + base + "/options", { method: "POST" }),
        env,
      );
      assert.equal(res.status, 503, name);
      assert.equal((await res.json()).error, "database_schema_not_ready");
      f.db.sqlite.exec("ALTER TABLE hidden_" + name + " RENAME TO " + name);
    }
    for (const name of [
      "identity_guardian_credential_binding",
      "identity_passkey_immutable_binding",
      "identity_challenge_immutable_binding",
    ]) {
      const sql = f.db.sqlite
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",
        )
        .get(name)!.sql;
      f.db.sqlite.exec("DROP TRIGGER " + name);
      assert.equal(
        (
          await runtime.fetch(
            new Request(origin + base + "/options", { method: "POST" }),
            env,
          )
        ).status,
        503,
        name,
      );
      f.db.sqlite.exec(String(sql));
    }
  } finally {
    f.db.close();
  }
});
test("native storage rejects transplanted guardians/passkeys, duplicate current codes and immutable challenge rewrites", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    assert.throws(() =>
      f.db.sqlite
        .prepare("UPDATE identity_guardian_challenges SET origin=?")
        .run("https://evil.example"),
    );
    assert.throws(() =>
      f.db.sqlite
        .prepare("UPDATE identity_guardian_challenges SET operation=?")
        .run("recovery"),
    );
    assert.throws(() =>
      f.db.sqlite
        .prepare(
          "INSERT INTO identity_guardians(guardian_id,agent_id,invitation_id,email_verified_at,created_at) VALUES(?,?,?,?,?)",
        )
        .run(
          "f".repeat(32),
          "mcid:" + "b".repeat(64),
          "a".repeat(32),
          time,
          time,
        ),
    );
    assert.equal((await f.complete(start)).response.status, 200);
    const g = f.db.sqlite.prepare("SELECT * FROM identity_guardians").get()!,
      p = f.db.sqlite
        .prepare("SELECT * FROM identity_guardian_passkeys")
        .get()!;
    assert.throws(() =>
      f.db.sqlite
        .prepare("UPDATE identity_guardians SET agent_id=?")
        .run("mcid:" + "b".repeat(64)),
    );
    assert.throws(() =>
      f.db.sqlite
        .prepare("UPDATE identity_guardian_passkeys SET public_key=?")
        .run("invalidkey"),
    );
    assert.throws(() =>
      f.db.sqlite
        .prepare("UPDATE identity_guardian_passkeys SET counter=-1")
        .run(),
    );
    assert.throws(() =>
      f.db.sqlite
        .prepare(
          "INSERT INTO identity_offline_recovery_codes(agent_id,code_hash,authority_epoch,identity_version,created_at,confirmed_at) VALUES(?,?,1,4,?,?)",
        )
        .run(g.agent_id, "f".repeat(64), time, time),
    );
    assert.throws(() =>
      f.db.sqlite
        .prepare(
          "INSERT INTO identity_guardian_passkeys(credential_id,guardian_id,agent_id,webauthn_user_id,public_key,counter,device_type,backed_up,transports_json,aaguid,created_at) VALUES(?,?,?,?,?,0,'singleDevice',0,'[]','aaguid',?)",
        )
        .run(
          "abc",
          g.guardian_id,
          "mcid:" + "b".repeat(64),
          "Q".repeat(43),
          p.public_key,
          time,
        ),
    );
  } finally {
    f.db.close();
  }
});
test("credential IDs are globally unique across households and both quota boundaries are atomic", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    assert.equal((await f.complete(start)).response.status, 200);
    const b = {
        ...f.input,
        requestKey: "options-other-home",
        invitationId: "b".repeat(32),
        confirmationCode: "d".repeat(64),
      },
      other = await f.begin(b);
    const response = await f.authenticator.registration(other.options, origin);
    assert.equal(
      (
        await f.complete(other, {
          ...b,
          requestKey: "complete-other-home",
          offlineRecoveryCode: "f".repeat(64),
          response,
        })
      ).response.status,
      409,
    );
    assert.equal(f.count("identity_guardians"), 1);
    assert.equal(f.count("identity_audit"), 1);
  } finally {
    f.db.close();
  }
  const quota = await fixture();
  try {
    quota.db.sqlite
      .prepare("INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?)")
      .run("registration:global", 999, "2026-10-31T01:00:00.000Z");
    quota.db.sqlite
      .prepare("INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?)")
      .run(
        "registration:" + quota.input.invitationId,
        19,
        "2026-10-31T01:00:00.000Z",
      );
    const results = await Promise.all([quota.options(), quota.options()]);
    assert.deepEqual(
      results.map((r) => r.status),
      [200, 200],
    );
    assert.equal(quota.count("identity_guardian_challenges"), 1);
    assert.equal(
      quota.db.sqlite
        .prepare("SELECT count FROM rate_limits WHERE key=?")
        .get("registration:global")!.count,
      1000,
    );
    assert.equal(
      (await quota.options({ ...quota.input, requestKey: "quota-after-last" }))
        .status,
      429,
    );
  } finally {
    quota.db.close();
  }
});
test("unconfigured local registration never reads provider keys or creates challenges", async () => {
  const f = await fixture();
  try {
    const { createIdentityRegistration } =
      await import("../server/live/identity-registration.ts");
    for (const environment of [
      { db: f.db, origin },
      { db: f.db, origin: "http://127.0.0.1:8787", contactKey },
    ]) {
      const res = await createIdentityRegistration(environment).fetch(
        new Request(environment.origin + base + "/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(f.input),
        }),
      );
      assert.equal(res!.status, 503);
    }
    assert.equal(f.count("identity_guardian_challenges"), 0);
  } finally {
    f.db.close();
  }
});

test("none attestation cannot smuggle EC private material or arbitrary fields into the stored COSE public key", async () => {
  const f = await fixture();
  try {
    const start = await f.begin(),
      jwk = await crypto.subtle.exportKey(
        "jwk",
        f.authenticator.keys.privateKey,
      );
    for (const [label, value] of [
      [-4, isoBase64URL.toBuffer(jwk.d!)],
      [99, new TextEncoder().encode("hidden-sensitive-metadata")],
    ] as const) {
      const cose = new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x!)],
        [-3, isoBase64URL.toBuffer(jwk.y!)],
        [label, value],
      ]);
      const response = await f.authenticator.registration(
        start.options,
        origin,
        { publicKey: isoCBOR.encode(cose) },
      );
      assert.equal(
        (await f.complete(start, { response })).response.status,
        400,
        String(label),
      );
      assert.equal(f.count("identity_guardian_passkeys"), 0);
    }
  } finally {
    f.db.close();
  }
});
test("revoked Passkeys are retained for audit but do not count as configured current recovery", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    assert.equal((await f.complete(start)).response.status, 200);
    assert(
      f.db.sqlite
        .prepare("PRAGMA table_info(identity_guardian_passkeys)")
        .all()
        .some((c) => c.name === "revoked_at"),
      "Passkey revocation metadata is implemented",
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT revoked_at FROM identity_guardian_passkeys")
        .get()!.revoked_at,
      null,
    );
    f.db.sqlite.exec(
      "UPDATE identity_guardian_passkeys SET revoked_at=created_at",
    );
    assert.equal(f.count("identity_guardian_passkeys"), 1);
    assert.throws(() =>
      f.db.sqlite.exec("UPDATE identity_guardian_passkeys SET revoked_at=NULL"),
    );
  } finally {
    f.db.close();
  }
});
test("transport metadata must be an allowlisted string array, never nested or coercible data", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    const response = await f.authenticator.registration(start.options, origin);
    (response.response as unknown as Record<string, unknown>).transports = [
      ["internal"],
    ];
    assert.equal((await f.complete(start, { response })).response.status, 400);
    assert.equal(f.count("identity_guardian_passkeys"), 0);
  } finally {
    f.db.close();
  }
});

test("thirty wrong confirmation attempts share a private IP bucket; another IP can use the same unclaimed invitation key", async () => {
  const f = await fixture();
  try {
    const ip = "203.0.113.17",
      other = "2001:db8::42",
      wrong = { ...f.input, confirmationCode: "f".repeat(64) };
    for (let n = 0; n < 30; n++)
      assert.equal(
        (await f.options(wrong, { "CF-Connecting-IP": ip })).status,
        403,
        String(n),
      );
    assert.equal(
      (await f.options(wrong, { "CF-Connecting-IP": ip })).status,
      429,
    );
    assert.equal(f.count("identity_guardian_challenges"), 0);
    assert.equal(
      f.db.sqlite
        .prepare("SELECT count FROM rate_limits WHERE key=?")
        .get("registration:" + f.input.invitationId),
      undefined,
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT count FROM rate_limits WHERE key=?")
        .get("registration:global"),
      undefined,
    );
    assert.equal(
      (await f.options(f.input, { "CF-Connecting-IP": other })).status,
      200,
    );
    const buckets = f.db.sqlite
      .prepare(
        "SELECT key FROM rate_limits WHERE key LIKE 'registration:http-ip:%'",
      )
      .all();
    assert.equal(buckets.length, 2);
    const persisted = JSON.stringify(
      f.db.sqlite.prepare("SELECT * FROM rate_limits").all(),
    );
    assert(!persisted.includes(ip));
    assert(!persisted.includes(other));
  } finally {
    f.db.close();
  }
});

test("unknown invitation retries and complete attempts share the HTTP IP ceiling without reserving invite keys", async () => {
  const f = await fixture();
  try {
    const headers = { "CF-Connecting-IP": "203.0.113.88" },
      unknown = { ...f.input, invitationId: "f".repeat(32) },
      body = {
        ...unknown,
        challengeId: "f".repeat(32),
        response: {},
        offlineRecoveryCode: "e".repeat(64),
        backupConfirmed: true,
      };
    for (let n = 0; n < 15; n++)
      assert.equal((await f.options(unknown, headers)).status, 403);
    for (let n = 0; n < 15; n++)
      assert.equal((await f.send("/complete", body, headers)).status, 403);
    assert.equal((await f.send("/complete", body, headers)).status, 429);
    assert.equal(f.count("identity_guardian_challenges"), 0);
    assert.equal(f.count("identity_registration_requests"), 0);
  } finally {
    f.db.close();
  }
});

test("HTTP IP quota uses a SQL-native sixty-second expiry, rejects before parsing, and does not exempt exact receipts", async () => {
  const f = await fixture();
  try {
    const start = await f.begin(),
      { body, response } = await f.complete(start);
    assert.equal(response.status, 200);
    for (let n = 0; n < 28; n++)
      assert.equal((await f.send("/complete", body)).status, 200);
    assert.equal((await f.send("/complete", body)).status, 429);
    assert.equal(f.count("identity_audit"), 1);
    f.setTime(time, "2026-10-31T00:01:00.000Z");
    assert.equal((await f.send("/complete", body)).status, 200);
    assert.equal(f.count("identity_audit"), 1);
    const rows = f.db.sqlite
      .prepare(
        "SELECT key,count,expires_at FROM rate_limits WHERE key LIKE 'registration:http-ip:%' ORDER BY key",
      )
      .all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 1);
    assert.equal(rows[0].expires_at, "2026-10-31T00:02:00.000Z");
    const ip = { "CF-Connecting-IP": "203.0.113.29" };
    for (let n = 0; n < 30; n++)
      assert.equal(
        (await f.options({ ...f.input, requestKey: "x" }, ip)).status,
        400,
      );
    const raw = new Request(origin + base + "/options", {
      method: "POST",
      headers: { "Content-Type": "text/plain", ...ip },
      body: "unparsed",
    });
    assert.equal((await f.handler.fetch(raw))!.status, 429);
    f.setTime(time, "2026-10-31T00:02:45.250Z");
    const offsetIP = "203.0.113.71";
    assert.equal(
      (
        await f.options(
          { ...f.input, requestKey: "x" },
          { "CF-Connecting-IP": offsetIP },
        )
      ).status,
      400,
    );
    const offsetBucket =
      "registration:http-ip:" +
      (await hashPrivate(contactKey, "registration-ip", offsetIP));
    assert.equal(
      f.db.sqlite
        .prepare("SELECT expires_at FROM rate_limits WHERE key=?")
        .get(offsetBucket)!.expires_at,
      "2026-10-31T00:03:45.250Z",
    );
  } finally {
    f.db.close();
  }
});

test("transport rejects do not spend a valid IP quota and oversized addresses map to the bounded unknown bucket", async () => {
  const f = await fixture();
  try {
    const headers = { "CF-Connecting-IP": "203.0.113.45" };
    for (let n = 0; n < 31; n++)
      assert.equal(
        (
          await f.options(f.input, {
            ...headers,
            Origin: "https://evil.example",
          })
        ).status,
        403,
      );
    assert.equal(f.count("rate_limits"), 0);
    assert.equal((await f.options(f.input, headers)).status, 200);
    for (let n = 0; n < 30; n++)
      assert.equal(
        (
          await f.options(
            {
              ...f.input,
              requestKey: "oversized-unclaimed",
              confirmationCode: "f".repeat(64),
            },
            { "CF-Connecting-IP": "a".repeat(65) },
          )
        ).status,
        403,
      );
    assert.equal(
      (await f.options({ ...f.input, confirmationCode: "f".repeat(64) }))
        .status,
      429,
    );
    const keys = JSON.stringify(
      f.db.sqlite.prepare("SELECT key FROM rate_limits").all(),
    );
    assert(!keys.includes("a".repeat(65)));
  } finally {
    f.db.close();
  }
});

test("concurrent HTTP requests atomically spend only the final available minute slot", async () => {
  const f = await fixture();
  try {
    const headers = { "CF-Connecting-IP": "203.0.113.99" },
      wrong = { ...f.input, confirmationCode: "f".repeat(64) };
    for (let n = 0; n < 29; n++)
      assert.equal((await f.options(wrong, headers)).status, 403);
    const responses = await Promise.all([
      f.options(wrong, headers),
      f.options(wrong, headers),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [403, 429]);
    assert.equal(f.count("identity_guardian_challenges"), 0);
  } finally {
    f.db.close();
  }
});

test("options authenticate the confirmation before disclosing whether a request key has already been used", async () => {
  const f = await fixture();
  try {
    await f.begin();
    const wrong = { ...f.input, confirmationCode: "f".repeat(64) };
    assert.equal((await f.options(wrong)).status, 403);
    assert.equal(
      (await f.options({ ...wrong, requestKey: "never-seen-before" })).status,
      403,
    );
    // A later valid confirmation for this invitation still cannot rebind the old logical key.
    f.db.sqlite
      .prepare(
        "UPDATE identity_guardian_invites SET invite_token_hash=? WHERE id=?",
      )
      .run(
        await hashPrivate(
          contactKey,
          "guardian-confirmation:" + f.input.invitationId,
          wrong.confirmationCode,
        ),
        f.input.invitationId,
      );
    assert.equal((await f.options(wrong)).status, 409);
    assert.equal(f.count("identity_guardian_challenges"), 1);
  } finally {
    f.db.close();
  }
});
