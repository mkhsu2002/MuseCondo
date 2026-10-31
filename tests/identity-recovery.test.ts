import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { LocalDatabase } from "../server/live/local-db.ts";
import { createIdentityRegistration } from "../server/live/identity-registration.ts";
import {
  encryptPrivate,
  hashIdentityInput,
  hashPrivate,
} from "../server/live/identity-private.ts";
import { identityAuthenticator } from "./helpers/identity-authenticator.ts";
const origin = "https://identity.example",
  time = "2026-10-31T00:00:00.000Z",
  contactKey = "9".repeat(64),
  account = "a".repeat(16),
  agentId = "mcid:" + "a".repeat(64),
  inviteId = "a".repeat(32),
  candidate = "1".repeat(64);
const native = new LocalDatabase(":memory:");
test.after(() => native.close());
async function fixture() {
  const db = new LocalDatabase(":memory:");
  for (const name of readdirSync(new URL("../migrations/", import.meta.url))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    db.sqlite.exec(
      readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
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
  db.sqlite
    .prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)")
    .run(account, await hashIdentityInput("a".repeat(64)), time);
  db.sqlite
    .prepare(
      "INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Synthetic Home','Private','resident','external-ready',?)",
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
      "https://source.example/a/condo.json",
      time,
      time,
    );
  db.sqlite
    .prepare(
      "INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,version,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,3,1,?,?)",
    )
    .run(agentId, account, account, account, time, time);
  db.sqlite
    .prepare(
      "INSERT INTO identity_guardian_invites(id,agent_id,account_id,version,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,invite_token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,2,3,1,'accepted',?,?,?,?,?,?)",
    )
    .run(
      inviteId,
      agentId,
      account,
      await encryptPrivate(
        contactKey,
        "guardian-recipient",
        agentId,
        "synthetic@example.com",
      ),
      await hashPrivate(contactKey, "guardian-email", "synthetic@example.com"),
      await hashPrivate(
        contactKey,
        "guardian-confirmation:" + inviteId,
        "c".repeat(64),
      ),
      "2026-11-01T00:00:00.000Z",
      time,
      time,
    );
  const registration = createIdentityRegistration({
    db,
    origin,
    contactKey,
    now: () => new Date(appNow),
  });
  const auth = await identityAuthenticator(),
    registrationInput = {
      requestKey: "registration-options",
      invitationId: inviteId,
      confirmationCode: "c".repeat(64),
    };
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request(origin + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const options = await (await registration.fetch(
    post("/api/v1/identity/guardian/registration/options", registrationInput),
  ))!.json();
  const registered = await registration.fetch(
    post("/api/v1/identity/guardian/registration/complete", {
      ...registrationInput,
      requestKey: "registration-complete",
      challengeId: options.challengeId,
      response: await auth.registration(options.options, origin),
      offlineRecoveryCode: "e".repeat(64),
      backupConfirmed: true,
    }),
  );
  assert.equal(registered!.status, 200, await registered!.clone().text());
  assert(
    existsSync(new URL("../server/live/identity-recovery.ts", import.meta.url)),
    "Passkey recovery handler must exist",
  );
  const { createIdentityRecovery } = await import(
    "../server/live/identity-recovery.ts"
  );
  const handler = createIdentityRecovery({
    db,
    origin,
    contactKey,
    now: () => new Date(appNow),
  });
  const send = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) => (await handler.fetch(post("/api/v1/identity/" + path, body, headers)))!;
  const create = (
    body: unknown = { requestKey: "candidate-request-1", agentId },
    key = candidate,
  ) => send("recovery/requests", body, { "X-Identity-Candidate-Key": key });
  const begin = async (
    decision = "continue",
    key = candidate,
    requestKey = "candidate-request-1",
  ) => {
    const r = await create({ requestKey, agentId }, key);
    assert.equal(r.status, 201, await r.clone().text());
    const request = await r.json();
    const context = await send("guardian/recovery/context", {
      requestId: request.requestId,
    });
    assert.equal(context.status, 200);
    const res = await send("guardian/recovery/options", {
      requestKey: "recovery-options-" + requestKey,
      requestId: request.requestId,
      decision,
      method: "passkey",
    });
    assert.equal(res.status, 200, await res.clone().text());
    return { ...(await res.json()), request };
  };
  const body = async (
    start: Awaited<ReturnType<typeof begin>>,
    extra: Record<string, unknown> = {},
  ) => ({
    requestKey: "recovery-complete-1",
    requestId: start.request.requestId,
    challengeId: start.challengeId,
    response: await auth.assertion(
      start.options,
      origin,
      options.options.user.id,
    ),
    ...(start.decision === "new"
      ? {}
      : { offlineRecoveryCode: "f".repeat(64), backupConfirmed: true }),
    ...extra,
  });
  const count = (table: string) =>
    Number(db.sqlite.prepare("SELECT COUNT(*) n FROM " + table).get()!.n);
  return {
    db,
    handler,
    auth,
    send,
    create,
    begin,
    body,
    count,
    userHandle: options.options.user.id,
    setTime: (app: string, nativeTime = app) => {
      appNow = app;
      dbNow = nativeTime;
    },
  };
}
test("continue requires a real scoped Passkey signature, atomically revokes every old authority and preserves the home", async () => {
  const f = await fixture();
  try {
    for (const [table, sql, raw] of [
      [
        "tower_tokens",
        'INSERT INTO tower_tokens(id,account_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,\'["tower:read","tower:write"]\',?,?)',
        "2".repeat(64),
      ],
      [
        "onboarding_grants",
        'INSERT INTO onboarding_grants(id,account_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,\'["home:read","home:onboard"]\',?,?)',
        "3".repeat(64),
      ],
      [
        "agent_tokens",
        "INSERT INTO agent_tokens(id,room_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,'[\"posts:write\"]',?,?)",
        "4".repeat(64),
      ],
    ]) {
      f.db.sqlite
        .prepare(sql)
        .run(
          table,
          account,
          await hashIdentityInput(raw),
          time,
          "2026-11-20T00:00:00.000Z",
        );
    }
    f.db.sqlite
      .prepare(
        "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)",
      )
      .run(
        await hashIdentityInput("5".repeat(64)),
        account,
        "csrf",
        "2026-11-20T00:00:00.000Z",
      );
    const home = f.db.sqlite.prepare("SELECT * FROM rooms").all(),
      residency = f.db.sqlite.prepare("SELECT * FROM tower_residencies").all();
    const start = await f.begin(),
      body = await f.body(start),
      bad = structuredClone(body);
    bad.response.response.signature =
      bad.response.response.signature.slice(0, -3) + "abc";
    assert.equal((await f.send("guardian/recovery/complete", bad)).status, 403);
    const response = await f.send("guardian/recovery/complete", body);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.state, "continued");
    assert.equal(result.agentId, agentId);
    assert(!JSON.stringify(result).includes(candidate));
    assert.deepEqual(f.db.sqlite.prepare("SELECT * FROM rooms").all(), home);
    assert.deepEqual(
      f.db.sqlite.prepare("SELECT * FROM tower_residencies").all(),
      residency,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT authority_epoch FROM agent_identities").get()!
        .authority_epoch,
      2,
    );
    for (const table of ["onboarding_grants", "agent_tokens"])
      assert.equal(
        f.db.sqlite.prepare("SELECT revoked FROM " + table).get()!.revoked,
        1,
      );
    assert.equal(f.count("sessions"), 0);
    assert.equal(f.count("identity_recovery_instances"), 1);
    assert.equal(f.count("identity_recovery_receipts"), 1);
    assert.equal(
      f.db.sqlite
        .prepare("SELECT count(*) n FROM tower_tokens WHERE revoked=0")
        .get()!.n,
      1,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT state FROM identity_mail_events").get()!
        .state,
      "pending",
    );
    assert.equal(
      (await f.send("guardian/recovery/complete", body)).status,
      200,
    );
    assert.equal(f.count("identity_recovery_instances"), 1);
    assert.equal(f.count("identity_recovery_receipts"), 1);
    const changed = { ...body, offlineRecoveryCode: "0".repeat(64) };
    assert.equal(
      (await f.send("guardian/recovery/complete", changed)).status,
      409,
    );
    const persisted = JSON.stringify(
      f.db.sqlite.prepare("SELECT * FROM identity_recovery_receipts").all(),
    );
    for (const secret of [
      candidate,
      "f".repeat(64),
      body.response.response.signature,
    ])
      assert(!persisted.includes(secret));
  } finally {
    f.db.close();
  }
});
test("new requires explicit decision and leaves old identity, backup, tokens and residence unchanged", async () => {
  const f = await fixture();
  try {
    const before = f.db.sqlite.prepare("SELECT * FROM agent_identities").all(),
      backup = f.db.sqlite
        .prepare("SELECT * FROM identity_offline_recovery_codes")
        .all();
    const start = await f.begin("new"),
      response = await f.send(
        "guardian/recovery/complete",
        await f.body(start),
      );
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).state, "new-admission-required");
    assert.deepEqual(
      f.db.sqlite.prepare("SELECT * FROM agent_identities").all(),
      before,
    );
    assert.deepEqual(
      f.db.sqlite
        .prepare("SELECT * FROM identity_offline_recovery_codes")
        .all(),
      backup,
    );
    assert.equal(f.count("tower_tokens"), 0);
    assert.equal(f.count("identity_recovery_instances"), 0);
  } finally {
    f.db.close();
  }
});

