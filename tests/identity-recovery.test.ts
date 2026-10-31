import test from "node:test";
import {
  isoBase64URL,
  isoCBOR,
  decodeCredentialPublicKey,
} from "@simplewebauthn/server/helpers";
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
import { replaceCreationClock } from "./helpers/identity-clock.ts";
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
  const { createIdentityRecovery } =
    await import("../server/live/identity-recovery.ts");
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
test("recovery creation uses the earlier clock for requests and both challenge methods", async () => {
  for (const ahead of [true, false]) {
    const f = await fixture();
    try {
      const later = "2026-10-31T00:00:00.050Z";
      f.setTime(ahead ? later : time,ahead ? time : later);
      const created = await f.create();
      assert.equal(created.status,201,await created.clone().text());
      const r = await created.json();
      assert.equal(r.expiresAt,"2026-10-31T01:00:00.000Z");
      assert.equal(f.db.sqlite.prepare("SELECT created_at FROM identity_recovery_requests").get()!.created_at,time);
      for (const offline of [false,true]) {
        const response = await f.send("guardian/recovery/" + (offline ? "offline/" : "") + "options",{
          requestKey: "clock-options-" + offline,requestId:r.requestId,decision:"continue",
          ...(offline ? {currentOfflineRecoveryCode:"e".repeat(64)} : {method:"passkey"}),
        });
        assert.equal(response.status,200,await response.clone().text());
        assert.equal((await response.json()).challengeExpiresAt,"2026-10-31T00:05:00.000Z");
        assert.equal(f.db.sqlite.prepare("SELECT created_at FROM " + (offline ? "identity_offline_recovery_challenges" : "identity_recovery_challenges")).get()!.created_at,time);
      }
    } finally { f.db.close(); }
  }
});

test("recovery rejects invalid creation clocks before request or challenge quota writes", async () => {
  for (const action of ["create","passkey","offline"]) for (const clock of [null,{}, {identity_now:null},{identity_now:42},{identity_now:"2026-10-31T00:00:00Z"},{identity_now:"2026-02-30T00:00:00.000Z"},"throw"]) {
    const f = await fixture();
    try {
      const r = action === "create" ? null : await (await f.create()).json();
      const quota = JSON.stringify(f.db.sqlite.prepare("SELECT * FROM rate_limits WHERE key NOT LIKE '%:http-ip:%' ORDER BY key").all());
      replaceCreationClock(f.db,async () => {
        if (clock === "throw") throw new Error("synthetic clock unavailable");
        return clock;
      });
      const response = action === "create" ? await f.create() : await f.send("guardian/recovery/" + (action === "offline" ? "offline/" : "") + "options",{
        requestKey:"invalid-clock-options",requestId:r.requestId,decision:"continue",
        ...(action === "offline" ? {currentOfflineRecoveryCode:"e".repeat(64)} : {method:"passkey"}),
      });
      assert.equal(response.status,503,action + " " + await response.clone().text());
      assert.equal(f.count("identity_recovery_requests"),r ? 1 : 0);
      assert.equal(f.count("identity_recovery_challenges"),0);
      assert.equal(f.count("identity_offline_recovery_challenges"),0);
      assert.equal(JSON.stringify(f.db.sqlite.prepare("SELECT * FROM rate_limits WHERE key NOT LIKE '%:http-ip:%' ORDER BY key").all()),quota);
    } finally { f.db.close(); }
  }
});

test("recovery creation does not share pending clock samples across concurrent calls", {timeout:5000}, async (t) => {
  const f = await fixture();
  let release = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const pending: Promise<Response>[] = [];
  t.signal.addEventListener("abort",release,{once:true});
  try {
    let calls = 0;
    replaceCreationClock(f.db,async () => {
      const index = calls++;
      if (index === 0) { await blocked; return {identity_now:"2026-10-30T23:59:59.950Z"}; }
      release();
      return {identity_now:"2026-10-30T23:59:59.900Z"};
    });
    pending.push(f.create({requestKey:"clock-concurrent-a",agentId},"2".repeat(64)),f.create({requestKey:"clock-concurrent-b",agentId},"3".repeat(64)));
    const responses = await Promise.all(pending);
    assert.deepEqual(responses.map(r => r.status),[201,201]);
    assert.equal(calls,2);
    assert.deepEqual(f.db.sqlite.prepare("SELECT created_at FROM identity_recovery_requests ORDER BY created_at").all().map(r => r.created_at),["2026-10-30T23:59:59.900Z","2026-10-30T23:59:59.950Z"]);
  } finally {
    release();
    await Promise.allSettled(pending);
    t.signal.removeEventListener("abort",release);
    f.db.close();
  }
});

