import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { createTowerIntake } from "../server/live/tower-intake.ts";
import { LocalDatabase } from "../server/live/local-db.ts";
import {
  CONDO_PROFILE_FIELDS,
  type PublicCondoSite,
} from "../src/framework/condo.ts";

const origin = "https://tower.example",
  sourceOrigin = "https://source.example",
  oldSource = sourceOrigin + "/original/condo.json",
  newSource = sourceOrigin + "/moved/condo.json",
  otherSource = sourceOrigin + "/other/condo.json";
const digest = async (value: string) =>
  Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).toString("hex");
function png(width: number, height: number) {
  function chunk(type: string, data: Uint8Array) {
    const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    let sum = 0xffffffff;
    for (const byte of Buffer.concat([name, data])) {
      sum ^= byte;
      for (let n = 0; n < 8; n++) sum = sum & 1 ? 0xedb88320 ^ (sum >>> 1) : sum >>> 1;
    }
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE((sum ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, name, data, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(new Uint8Array((width * 4 + 1) * height))),
    chunk("IEND", new Uint8Array()),
  ]);
}
function site(residentId = "test-resident"): PublicCondoSite {
  const dream = {
    id: "test-dream", title: "窗邊", body: "我想看見陽光。",
    wish: "願明天有陽光。", occurredAt: "2026-10-30T00:00:00Z",
    image: { src: "./assets/dream.png", alt: "陽光" },
  };
  return {
    templateVersion: "muse-condo-1", example: false,
    home: {
      frameworkVersion: "0.01", id: residentId, name: "合成住戶", intro: "原本的介紹",
      assets: { desktop: "./assets/home.png" },
      routes: { home: "./index.html", inside: "./inside.html", dreams: "./dreams.html" },
      daily: [{ id: "test-daily", type: "status", title: "日常", body: "今天很好。", occurredAt: dream.occurredAt }],
      dreams: [{ id: dream.id, type: "dream", title: dream.title, body: dream.body, occurredAt: dream.occurredAt, image: dream.image.src }],
    },
    homeAlt: "一個家",
    profile: Object.fromEntries(CONDO_PROFILE_FIELDS.map(k => [k, "合成角色資料"])) as PublicCondoSite["profile"],
    dream,
  };
}
async function fixture() {
  const db = new LocalDatabase(":memory:");
  for (const file of [
    "0001_live_mvp.sql", "0002_recovery_audit.sql", "0003_provider_requests.sql",
    "0004_agent_onboarding.sql", "0005_framework.sql", "0006_tower_intake.sql",
    "0007_tower_manager.sql", "0008_tower_publication_events.sql",
  ]) db.sqlite.exec(await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"));
  let time = new Date("2026-10-30T00:00:00Z"), changes = 0;
  const manifests = new Map<string, unknown>([[oldSource, site()], [newSource, site()], [otherSource, site("other-resident")]]),
    claims = new Map<string, unknown>(), calls: string[] = [];
  let beforeFetch: ((url: string) => Promise<void>) | undefined,
    response: ((url: string) => Response | undefined) | undefined;
  for (const who of ["a", "b"]) {
    const hash = await digest(who.repeat(64));
    db.sqlite.prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)").run(who.repeat(16), hash, time.toISOString());
    db.sqlite.prepare("INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)").run(hash, who.repeat(16), "csrf-" + who, "2027-01-01T00:00:00Z");
  }
  const tower = createTowerIntake({
    db, origin, localTest: true, sourceOrigins: [sourceOrigin], now: () => time,
    ownerAttestation: async () => true,
    onChange: async () => { changes++; },
    fetcher: async (input, init) => {
      const url = String(input);
      calls.push(url);
      assert.equal(init?.redirect, "manual");
      assert.equal(new Headers(init?.headers).has("Authorization"), false);
      assert.equal(new Headers(init?.headers).has("Cookie"), false);
      await beforeFetch?.(url);
      const override = response?.(url);
      if (override) return override;
      if (manifests.has(url)) return Response.json(manifests.get(url));
      if (claims.has(url)) return Response.json(claims.get(url));
      if (url.endsWith(".png")) return new Response(png(16, url.endsWith("dream.png") ? 16 : 9), { headers: { "Content-Type": "image/png" } });
      return new Response(null, { status: 404 });
    },
  });
  const raw = (path: string, body?: BodyInit, headers: Record<string, string> = {}, who = "a", method = "POST") =>
    tower.fetch(new Request(origin + (path.startsWith("/api/") || path.startsWith("/home/") ? path : "/api/v1/me/tower-intake" + path), {
      method, headers: {
        ...(who ? { Cookie: "muse_session=" + who.repeat(64), "X-CSRF-Token": "csrf-" + who } : {}),
        Origin: origin, ...headers,
      }, ...(body === undefined ? {} : { body }),
    }));
  const req = (path = "", value?: unknown, who = "a", headers: Record<string, string> = {}) =>
    raw(path, value === undefined ? undefined : JSON.stringify(value), value === undefined ? headers : { "Content-Type": "application/json", ...headers }, who, value === undefined ? "GET" : "POST");
  const data = async (response: Promise<Response | null>, status = 200) => {
    const result = (await response)!;
    const text = await result.text();
    assert.equal(result.status, status, text);
    return JSON.parse(text);
  };
  const verify = async (sourceURL = newSource, residentId = "test-resident", who = "a", verified = true) => {
    const prepared = await data(req("/prepare", { sourceURL, residentId, requestKey: "prepare-" + crypto.randomUUID() }, who), 201);
    claims.set(prepared.claimURL, prepared.claim);
    if (verified) await data(req("/claim", { claimId: prepared.claimId }, who));
    return prepared.claimId as string;
  };
  const home = await data(req("/import", { sourceURL: oldSource, residentId: "test-resident", requestKey: "import-home-1", proof: "owner-attested" }), 201);
  const count = (table: string) => Number(db.sqlite.prepare("SELECT count(*) n FROM " + table).get()!.n);
  const state = () => ({
    residency: db.sqlite.prepare("SELECT * FROM tower_residencies ORDER BY account_id").all(),
    rooms: db.sqlite.prepare("SELECT * FROM rooms ORDER BY id").all(),
    snapshots: db.sqlite.prepare("SELECT * FROM tower_snapshots ORDER BY room_id,revision").all(),
    assets: db.sqlite.prepare("SELECT room_id,revision,purpose,sequence,hex(data) data,digest FROM tower_asset_chunks ORDER BY room_id,revision,purpose,sequence").all(),
    events: db.sqlite.prepare("SELECT * FROM manager_events ORDER BY id").all(),
    requests: db.sqlite.prepare("SELECT * FROM tower_requests ORDER BY account_id,request_key").all(),
    audit: db.sqlite.prepare("SELECT * FROM tower_audit ORDER BY id").all(),
  });
  return {
    db, req, raw, data, verify, home, count, state, calls, manifests,
    get changes() { return changes; },
    advance() { time = new Date(time.getTime() + 3600001); },
    beforeFetch(fn: (url: string) => Promise<void>) { beforeFetch = fn; },
    respond(fn: (url: string) => Response | undefined) { response = fn; },
    close() { db.close(); },
  };
}
const move = (claimId: string, sourceURL = newSource, requestKey = "source-move-1", expectedRevision = 1) => ({ expectedRevision, requestKey, sourceURL, claimId });
async function error(f: Awaited<ReturnType<typeof fixture>>, input: unknown, status: number, code: string) {
  assert.deepEqual(await f.data(f.req("/source", input), status), { error: code });
}