test("fresh and historical requests reject wrong scope, signature, challenge, rp, origin, UV, handle and private fields before receipt reads", async () => {
  const f = await fixture();
  try {
    const start = await f.begin(),
      body = await f.body(start);
    assert.equal(
      (await f.send("guardian/recovery/complete", body)).status,
      200,
    );
    const prepare = f.db.prepare.bind(f.db);
    let receipts = 0;
    f.db.prepare = (sql: string) => {
      if (
        sql.startsWith(
          "SELECT input_hash,response_json FROM identity_recovery_receipts",
        )
      )
        receipts++;
      return prepare(sql);
    };
    const other = await identityAuthenticator();
    for (const overrides of [
      { challenge: "wrong-challenge" },
      { rpID: "evil.example" },
      { origin: "https://evil.example" },
      { flags: 1 },
      { flags: 4 },
      { flags: 0x15 },
      { counter: 0, signingKey: other.keys.privateKey },
      { userHandle: "A".repeat(43) },
      { client: { crossOrigin: true } },
      { client: { topOrigin: "https://evil.example" } },
    ]) {
      const response = await f.auth.assertion(
        start.options,
        origin,
        f.userHandle,
        overrides,
      );
      const r = await f.send("guardian/recovery/complete", {
        ...body,
        response,
      });
      assert.equal(r.status, 403, JSON.stringify(overrides));
    }
    const nested = structuredClone(body);
    (
      nested.response.response as unknown as Record<string, unknown>
    ).privateKey = "not-accepted";
    assert.equal(
      (await f.send("guardian/recovery/complete", nested)).status,
      403,
    );
    assert.equal(receipts, 0);
    assert.equal(
      (await f.send("guardian/recovery/complete", body)).status,
      200,
    );
    assert(receipts > 0);
  } finally {
    f.db.close();
  }
});
test("candidate proof scopes create idempotency and minimal status; no key reuse with any current or historical credential/code", async () => {
  const f = await fixture();
  try {
    for (const raw of ["a".repeat(64), "e".repeat(64)])
      assert.equal((await f.create(undefined, raw)).status, 409);
    const res = await f.create();
    assert.equal(res.status, 201);
    const request = await res.json();
    assert.equal((await f.create()).status, 201);
    assert.equal(
      (await f.create({ requestKey: "different-request", agentId })).status,
      409,
    );
    const get = (raw: string) =>
      f.handler.fetch(
        new Request(
          origin + "/api/v1/identity/recovery/requests/" + request.requestId,
          { headers: { "X-Identity-Candidate-Key": raw } },
        ),
      );
    assert.equal((await get("2".repeat(64)))!.status, 403);
    const view = await (await get(candidate))!.json();
    assert.deepEqual(Object.keys(view).sort(), [
      "agentId",
      "expiresAt",
      "requestId",
      "state",
    ]);
    assert(!JSON.stringify(view).includes("synthetic@example.com"));
    f.db.sqlite
      .prepare(
        "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)",
      )
      .run(
        await hashIdentityInput("6".repeat(64)),
        account,
        "csrf",
        "2026-11-20T00:00:00.000Z",
      );
    f.db.sqlite.exec("DELETE FROM sessions");
    assert.equal(
      (
        await f.create(
          { requestKey: "history-session", agentId },
          "6".repeat(64),
        )
      ).status,
      409,
    );
    const bad = {
      requestKey: "no-default-choice",
      requestId: request.requestId,
      method: "passkey",
    };
    assert.equal((await f.send("guardian/recovery/options", bad)).status, 400);
  } finally {
    f.db.close();
  }
});
test("HTTP recovery protection rejects mixed credentials, cross-origin, query secrets and bounded malformed payloads; private fixed IP quota precedes parsing", async () => {
  const f = await fixture();
  try {
    for (const headers of [
      { Origin: "https://evil.example" },
      { Cookie: "muse_session=x" },
      { Authorization: "Bearer x" },
      { "Sec-Fetch-Site": "cross-site" },
    ] as Record<string, string>[])
      assert.equal(
        (
          await f
            .create(undefined, candidate)
            .then(async () =>
              f.send(
                "recovery/requests",
                { requestKey: "new-transport-key", agentId },
                { ...headers, "X-Identity-Candidate-Key": "8".repeat(64) },
              ),
            )
        ).status,
        403,
      );
    const req = (
      suffix: string,
      headers: Record<string, string>,
      body = "unparsed",
    ) =>
      f.handler.fetch(
        new Request(
          origin + "/api/v1/identity/guardian/recovery/context" + suffix,
          { method: "POST", headers, body },
        ),
      );
    assert.equal(
      (await req("?key=forbidden", { "Content-Type": "application/json" }))!
        .status,
      400,
    );
    assert.equal(
      (await req("", {
        "Content-Type": "text/plain",
        "CF-Connecting-IP": "203.0.113.88",
      }))!.status,
      415,
    );
    assert.equal(
      (await req(
        "",
        {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.88",
        },
        "x".repeat(32769),
      ))!.status,
      413,
    );
    for (let n = 0; n < 28; n++)
      assert.equal(
        (await req("", {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.88",
        }))!.status,
        400,
      );
    const limited = (await req("", {
      "Content-Type": "text/plain",
      "CF-Connecting-IP": "203.0.113.88",
    }))!;
    assert.equal(limited.status, 429);
    for (const [name, value] of [
      ["Cache-Control", "no-store"],
      ["Referrer-Policy", "no-referrer"],
      ["X-Content-Type-Options", "nosniff"],
      ["X-Robots-Tag", "noindex, nofollow"],
    ])
      assert.equal(limited.headers.get(name), value);
    const rows = f.db.sqlite
      .prepare("SELECT * FROM rate_limits WHERE key LIKE 'recovery:http-ip:%'")
      .all();
    assert(!JSON.stringify(rows).includes("203.0.113.88"));
    assert(rows.length <= 2);
    f.setTime(time, "2026-10-31T00:01:00.000Z");
    assert.equal(
      (await req("", {
        "Content-Type": "text/plain",
        "CF-Connecting-IP": "203.0.113.88",
      }))!.status,
      415,
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT count FROM rate_limits WHERE key=?")
        .get(
          "recovery:http-ip:" +
            (await hashPrivate(
              contactKey,
              "identity-recovery-ip",
              "203.0.113.88",
            )),
        )!.count,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("continue rejects reused backup generations and candidate keys without consuming anything", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    for (const code of ["e".repeat(64), candidate, "a".repeat(64)]) {
      const r = await f.send(
        "guardian/recovery/complete",
        await f.body(start, { offlineRecoveryCode: code }),
      );
      assert.equal(r.status, 409);
      assert.equal(f.count("identity_recovery_receipts"), 0);
      assert.equal(
        f.db.sqlite
          .prepare("SELECT authority_epoch FROM agent_identities")
          .get()!.authority_epoch,
        1,
      );
    }
    assert.equal(
      (await f.send("guardian/recovery/complete", await f.body(start))).status,
      200,
    );
  } finally {
    f.db.close();
  }
});
test("DB execution clocks, guardian/counter/tuple changes and two simultaneous requests revalidate inside the transaction", async () => {
  for (const mutation of [
    "clock",
    "guardian",
    "counter",
    "revoked",
    "binding",
  ]) {
    const f = await fixture();
    try {
      const start = await f.begin(),
        body = await f.body(start),
        batch = f.db.batch.bind(f.db);
      let changed = false;
      f.db.batch = async (rows) => {
        if (
          !changed &&
          rows.some(
            (s) =>
              "sql" in s &&
              String(s.sql).startsWith(
                "INSERT INTO identity_recovery_receipts",
              ),
          )
        ) {
          changed = true;
          if (mutation === "clock") f.setTime(time, "2026-10-31T00:05:00.000Z");
          else if (mutation === "guardian")
            f.db.sqlite.exec("UPDATE identity_guardians SET version=version+1");
          else if (mutation === "counter")
            f.db.sqlite.exec("UPDATE identity_guardian_passkeys SET counter=8");
          else if (mutation === "revoked")
            f.db.sqlite.exec(
              "UPDATE identity_guardian_passkeys SET revoked_at=created_at",
            );
          else
            f.db.sqlite.exec(
              "UPDATE tower_residencies SET resident_id='bbbbbbbbbbbbbbbb'",
            );
        }
        return batch(rows);
      };
      assert.equal(
        (await f.send("guardian/recovery/complete", body)).status,
        409,
        mutation,
      );
      assert.equal(f.count("identity_recovery_receipts"), 0);
      assert.equal(f.count("tower_tokens"), 0);
      assert.equal(
        f.db.sqlite
          .prepare("SELECT authority_epoch FROM agent_identities")
          .get()!.authority_epoch,
        1,
      );
    } finally {
      f.db.close();
    }
  }
  const f = await fixture();
  try {
    const a = await f.begin("continue"),
      b = await f.begin("continue", "2".repeat(64), "candidate-request-2"),
      bodies = await Promise.all([
        f.body(a),
        f.body(b, {
          requestKey: "recovery-complete-2",
          offlineRecoveryCode: "7".repeat(64),
        }),
      ]);
    const responses = await Promise.all(
      bodies.map((body) => f.send("guardian/recovery/complete", body)),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(f.count("identity_recovery_receipts"), 1);
    assert.equal(f.count("identity_recovery_instances"), 1);
  } finally {
    f.db.close();
  }
});
test("same body concurrent retries return one receipt; revoked key reads exact history but cannot authorize new work", async () => {
  const f = await fixture();
  try {
    const start = await f.begin(),
      body = await f.body(start);
    const responses = await Promise.all([
      f.send("guardian/recovery/complete", body),
      f.send("guardian/recovery/complete", body),
    ]);
    assert.deepEqual(
      responses.map((r) => r.status),
      [200, 200],
    );
    assert.deepEqual(await responses[0].json(), await responses[1].json());
    f.db.sqlite.exec(
      "UPDATE identity_guardian_passkeys SET revoked_at=created_at",
    );
    f.setTime("2026-11-02T00:00:00.000Z");
    assert.equal(
      (await f.send("guardian/recovery/complete", body)).status,
      200,
    );
    assert.equal(
      (
        await f.send("guardian/recovery/complete", {
          ...body,
          requestKey: "fresh-after-revoke",
        })
      ).status,
      409,
    );
    assert.equal(f.count("identity_recovery_receipts"), 1);
  } finally {
    f.db.close();
  }
});

test("login read before recovery cannot insert a new session after the account credential changes", async () => {
  const f = await fixture();
  try {
    const { createLiveApp } = await import("../server/live/app.ts");
    const start = await f.begin(),
      body = await f.body(start),
      prepare = f.db.prepare.bind(f.db);
    let ran = false;
    f.db.prepare = (sql: string) => {
      const statement = prepare(sql);
      if (
        sql.startsWith("SELECT id,test_only FROM accounts WHERE login_hash=")
      ) {
        const bind = statement.bind.bind(statement);
        statement.bind = (...values: unknown[]) => {
          const bound = bind(...values),
            first = bound.first.bind(bound);
          bound.first = async <T>() => {
            const result = await first<T>();
            if (!ran) {
              ran = true;
              assert.equal(
                (await f.send("guardian/recovery/complete", body)).status,
                200,
              );
            }
            return result;
          };
          return bound;
        };
      }
      return statement;
    };
    const app = createLiveApp({
        db: f.db,
        origin,
        localTest: true,
        registrationEnabled: false,
        now: () => new Date(time),
      }),
      res = await app.fetch(
        new Request(origin + "/api/v1/session", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ credential: "a".repeat(64) }),
        }),
      );
    assert(res.status >= 400);
    assert.equal(f.count("sessions"), 0);
  } finally {
    f.db.close();
  }
});
test("owner token and onboarding-grant mints begun with old session cannot survive recovery before their write", async () => {
  for (const endpoint of ["tokens", "onboarding-grants"]) {
    const f = await fixture();
    try {
      const { createLiveApp } = await import("../server/live/app.ts");
      const raw = "6".repeat(64);
      f.db.sqlite
        .prepare(
          "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)",
        )
        .run(
          await hashIdentityInput(raw),
          account,
          "synthetic-csrf",
          "2026-11-20T00:00:00.000Z",
        );
      const start = await f.begin(),
        body = await f.body(start),
        table = endpoint === "tokens" ? "agent_tokens" : "onboarding_grants",
        prefix = "INSERT INTO " + table,
        prepare = f.db.prepare.bind(f.db),
        batch = f.db.batch.bind(f.db);
      let ran = false;
      const recover = async () => {
        if (!ran) {
          ran = true;
          assert.equal(
            (await f.send("guardian/recovery/complete", body)).status,
            200,
          );
        }
      };
      f.db.prepare = (sql: string) => {
        const statement = prepare(sql);
        if (sql.startsWith(prefix)) {
          const bind = statement.bind.bind(statement);
          statement.bind = (...values: unknown[]) => {
            const bound = bind(...values),
              run = bound.run.bind(bound);
            bound.run = async () => {
              await recover();
              return run();
            };
            return bound;
          };
        }
        return statement;
      };
      f.db.batch = async (rows) => {
        if (rows.some((s) => "sql" in s && String(s.sql).startsWith(prefix)))
          await recover();
        return batch(rows);
      };
      const app = createLiveApp({
        db: f.db,
        origin,
        localTest: true,
        registrationEnabled: false,
        now: () => new Date(time),
      });
      const response = await app.fetch(
        new Request(origin + "/api/v1/me/" + endpoint, {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Cookie: "muse_session=" + raw,
            "X-CSRF-Token": "synthetic-csrf",
          },
          body: JSON.stringify(
            endpoint === "tokens"
              ? { scopes: ["posts:write"] }
              : { scopes: ["home:read", "home:onboard"], analyzeConsent: true },
          ),
        }),
      );
      assert(response.status >= 400, endpoint);
      assert(ran);
      assert.equal(f.count(table), 0, endpoint);
    } finally {
      f.db.close();
    }
  }
});
test("reserved security-notice and identity-card mail events remain pending with no delivery attempt", async () => {
  const f = await fixture();
  try {
    const { createIdentityMail } = await import(
      "../server/live/identity-mail.ts"
    );
    const start = await f.begin();
    assert.equal(
      (await f.send("guardian/recovery/complete", await f.body(start))).status,
      200,
    );
    const event = f.db.sqlite
      .prepare("SELECT * FROM identity_mail_events")
      .get()!;
    let calls = 0;
    const mail = createIdentityMail({
      db: f.db,
      origin,
      contactKey,
      apiKey: "synthetic-provider-key",
      from: "Synthetic <sender@example.com>",
      fetcher: async () => {
        calls++;
        throw new Error("must not dispatch");
      },
    });
    for (const kind of ["security-notice", "identity-card"]) {
      f.db.sqlite
        .prepare("UPDATE identity_mail_events SET kind=? WHERE id=?")
        .run(kind, event.id);
      const status = await mail.processOne(String(event.id));
      assert.equal(status!.state, "pending");
      assert.equal(status!.attemptCount, 0);
    }
    assert.equal(calls, 0);
  } finally {
    f.db.close();
  }
});