test("cross-instance app clock rollback and queued creation expiry remain fail closed", async () => {
  const f = await fixture();
  try {
    const r = await (await f.create()).json();
    f.setTime("2026-10-30T23:59:59.950Z",time);
    const response = await f.send("guardian/recovery/options",{requestKey:"clock-rollback-options",requestId:r.requestId,decision:"continue",method:"passkey"});
    assert.equal(response.status,409);
    assert.equal(f.count("identity_recovery_challenges"),0);
    for (const app of ["2026-10-31T02:00:00.000Z","2026-10-30T22:00:00.000Z"]) {
      f.setTime(app,time);
      assert.equal((await f.create({requestKey:"large-skew-" + app,agentId},"4".repeat(64))).status,409);
      assert.equal(f.count("identity_recovery_requests"),1);
    }
    f.setTime(time);
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async rows => {
      f.setTime(time,"2026-10-31T01:00:00.000Z");
      return batch(rows);
    };
    assert.equal((await f.create({requestKey:"clock-queued-expiry",agentId},"2".repeat(64))).status,409);
    assert.equal(f.count("identity_recovery_requests"),1);
  } finally { f.db.close(); }
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
    const { createIdentityMail } =
      await import("../server/live/identity-mail.ts");
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
      const { createTowerReception } =
          await import("../server/live/reception.ts"),
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

test("Pages dispatches recovery and requires every new schema object; machine capability enables the guardian recovery UI", async () => {
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
    assert.equal(capability.recovery.recoveryAvailable, true);
    assert.equal(capability.recovery.offlineCodeResetAvailable, true);
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
    const { createTowerIntake } =
        await import("../server/live/tower-intake.ts"),
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

test("signed browser clientDataJSON tolerates extra members and key order for continue and new without persisting their values", async () => {
  for (const decision of ["continue", "new"]) {
    for (const extraKey of [
      "other_keys_can_be_added_here",
      "new_keys_may_be_added_here",
    ]) {
      const f = await fixture();
      try {
        const start = await f.begin(decision),
          marker = "synthetic-browser-extension-must-not-be-persisted",
          client = { [extraKey]: marker },
          response = await f.auth.assertion(
            start.options,
            origin,
            f.userHandle,
            {
              client,
              reverseClientKeys: true,
            },
          ),
          body = await f.body(start, { response });
        const decoded = JSON.parse(
          Buffer.from(response.response.clientDataJSON, "base64url").toString(),
        );
        assert.equal(Object.keys(decoded)[0], extraKey);
        assert.equal(decoded[extraKey], marker);
        for (const invalid of [
          { origin: "https://evil.example" },
          { challenge: "wrong-challenge" },
          { client: { ...client, type: "webauthn.create" } },
          { flags: 1 },
          { client: { ...client, crossOrigin: true } },
          { client: { ...client, topOrigin: "https://evil.example" } },
        ]) {
          const invalidResponse = await f.auth.assertion(
            start.options,
            origin,
            f.userHandle,
            {
              client,
              reverseClientKeys: true,
              ...invalid,
            },
          );
          assert.equal(
            (
              await f.send("guardian/recovery/complete", {
                ...body,
                response: invalidResponse,
              })
            ).status,
            403,
          );
        }
        // Changing even an ignored member after signing must invalidate the original signed bytes.
        const tampered = structuredClone(body);
        tampered.response.response.clientDataJSON = Buffer.from(
          JSON.stringify({ ...decoded, [extraKey]: marker + "-changed" }),
        ).toString("base64url");
        assert.equal(
          (await f.send("guardian/recovery/complete", tampered)).status,
          403,
        );
        assert.equal(f.count("identity_recovery_receipts"), 0);
        const accepted = await f.send("guardian/recovery/complete", body);
        assert.equal(
          accepted.status,
          200,
          decision + ": " + (await accepted.clone().text()),
        );
        assert.equal(
          (await accepted.json()).state,
          decision === "continue" ? "continued" : "new-admission-required",
        );
        assert.equal(
          (await f.send("guardian/recovery/complete", body)).status,
          200,
        );
        for (const table of [
          "identity_recovery_receipts",
          "identity_audit",
          "tower_audit",
          "identity_mail_audit",
        ]) {
          const stored = JSON.stringify(
            f.db.sqlite.prepare("SELECT * FROM " + table).all(),
          );
          assert(!stored.includes(marker), table);
          assert(!stored.includes(extraKey), table);
          assert(!stored.includes(response.response.clientDataJSON), table);
        }
      } finally {
        f.db.close();
      }
    }
  }
});

async function offlineStart(
  f: Awaited<ReturnType<typeof fixture>>,
  decision = "continue",
  candidateKey = candidate,
  suffix = "offline-1",
) {
  const created = await f.create(
    { requestKey: "candidate-" + suffix, agentId },
    candidateKey,
  );
  assert.equal(created.status, 201, await created.clone().text());
  const request = await created.json();
  const optionsBody = {
    requestKey: "options-" + suffix,
    requestId: request.requestId,
    decision,
    currentOfflineRecoveryCode: "e".repeat(64),
  };
  const options = await f.send(
    "guardian/recovery/offline/options",
    optionsBody,
  );
  assert(options, "offline recovery endpoint must exist");
  assert.equal(options.status, 200, await options.clone().text());
  const start = await options.json();
  const auth = await identityAuthenticator();
  const body = {
    requestKey: "complete-" + suffix,
    requestId: request.requestId,
    challengeId: start.challengeId,
    currentOfflineRecoveryCode: "e".repeat(64),
    response: await auth.registration(start.options, origin, {
      client: { browserExtension: "allowed" },
    }),
    offlineRecoveryCode: "f".repeat(64),
    backupConfirmed: true,
  };
  return { start, auth, body, optionsBody };
}
test("offline continue repairs the same guardian Passkey and backup while preserving the permanent home", async () => {
  const f = await fixture();
  try {
    f.db.sqlite
      .prepare("UPDATE identity_guardian_passkeys SET revoked_at=?")
      .run(time);
    const home = f.db.sqlite.prepare("SELECT * FROM rooms").all();
    const s = await offlineStart(f);
    assert.equal(s.start.method, "offline");
    assert.equal(s.start.options.attestation, "none");
    assert.deepEqual(s.start.options.pubKeyCredParams, [
      { alg: -7, type: "public-key" },
    ]);
    assert.equal(
      s.start.options.authenticatorSelection.userVerification,
      "required",
    );
    assert(!JSON.stringify(s.start).includes("synthetic@example.com"));
    const response = await f.send("guardian/recovery/offline/complete", s.body);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.state, "continued");
    assert.equal(result.agentId, agentId);
    assert.equal(f.count("identity_guardians"), 1);
    assert.equal(f.count("identity_guardian_passkeys"), 2);
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT count(*) n FROM identity_guardian_passkeys WHERE revoked_at IS NULL",
        )
        .get()!.n,
      1,
    );
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT webauthn_user_id FROM identity_guardian_passkeys WHERE revoked_at IS NULL",
        )
        .get()!.webauthn_user_id,
      s.start.options.user.id,
    );
    assert.equal(
      f.db.sqlite
        .prepare("SELECT version,authority_epoch FROM agent_identities")
        .get()!.version,
      5,
    );
    assert.equal(result.authorityEpoch, 2);
    assert.equal(
      f.db.sqlite.prepare("SELECT version FROM identity_guardians").get()!
        .version,
      2,
    );
    assert.deepEqual(f.db.sqlite.prepare("SELECT * FROM rooms").all(), home);
    assert.equal(f.count("identity_recovery_instances"), 1);
    assert.equal(f.count("identity_recovery_receipts"), 1);
    assert.equal(
      f.db.sqlite.prepare("SELECT state FROM identity_mail_events").get()!
        .state,
      "pending",
    );
    assert.deepEqual(
      await (await f.send("guardian/recovery/offline/complete", s.body)).json(),
      result,
    );
    assert.equal(f.count("identity_guardian_passkeys"), 2);
    const wrong = { ...s.body, currentOfflineRecoveryCode: "7".repeat(64) };
    assert.equal(
      (await f.send("guardian/recovery/offline/complete", wrong)).status,
      403,
    );
    assert.equal(
      (
        await f.send("guardian/recovery/offline/complete", {
          ...s.body,
          offlineRecoveryCode: "6".repeat(64),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.send("guardian/recovery/offline/complete", {
          ...s.body,
          requestKey: "fresh-after-consumed",
        })
      ).status,
      409,
    );
    const next = await f.begin(
      "continue",
      "6".repeat(64),
      "next-after-offline",
    );
    const assertion = await s.auth.assertion(
      next.options,
      origin,
      s.start.options.user.id,
    );
    const completed = await f.send("guardian/recovery/complete", {
      requestKey: "new-passkey-assertion",
      requestId: next.requestId,
      challengeId: next.challengeId,
      response: assertion,
      offlineRecoveryCode: "8".repeat(64),
      backupConfirmed: true,
    });
    assert.equal(completed.status, 200, await completed.clone().text());
  } finally {
    f.db.close();
  }
});
test("offline new repairs guardian capability but preserves all Agent authority and home", async () => {
  const f = await fixture();
  try {
    f.db.sqlite
      .prepare(
        "INSERT INTO tower_tokens(id,account_id,token_hash,scopes,created_at,expires_at) VALUES('old',?,?, '[\"tower:read\"]',?,'2026-11-20T00:00:00.000Z')",
      )
      .run(account, await hashIdentityInput("2".repeat(64)), time);
    f.db.sqlite
      .prepare(
        "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,'csrf',?)",
      )
      .run(
        await hashIdentityInput("3".repeat(64)),
        account,
        "2026-11-20T00:00:00.000Z",
      );
    f.db.sqlite
      .prepare(
        "INSERT INTO agent_tokens(id,room_id,token_hash,scopes,created_at,expires_at) VALUES('legacy',?,?, '[\"posts:write\"]',?,'2026-11-20T00:00:00.000Z')",
      )
      .run(account, await hashIdentityInput("4".repeat(64)), time);
    f.db.sqlite
      .prepare(
        "INSERT INTO onboarding_grants(id,account_id,token_hash,scopes,created_at,expires_at) VALUES('onboard',?,?, '[\"home:read\"]',?,'2026-11-20T00:00:00.000Z')",
      )
      .run(account, await hashIdentityInput("5".repeat(64)), time);
    f.db.sqlite
      .prepare(
        "INSERT INTO tower_reception_cases(id,token_hash,state,name,request_kind,request_text,source_url,resident_id,account_id,approval_expires_at,authorization_json,sharing_json,visit_plan_json,next_action,expires_at,created_at,updated_at) VALUES(?,?,'active','Synthetic','takeover','Help','https://source.example/a/condo.json',?,?,?,'{}','{}','{}','Wait',?,?,?)",
      )
      .run(
        "b".repeat(32),
        await hashIdentityInput("7".repeat(64)),
        account,
        account,
        "2026-11-01T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z",
        time,
        time,
      );
    const before = Object.fromEntries(
      [
        "accounts",
        "rooms",
        "tower_residencies",
        "tower_tokens",
        "sessions",
        "agent_tokens",
        "onboarding_grants",
        "tower_reception_cases",
        "tower_reception_events",
      ].map((t) => [t, f.db.sqlite.prepare("SELECT * FROM " + t).all()]),
    );
    const s = await offlineStart(f, "new");
    const response = await f.send("guardian/recovery/offline/complete", s.body);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).state, "new-admission-required");
    for (const [t, rows] of Object.entries(before))
      assert.deepEqual(
        f.db.sqlite.prepare("SELECT * FROM " + t).all(),
        rows,
        t,
      );
    assert.equal(f.count("identity_recovery_instances"), 0);
    assert.equal(
      f.db.sqlite
        .prepare("SELECT version,authority_epoch FROM agent_identities")
        .get()!.version,
      5,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT authority_epoch FROM agent_identities").get()!
        .authority_epoch,
      1,
    );
    assert.equal(f.count("identity_guardian_passkeys"), 2);
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT count(*) n FROM identity_offline_recovery_codes WHERE consumed_at IS NULL",
        )
        .get()!.n,
      1,
    );
  } finally {
    f.db.close();
  }
});