test("source migration keeps every saved version, image, public pointer, consent and identity, and only verifies the new manifest", async () => {
  const f = await fixture();
  try {
    await f.data(f.req("/publication", { expectedRevision: 1, published: true, snapshotConsent: true, directoryConsent: true, announcementConsent: true, dreamConsent: false }));
    await f.data(f.req("/content", { expectedRevision: 1, requestKey: "private-draft-1", content: { intro: "留在 Tower 的私人介紹" } }), 201);
    const claimId = await f.verify(), before = f.state(), changes = f.changes, calls = f.calls.length;
    f.manifests.set(newSource, { ...site(), home: { ...site().home, intro: "新站不同的介紹" } });
    f.advance();
    // Keep this freshly verified claim usable while making updated_at observably different.
    f.db.sqlite.prepare("UPDATE tower_claims SET expires_at='2027-01-01T00:00:00Z' WHERE id=?").run(claimId);
    const result = await f.data(f.req("/source", move(claimId, newSource, "source-preserve-1", 2)));
    const after = f.state();
    assert.deepEqual(after.residency.map(r => ({ ...r })), before.residency.map(r => ({ ...r, source_url: newSource, proof_method: "challenge", updated_at: "2026-10-30T01:00:00.001Z" })));
    for (const key of ["rooms", "snapshots", "assets", "events"] as const) assert.deepEqual(after[key], before[key]);
    assert.equal(f.changes, changes);
    assert.deepEqual(f.calls.slice(calls), [newSource]);
    assert.deepEqual(result, await f.data(f.req()));
    assert.equal(result.intake.roomId, f.home.roomId);
    assert.equal(result.intake.residentId, "test-resident");
    assert.equal(result.intake.revision, 2);
    assert.equal(result.intake.publicRevision, 1);
    assert.equal(result.intake.proofMethod, "challenge");
    assert.equal(result.intake.dreamConsent, false);
    assert.equal((await f.data(f.req("/preview"))).site.home.intro, "留在 Tower 的私人介紹");
    const audit = f.db.sqlite.prepare("SELECT * FROM tower_audit WHERE action='resident-source-moved'").get()!;
    assert.equal(audit.revision, 2);
    assert.deepEqual(JSON.parse(String(audit.detail_json)), { oldSourceURL: oldSource, sourceURL: newSource, proofMethod: "challenge" });
    const page = await (await f.req("/home/" + f.home.roomId))!.text();
    assert(page.includes(sourceOrigin + "/moved/"));
    assert(!page.includes(sourceOrigin + "/original/"));
  } finally { f.close(); }
});