test("legacy reception approval and pre-existing approval activation cannot bypass a designated guardian", async () => {
  for (const state of ["pending", "approved"]) {
    const f = await fixture();
    try {
      const { createTowerReception } = await import(
          "../server/live/reception.ts"
        ),
        caseId = "b".repeat(32),
        caseKey = "7".repeat(64);
      f.db.sqlite
        .prepare(
          "INSERT INTO tower_reception_cases(id,token_hash,state,name,request_kind,request_text,source_url,resident_id,account_id,approval_expires_at,authorization_json,sharing_json,visit_plan_json,next_action,expires_at,created_at,updated_at) VALUES(?,?,?,'Synthetic','takeover','Help',?,?,?,?, '{}','{}','{}','Wait',?,?,?)",
        )
        .run(
          caseId,
          await hashIdentityInput(caseKey),
          state,
          "https://source.example/a/condo.json",
          account,
          state === "pending" ? null : account,
          state === "pending" ? null : "2026-11-01T00:00:00.000Z",
          "2026-11-01T00:00:00.000Z",
          time,
          time,
        );
      const handler = createTowerReception({
          db: f.db,
          origin,
          now: () => new Date(time),
          operator: async () => true,
        }),
        operation = state === "pending" ? "approve" : "activate",
        res = await handler.fetch(
          new Request(
            origin +
              "/api/v1/" +
              (state === "pending" ? "operator/" : "") +
              "reception/cases/" +
              caseId +
              "/" +
              operation,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(state === "pending"
                  ? {}
                  : {
                      Authorization: "Bearer " + caseKey,
                      "X-Tower-Agent-Key": "8".repeat(64),
                    }),
              },
              body: JSON.stringify({
                requestKey: "legacy-" + operation,
                expectedVersion: 1,
                ...(state === "pending"
                  ? {
                      accountId: account,
                      residentId: account,
                      sourceURL: "https://source.example/a/condo.json",
                      approvedDays: 1,
                    }
                  : {}),
              }),
            },
          ),
        );
      assert.equal(res!.status, 409, state);
      assert.equal(f.count("tower_tokens"), 0);
      assert.equal(
        f.db.sqlite.prepare("SELECT state FROM tower_reception_cases").get()!
          .state,
        state,
      );
    } finally {
      f.db.close();
    }
  }
});