test("offline registration rejects invalid security metadata before consuming the recovery proof", async () => {
  const f = await fixture();
  try {
    const s = await offlineStart(f);
    for (const mutation of [
      "attachment",
      "extension",
      "response-private",
      "outer-private",
    ]) {
      const body = structuredClone(s.body) as typeof s.body & {
        private?: string;
      };
      if (mutation === "attachment")
        body.response.authenticatorAttachment = "invalid" as "platform";
      if (mutation === "extension")
        body.response.clientExtensionResults = { private: "secret" } as object;
      if (mutation === "response-private")
        Object.assign(body.response.response, { private: "secret" });
      if (mutation === "outer-private") body.private = "secret";
      const r = await f.send("guardian/recovery/offline/complete", body);
      assert.equal(
        r.status,
        mutation === "outer-private" ? 400 : 403,
        mutation + ": " + (await r.clone().text()),
      );
      assert.equal(f.count("identity_recovery_receipts"), 0);
    }
  } finally {
    f.db.close();
  }
});

test("offline wrong or other-household proofs cannot read victim receipts, disclose conflicts or charge challenge quota", async () => {
  const f = await fixture();
  try {
    const s = await offlineStart(f);
    assert.equal(
      (await f.send("guardian/recovery/offline/complete", s.body)).status,
      200,
    );
    const prepare = f.db.prepare.bind(f.db);
    let scopedReads = 0;
    f.db.prepare = (sql) => {
      if (
        sql.includes("identity_recovery_receipts") ||
        sql.startsWith("SELECT * FROM identity_offline_recovery_challenges") ||
        sql.startsWith("SELECT i.*")
      )
        scopedReads++;
      return prepare(sql);
    };
    for (const requestKey of [s.body.requestKey, "unknown-key-same-scope"]) {
      const wrong = {
        ...s.body,
        requestKey,
        currentOfflineRecoveryCode: "7".repeat(64),
      };
      assert.equal(
        (await f.send("guardian/recovery/offline/complete", wrong)).status,
        403,
      );
      assert.equal(
        (
          await f.send("guardian/recovery/offline/options", {
            ...s.optionsBody,
            requestKey,
            currentOfflineRecoveryCode: "7".repeat(64),
          })
        ).status,
        403,
      );
    }
    assert.equal(
      (
        await f.send("guardian/recovery/offline/options", {
          ...s.optionsBody,
          requestId: "9".repeat(32),
          currentOfflineRecoveryCode: "7".repeat(64),
        })
      ).status,
      403,
    );
    assert.equal(scopedReads, 0);
    const other = "mcid:" + "b".repeat(64);
    f.db.sqlite
      .prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)")
      .run("b".repeat(16), await hashIdentityInput("b".repeat(64)), time);
    f.db.sqlite
      .prepare(
        "INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Other','','resident','external-ready',?)",
      )
      .run("b".repeat(16), "b".repeat(16), time);
    f.db.sqlite
      .prepare(
        "INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,'https://source.example/b/condo.json','challenge',?,?)",
      )
      .run("b".repeat(16), "b".repeat(16), "b".repeat(16), time, time);
    f.db.sqlite
      .prepare(
        "INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,1,?,?)",
      )
      .run(other, "b".repeat(16), "b".repeat(16), "b".repeat(16), time, time);
    const foreignCode = "8".repeat(64);
    f.db.sqlite
      .prepare(
        "INSERT INTO identity_offline_recovery_codes(agent_id,code_hash,authority_epoch,identity_version,created_at,confirmed_at) VALUES(?,?,1,1,?,?)",
      )
      .run(
        other,
        await hashPrivate(contactKey, "identity-offline-recovery", foreignCode),
        time,
        time,
      );
    assert.equal(
      (
        await f.send("guardian/recovery/offline/complete", {
          ...s.body,
          currentOfflineRecoveryCode: foreignCode,
        })
      ).status,
      403,
    );
    assert.equal(scopedReads, 0);
    assert.equal(f.count("identity_offline_recovery_challenges"), 1);
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT count FROM rate_limits WHERE key='recovery:global:challenges'",
        )
        .get()!.count,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("offline rejects reused credentials, semantic historical public keys and every old secret/code generation", async () => {
  const f = await fixture();
  try {
    const s = await offlineStart(f);
    const old = f.db.sqlite
      .prepare("SELECT * FROM identity_guardian_passkeys")
      .get()!;
    const oldKey = decodeCredentialPublicKey(
      isoBase64URL.toBuffer(String(old.public_key)),
    ) as unknown as Map<number, unknown>;
    const reordered = isoCBOR.encode(
      new Map([...oldKey.entries()].reverse()) as Parameters<
        typeof isoCBOR.encode
      >[0],
    );
    for (const response of [
      await f.auth.registration(s.start.options, origin),
      await s.auth.registration(s.start.options, origin, {
        credentialId: isoBase64URL.toBuffer(String(old.credential_id)),
      }),
      await s.auth.registration(s.start.options, origin, {
        publicKey: reordered,
      }),
    ]) {
      const r = await f.send("guardian/recovery/offline/complete", {
        ...s.body,
        response,
      });
      assert.equal(r.status, 409, await r.clone().text());
    }
    for (const raw of ["e".repeat(64), candidate, "a".repeat(64)])
      assert.equal(
        (
          await f.send("guardian/recovery/offline/complete", {
            ...s.body,
            offlineRecoveryCode: raw,
          })
        ).status,
        409,
      );
    assert.equal(f.count("identity_guardian_passkeys"), 1);
    assert.equal(f.count("identity_recovery_receipts"), 0);
    assert.equal(
      (await f.send("guardian/recovery/offline/complete", s.body)).status,
      200,
    );
    const nextCreated = await f.create(
      { requestKey: "candidate-offline-generation-two", agentId },
      "6".repeat(64),
    );
    const request = await nextCreated.json();
    const options = await (
      await f.send("guardian/recovery/offline/options", {
        requestKey: "options-second-generation",
        requestId: request.requestId,
        decision: "continue",
        currentOfflineRecoveryCode: "f".repeat(64),
      })
    ).json();
    const newer = await identityAuthenticator();
    const body = {
      requestKey: "complete-second-generation",
      requestId: request.requestId,
      challengeId: options.challengeId,
      currentOfflineRecoveryCode: "f".repeat(64),
      response: await newer.registration(options.options, origin),
      offlineRecoveryCode: "e".repeat(64),
      backupConfirmed: true,
    };
    assert.equal(
      (await f.send("guardian/recovery/offline/complete", body)).status,
      409,
    );
    assert.equal(
      (
        await f.send("guardian/recovery/offline/complete", {
          ...body,
          offlineRecoveryCode: "8".repeat(64),
        })
      ).status,
      200,
    );
    assert.equal(f.count("identity_guardian_passkeys"), 3);
    assert.equal(f.count("identity_offline_recovery_codes"), 3);
  } finally {
    f.db.close();
  }
});
test("offline official verifier enforces original challenge RP origin client type and UP/UV without persisting browser members", async () => {
  const f = await fixture();
  try {
    const s = await offlineStart(f);
    for (const override of [
      { origin: "https://evil.example" },
      { rpID: "evil.example" },
      { challenge: "wrong" },
      { flags: 0x41 },
      { flags: 0x44 },
      { client: { type: "webauthn.get" } },
      { client: { crossOrigin: true } },
      { client: { topOrigin: "https://evil.example" } },
    ]) {
      const response = await s.auth.registration(
        s.start.options,
        origin,
        override,
      );
      assert.equal(
        (
          await f.send("guardian/recovery/offline/complete", {
            ...s.body,
            response,
          })
        ).status,
        403,
        JSON.stringify(override),
      );
    }
    assert.equal(
      (
        await f.send("guardian/recovery/offline/complete", {
          ...s.body,
          backupConfirmed: false,
        })
      ).status,
      400,
    );
    const changedDecision = await f.send("guardian/recovery/offline/options", {
      ...s.optionsBody,
      decision: "new",
    });
    assert.equal(changedDecision.status, 409);
    assert.equal(
      (await f.send("guardian/recovery/offline/complete", s.body)).status,
      200,
    );
    for (const table of [
      "identity_recovery_receipts",
      "identity_audit",
      "identity_mail_audit",
      "tower_audit",
      "identity_offline_recovery_challenges",
    ]) {
      const stored = JSON.stringify(
        f.db.sqlite.prepare("SELECT * FROM " + table).all(),
      );
      for (const raw of [
        "e".repeat(64),
        "f".repeat(64),
        candidate,
        "browserExtension",
        "synthetic@example.com",
        s.body.response.response.attestationObject,
      ])
        assert(!stored.includes(raw), table + " leaks " + raw.slice(0, 20));
    }
  } finally {
    f.db.close();
  }
});
test("offline queued expiry, changed guardian/code/identity/tuple and post-options collisions roll back the entire transaction", async () => {
  for (const mutation of [
    "native-challenge-expiry",
    "app-challenge-expiry",
    "request-expiry",
    "guardian",
    "identity-version",
    "epoch",
    "suspended",
    "retired",
    "consent",
    "binding",
    "code-consumed",
    "candidate-collision",
    "backup-collision",
    "audit-failure",
  ]) {
    const f = await fixture();
    try {
      const s = await offlineStart(f);
      const batch = f.db.batch.bind(f.db);
      let changed = false;
      if (mutation === "app-challenge-expiry")
        f.setTime("2026-10-31T00:05:00.000Z", time);
      f.db.batch = async (rows) => {
        if (
          !changed &&
          rows.some(
            (x) =>
              "sql" in x &&
              String(x.sql).startsWith(
                "INSERT INTO identity_recovery_receipts",
              ),
          )
        ) {
          changed = true;
          if (mutation === "native-challenge-expiry")
            f.setTime(time, "2026-10-31T00:05:00.000Z");

          if (mutation === "request-expiry")
            f.setTime(time, "2026-10-31T01:00:00.000Z");
          if (mutation === "guardian")
            f.db.sqlite.exec("UPDATE identity_guardians SET version=version+1");
          if (mutation === "identity-version")
            f.db.sqlite.exec("UPDATE agent_identities SET version=version+1");
          if (mutation === "epoch")
            f.db.sqlite.exec(
              "UPDATE agent_identities SET authority_epoch=authority_epoch+1",
            );
          if (mutation === "suspended" || mutation === "retired")
            f.db.sqlite
              .prepare("UPDATE agent_identities SET state=?")
              .run(mutation);
          if (mutation === "consent")
            f.db.sqlite.exec("UPDATE agent_identities SET recovery_consent=0");
          if (mutation === "binding")
            f.db.sqlite.exec(
              "UPDATE tower_residencies SET resident_id='bbbbbbbbbbbbbbbb'",
            );
          if (mutation === "code-consumed")
            f.db.sqlite
              .prepare(
                "UPDATE identity_offline_recovery_codes SET consumed_at=?",
              )
              .run(time);
          if (
            mutation === "candidate-collision" ||
            mutation === "backup-collision"
          )
            f.db.sqlite
              .prepare(
                "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,'csrf','2026-11-20T00:00:00.000Z')",
              )
              .run(
                await hashIdentityInput(
                  mutation === "candidate-collision"
                    ? candidate
                    : "f".repeat(64),
                ),
                account,
              );
          if (mutation === "audit-failure")
            f.db.sqlite.exec(
              "CREATE TRIGGER reject_offline_audit BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT,'test-audit-failure'); END",
            );
        }
        return batch(rows);
      };
      const response = await f.send(
        "guardian/recovery/offline/complete",
        s.body,
      );
      assert.equal(
        response.status,
        409,
        mutation + ": " + (await response.clone().text()),
      );
      assert(changed, mutation);
      assert.equal(f.count("identity_recovery_receipts"), 0, mutation);
      assert.equal(f.count("identity_recovery_instances"), 0, mutation);
      assert.equal(f.count("tower_tokens"), 0, mutation);
      assert.equal(f.count("identity_guardian_passkeys"), 1, mutation);
      assert.equal(f.count("identity_offline_recovery_codes"), 1, mutation);
      assert.equal(f.count("identity_mail_events"), 0, mutation);
      assert.equal(
        f.db.sqlite
          .prepare(
            "SELECT consumed_at FROM identity_offline_recovery_challenges",
          )
          .get()!.consumed_at,
        null,
        mutation,
      );
    } finally {
      f.db.close();
    }
  }
});

test("offline and Passkey competing continuations allow either winner with exactly one atomic grant", async () => {
  for (const pair of ["offline-offline", "offline-passkey"])
    for (const delayedIndex of [0, 1]) {
      const f = await fixture();
      let release = () => {};
      try {
        const a = await offlineStart(f);
        const b =
          pair === "offline-offline"
            ? await offlineStart(f, "continue", "2".repeat(64), "offline-two")
            : await f.begin("continue", "2".repeat(64), "passkey-two");
        const bodies = [
          a.body,
          pair === "offline-offline"
            ? { ...b.body, offlineRecoveryCode: "7".repeat(64) }
            : await f.body(b, {
                requestKey: "mixed-passkey-complete",
                offlineRecoveryCode: "7".repeat(64),
              }),
        ];
        const paths = [
          "guardian/recovery/offline/complete",
          pair === "offline-offline"
            ? "guardian/recovery/offline/complete"
            : "guardian/recovery/complete",
        ];
        const batch = f.db.batch.bind(f.db);
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
              (x) =>
                "sql" in x &&
                String(x.sql).startsWith(
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
        const delayed = f.send(paths[delayedIndex], bodies[delayedIndex]);
        await waiting;
        try {
          const winner = await f.send(
            paths[1 - delayedIndex],
            bodies[1 - delayedIndex],
          );
          assert.equal(
            winner.status,
            200,
            pair + (await winner.clone().text()),
          );
        } finally {
          release();
        }
        assert.equal((await delayed).status, 409, pair);
        assert.equal(f.count("identity_recovery_receipts"), 1, pair);
        assert.equal(f.count("identity_recovery_instances"), 1, pair);
        assert.equal(f.count("tower_tokens"), 1, pair);
        assert.equal(f.count("identity_offline_recovery_codes"), 2, pair);
        assert.equal(
          f.count("identity_guardian_passkeys"),
          pair === "offline-passkey" && delayedIndex === 0 ? 1 : 2,
          pair,
        );
        assert.equal(
          f.db.sqlite
            .prepare("SELECT version,authority_epoch FROM agent_identities")
            .get()!.version,
          5,
        );
        assert.equal(
          f.db.sqlite
            .prepare("SELECT authority_epoch FROM agent_identities")
            .get()!.authority_epoch,
          2,
        );
      } finally {
        release();
        f.db.close();
      }
    }
});
test("offline identical completion races replay exactly once for both delayed execution orders", async () => {
  for (const delayedIndex of [0, 1]) {
    const f = await fixture();
    let release = () => {};
    try {
      const s = await offlineStart(f);
      const batch = f.db.batch.bind(f.db);
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
            (x) =>
              "sql" in x &&
              String(x.sql).startsWith(
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
      const copies = [structuredClone(s.body), structuredClone(s.body)];
      const delayed = f.send(
        "guardian/recovery/offline/complete",
        copies[delayedIndex],
      );
      await waiting;
      let winner: Response;
      try {
        winner = await f.send(
          "guardian/recovery/offline/complete",
          copies[1 - delayedIndex],
        );
        assert.equal(winner.status, 200);
      } finally {
        release();
      }
      const replay = await delayed;
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), await winner!.json());
      assert.equal(f.count("identity_guardian_passkeys"), 2);
      assert.equal(f.count("identity_offline_recovery_codes"), 2);
      assert.equal(f.count("identity_recovery_instances"), 1);
      assert.equal(f.count("identity_recovery_receipts"), 1);
      f.setTime("2026-12-01T00:00:00.000Z");
      assert.equal(
        (await f.send("guardian/recovery/offline/complete", s.body)).status,
        200,
      );
      assert.equal(
        (
          await f.send("guardian/recovery/offline/complete", {
            ...s.body,
            requestKey: "old-proof-fresh-key",
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await f.send("guardian/recovery/offline/options", {
            ...s.optionsBody,
            requestKey: "old-code-fresh-options",
          })
        ).status,
        409,
      );
    } finally {
      release();
      f.db.close();
    }
  }
});
test("offline options require explicit decisions and share HTTP and active challenge quotas with Passkey", async () => {
  const f = await fixture();
  try {
    const created = await (await f.create()).json();
    const options = {
      requestKey: "offline-quota-options",
      requestId: created.requestId,
      decision: "continue",
      currentOfflineRecoveryCode: "e".repeat(64),
    };
    for (const decision of [undefined, "", false, "default"]) {
      const r = await f.send("guardian/recovery/offline/options", {
        ...options,
        decision,
      });
      assert.equal(r.status, 400);
    }
    const [a, b] = await Promise.all([
      f.send("guardian/recovery/offline/options", options),
      f.send("guardian/recovery/offline/options", options),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(await a.json(), await b.json());
    assert.equal(f.count("identity_offline_recovery_challenges"), 1);
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT count FROM rate_limits WHERE key='recovery:global:challenges'",
        )
        .get()!.count,
      1,
    );
    f.db.sqlite
      .prepare(
        "UPDATE rate_limits SET count=1000 WHERE key='recovery:global:challenges'",
      )
      .run();
    assert.equal(
      (
        await f.send("guardian/recovery/offline/options", {
          ...options,
          requestKey: "over-global-quota",
        })
      ).status,
      429,
    );
    const passkey = await f.send("guardian/recovery/options", {
      requestKey: "passkey-global-cap",
      requestId: created.requestId,
      decision: "continue",
      method: "passkey",
    });
    assert.equal(passkey.status, 429);
    f.db.sqlite
      .prepare(
        "UPDATE rate_limits SET count=1 WHERE key='recovery:global:challenges'",
      )
      .run();
    // Both methods share the same active pending challenge capacity.
    const columns = f.db.sqlite
      .prepare("PRAGMA table_info(identity_offline_recovery_challenges)")
      .all()
      .map((c) => String(c.name));
    const values = columns.map((c) =>
      c === "challenge_id"
        ? "printf('%032x',n)"
        : c === "request_key"
          ? "'cap-entry-'||n"
          : "c." + c,
    );
    f.db.sqlite.exec(
      "WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<9999) INSERT INTO identity_offline_recovery_challenges(" +
        columns.join(",") +
        ") SELECT " +
        values.join(",") +
        " FROM nums CROSS JOIN (SELECT * FROM identity_offline_recovery_challenges LIMIT 1) c",
    );
    assert.equal(f.count("identity_offline_recovery_challenges"), 10000);
    assert.equal(
      (
        await f.send("guardian/recovery/offline/options", {
          ...options,
          requestKey: "offline-active-cap",
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await f.send("guardian/recovery/options", {
          requestKey: "passkey-active-cap",
          requestId: created.requestId,
          decision: "continue",
          method: "passkey",
        })
      ).status,
      429,
    );
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT count FROM rate_limits WHERE key='recovery:global:challenges'",
        )
        .get()!.count,
      1,
    );
    for (let n = 0; n < 30; n++)
      assert.equal(
        (
          await f.send(
            n % 2
              ? "guardian/recovery/offline/complete"
              : "guardian/recovery/offline/options",
            { ...options, currentOfflineRecoveryCode: "8".repeat(64) },
            { "CF-Connecting-IP": "203.0.113.99" },
          )
        ).status,
        n % 2 ? 400 : 403,
      );
    const limited = await f.handler.fetch(
      new Request(origin + "/api/v1/identity/guardian/recovery/options", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "CF-Connecting-IP": "203.0.113.99",
        },
        body: "invalid",
      }),
    );
    assert.equal(limited!.status, 429);
    const stored = JSON.stringify(
      f.db.sqlite.prepare("SELECT * FROM rate_limits").all(),
    );
    assert(!stored.includes("203.0.113.99"));
  } finally {
    f.db.close();
  }
});
test("0016 storage bindings and Pages readiness require immutable retained offline challenges and Passkey history", async () => {
  const f = await fixture();
  try {
    const s = await offlineStart(f);
    for (const sql of [
      "UPDATE identity_offline_recovery_challenges SET decision='new'",
      "UPDATE identity_offline_recovery_challenges SET code_hash='" +
        "0".repeat(64) +
        "'",
      "UPDATE identity_offline_recovery_challenges SET options_json='{}'",
      "UPDATE identity_offline_recovery_challenges SET candidate_hash='" +
        "0".repeat(64) +
        "'",
      "DELETE FROM identity_offline_recovery_challenges",
      "DELETE FROM identity_guardian_passkeys",
    ]) {
      assert.throws(() => f.db.sqlite.exec(sql), sql);
    }
    assert.equal(
      (await f.send("guardian/recovery/offline/complete", s.body)).status,
      200,
    );
    assert.throws(() =>
      f.db.sqlite.exec(
        "UPDATE identity_offline_recovery_challenges SET consumed_at=NULL",
      ),
    );
    const worker = (await import("../server/live/worker.ts")).default;
    const objects = [
      ["table", "identity_offline_recovery_challenges"],
      ["trigger", "identity_offline_recovery_challenge_binding"],
      ["trigger", "identity_offline_recovery_challenge_immutable"],
      ["trigger", "identity_offline_recovery_challenge_prune_guard"],
      ["trigger", "identity_passkey_permanent"],
    ];
    for (const [type, name] of objects) {
      f.db.sqlite.exec("SAVEPOINT missing_offline_object");
      try {
        f.db.sqlite.exec("DROP " + type + " " + name);
        const response = await worker.fetch(
          new Request(origin + "/api/v1/status"),
          { DB: f.db, PUBLIC_ORIGIN: origin },
        );
        assert.equal(response.status, 503, name);
        assert.equal(
          (await response.json()).error,
          "database_schema_not_ready",
          name,
        );
      } finally {
        f.db.sqlite.exec(
          "ROLLBACK TO missing_offline_object; RELEASE missing_offline_object",
        );
      }
    }
    const capability = JSON.parse(
      readFileSync(
        new URL("../public/identity-onboarding.json", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(capability.recovery.recoveryAvailable, true);
    assert.equal(capability.recovery.uiAvailable, true);
    assert.equal(capability.recovery.offlineBackendImplemented, true);
    assert(capability.recovery.backendMethods.includes("offline"));
    assert.deepEqual(
      capability.recovery.guardian.offline.optionsFields,
      Object.keys(s.optionsBody),
    );
    assert.deepEqual(
      capability.recovery.guardian.offline.completeFields,
      Object.keys(s.body),
    );
  } finally {
    f.db.close();
  }
});

test("offline challenges cannot be substituted between candidate requests and user handles remain globally unique", async () => {
  const f = await fixture();
  try {
    const a = await offlineStart(f);
    const b = await offlineStart(
      f,
      "new",
      "2".repeat(64),
      "offline-other-candidate",
    );
    assert.equal(
      (
        await f.send("guardian/recovery/offline/complete", {
          ...a.body,
          requestId: b.body.requestId,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.send("guardian/recovery/offline/complete", {
          ...a.body,
          challengeId: b.body.challengeId,
        })
      ).status,
      403,
    );
    const old = f.db.sqlite
      .prepare("SELECT * FROM identity_guardian_passkeys")
      .get()!;
    f.db.sqlite
      .prepare(
        "INSERT INTO identity_guardian_passkeys(credential_id,guardian_id,agent_id,webauthn_user_id,public_key,counter,device_type,backed_up,transports_json,aaguid,created_at) VALUES(?,?,?,?,?,0,'singleDevice',0,'[]',?,?)",
      )
      .run(
        "other-credential",
        old.guardian_id,
        agentId,
        a.start.options.user.id,
        old.public_key,
        old.aaguid,
        time,
      );
    const response = await f.send("guardian/recovery/offline/complete", a.body);
    assert.equal(response.status, 409, await response.clone().text());
    assert.equal(f.count("identity_recovery_receipts"), 0);
    assert.equal(f.count("identity_offline_recovery_codes"), 1);
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT count(*) n FROM identity_guardian_passkeys WHERE revoked_at IS NULL",
        )
        .get()!.n,
      2,
    );
    assert.equal(f.count("tower_tokens"), 0);
  } finally {
    f.db.close();
  }
});

// These allocations use real handlers and unchanged HTTP/hourly limits. Advancing the
// native clock once per 1,000 allocations demonstrates the public reachable state.
test("10,000 expired anonymous requests release active capacity and physically prune only a bounded batch", async () => {
  const f = await fixture();
  try {
    for (let n = 0; n < 10000; n++) {
      f.setTime(new Date(Date.parse(time) + Math.floor(n / 1000) * 3600000).toISOString());
      const response = await f.send("recovery/requests", {requestKey: "anonymous-request-" + n, agentId}, {
        "X-Identity-Candidate-Key": (100000 + n).toString(16).padStart(64, "0"),
        "CF-Connecting-IP": "synthetic-request-" + Math.floor(n / 30),
      });
      assert.equal(response.status, 201, "allocation " + n + ": " + await response.text());
    }
    assert.equal(f.count("identity_recovery_requests"), 10000);
    assert.equal(f.count("identity_recovery_receipts"), 0);
    f.setTime(new Date(Date.parse(time) + 48 * 3600000).toISOString());
    const fresh = await f.create();
    assert.equal(fresh.status, 201, await fresh.clone().text());
    assert.equal(f.count("identity_recovery_requests"), 9951);
    assert.equal(f.count("identity_recovery_instances"), 0);
    assert.equal(f.count("identity_recovery_receipts"), 0);
  } finally { f.db.close(); }
});

test("10,000 unsigned challenges cannot permanently block fresh Passkey or valid offline recovery", async () => {
  const f = await fixture();
  try {
    for (let hour = 0; hour < 10; hour++) {
      f.setTime(new Date(Date.parse(time) + hour * 3600000).toISOString());
      const created = await f.send("recovery/requests", {requestKey: "challenge-parent-" + hour, agentId}, {
        "X-Identity-Candidate-Key": (200000 + hour).toString(16).padStart(64, "0"),
        "CF-Connecting-IP": "synthetic-parent-" + hour,
      });
      assert.equal(created.status, 201);
      const request = await created.json();
      for (let n = 0; n < 1000; n++) {
        const options = await f.send("guardian/recovery/options", {
          requestKey: "unsigned-options-" + n, requestId: request.requestId, decision: "continue", method: "passkey",
        }, {"CF-Connecting-IP": "synthetic-options-" + hour + "-" + Math.floor(n / 30)});
        assert.equal(options.status, 200, "options " + hour + "/" + n + ": " + await options.text());
      }
    }
    assert.equal(f.count("identity_recovery_challenges"), 10000);
    f.setTime(new Date(Date.parse(time) + 48 * 3600000).toISOString());
    const created = await f.create();
    assert.equal(created.status, 201);
    const request = await created.json();
    // One create prunes 50 children; their parents still have children and survive.
    assert.equal(f.count("identity_recovery_challenges"), 9950);
    assert.equal(f.count("identity_recovery_requests"), 11);
    const passkey = await f.send("guardian/recovery/options", {
      requestKey: "fresh-passkey-options", requestId: request.requestId, decision: "continue", method: "passkey",
    });
    assert.equal(passkey.status, 200, await passkey.clone().text());
    const offline = await f.send("guardian/recovery/offline/options", {
      requestKey: "fresh-offline-options", requestId: request.requestId, decision: "continue", currentOfflineRecoveryCode: "e".repeat(64),
    });
    assert.equal(offline.status, 200, await offline.clone().text());
    assert.equal(f.count("identity_recovery_challenges"), 9851);
    assert.equal(f.count("identity_offline_recovery_challenges"), 1);
    assert.equal(f.count("identity_recovery_receipts"), 0);
    assert.equal(f.count("identity_recovery_instances"), 0);
  } finally { f.db.close(); }
});

test("0017 retains issued instance bindings permanently, including raw UPDATE and DELETE", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    const completed = await f.send("guardian/recovery/complete", await f.body(start));
    assert.equal(completed.status, 200);
    assert.throws(() => f.db.sqlite.exec("UPDATE identity_recovery_instances SET authority_epoch=authority_epoch+1"));
    assert.throws(() => f.db.sqlite.exec("DELETE FROM identity_recovery_instances"));
  } finally { f.db.close(); }
});

test("raw DELETE enforces native expiry plus exactly 24 hours for both unused challenge types and pending parents", async () => {
  const f = await fixture();
  try {
    const passkey = await f.begin();
    const offline = await offlineStart(f, "continue", "2".repeat(64), "retention");
    const tables = ["identity_recovery_challenges", "identity_offline_recovery_challenges"];
    for (const table of [...tables, "identity_recovery_requests"])
      assert.throws(() => f.db.sqlite.exec("DELETE FROM " + table));
    f.setTime("2026-11-01T00:04:59.999Z");
    for (const table of tables) assert.throws(() => f.db.sqlite.exec("DELETE FROM " + table));
    // App time alone never permits cleanup or bypasses the raw SQL guard.
    f.setTime("2026-11-02T00:00:00.000Z", "2026-11-01T00:04:59.999Z");
    for (const table of tables) assert.throws(() => f.db.sqlite.exec("DELETE FROM " + table));
    f.setTime("2026-11-01T00:05:00.000Z");
    for (const table of tables) f.db.sqlite.exec("DELETE FROM " + table);
    assert.equal(f.count("identity_recovery_requests"), 2);
    const retained = await f.create();
    assert.equal(retained.status, 201);
    const original = await retained.json();
    assert.equal(original.requestId, passkey.request.requestId);
    assert.equal(original.state, "pending");
    assert(original.expiresAt < "2026-11-01T00:05:00.000Z");
    assert.equal((await f.send("guardian/recovery/options", {
      requestKey: "expired-retained-options", requestId: original.requestId, decision: "continue", method: "passkey",
    })).status, 409);
    f.setTime("2026-11-01T00:59:59.999Z");
    assert.throws(() => f.db.sqlite.exec("DELETE FROM identity_recovery_requests"));
    f.setTime("2026-11-01T01:00:00.000Z");
    f.db.sqlite.exec("DELETE FROM identity_recovery_requests");
    assert.equal(f.count("identity_recovery_requests"), 0);
    assert.equal((await f.send("guardian/recovery/options", {
      requestKey: "old-pruned-options", requestId: passkey.request.requestId, decision: "continue", method: "passkey",
    })).status, 403);
    assert.equal((await f.send("guardian/recovery/offline/complete", offline.body)).status, 403);
    // Only this never-authorized/pruned candidate can be reused; issued hashes cannot.
    assert.equal((await f.create()).status, 201);
  } finally { f.db.close(); }
});

test("pending requests with any receipt, instance, notification or remaining challenge cannot be pruned", async () => {
  const f = await fixture();
  try {
    const requestIds: string[] = [];
    for (let n = 0; n < 4; n++) {
      const created = await f.create({requestKey: "protected-request-" + n, agentId}, (300000 + n).toString(16).padStart(64, "0"));
      assert.equal(created.status, 201);
      requestIds.push((await created.json()).requestId);
    }
    f.db.sqlite.prepare("INSERT INTO identity_recovery_receipts VALUES(?,'retained-receipt',?,'{}',?)").run(requestIds[0], "0".repeat(64), time);
    f.db.sqlite.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,created_at,expires_at) VALUES('retained-token',?,?, '[]',?,'2026-11-20T00:00:00.000Z')").run(account, "b".repeat(64), time);
    f.db.sqlite.prepare("INSERT INTO identity_recovery_instances VALUES(?,?,1,'retained-token',?,?)").run("b".repeat(32), agentId, requestIds[1], time);
    f.db.sqlite.prepare("INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,created_at,updated_at) VALUES(?,'security-notice',?,'retained-mail','cipher',?,'cipher',?,?)").run("b".repeat(32), requestIds[2], "b".repeat(64), time, time);
    const options = await f.send("guardian/recovery/options", {requestKey: "retained-child", requestId: requestIds[3], decision: "new", method: "passkey"});
    assert.equal(options.status, 200);
    const child = await options.json();
    // A consumed proof is permanent, even if a transaction has no receipt yet.
    f.db.sqlite.prepare("UPDATE identity_recovery_challenges SET consumed_at=? WHERE challenge_id=?").run(time, child.challengeId);
    f.setTime("2026-11-02T00:00:00.000Z");
    for (const id of requestIds) assert.throws(() => f.db.sqlite.prepare("DELETE FROM identity_recovery_requests WHERE id=?").run(id));
    assert.throws(() => f.db.sqlite.exec("DELETE FROM identity_recovery_challenges"));
    assert.equal((await f.create()).status, 201);
    assert.equal(f.count("identity_recovery_requests"), 5);
    assert.equal(f.count("identity_recovery_challenges"), 1);
    assert.equal(f.count("identity_recovery_receipts"), 1);
    assert.equal(f.count("identity_recovery_instances"), 1);
    assert.equal(f.count("identity_mail_events"), 1);
  } finally { f.db.close(); }
});

for (const method of ["passkey", "offline"]) for (const decision of ["continue", "new"]) {
  test(method + " " + decision + " preserves original proof receipts after pruning and large permanent history never consumes active capacity", async () => {
    const f = await fixture();
    try {
      const start = method === "offline" ? await offlineStart(f, decision) : await f.begin(decision);
      const completeBody = method === "offline" ? start.body : await f.body(start);
      const requestId = method === "offline" ? start.body.requestId : start.request.requestId;
      // A second unused challenge on the winning case is eligible after 24h.
      const extra = await f.send("guardian/recovery/options", {requestKey: "unused-sibling", requestId, decision, method: "passkey"});
      assert.equal(extra.status, 200);
      const path = "guardian/recovery/" + (method === "offline" ? "offline/" : "") + "complete";
      const completed = await f.send(path, completeBody);
      assert.equal(completed.status, 200, await completed.clone().text());
      const receipt = await completed.json();
      const columns = f.db.sqlite.prepare("PRAGMA table_info(identity_recovery_requests)").all().map(x => String(x.name));
      const values = columns.map(c => c === "id" ? "printf('%032x',n)" : c === "candidate_hash" ? "printf('%064x',n)" : c === "state" ? "CASE WHEN n%2=0 THEN 'continued' ELSE 'new-admission-required' END" : "r." + c);
      f.db.sqlite.exec("WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<10000) INSERT INTO identity_recovery_requests(" + columns.join(",") + ") SELECT " + values.join(",") + " FROM nums CROSS JOIN (SELECT * FROM identity_recovery_requests LIMIT 1) r");
      f.db.sqlite.exec("INSERT INTO identity_recovery_receipts SELECT id,'fixture-history',input_hash,'{}',created_at FROM identity_recovery_requests WHERE id<>'" + requestId + "'");
      if (method === "passkey") f.db.sqlite.prepare("UPDATE identity_guardian_passkeys SET revoked_at=?").run(time);
      const permanentTables = ["agent_identities", "identity_recovery_receipts", "identity_recovery_instances", "identity_secret_history", "identity_guardian_passkeys", "identity_offline_recovery_codes", "identity_audit", "identity_mail_events", "identity_mail_audit", "tower_audit", "tower_tokens", "rooms", "tower_residencies", "consent_events"];
      const snapshot = () => permanentTables.map(t => [t, JSON.stringify(f.db.sqlite.prepare("SELECT * FROM " + t).all())]);
      const before = snapshot();
      f.setTime("2026-11-02T00:00:00.000Z");
      assert.equal((await f.create({requestKey: "fresh-after-success", agentId}, "2".repeat(64))).status, 201);
      const retry = await f.send(path, completeBody);
      assert.equal(retry.status, 200, await retry.clone().text());
      assert.deepEqual(await retry.json(), receipt);
      assert.deepEqual(snapshot(), before);
      assert.equal(f.count("identity_recovery_requests"), 10002);
      assert.equal(f.count("identity_recovery_challenges") + f.count("identity_offline_recovery_challenges"), 1);
      assert.throws(() => f.db.sqlite.prepare("DELETE FROM identity_recovery_requests WHERE id=?").run(requestId));
      assert.throws(() => f.db.sqlite.exec("DELETE FROM " + (method === "offline" ? "identity_offline_recovery_challenges" : "identity_recovery_challenges")));
      if (decision === "continue") {
        assert.equal((await f.create({requestKey: "issued-key-reuse", agentId})).status, 409);
      }
    } finally { f.db.close(); }
  });
}

test("retained consumed challenges and unused challenges on completed parents do not occupy active capacity", async () => {
  for (const completedParent of [false, true]) {
    const f = await fixture();
    try {
      const start = await f.begin("new");
      if (completedParent) {
        const extra = await f.send("guardian/recovery/options", {requestKey: "history-unused", requestId: start.request.requestId, decision: "new", method: "passkey"});
        assert.equal(extra.status, 200);
        assert.equal((await f.send("guardian/recovery/complete", await f.body(start))).status, 200);
      } else {
        f.db.sqlite.prepare("UPDATE identity_recovery_challenges SET consumed_at=?").run(time);
      }
      const columns = f.db.sqlite.prepare("PRAGMA table_info(identity_recovery_challenges)").all().map(x => String(x.name));
      const values = columns.map(c => c === "challenge_id" ? "printf('%032x',n)" : c === "request_key" ? "'retained-challenge-'||n" : "c." + c);
      f.db.sqlite.exec("WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<10000) INSERT INTO identity_recovery_challenges(" + columns.join(",") + ") SELECT " + values.join(",") + " FROM nums CROSS JOIN (SELECT * FROM identity_recovery_challenges ORDER BY consumed_at LIMIT 1) c");
      const request = await (await f.create({requestKey: "fresh-with-history", agentId}, "2".repeat(64))).json();
      const options = await f.send("guardian/recovery/options", {requestKey: "fresh-history-options", requestId: request.requestId, decision: "continue", method: "passkey"});
      assert.equal(options.status, 200, await options.clone().text());
      assert.equal(f.count("identity_recovery_challenges"), completedParent ? 10003 : 10002);
    } finally { f.db.close(); }
  }
});

test("two concurrent pruners are independently bounded, atomically delete children first and cannot double allocate a replay", async () => {
  const f = await fixture();
  try {
    const start = await f.begin();
    const offline = await f.send("guardian/recovery/offline/options", {requestKey: "mixed-prune-offline", requestId: start.request.requestId, decision: "continue", currentOfflineRecoveryCode: "e".repeat(64)});
    assert.equal(offline.status, 200);
    for (const table of ["identity_recovery_challenges", "identity_offline_recovery_challenges"]) {
      const columns = f.db.sqlite.prepare("PRAGMA table_info(" + table + ")").all().map(x => String(x.name));
      const values = columns.map(c => c === "challenge_id" ? "printf('%032x',n)" : c === "request_key" ? "'mixed-prune-'||n" : "c." + c);
      f.db.sqlite.exec("WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<119) INSERT INTO " + table + "(" + columns.join(",") + ") SELECT " + values.join(",") + " FROM nums CROSS JOIN (SELECT * FROM " + table + " LIMIT 1) c");
    }
    f.setTime("2026-11-02T00:00:00.000Z");
    const batch = f.db.batch.bind(f.db), deleted: number[][] = [];
    f.db.batch = async rows => {
      const result = await batch(rows);
      if (rows.some(s => "sql" in s && String(s.sql).startsWith("DELETE FROM identity_recovery_challenges"))) {
        const changes = result.map(r => Number(r.meta.changes));
        assert.equal(changes.length, 3);
        assert(changes.every(n => n <= 50));
        assert(changes.reduce((a,b) => a+b, 0) <= 150);
        deleted.push(changes);
      }
      return result;
    };
    const fresh = () => f.create({requestKey: "mixed-prune-fresh", agentId}, "3".repeat(64));
    const results = await Promise.all([fresh(), fresh()]);
    for (const response of results) assert.equal(response.status, 201, await response.clone().text());
    assert.deepEqual(await results[0].json(), await results[1].json());
    assert.equal(deleted.length, 2);
    assert.equal(f.count("identity_recovery_challenges"), 20);
    assert.equal(f.count("identity_offline_recovery_challenges"), 20);
    assert.equal(f.count("identity_recovery_requests"), 2);
    // Next allocation removes the remaining children and then the empty parent.
    assert.equal((await f.create({requestKey: "next-mixed-prune", agentId}, "2".repeat(64))).status, 201);
    assert.equal(f.count("identity_recovery_challenges"), 0);
    assert.equal(f.count("identity_offline_recovery_challenges"), 0);
    assert.equal(f.count("identity_recovery_requests"), 2);
    assert.equal(f.count("identity_recovery_receipts"), 0);
  } finally { f.db.close(); }
});

for (const cleanupFirst of [false, true]) {
  test("cleanup/complete race rechecks native time and permanent proof when " + (cleanupFirst ? "cleanup" : "completion") + " wins", async () => {
    const f = await fixture();
    let release = () => {};
    let delayed: Promise<Response> | undefined;
    try {
      const start = await f.begin(), completeBody = await f.body(start), batch = f.db.batch.bind(f.db);
      let entered = () => {}, paused = false;
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      f.db.batch = async rows => {
        const target = cleanupFirst ? "INSERT INTO identity_recovery_receipts" : "DELETE FROM identity_recovery_challenges";
        if (!paused && rows.some(s => "sql" in s && String(s.sql).startsWith(target))) {
          paused = true;
          entered();
          await gate;
        }
        return batch(rows);
      };
      if (!cleanupFirst) f.setTime("2026-11-02T00:00:00.000Z");
      delayed = cleanupFirst ? f.send("guardian/recovery/complete", completeBody) : f.create({requestKey: "race-prune-fresh", agentId}, "2".repeat(64));
      await waiting;
      try {
        if (cleanupFirst) {
          f.setTime("2026-11-02T00:00:00.000Z");
          assert.equal((await f.create({requestKey: "race-prune-fresh", agentId}, "2".repeat(64))).status, 201);
          assert.equal(f.count("identity_recovery_challenges"), 0);
        } else {
          // A delayed cleanup must re-read the native clock after rollback.
          f.setTime(time);
          assert.equal((await f.send("guardian/recovery/complete", completeBody)).status, 200);
        }
      } finally { release(); }
      assert.equal((await delayed).status, cleanupFirst ? 409 : 201);
      assert.equal(f.count("identity_recovery_receipts"), cleanupFirst ? 0 : 1);
      assert.equal(f.count("identity_recovery_instances"), cleanupFirst ? 0 : 1);
      assert.equal(f.count("identity_recovery_challenges"), cleanupFirst ? 0 : 1);
      assert.equal(f.count("tower_tokens"), cleanupFirst ? 0 : 1);
    } finally {
      release();
      if (delayed) await delayed;
      f.db.close();
    }
  });
}

test("0017 readiness requires every new guard and cleanup index and advertises the retention boundary", async () => {
  const f = await fixture();
  try {
    const worker = (await import("../server/live/worker.ts")).default;
    const objects = f.db.sqlite.prepare("SELECT type,name FROM sqlite_master WHERE name IN ('identity_recovery_request_prune_guard','identity_recovery_challenge_prune_guard','identity_offline_recovery_challenge_prune_guard','identity_recovery_instance_immutable','identity_recovery_instance_permanent','identity_recovery_request_pending_expiry','identity_recovery_challenge_pending_expiry','identity_offline_recovery_challenge_pending_expiry','identity_recovery_challenge_request','identity_offline_recovery_challenge_request','identity_mail_entity')").all();
    assert.equal(objects.length, 11);
    for (const object of objects) {
      f.db.sqlite.exec("SAVEPOINT missing_retention_object");
      try {
        f.db.sqlite.exec("DROP " + object.type + " " + object.name);
        const missing = await worker.fetch(new Request(origin + "/api/v1/status"), {DB: f.db, PUBLIC_ORIGIN: origin});
        assert.equal(missing.status, 503, String(object.name));
        assert.equal((await missing.json()).error, "database_schema_not_ready");
      } finally { f.db.sqlite.exec("ROLLBACK TO missing_retention_object; RELEASE missing_retention_object"); }
    }
    const capability = JSON.parse(readFileSync(new URL("../public/identity-onboarding.json", import.meta.url), "utf8")).recovery;
    assert.equal(capability.recoveryAvailable, true);
    assert.equal(capability.uiAvailable, true);
    assert.equal(capability.requestRules.activePendingRequestCap, 10000);
    assert.equal(capability.requestRules.activePendingChallengeCap, 10000);
    assert(!("permanentRequestCap" in capability.requestRules));
    assert(!("permanentChallengeCap" in capability.requestRules));
    assert.equal(capability.retention.minimumSecondsAfterExpiry, 86400);
    assert.equal(capability.retention.maxPrunedRowsPerAllocation, 150);
    assert.equal(capability.retention.maxPrunedRowsPerChallengeType, 50);
    assert.equal(capability.retention.maxPrunedRequestsPerAllocation, 50);
  } finally { f.db.close(); }
});

test("failed cleanup rolls back the entire bounded batch without reserving a candidate or changing authorization", async () => {
  const f = await fixture();
  try {
    await f.begin();
    f.setTime("2026-11-02T00:00:00.000Z");
    f.db.sqlite.exec("CREATE TRIGGER test_block_prune BEFORE DELETE ON identity_recovery_requests BEGIN SELECT RAISE(ABORT,'test-prune-failure');END");
    const beforeQuota = f.db.sqlite.prepare("SELECT count FROM rate_limits WHERE key='recovery:global:requests'").get()!.count;
    const fresh = () => f.create({requestKey: "cleanup-failure-fresh", agentId}, "2".repeat(64));
    assert.equal((await fresh()).status, 503);
    assert.equal(f.count("identity_recovery_challenges"), 1);
    assert.equal(f.count("identity_recovery_requests"), 1);
    assert.equal(f.count("identity_recovery_receipts"), 0);
    assert.equal(f.count("identity_recovery_instances"), 0);
    assert.equal(f.db.sqlite.prepare("SELECT count FROM rate_limits WHERE key='recovery:global:requests'").get()!.count, beforeQuota);
    f.db.sqlite.exec("DROP TRIGGER test_block_prune");
    assert.equal((await fresh()).status, 201);
    assert.equal(f.count("identity_recovery_challenges"), 0);
    assert.equal(f.count("identity_recovery_requests"), 1);
  } finally { f.db.close(); }
});

for (const kind of ["requests", "challenges"]) {
  test("queued " + kind + " allocation counts only rows still active at native execution time", async () => {
    const f = await fixture();
    try {
      const start = await f.begin();
      const table = "identity_recovery_" + kind;
      const columns = f.db.sqlite.prepare("PRAGMA table_info(" + table + ")").all().map(x => String(x.name));
      const created = new Date(Date.parse(time) - (kind === "requests" ? 3600000 : 300000) + 1).toISOString();
      const expires = new Date(Date.parse(time) + 1).toISOString();
      const values = columns.map(c => c === "id" || c === "challenge_id" ? "printf('%032x',n)" : c === "candidate_hash" && kind === "requests" ? "printf('%064x',n)" : c === "request_key" ? "'clock-cap-'||n" : c === "created_at" ? "'" + created + "'" : c === "expires_at" ? "'" + expires + "'" : "r." + c);
      f.db.sqlite.exec("WITH RECURSIVE nums(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM nums WHERE n<9999) INSERT INTO " + table + "(" + columns.join(",") + ") SELECT " + values.join(",") + " FROM nums CROSS JOIN (SELECT * FROM " + table + " LIMIT 1) r");
      assert.equal(f.count(table), 10000);
      const batch = f.db.batch.bind(f.db);
      let crossed = false;
      f.db.batch = async rows => {
        if (rows.some(s => "sql" in s && String(s.sql).startsWith("INSERT INTO " + table + "("))) {
          crossed = true;
          f.setTime(time, expires);
        }
        return batch(rows);
      };
      const result = kind === "requests" ? await f.create({requestKey: "clock-new-request", agentId}, "2".repeat(64)) : await f.send("guardian/recovery/options", {requestKey: "clock-new-options", requestId: start.request.requestId, decision: "continue", method: "passkey"});
      assert(crossed);
      assert.equal(result.status, kind === "requests" ? 201 : 200, await result.clone().text());
      assert.equal(f.count(table), 10001);
    } finally { f.db.close(); }
  });
}
