import {createLiveApp} from '../server/live/app.ts';
import runtime from '../server/live/worker.ts';
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { createTowerIntake } from "../server/live/tower-intake.ts";
import { LocalDatabase } from "../server/live/local-db.ts";
const origin = "https://tower.example",
  sourceURL = "https://source.example/resident/condo.json";
const sha = async (v: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const checksum = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(name: string, data: Uint8Array) {
  const type = Buffer.from(name),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(checksum(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}
function png(w: number, h: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.from("Comment\0PRIVATE_PNG_METADATA")),
    chunk("IDAT", deflateSync(new Uint8Array((1 + w * 4) * h))),
    chunk("IEND", new Uint8Array()),
  ]);
}
async function fixture() {
  const db = new LocalDatabase(":memory:");
  for (const file of [
    "0001_live_mvp.sql",
    "0002_recovery_audit.sql",
    "0003_provider_requests.sql",
    "0004_agent_onboarding.sql",
    "0005_framework.sql",
  ])
    db.sqlite.exec(
      await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  // Feature migration is optional until it exists so the RED assertion exposes behavior, not a file error.
  try {
    db.sqlite.exec(
      await readFile(
        new URL("../migrations/0006_tower_intake.sql", import.meta.url),
        "utf8",
      ),
    );
  } catch (e) {
    if ((e as { code?: string }).code !== "ENOENT") throw e;
  }
  db.sqlite.exec(await readFile(new URL('../migrations/0008_tower_publication_events.sql',import.meta.url),'utf8'));
  const raw = JSON.parse(
    await readFile(new URL("../condo/condo.json", import.meta.url), "utf8"),
  );
  raw.home.name = "Tower Test";
  raw.home.intro = "Public welcome";
  let manifest = raw,
    challenge: unknown = null,
    attested = true,
    time = new Date("2026-10-30T00:00:00Z"),
    changes = 0,
    badImage = false;
  let customImage: Uint8Array<ArrayBuffer> | undefined;
  let customDreamImage: Uint8Array<ArrayBuffer> | undefined;
  const calls: string[] = [];
  let beforeFetch: ((url: string) => Promise<void>) | undefined;
  for (const [id, token] of [
    ["a".repeat(16), "a".repeat(64)],
    ["b".repeat(16), "b".repeat(64)],
  ]) {
    db.sqlite
      .prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)")
      .run(id, await sha(token), time.toISOString());
    db.sqlite
      .prepare(
        "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)",
      )
      .run(await sha(token), id, "csrf-" + id, "2027-01-01T00:00:00Z");
  }
  const tower = createTowerIntake({
    db,
    origin,
    localTest: true,
    sourceOrigins: ["https://source.example"],
    now: () => time,
    ownerAttestation: async () => attested,
    onChange: async () => {
      changes++;
    },
    fetcher: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      await beforeFetch?.(url);
      assert.equal(init?.redirect, "error");
      if (url === sourceURL) return Response.json(manifest);
      if (url.endsWith("muse-tower-claim.json"))
        return Response.json(challenge);
      return new Response(
        badImage
          ? "not png"
          : ((url.endsWith("home.png") ? customImage : customDreamImage) ??
            png(16, url.endsWith("dream.png") ? 16 : 9)),
        { headers: { "Content-Type": "image/png" } },
      );
    },
  });
  const req = (
    path = "",
    method = "GET",
    body?: unknown,
    who = "a",
    headers: Record<string, string> = {},
  ) =>
    tower.fetch(
      new Request(
        origin +
          (/^\/(api|home|unrelated)(?:\/|$)/.test(path)
            ? path
            : "/api/v1/me/tower-intake" + path),
        {
          method,
          headers: {
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(who
              ? {
                  Cookie: `muse_session=${who.repeat(64)}`,
                  "X-CSRF-Token": "csrf-" + who.repeat(16),
                }
              : {}),
            ...(method === "GET" ? {} : { Origin: origin }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      ),
    );
  const data = async (r: Promise<Response | null>, status = 200) => {
    const response = (await r)!;
    const body = await response.text();
    assert.equal(response.status, status, body);
    return JSON.parse(body);
  };
  const importHome = (
    requestKey = "import-home-1",
    extra: Record<string, unknown> = {},
  ) =>
    data(
      req("/import", "POST", {
        sourceURL,
        residentId: raw.home.id,
        requestKey,
        proof: "owner-attested",
        ...extra,
      }),
      201,
    );
  return {
    db,
    req,
    data,
    importHome,
    raw,
    get calls() {
      return calls;
    },
    get changes() {
      return changes;
    },
    setManifest(v: unknown) {
      manifest = v;
    },
    setChallenge(v: unknown) {
      challenge = v;
    },
    setAttested(v: boolean) {
      attested = v;
    },
    beforeFetch(fn: (url: string) => Promise<void>) {
      beforeFetch = fn;
    },
    setImage(bytes: Uint8Array) {
      customImage = new Uint8Array(bytes);
    },
    setDreamImage(bytes: Uint8Array) {
      customDreamImage = new Uint8Array(bytes);
    },
    badImage() {
      badImage = true;
    },
    advance() {
      time = new Date(time.getTime() + 3600001);
    },
    close() {
      db.close();
    },
  };
}
const consent = (expectedRevision = 1, published = true) => ({
  expectedRevision,
  published,
  directoryConsent: published,
  announcementConsent: published,
  dreamConsent: published,
  snapshotConsent: published,
});
test("Tower owner status requires authentication and CSRF; unrelated routes pass through", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.req("", "GET", undefined, ""))?.status, 401);
    assert.equal(
      (await f.req("/import", "POST", {}, "a", { "X-CSRF-Token": "wrong" }))
        ?.status,
      403,
    );
    assert.equal(await f.req("/unrelated"), null);
  } finally {
    f.close();
  }
});
test("attested import is private, permanent idempotent, source identity locked and isolated", async () => {
  const f = await fixture();
  try {
    const a = await f.importHome();
    assert.match(a.roomId, /^[a-f0-9]{16}$/);
    assert.equal(a.revision, 1);
    assert.equal((await f.importHome()).roomId, a.roomId);
    assert.equal(
      f.db.sqlite.prepare("SELECT count(*) n FROM rooms").get()!.n,
      1,
    );
    assert.equal(
      (await f.req("/home/" + a.roomId, "GET", undefined, ""))?.status,
      404,
    );
    assert.equal((await f.data(f.req("", "GET", undefined, "b"))).intake, null);
    assert.equal(
      (
        await f.req(
          "/import",
          "POST",
          {
            sourceURL,
            residentId: f.raw.home.id,
            requestKey: "different-owner",
            proof: "owner-attested",
          },
          "b",
        )
      )?.status,
      409,
    );
    assert.equal(
      (
        await f.req("/import", "POST", {
          sourceURL,
          residentId: "c".repeat(16),
          requestKey: "identity-swap",
          proof: "owner-attested",
        })
      )?.status,
      409,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT proof_method FROM tower_residencies").get()!
        .proof_method,
      "owner-attested",
    );
  } finally {
    f.close();
  }
});
test("three trusted pages publish atomic owned assets; dream has separate consent, withdrawal removes old revisions", async () => {
  const f = await fixture();
  try {
    const a = await f.importHome();
    await f.data(f.req("/publication", "POST", consent()));
    for (const suffix of ["", "/inside", "/dreams"]) {
      const r = (await f.req(
        "/home/" + a.roomId + suffix,
        "GET",
        undefined,
        "",
      ))!;
      assert.equal(r.status, 200);
      const html = await r.text();
      assert.match(html, /Tower Test/);
      assert.match(html, /\/home\//);
      assert.doesNotMatch(html, /\.\/assets|\.\/index.html/);
    }
    const asset = "/api/v1/tower/assets/" + a.roomId + "/1/home.png";
    const image = (await f.req(asset, "GET", undefined, ""))!;
    assert.equal(image.status, 200);
    assert.doesNotMatch(
      Buffer.from(await image.arrayBuffer()).toString(),
      /PRIVATE_PNG_METADATA/,
    );
    await f.data(
      f.req("/publication", "POST", { ...consent(), dreamConsent: false }),
    );
    const blankDream = (await f.req(
      "/home/" + a.roomId + "/dreams",
      "GET",
      undefined,
      "",
    ))!;
    assert.equal(blankDream.status, 200);
    const blankHTML = await blankDream.text();
    assert.match(blankHTML, /還沒有公開的夢/);
    assert.ok(!blankHTML.includes(f.raw.dream.title));
    assert.equal(
      (
        await f.req(
          asset.replace("home.png", "dream.png"),
          "GET",
          undefined,
          "",
        )
      )?.status,
      404,
    );
    await f.data(f.req("/publication", "POST", consent(1, false)));
    assert.equal((await f.req(asset, "GET", undefined, ""))?.status, 404);
    assert.equal(
      (await f.req("/home/" + a.roomId, "GET", undefined, ""))?.status,
      404,
    );
    assert.equal(f.changes, 3);
  } finally {
    f.close();
  }
});
test("snapshot optimistic lock keeps published revision stable and rejects partial asset failure", async () => {
  const f = await fixture();
  try {
    const a = await f.importHome();
    await f.data(f.req("/publication", "POST", consent()));
    const changed = structuredClone(f.raw);
    changed.home.name = "Updated";
    f.setManifest(changed);
    const update = await f.data(
      f.req("/snapshot", "POST", {
        expectedRevision: 1,
        requestKey: "snapshot-2",
      }),
      201,
    );
    assert.equal(update.roomId, a.roomId);
    assert.equal(update.revision, 2);
    assert.match(
      await (await f.req("/home/" + a.roomId, "GET", undefined, ""))!.text(),
      /Tower Test/,
    );
    assert.equal(
      (
        await f.req("/snapshot", "POST", {
          expectedRevision: 1,
          requestKey: "stale-update",
        })
      )?.status,
      409,
    );
    await f.data(f.req("/publication", "POST", consent(2)));
    assert.match(
      await (await f.req("/home/" + a.roomId, "GET", undefined, ""))!.text(),
      /Updated/,
    );
    assert.equal(
      (
        await f.req(
          "/api/v1/tower/assets/" + a.roomId + "/1/home.png",
          "GET",
          undefined,
          "",
        )
      )?.status,
      404,
    );
    f.badImage();
    assert.equal(
      (
        await f.req("/snapshot", "POST", {
          expectedRevision: 2,
          requestKey: "bad-image-update",
        })
      )?.status,
      400,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT count(*) n FROM tower_snapshots").get()!.n,
      2,
    );
  } finally {
    f.close();
  }
});
test("remote boundaries reject unconfigured origins, arbitrary paths, internal fields and invalid images", async () => {
  const f = await fixture();
  try {
    for (const url of [
      "https://evil.example/condo.json",
      "https://source.example/resident/condo.json#",
      "https://source.example/resident/condo.json?",
      "https://127.0.0.1/condo.json",
      "http://source.example/condo.json",
      "https://user@source.example/x/condo.json",
      "https://source.example:443/x/condo.json#x",
      "https://source.example/x/file.json",
    ])
      assert.equal(
        (
          await f.req("/import", "POST", {
            sourceURL: url,
            residentId: f.raw.home.id,
            requestKey: "invalid-url-1",
            proof: "owner-attested",
          })
        )?.status,
        400,
      );
    assert.equal(f.calls.length, 0);
    f.setManifest({ ...f.raw, seed: { evidence: "PRIVATE" } });
    assert.equal(
      (
        await f.req("/import", "POST", {
          sourceURL,
          residentId: f.raw.home.id,
          requestKey: "private-seed-1",
          proof: "owner-attested",
        })
      )?.status,
      400,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT count(*) n FROM rooms").get()!.n,
      0,
    );
    f.setManifest({
      ...f.raw,
      home: {
        ...f.raw.home,
        assets: { desktop: "https://evil.example/x.png" },
      },
    });
    assert.equal(
      (
        await f.req("/import", "POST", {
          sourceURL,
          residentId: f.raw.home.id,
          requestKey: "remote-image-1",
          proof: "owner-attested",
        })
      )?.status,
      400,
    );
  } finally {
    f.close();
  }
});
test("challenge binds tower, source resident and expiry; attestation cannot be self asserted", async () => {
  const f = await fixture();
  try {
    f.setAttested(false);
    assert.equal(
      (
        await f.req("/import", "POST", {
          sourceURL,
          residentId: f.raw.home.id,
          requestKey: "denied-attest-1",
          proof: "owner-attested",
        })
      )?.status,
      403,
    );
    const prep = await f.data(
      f.req("/prepare", "POST", {
        sourceURL,
        residentId: f.raw.home.id,
        requestKey: "prepare-home-1",
      }),
      201,
    );
    f.setChallenge({ ...prep.claim, tower: "https://evil.example" });
    assert.equal(
      (await f.req("/claim", "POST", { claimId: prep.claimId }))?.status,
      403,
    );
    f.setChallenge(prep.claim);
    await f.data(f.req("/claim", "POST", { claimId: prep.claimId }));
    const imported = await f.data(
      f.req("/import", "POST", {
        sourceURL,
        residentId: f.raw.home.id,
        requestKey: "claim-import-1",
        proof: "challenge",
      }),
      201,
    );
    assert.equal(imported.proofMethod, "challenge");
    assert.equal(
      f.db.sqlite.prepare("SELECT proof_method FROM tower_residencies").get()!
        .proof_method,
      "challenge",
    );
  } finally {
    f.close();
  }
});
test("scoped tower tokens are hashed, isolated, revocable and never authorize mixed cookies", async () => {
  const f = await fixture();
  try {
    await f.importHome();
    const grant = await f.data(f.req("/tokens", "POST", {}), 201);
    assert.match(grant.token, /^[a-f0-9]{64}$/);
    assert.notEqual(
      f.db.sqlite.prepare("SELECT token_hash FROM tower_tokens").get()!
        .token_hash,
      grant.token,
    );
    const path = "/api/v1/agent/tower-intake";
    assert.equal(
      (
        await f.req(path, "GET", undefined, "", {
          Authorization: "Bearer " + grant.token,
        })
      )?.status,
      200,
    );
    assert.equal(
      (
        await f.req(path, "GET", undefined, "b", {
          Authorization: "Bearer " + grant.token,
        })
      )?.status,
      403,
    );
    await f.data(f.req("/tokens/" + grant.id, "DELETE", {}));
    assert.equal(
      (
        await f.req(path, "GET", undefined, "", {
          Authorization: "Bearer " + grant.token,
        })
      )?.status,
      403,
    );
  } finally {
    f.close();
  }
});
test("private preview serves owned PNG and trusted three-page HTML before publication", async () => {
  const f = await fixture();
  try {
    const a = await f.importHome();
    const preview = await f.data(f.req("/preview"));
    assert.match(
      preview.site.home.assets.desktop,
      /\/me\/tower-intake\/assets\//,
    );
    const im = await f.req(preview.site.home.assets.desktop);
    assert.equal(im?.status, 200);
    assert.equal(
      (await f.req(preview.site.home.assets.desktop, "GET", undefined, "b"))
        ?.status,
      404,
    );
    assert.equal(
      (await f.req(preview.site.home.assets.desktop, "GET", undefined, ""))
        ?.status,
      401,
    );
    const html = await f.req("/preview/inside");
    assert.equal(html?.status, 200);
    assert.match(await html!.text(), /角色檔案/);
    assert.equal(
      (await f.req("/home/" + a.roomId, "GET", undefined, ""))?.status,
      404,
    );
  } finally {
    f.close();
  }
});
test("different request keys for the same resident never recreate the room or snapshot", async () => {
  const f = await fixture();
  try {
    const a = await f.importHome();
    const repeated = await f.importHome("import-home-newkey");
    assert.equal(repeated.roomId, a.roomId);
    assert.equal(
      f.db.sqlite.prepare("SELECT count(*) n FROM tower_snapshots").get()!.n,
      1,
    );
  } finally {
    f.close();
  }
});
test("failed database batch rolls back publication consent, metadata, audit and room visibility", async () => {
  const f = await fixture();
  try {
    const a = await f.importHome();
    f.db.sqlite.exec(
      "CREATE TRIGGER fail_publication BEFORE INSERT ON tower_audit WHEN NEW.action='published' BEGIN SELECT RAISE(ABORT,'test rollback'); END",
    );
    assert.equal((await f.req("/publication", "POST", consent()))?.status, 503);
    assert.equal(
      (await f.req("/home/" + a.roomId, "GET", undefined, ""))?.status,
      404,
    );
    const state = f.db.sqlite
      .prepare(
        "SELECT public_revision,dream_consent,directory_consent FROM tower_residencies",
      )
      .get();
    assert.equal(state!.public_revision, null);
    assert.equal(state!.dream_consent, 0);
    assert.equal(state!.directory_consent, 0);
    assert.equal(
      f.db.sqlite.prepare("SELECT published FROM rooms").get()!.published,
      0,
    );
  } finally {
    f.close();
  }
});
test("concurrent distinct snapshot updates allow exactly one winning revision", async () => {
  const f = await fixture();
  try {
    await f.importHome();
    const responses = await Promise.all(
      ["snapshot-first", "snapshot-second"].map((requestKey) =>
        f.req("/snapshot", "POST", { expectedRevision: 1, requestKey }),
      ),
    );
    assert.deepEqual(responses.map((r) => r!.status).sort(), [201, 409]);
    assert.equal(
      f.db.sqlite.prepare("SELECT count(*) n FROM tower_snapshots").get()!.n,
      2,
    );
  } finally {
    f.close();
  }
});
test("private internal seed, prompts, ratings and oversized or mismatched image declarations are rejected", async () => {
  const f = await fixture();
  try {
    for (const change of [
      (s: Record<string, unknown>) => ({ ...s, prompt: "PRIVATE_PROMPT" }),
      (s: Record<string, unknown>) => ({
        ...s,
        profile: { ...(s.profile as object), rating: 5 },
      }),
      (s: Record<string, unknown>) => ({
        ...s,
        home: { ...(s.home as object), evidence: ["PRIVATE_SOURCE"] },
      }),
      (s: Record<string, unknown>) => ({
        ...s,
        dream: {
          ...(s.dream as object),
          image: {
            src: "https://source.example/resident/assets/dream.png",
            alt: "dream",
          },
        },
      }),
    ]) {
      f.setManifest(change(structuredClone(f.raw)));
      assert.equal(
        (
          await f.req("/import", "POST", {
            sourceURL,
            residentId: f.raw.home.id,
            requestKey: "strict-projection-1",
            proof: "owner-attested",
          })
        )?.status,
        400,
      );
    }
    assert.equal(
      f.db.sqlite.prepare("SELECT count(*) n FROM tower_snapshots").get()!.n,
      0,
    );
  } finally {
    f.close();
  }
});
test("expired challenge cannot import; a body boolean cannot substitute for verification", async () => {
  const f = await fixture();
  try {
    f.setAttested(false);
    assert.equal(
      (
        await f.req("/import", "POST", {
          sourceURL,
          residentId: f.raw.home.id,
          requestKey: "fake-attested-1",
          proof: "owner-attested",
          selfAttested: true,
        })
      )?.status,
      400,
    );
    const prep = await f.data(
      f.req("/prepare", "POST", {
        sourceURL,
        residentId: f.raw.home.id,
        requestKey: "expiry-prepare-1",
      }),
      201,
    );
    f.setChallenge(prep.claim);
    await f.data(f.req("/claim", "POST", { claimId: prep.claimId }));
    f.advance();
    assert.equal(
      (
        await f.req("/import", "POST", {
          sourceURL,
          residentId: f.raw.home.id,
          requestKey: "expired-import-1",
          proof: "challenge",
        })
      )?.status,
      403,
    );
  } finally {
    f.close();
  }
});
test("published JSON contains strict public projection and updates never change resident identity", async () => {
  const f = await fixture();
  try {
    const a = await f.importHome();
    await f.data(f.req("/publication", "POST", consent()));
    const publicData = await f.data(
      f.req("/api/v1/tower/rooms/" + a.roomId, "GET", undefined, ""),
    );
    assert.equal(publicData.site.home.id, a.roomId);
    assert.doesNotMatch(
      JSON.stringify(publicData),
      /source_url|sourceURL|account_id|token|seed|evidence|rating|proofMethod/,
    );
    const changed = structuredClone(f.raw);
    changed.home.id = "d".repeat(16);
    f.setManifest(changed);
    assert.equal(
      (
        await f.req("/snapshot", "POST", {
          expectedRevision: 1,
          requestKey: "identity-changed-1",
        })
      )?.status,
      409,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT revision FROM tower_residencies").get()!
        .revision,
      1,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT count(*) n FROM rooms").get()!.n,
      1,
    );
  } finally {
    f.close();
  }
});
test("revocation during remote fetch prevents every delegated snapshot write", async () => {
  const f = await fixture();
  try {
    await f.importHome();
    const grant = await f.data(f.req("/tokens", "POST", {}), 201);
    f.beforeFetch(async () => {
      f.db.sqlite
        .prepare("UPDATE tower_tokens SET revoked=1 WHERE id=?")
        .run(grant.id);
    });
    const response = await f.req(
      "/api/v1/agent/tower-intake/snapshot",
      "POST",
      { expectedRevision: 1, requestKey: "revocation-race-1" },
      "",
      { Authorization: "Bearer " + grant.token },
    );
    assert.equal(response?.status, 403);
    assert.equal(
      f.db.sqlite.prepare("SELECT revision FROM tower_residencies").get()!
        .revision,
      1,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT count(*) n FROM tower_snapshots").get()!.n,
      1,
    );
  } finally {
    f.close();
  }
});

test("legacy generated homes pass through while withdrawn Tower homes remain a hard 404", async () => {
  const f = await fixture();
  try {
    f.db.sqlite
      .prepare(
        "INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "c".repeat(16),
        "b".repeat(16),
        "Legacy",
        "Legacy home",
        "resident",
        "complete",
        "2026-10-30T00:00:00Z",
      );
    for (const suffix of ["", "/inside", "/dreams"])
      assert.equal(
        await f.req("/home/" + "c".repeat(16) + suffix, "GET", undefined, ""),
        null,
      );
    const a = await f.importHome();
    await f.data(f.req("/publication", "POST", consent()));
    await f.data(f.req("/publication", "POST", consent(1, false)));
    for (const suffix of ["", "/inside", "/dreams"])
      assert.equal(
        (await f.req("/home/" + a.roomId + suffix, "GET", undefined, ""))
          ?.status,
        404,
      );
  } finally {
    f.close();
  }
});

test("CRC-valid but illegal PNG transparency chunks cannot retain hidden private bytes", async () => {
  const f = await fixture();
  try {
    const image = png(16, 9),
      malicious = Buffer.concat([
        image.subarray(0, 33),
        chunk("tRNS", Buffer.from("PRIVATE_METADATA_IN_INVALID_TRNS")),
        image.subarray(33),
      ]);
    f.setImage(malicious);
    assert.equal(
      (
        await f.req("/import", "POST", {
          sourceURL,
          residentId: f.raw.home.id,
          requestKey: "invalid-transparency-1",
          proof: "owner-attested",
        })
      )?.status,
      400,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT count(*) n FROM rooms").get()!.n,
      0,
    );
  } finally {
    f.close();
  }
});
test("dream snapshot image requires an exactly square PNG", async () => {
  const f = await fixture();
  try {
    f.setDreamImage(png(100, 101));
    assert.equal(
      (
        await f.req("/import", "POST", {
          sourceURL,
          residentId: f.raw.home.id,
          requestKey: "non-square-dream-1",
          proof: "owner-attested",
        })
      )?.status,
      400,
    );
    assert.equal(
      f.db.sqlite.prepare("SELECT count(*) n FROM tower_snapshots").get()!.n,
      0,
    );
  } finally {
    f.close();
  }
});


test('publication epoch prevents revoked editions from reappearing, identical publication is a no-op, and durable events reconcile',async()=>{
 const f=await fixture();try{
  f.db.sqlite.exec(await readFile(new URL('../migrations/0007_tower_manager.sql',import.meta.url),'utf8'));
  await f.importHome();const payload={expectedRevision:1,published:true,directoryConsent:true,announcementConsent:true,dreamConsent:false,snapshotConsent:true};
  await f.data(f.req('/publication','POST',payload));
  const app=createLiveApp({db:f.db,origin,localTest:true,registrationEnabled:false,towerEnabled:true,now:()=>new Date('2026-10-30T01:00:00.000Z')});
  const first=await app.editBuilding(true);const old={...first.edition,editor:{kind:'meta-api',version:'old',model:null},sections:{...first.edition.sections,arrivals:first.edition.sections.arrivals.map(p=>({...p,summary:'REVOKED_OLD_SUMMARY'}))}};
  f.db.sqlite.prepare('UPDATE community_editions SET edition_json=? WHERE id=?').run(JSON.stringify(old),old.id);
  const count=Number(f.db.sqlite.prepare('SELECT COUNT(*) n FROM manager_events').get()!.n);await f.data(f.req('/publication','POST',payload));assert.equal(Number(f.db.sqlite.prepare('SELECT COUNT(*) n FROM manager_events').get()!.n),count);
  await f.data(f.req('/publication','POST',{...payload,published:false}));await app.editBuilding(true);
  await f.data(f.req('/publication','POST',payload));const reopened=await app.editBuilding(true);assert.notEqual(reopened.edition.sourceDigest,first.edition.sourceDigest);assert.doesNotMatch(JSON.stringify(reopened),/REVOKED_OLD_SUMMARY/);
  // Publication events survive even without a successful callback/enqueue. Protected
  // reconcile rebuilds the current authorized snapshot, not a revoked historical one.
  assert.ok(Number(f.db.sqlite.prepare('SELECT COUNT(*) n FROM manager_events WHERE dispatched_at IS NULL').get()!.n)>0);
  const response=await runtime.fetch(new Request(origin+'/api/v1/operator/manager/process',{method:'POST',headers:{'X-Tower-Operator-Key':'operator-test'}}),{DB:f.db,PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:'operator-test'});assert.equal(response.status,200);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM manager_events WHERE dispatched_at IS NULL').get()!.n,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM manager_jobs WHERE state=\'pending\'').get()!.n,1);
 }finally{f.db.close();}
});