test("Pages dispatches recovery and requires every new schema object; machine capability remains unavailable overall", async () => {
  const f = await fixture();
  try {
    const worker = (await import("../server/live/worker.ts")).default,
      request = () =>
        new Request(origin + "/api/v1/identity/recovery/requests", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Identity-Candidate-Key": candidate,
          },
          body: JSON.stringify({ requestKey: "runtime-request", agentId }),
        });
    const response = await worker.fetch(request(), {
      DB: f.db,
      PUBLIC_ORIGIN: origin,
    });
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).error,
      "identity_recovery_not_configured",
    );
    const objects = f.db.sqlite
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'identity_recovery_%' OR name LIKE 'identity_history_%' OR name='identity_secret_history' OR name LIKE 'identity_offline_history_%'",
      )
      .all();
    assert(objects.length >= 15);
    for (const object of objects.filter(
      (x) => x.type === "table" || x.type === "trigger",
    )) {
      f.db.sqlite.exec("SAVEPOINT missing_object");
      try {
        f.db.sqlite.exec("DROP " + object.type + " " + object.name);
        const missing = await worker.fetch(request(), {
          DB: f.db,
          PUBLIC_ORIGIN: origin,
        });
        assert.equal(missing.status, 503, String(object.name));
        assert.equal(
          (await missing.json()).error,
          "database_schema_not_ready",
          String(object.name),
        );
      } finally {
        f.db.sqlite.exec("ROLLBACK TO missing_object; RELEASE missing_object");
      }
    }
    const capability = JSON.parse(
      readFileSync(
        new URL("../public/identity-onboarding.json", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(capability.recovery.recoveryAvailable, false);
    assert.equal(capability.recovery.offlineCodeResetAvailable, false);
    assert.equal(capability.recovery.backendMethods[0], "passkey");
  } finally {
    f.db.close();
  }
});