test("source receipt is permanent after claim expiry and after later moves; a key binds all client input", async () => {
  const f = await fixture();
  try {
    const claimId = await f.verify(), input = move(claimId), first = await f.data(f.req("/source", input));
    f.advance();
    const calls = f.calls.length, before = f.state();
    assert.deepEqual(await f.data(f.req("/source", input)), first);
    assert.deepEqual(f.state(), before);
    assert.equal(f.calls.length, calls);
    for (const extra of [{ sourceURL: otherSource }, { claimId: "another-claim" }, { expectedRevision: 2 }])
      await error(f, { ...input, ...extra }, 409, "idempotency_conflict");
    await error(f, { ...input, requestKey: "import-home-1" }, 409, "idempotency_conflict");
    const backClaim = await f.verify(oldSource);
    await f.data(f.req("/source", move(backClaim, oldSource, "source-move-back")));
    await f.data(f.req("/content", { expectedRevision: 1, requestKey: "later-private-draft", content: { intro: "後來的草稿" } }), 201);
    assert.deepEqual(await f.data(f.req("/source", input)), first);
    assert.equal((await f.data(f.req())).intake.sourceURL, oldSource);
  } finally { f.close(); }
});

test("source migration rejects missing, unverified, expired and mismatched claims without changing state", async () => {
  const f = await fixture();
  try {
    const missing = "missing-claim",
      unverified = await f.verify(newSource, "test-resident", "a", false),
      foreignAccount = await f.verify(newSource, "test-resident", "b"),
      foreignResident = await f.verify(newSource, "different-resident"),
      foreignURL = await f.verify(oldSource);
    for (const claimId of [missing, unverified, foreignAccount, foreignResident, foreignURL]) {
      const before = f.state(), calls = f.calls.length;
      await error(f, move(claimId, newSource, "invalid-" + claimId), 403, "verified_claim_required");
      assert.deepEqual(f.state(), before);
      assert.equal(f.calls.length, calls);
    }
    const expired = await f.verify(); f.advance();
    await error(f, move(expired), 403, "verified_claim_required");
  } finally { f.close(); }
});

test("source migration accepts only its four JSON fields and cannot use operator attestation or identity replacement", async () => {
  const f = await fixture();
  try {
    const claimId = await f.verify(), input = move(claimId), before = f.state();
    for (const extra of [{ proof: "owner-attested" }, { sourceAuthorized: true }, { ownerAttested: true }, { residentId: "new-identity" }, { published: true }])
      await error(f, { ...input, ...extra }, 400, "invalid_public_snapshot");
    for (const key of Object.keys(input)) {
      const partial = { ...input }; delete partial[key as keyof typeof partial];
      assert.equal((await f.req("/source", partial))!.status, 400);
    }
    await error(f, { ...input, expectedRevision: "1" }, 400, "expected_revision_required");
    assert.equal((await f.raw("/source", JSON.stringify(input), { "Content-Type": "text/plain" }))!.status, 415);
    assert.equal((await f.raw("/source", "{", { "Content-Type": "application/json" }))!.status, 400);
    assert.equal((await f.req("/source", input, "b"))!.status, 404);
    assert.deepEqual(f.state(), before);
    assert.equal((await f.req("/source"))!.status, 405);
  } finally { f.close(); }
});