test("a second household cannot register any recovery candidate as its offline backup", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.create()).status, 201);
    const otherAccount = "b".repeat(16),
      otherAgent = "mcid:" + "b".repeat(64),
      otherInvite = "b".repeat(32),
      confirmation = "d".repeat(64);
    f.db.sqlite
      .prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)")
      .run(otherAccount, await hashIdentityInput("b".repeat(64)), time);
    f.db.sqlite
      .prepare(
        "INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Other Home','Private','resident','external-ready',?)",
      )
      .run(otherAccount, otherAccount, time);
    f.db.sqlite
      .prepare(
        "INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)",
      )
      .run(
        otherAccount,
        otherAccount,
        otherAccount,
        "https://source.example/b/condo.json",
        time,
        time,
      );
    f.db.sqlite
      .prepare(
        "INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,version,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,3,1,?,?)",
      )
      .run(otherAgent, otherAccount, otherAccount, otherAccount, time, time);
    f.db.sqlite
      .prepare(
        "INSERT INTO identity_guardian_invites(id,agent_id,account_id,version,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,invite_token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,2,3,1,'accepted',?,?,?,?,?,?)",
      )
      .run(
        otherInvite,
        otherAgent,
        otherAccount,
        await encryptPrivate(
          contactKey,
          "guardian-recipient",
          otherAgent,
          "other@example.com",
        ),
        await hashPrivate(contactKey, "guardian-email", "other@example.com"),
        await hashPrivate(
          contactKey,
          "guardian-confirmation:" + otherInvite,
          confirmation,
        ),
        "2026-11-01T00:00:00.000Z",
        time,
        time,
      );
    const handler = createIdentityRegistration({
        db: f.db,
        origin,
        contactKey,
        now: () => new Date(time),
      }),
      input = {
        requestKey: "other-household-options",
        invitationId: otherInvite,
        confirmationCode: confirmation,
      },
      send = (path: string, body: unknown) =>
        handler.fetch(
          new Request(
            origin + "/api/v1/identity/guardian/registration/" + path,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
          ),
        );
    const start = await (await send("options", input))!.json(),
      auth = await identityAuthenticator(),
      res = await send("complete", {
        ...input,
        requestKey: "other-household-complete",
        challengeId: start.challengeId,
        response: await auth.registration(start.options, origin),
        offlineRecoveryCode: candidate,
        backupConfirmed: true,
      });
    assert.equal(res!.status, 400);
    assert.equal(f.count("identity_guardians"), 1);
    assert.equal(f.count("identity_offline_recovery_codes"), 1);
  } finally {
    f.db.close();
  }
});

test("old credential paths reject after continue and the candidate key is only a scoped Tower credential", async () => {
  const f = await fixture();
  try {
    const { createLiveApp } = await import("../server/live/app.ts"),
      { createTowerIntake } = await import("../server/live/tower-intake.ts");
    const sessionKey = "6".repeat(64),
      towerKey = "2".repeat(64),
      legacyKey = "3".repeat(64),
      onboardingKey = "4".repeat(64),
      expires = "2026-11-20T00:00:00.000Z";
    f.db.sqlite
      .prepare(
        "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)",
      )
      .run(await hashIdentityInput(sessionKey), account, "csrf", expires);
    f.db.sqlite
      .prepare(
        'INSERT INTO tower_tokens(id,account_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,\'["tower:read","tower:write"]\',?,?)',
      )
      .run(
        "old-tower",
        account,
        await hashIdentityInput(towerKey),
        time,
        expires,
      );
    f.db.sqlite
      .prepare(
        "INSERT INTO agent_tokens(id,room_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,'[\"dreams:read\"]',?,?)",
      )
      .run(
        "old-legacy",
        account,
        await hashIdentityInput(legacyKey),
        time,
        expires,
      );
    f.db.sqlite
      .prepare(
        'INSERT INTO onboarding_grants(id,account_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,\'["home:read","home:onboard"]\',?,?)',
      )
      .run(
        "old-onboarding",
        account,
        await hashIdentityInput(onboardingKey),
        time,
        expires,
      );
    const start = await f.begin(),
      res = await f.send("guardian/recovery/complete", await f.body(start));
    assert.equal(res.status, 200);
    const app = createLiveApp({
        db: f.db,
        origin,
        localTest: true,
        registrationEnabled: false,
        now: () => new Date(time),
      }),
      intake = createTowerIntake({
        sourceOrigins: [],
        db: f.db,
        origin,
        localTest: true,
        now: () => new Date(time),
      });
    const login = await app.fetch(
      new Request(origin + "/api/v1/session", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ credential: "a".repeat(64) }),
      }),
    );
    assert.equal(login.status, 401);
    assert.equal(
      (
        await app.fetch(
          new Request(origin + "/api/v1/me", {
            headers: { Cookie: "muse_session=" + sessionKey },
          }),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await app.fetch(
          new Request(origin + "/api/v1/agent/home", {
            headers: { Authorization: "Bearer " + onboardingKey },
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await app.fetch(
          new Request(origin + "/api/v1/agent/rooms/" + account + "/dreams", {
            headers: { Authorization: "Bearer " + legacyKey },
          }),
        )
      ).status,
      403,
    );
    for (const raw of [towerKey, candidate]) {
      const response = await intake.fetch(
        new Request(origin + "/api/v1/agent/tower-intake", {
          headers: { Authorization: "Bearer " + raw },
        }),
      );
      assert.equal(response!.status, raw === candidate ? 200 : 403);
    }
    for (const raw of [
      "a".repeat(64),
      sessionKey,
      towerKey,
      legacyKey,
      onboardingKey,
    ])
      assert.equal(
        (await f.create({ requestKey: "post-recovery-history", agentId }, raw))
          .status,
        409,
      );
  } finally {
    f.db.close();
  }
});

test("ordered races allow either request to win while the delayed transaction rolls back all authority", async () => {
  for (const first of [0, 1]) {
    const f = await fixture();
    let release = () => {};
    try {
      const starts = [
          await f.begin("continue"),
          await f.begin("continue", "2".repeat(64), "race-request-two"),
        ],
        bodies = await Promise.all(
          starts.map((s, n) =>
            f.body(s, {
              requestKey: "ordered-complete-" + n,
              offlineRecoveryCode: (n ? "7" : "8").repeat(64),
            }),
          ),
        ),
        batch = f.db.batch.bind(f.db);
      let entered = () => {};
      const waiting = new Promise<void>((r) => {
          entered = r;
        }),
        gate = new Promise<void>((r) => {
          release = r;
        });
      let paused = false;
      f.db.batch = async (rows) => {
        if (
          !paused &&
          rows.some(
            (s) =>
              "sql" in s &&
              String(s.sql).startsWith(
                "INSERT INTO identity_recovery_receipts",
              ),
          )
        ) {
          paused = true;
          entered();
          await gate;
        }
        return batch(rows);
      };
      const delayed = f.send("guardian/recovery/complete", bodies[first]);
      await waiting;
      try {
        const winner = await f.send(
          "guardian/recovery/complete",
          bodies[1 - first],
        );
        assert.equal(winner.status, 200);
      } finally {
        release();
      }
      assert.equal((await delayed).status, 409);
      assert.equal(f.count("tower_tokens"), 1);
      assert.equal(f.count("identity_recovery_instances"), 1);
      assert.equal(
        f.db.sqlite
          .prepare("SELECT request_id FROM identity_recovery_instances")
          .get()!.request_id,
        starts[1 - first].request.requestId,
      );
    } finally {
      release();
      f.db.close();
    }
  }
});
test("inflight Tower owner rotation cannot revoke the new recovery token or mint another token", async () => {
  const f = await fixture();
  try {
    const { createTowerIntake } = await import(
        "../server/live/tower-intake.ts"
      ),
      raw = "6".repeat(64);
    f.db.sqlite
      .prepare(
        "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)",
      )
      .run(
        await hashIdentityInput(raw),
        account,
        "csrf",
        "2026-11-20T00:00:00.000Z",
      );
    const start = await f.begin(),
      body = await f.body(start),
      batch = f.db.batch.bind(f.db);
    let ran = false;
    f.db.batch = async (rows) => {
      if (
        !ran &&
        rows.some(
          (s) =>
            "sql" in s && String(s.sql).startsWith("INSERT INTO tower_tokens"),
        )
      ) {
        ran = true;
        assert.equal(
          (await f.send("guardian/recovery/complete", body)).status,
          200,
        );
      }
      return batch(rows);
    };
    const intake = createTowerIntake({
        sourceOrigins: [],
        db: f.db,
        origin,
        localTest: true,
        now: () => new Date(time),
      }),
      response = await intake.fetch(
        new Request(origin + "/api/v1/me/tower-intake/tokens", {
          method: "POST",
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Cookie: "muse_session=" + raw,
            "X-CSRF-Token": "csrf",
          },
          body: "{}",
        }),
      );
    assert.equal(response!.status, 403);
    assert(ran);
    assert.equal(f.count("tower_tokens"), 1);
    assert.equal(
      f.db.sqlite.prepare("SELECT revoked FROM tower_tokens").get()!.revoked,
      0,
    );
  } finally {
    f.db.close();
  }
});