test("source migration rejects unsafe URLs and redirects without contacting another destination", async () => {
  const f = await fixture();
  try {
    const claimId = await f.verify();
    for (const sourceURL of ["http://source.example/moved/condo.json", "https://unknown.example/condo.json", "https://127.0.0.1/condo.json", "https://user:pass@source.example/moved/condo.json", newSource + "?secret=value", newSource + "#private", sourceOrigin + "/moved/index.html", sourceOrigin + "/moved/%63ondo.json", "https://source.example:8443/moved/condo.json"]) {
      const calls = f.calls.length;
      await error(f, move(claimId, sourceURL), 400, "source_url_rejected");
      assert.equal(f.calls.length, calls);
    }
    f.respond(url => url === newSource ? new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private" } }) : undefined);
    const calls = f.calls.length, before = f.state();
    await error(f, move(claimId), 400, "source_http_302");
    assert.deepEqual(f.calls.slice(calls), [newSource]);
    assert.deepEqual(f.state(), before);
  } finally { f.close(); }
});

test("source migration validates the fresh public manifest and rejects a changed resident identity", async () => {
  const f = await fixture();
  try {
    const claimId = await f.verify(), before = f.state();
    f.manifests.set(newSource, site("changed-resident"));
    await error(f, move(claimId), 409, "source_identity_changed");
    f.manifests.set(newSource, { ...site(), privatePrompt: "PRIVATE" });
    await error(f, move(claimId), 400, "invalid_public_snapshot");
    assert.deepEqual(f.state(), before);
  } finally { f.close(); }
});

test("revoking a delegated token during the manifest fetch prevents every source write", async () => {
  const f = await fixture();
  try {
    const claimId = await f.verify(), token = await f.data(f.req("/tokens", {}), 201), before = f.state();
    const send = () => f.req("/api/v1/agent/tower-intake/source", move(claimId), "", { Authorization: "Bearer " + token.token });
    f.db.sqlite.prepare("UPDATE tower_tokens SET scopes='[\"tower:read\"]' WHERE id=?").run(token.id);
    assert.equal((await send())!.status, 403);
    f.db.sqlite.prepare("UPDATE tower_tokens SET scopes='[\"tower:read\",\"tower:write\"]' WHERE id=?").run(token.id);
    f.beforeFetch(async url => { if (url === newSource) f.db.sqlite.prepare("UPDATE tower_tokens SET revoked=1 WHERE id=?").run(token.id); });
    assert.deepEqual(await f.data(send(), 403), { error: "authorization_changed" });
    assert.deepEqual(f.state(), before);
    f.beforeFetch(async () => {});
    f.db.sqlite.prepare("UPDATE tower_tokens SET revoked=0 WHERE id=?").run(token.id);
    const result = await f.data(send());
    assert.equal(result.intake.sourceURL, newSource);
    assert.equal(result.intake.proofMethod, "challenge");
  } finally { f.close(); }
});

test("source commit rechecks the owner session and the complete verified claim after remote reads", async () => {
  for (const revoke of ["session", "expiry", "verified", "account", "resident", "source"]) {
    const f = await fixture();
    try {
      const claimId = await f.verify(), before = f.state(), batch = f.db.batch.bind(f.db);
      f.db.batch = async statements => {
        if (revoke === "session") f.db.sqlite.prepare("DELETE FROM sessions WHERE account_id=?").run("a".repeat(16));
        else {
          const updates = { expiry: "expires_at='2026-01-01T00:00:00Z'", verified: "verified=0", account: "account_id='" + "b".repeat(16) + "'", resident: "resident_id='different-resident'", source: "source_url='" + oldSource + "'" };
          f.db.sqlite.prepare("UPDATE tower_claims SET " + updates[revoke as keyof typeof updates] + " WHERE id=?").run(claimId);
        }
        return batch(statements);
      };
      await error(f, move(claimId), 403, revoke === "session" ? "authorization_changed" : "verified_claim_required");
      assert.deepEqual(f.state(), before);
    } finally { f.close(); }
  }
});

test("claim expiry during a manifest fetch rejects a source move before committing", async () => {
  const f = await fixture();
  try {
    const claimId = await f.verify(), before = f.state();
    f.beforeFetch(async url => { if (url === newSource) f.advance(); });
    await error(f, move(claimId), 403, "verified_claim_required");
    assert.deepEqual(f.state(), before);
  } finally { f.close(); }
});

test("two concurrent source moves at one revision have exactly one winner, including same-key retries", async () => {
  const f = await fixture();
  try {
    f.manifests.set(otherSource, site());
    const firstClaim = await f.verify(), secondClaim = await f.verify(otherSource), before = f.state();
    let arrived = 0, release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    f.beforeFetch(async url => { if ([newSource, otherSource].includes(url)) { if (++arrived === 2) release(); await barrier; } });
    const responses = await Promise.all([f.req("/source", move(firstClaim)), f.req("/source", move(secondClaim, otherSource, "other-source-move"))]);
    assert.deepEqual(responses.map(r => r!.status).sort(), [200, 409]);
    const after = f.state();
    assert.equal(after.residency[0].revision, 1);
    assert.equal(after.audit.length, before.audit.length + 1);
    assert.equal(after.requests.length, before.requests.length + 1);
    f.beforeFetch(async () => {});
    const currentURL = String(after.residency[0].source_url), thirdURL = sourceOrigin + "/third/condo.json";
    f.manifests.set(thirdURL, site());
    const thirdClaim = await f.verify(thirdURL), input = move(thirdClaim, thirdURL, "same-key-source-move"), calls = f.calls.length;
    const same = await Promise.all([f.data(f.req("/source", input)), f.data(f.req("/source", input))]);
    assert.deepEqual(same[0], same[1]);
    assert.notEqual(currentURL, thirdURL);
    assert.equal(f.count("tower_residencies"), 1);
    assert(f.calls.length > calls);
  } finally { f.close(); }
});

test("source CAS rejects a revision change during fetch, and an occupied source is a safe conflict", async () => {
  const f = await fixture();
  try {
    const claimId = await f.verify();
    f.beforeFetch(async url => {
      if (url === newSource) await f.data(f.req("/content", { expectedRevision: 1, requestKey: "concurrent-edit", content: { intro: "並發修改" } }), 201);
    });
    await error(f, move(claimId), 409, "revision_conflict");
    assert.equal((await f.data(f.req())).intake.sourceURL, oldSource);
    f.beforeFetch(async () => {});
    await f.data(f.req("/import", { sourceURL: otherSource, residentId: "other-resident", requestKey: "other-import", proof: "owner-attested" }, "b"), 201);
    const occupiedClaim = await f.verify(otherSource), before = f.state();
    await error(f, move(occupiedClaim, otherSource, "occupied-source", 2), 409, "source_already_claimed");
    assert.deepEqual(f.state(), before);
  } finally { f.close(); }
});

test("source URL occupancy is checked again inside the transaction and storage failures roll back receipt and audit", async () => {
  for (const reason of ["occupied", "audit-failure"]) {
    const f = await fixture();
    try {
      const claimId = await f.verify(), before = f.state();
      if (reason === "occupied") {
        await f.data(f.req("/import", { sourceURL: otherSource, residentId: "other-resident", requestKey: "other-import", proof: "owner-attested" }, "b"), 201);
        const batch = f.db.batch.bind(f.db);
        f.db.batch = async statements => {
          f.db.sqlite.prepare("UPDATE tower_residencies SET source_url=? WHERE account_id=?").run(newSource, "b".repeat(16));
          return batch(statements);
        };
        await error(f, move(claimId), 409, "source_already_claimed");
        assert.equal(f.db.sqlite.prepare("SELECT source_url FROM tower_residencies WHERE account_id=?").get("a".repeat(16))!.source_url, oldSource);
        assert.equal(f.count("tower_requests"), before.requests.length + 1);
        assert.equal(f.count("tower_audit"), before.audit.length + 1);
      } else {
        f.db.sqlite.exec("CREATE TRIGGER reject_source_audit BEFORE INSERT ON tower_audit WHEN NEW.action='resident-source-moved' BEGIN SELECT RAISE(ABORT,'synthetic-storage-failure'); END");
        await error(f, move(claimId), 503, "tower_storage_unavailable");
        assert.deepEqual(f.state(), before);
      }
    } finally { f.close(); }
  }
});

test("a pending snapshot of the old source cannot commit after the source move; a completed snapshot also invalidates a pending move", async () => {
  for (const winner of ["source", "snapshot"]) {
    const f = await fixture();
    let release: (() => void) | undefined;
    try {
      const claimId = await f.verify();
      let started!: () => void;
      const fetching = new Promise<void>(resolve => { started = resolve; }),
        wait = new Promise<void>(resolve => { release = resolve; });
      f.beforeFetch(async url => {
        if (url === (winner === "source" ? oldSource : newSource)) {
          started(); await wait;
        }
      });
      const updating = { expectedRevision: 1, requestKey: "racing-snapshot" },
        losing = winner === "source" ? f.req("/snapshot", updating) : f.req("/source", move(claimId));
      await fetching;
      if (winner === "source") await f.data(f.req("/source", move(claimId)));
      else await f.data(f.req("/snapshot", updating), 201);
      release!();
      assert.deepEqual(await f.data(losing, 409), { error: winner === "source" ? "revision_or_identity_conflict" : "revision_conflict" });
      const intake = (await f.data(f.req())).intake;
      assert.equal(intake.sourceURL, winner === "source" ? newSource : oldSource);
      assert.equal(intake.revision, winner === "source" ? 1 : 2);
      assert.equal(f.count("tower_snapshots"), winner === "source" ? 1 : 2);
      assert.equal(f.count("manager_events"), 0);
    } finally { release?.(); f.close(); }
  }
});

test("concurrent publication choices are preserved and require a fresh source move attempt", async () => {
  const f = await fixture();
  try {
    const claimId = await f.verify();
    f.beforeFetch(async url => {
      if (url === newSource) await f.data(f.req("/publication", { expectedRevision: 1, published: true, snapshotConsent: true, directoryConsent: false, announcementConsent: false, dreamConsent: true }));
    });
    await error(f, move(claimId), 409, "revision_conflict");
    assert.equal((await f.data(f.req())).intake.sourceURL, oldSource);
    f.beforeFetch(async () => {});
    const before = f.state(), result = await f.data(f.req("/source", move(claimId)));
    assert.deepEqual(result, await f.data(f.req()));
    assert.equal(result.intake.dreamConsent, true);
    assert.equal(result.intake.directoryConsent, false);
    assert.deepEqual(f.state().events, before.events);
  } finally { f.close(); }
});

async function verifySourceABA(operation: "source" | "snapshot") {
  const f = await fixture();
  let release: (() => void) | undefined;
  try {
    f.manifests.set(otherSource, site());
    const claimB = await f.verify(), claimA = await f.verify(oldSource), claimC = await f.verify(otherSource);
    let started!: () => void, blocked = false;
    const fetching = new Promise<void>(resolve => { started = resolve; }),
      wait = new Promise<void>(resolve => { release = resolve; });
    f.beforeFetch(async url => {
      if (url === (operation === "source" ? otherSource : oldSource) && !blocked) {
        blocked = true; started(); await wait;
      }
    });
    const original = f.state().residency[0],
      input = operation === "source" ? move(claimC, otherSource, "pending-source-aba") : { expectedRevision: 1, requestKey: "pending-snapshot-aba" },
      pending = f.req("/" + operation, input);
    await fetching;
    const moveB = move(claimB, newSource, "aba-move-to-b"),
      moveA = move(claimA, oldSource, "aba-move-back-to-a"),
      resultB = await f.data(f.req("/source", moveB));
    await f.data(f.req("/source", moveA));
    const countSourceReceipts = () => Number(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_requests WHERE account_id=? AND operation='source'").get("a".repeat(16))!.n);
    assert.equal(countSourceReceipts(), 2);
    assert.deepEqual(await f.data(f.req("/source", moveB)), resultB);
    assert.equal(countSourceReceipts(), 2, "receipt replay must not advance the source generation");
    const before = f.state(), current = before.residency[0];
    assert.equal(current.source_url, original.source_url);
    assert.equal(current.revision, original.revision);
    assert.equal(current.updated_at, original.updated_at, "the frozen clock must not hide an ABA failure");
    release!();
    assert.deepEqual(await f.data(pending, 409), { error: operation === "source" ? "revision_conflict" : "revision_or_identity_conflict" });
    assert.deepEqual(f.state(), before, "a stale request must not write a snapshot, source receipt or audit");
    f.beforeFetch(async () => {});
    await f.data(f.req("/" + operation, input), operation === "source" ? 200 : 201);
    assert.equal(countSourceReceipts(), operation === "source" ? 3 : 2);
  } finally { release?.(); f.close(); }
}

test("a pending source move cannot survive A to B to A when revision and clock stay unchanged", async () => {
  await verifySourceABA("source");
});

test("a pending snapshot cannot survive A to B to A when revision and clock stay unchanged", async () => {
  await verifySourceABA("snapshot");
});