test("a new signed operation still enforces the stored counter while the original signed receipt remains readable", async () => {
  const f = await fixture();
  try {
    const original = await f.begin("new"),
      body = await f.body(original);
    assert.equal(
      (await f.send("guardian/recovery/complete", body)).status,
      200,
    );
    const next = await f.begin("new", "2".repeat(64), "counter-second-request"),
      repeatCounter = await f.body(next, {
        requestKey: "counter-fresh-complete",
      });
    assert.equal(
      (await f.send("guardian/recovery/complete", repeatCounter)).status,
      403,
    );
    assert.equal(
      (await f.send("guardian/recovery/complete", body)).status,
      200,
    );
    assert.equal(f.count("identity_recovery_receipts"), 1);
  } finally {
    f.db.close();
  }
});
test("native session expiry is rechecked at an owner mint and Tower rotation execution boundary", async () => {
  for (const route of ["legacy", "tower"]) {
    const f = await fixture();
    try {
      const { createLiveApp } = await import("../server/live/app.ts"),
        { createTowerIntake } = await import("../server/live/tower-intake.ts"),
        raw = "6".repeat(64);
      f.db.sqlite
        .prepare(
          "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)",
        )
        .run(
          await hashIdentityInput(raw),
          account,
          "csrf",
          "2026-10-31T00:00:01.000Z",
        );
      const batch = f.db.batch.bind(f.db);
      f.db.batch = async (rows) => {
        if (
          rows.some(
            (s) =>
              "sql" in s &&
              /^INSERT INTO (agent_tokens|tower_tokens)/.test(String(s.sql)),
          )
        )
          f.setTime(time, "2026-10-31T00:00:01.000Z");
        return batch(rows);
      };
      const handler =
          route === "legacy"
            ? createLiveApp({
                db: f.db,
                origin,
                localTest: true,
                registrationEnabled: false,
                now: () => new Date(time),
              })
            : createTowerIntake({
                sourceOrigins: [],
                db: f.db,
                origin,
                localTest: true,
                now: () => new Date(time),
              }),
        response = await handler.fetch(
          new Request(
            origin +
              "/api/v1/me/" +
              (route === "legacy" ? "tokens" : "tower-intake/tokens"),
            {
              method: "POST",
              headers: {
                Origin: origin,
                "Content-Type": "application/json",
                Cookie: "muse_session=" + raw,
                "X-CSRF-Token": "csrf",
              },
              body: JSON.stringify(
                route === "legacy" ? { scopes: ["posts:write"] } : {},
              ),
            },
          ),
        );
      assert.equal(response!.status, 403, route);
      assert.equal(f.count("agent_tokens"), 0);
      assert.equal(f.count("tower_tokens"), 0);
    } finally {
      f.db.close();
    }
  }
});

test("fixed global quotas count a concurrent logical create once and return 429 without reserving another candidate", async () => {
  const f = await fixture();
  try {
    f.db.sqlite
      .prepare("INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?)")
      .run("recovery:global:requests", 999, "2026-10-31T01:00:00.000Z");
    const responses = await Promise.all([f.create(), f.create()]);
    assert.deepEqual(
      responses.map((r) => r.status),
      [201, 201],
    );
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT count FROM rate_limits WHERE key='recovery:global:requests'",
        )
        .get()!.count,
      1000,
    );
    assert.equal(f.count("identity_recovery_requests"), 1);
    assert.equal(
      (
        await f.create(
          { requestKey: "quota-new-candidate", agentId },
          "2".repeat(64),
        )
      ).status,
      429,
    );
    assert.equal(f.count("identity_recovery_requests"), 1);
  } finally {
    f.db.close();
  }
});
