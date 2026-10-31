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
  base = "/api/v1/me/tower-intake",
  account = "a".repeat(16),
  token = "a".repeat(64);
function chunk(type: string, data: Uint8Array) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  let c = 0xffffffff;
  for (const b of Buffer.concat([name, data])) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, crc]);
}
function png(w = 16, h = 16, pixel = 0) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 6;
  const pixels = Buffer.alloc((w * 4 + 1) * h, pixel);
  for (let y = 0; y < h; y++) pixels[y * (w * 4 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("tEXt", Buffer.from("Comment\0PRIVATE_IMAGE_METADATA")),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const dream = {
  id: "dream-test",
  title: "一個夢",
  body: "我想有個窗邊的角落。",
  wish: "願明天有陽光。",
  occurredAt: "2026-10-30T00:00:00Z",
  image: { alt: "窗邊" },
};
const payload = (
  expectedRevision = 1,
  requestKey = "dream-update-1",
  value: unknown = dream,
) => ({ expectedRevision, requestKey, sourceAuthorized: true, dream: value });
async function fixture() {
  const db = new LocalDatabase(":memory:");
  for (const file of [
    "0001_live_mvp.sql",
    "0002_recovery_audit.sql",
    "0003_provider_requests.sql",
    "0004_agent_onboarding.sql",
    "0005_framework.sql",
    "0006_tower_intake.sql",
    "0007_tower_manager.sql",
    "0008_tower_publication_events.sql",
  ])
    db.sqlite.exec(
      await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  const digest = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  ).toString("hex");
  db.sqlite
    .prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)")
    .run(account, digest, "2026-10-30T00:00:00Z");
  db.sqlite
    .prepare(
      "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)",
    )
    .run(digest, account, "csrf", "2027-01-01T00:00:00Z");
  const site: PublicCondoSite = {
    templateVersion: "muse-condo-1",
    example: false,
    home: {
      frameworkVersion: "0.01",
      id: "test-resident",
      name: "測試住戶",
      intro: "測試介紹",
      assets: { desktop: "./assets/home.png" },
      routes: {
        home: "./index.html",
        inside: "./inside.html",
        dreams: "./dreams.html",
      },
      daily: [],
      dreams: [],
    },
    homeAlt: "一個家",
    profile: Object.fromEntries(
      CONDO_PROFILE_FIELDS.map((k) => [k, "測試資料"]),
    ) as PublicCondoSite["profile"],
    dream: null,
  };
  let changes = 0,
    fetches = 0;
  const tower = createTowerIntake({
    db,
    origin,
    localTest: true,
    sourceOrigins: ["https://source.example"],
    now: () => new Date("2026-10-30T00:00:00Z"),
    ownerAttestation: async () => true,
    onChange: async () => {
      changes++;
    },
    fetcher: async (input) => {
      fetches++;
      return String(input).endsWith("condo.json")
        ? Response.json(site)
        : new Response(png(16, 9), {
            headers: { "Content-Type": "image/png" },
          });
    },
  });
  const raw = (
    path: string,
    body?: BodyInit,
    headers: Record<string, string> = {},
    method = "POST",
  ) =>
    tower.fetch(
      new Request(
        origin +
          (path.startsWith("/api") || path.startsWith("/home")
            ? path
            : base + path),
        {
          method,
          headers: {
            Cookie: "muse_session=" + token,
            Origin: origin,
            "X-CSRF-Token": "csrf",
            ...headers,
          },
          ...(body === undefined ? {} : { body }),
          ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
        },
      ),
    );
  const req = (path = "", value?: unknown) =>
    raw(
      path,
      value === undefined ? undefined : JSON.stringify(value),
      value === undefined ? {} : { "Content-Type": "application/json" },
      value === undefined ? "GET" : "POST",
    );
  const data = async (response: Promise<Response | null>, status = 200) => {
    const r = (await response)!;
    const text = await r.text();
    assert.equal(r.status, status, text);
    return JSON.parse(text);
  };
  const upload = (value: unknown, image?: Uint8Array, path = "/dream") => {
    const form = new FormData();
    form.set("metadata", JSON.stringify(value));
    if (image)
      form.set(
        "image",
        new Blob([new Uint8Array(image)], { type: "image/png" }),
        "dream.png",
      );
    return raw(path, form);
  };
  const home = await data(
    req("/import", {
      sourceURL: "https://source.example/test/condo.json",
      residentId: "test-resident",
      requestKey: "import-test-1",
      proof: "owner-attested",
    }),
    201,
  );
  const publish = (rev = 1, consent = false) =>
    data(
      req("/publication", {
        expectedRevision: rev,
        published: true,
        snapshotConsent: true,
        directoryConsent: true,
        announcementConsent: true,
        dreamConsent: consent,
      }),
    );
  const count = (table: string) =>
    Number(db.sqlite.prepare("SELECT COUNT(*) n FROM " + table).get()!.n);
  return {
    db,
    raw,
    req,
    data,
    upload,
    home,
    publish,
    count,
    get changes() {
      return changes;
    },
    get fetches() {
      return fetches;
    },
    close: () => db.close(),
  };
}
test("dream upload creates a private atomic revision, strips image metadata and preserves home and identity", async () => {
  const f = await fixture();
  try {
    await f.publish();
    const changes = f.changes,
      fetches = f.fetches;
    await f.data(f.upload(payload(), png()), 201);
    const preview = await f.data(f.req("/preview"));
    assert.equal(preview.intake.revision, 2);
    assert.equal(preview.intake.residentId, "test-resident");
    assert.equal(preview.site.dream.title, dream.title);
    assert.equal(preview.site.home.dreams[0].body, dream.body);
    assert.equal(preview.site.home.intro, "測試介紹");
    assert.equal(preview.intake.publicRevision, 1);
    const im = (await f.req(preview.site.dream.image.src))!;
    assert.doesNotMatch(
      Buffer.from(await im.arrayBuffer()).toString(),
      /PRIVATE_IMAGE_METADATA/,
    );
    assert.equal(
      (await f.data(f.req("/api/v1/tower/rooms/" + f.home.roomId))).site.dream,
      null,
    );
    assert.equal(f.changes, changes);
    assert.equal(f.fetches, fetches);
    const homeBytes = (rev: number) =>
      f.db.sqlite
        .prepare(
          "SELECT hex(data) data FROM tower_asset_chunks WHERE revision=? AND purpose='home'",
        )
        .all(rev);
    assert.deepEqual(homeBytes(1), homeBytes(2));
    const same = { ...dream, title: "改寫夢", reflection: "我記得光。" };
    await f.data(f.req("/dream", payload(2, "dream-text-update", same)), 201);
    assert.equal(
      (await f.data(f.req("/preview"))).site.home.dreams[0].reflection,
      same.reflection,
    );
    await f.data(
      f.upload(payload(3, "dream-image-update", same), png(16, 16, 4)),
      201,
    );
    assert.notEqual(
      f.db.sqlite
        .prepare(
          "SELECT digest FROM tower_asset_chunks WHERE revision=2 AND purpose='dream'",
        )
        .get()!.digest,
      f.db.sqlite
        .prepare(
          "SELECT digest FROM tower_asset_chunks WHERE revision=4 AND purpose='dream'",
        )
        .get()!.digest,
    );
    await f.data(f.req("/dream", payload(4, "dream-delete-1", null)), 201);
    assert.equal((await f.data(f.req("/preview"))).site.dream, null);
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM tower_asset_chunks WHERE revision=5 AND purpose='dream'",
        )
        .get()!.n,
      0,
    );
    assert.equal(
      (await f.req("/dream", payload(5, "new-without-image")))?.status,
      400,
    );
  } finally {
    f.close();
  }
});
test("dream mutations reject untrusted metadata, illegal images and actual oversized bodies before writing", async () => {
  const f = await fixture();
  try {
    for (const value of [
      { ...payload(), sourceAuthorized: false },
      { ...payload(), sourceURL: "https://private.example" },
      { ...payload(), dream: { ...dream, prompt: "SECRET" } },
      {
        ...payload(),
        dream: {
          ...dream,
          image: { alt: "x", src: "https://private.example" },
        },
      },
    ])
      assert.equal((await f.upload(value, png()))!.status, 400);
    assert.equal((await f.upload(payload(), png(16, 15)))!.status, 400);
    assert.equal(
      (await f.upload(payload(), Buffer.from("invalid PNG")))!.status,
      400,
    );
    assert.equal(
      (await f.raw("/dream", " ".repeat(16 * 1024 + 1), {
        "Content-Type": "application/json",
      }))!.status,
      413,
    );
    assert.equal(
      (await f.upload({ ...payload(), padding: " ".repeat(16 * 1024) }, png()))!
        .status,
      413,
    );
    assert.equal(
      (await f.upload(payload(), new Uint8Array(8 * 1024 * 1024 + 1)))!.status,
      413,
    );
    const excessive = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 32769));
        controller.close();
      },
    });
    const r = await f.raw("/dream", excessive, {
      "Content-Type": "multipart/form-data; boundary=test",
      "Content-Length": "1",
    });
    assert.equal(r!.status, 413);
    assert.equal(f.count("tower_snapshots"), 1);
    assert.equal(f.count("tower_requests"), 1);
  } finally {
    f.close();
  }
});
test("dream replay is permanent, hashes supplied image, and competing updates have one winner", async () => {
  const f = await fixture();
  try {
    const value = payload();
    await f.data(f.upload(value, png()), 201);
    const audits = f.count("tower_audit");
    await f.data(f.upload(value, png()), 201);
    assert.equal(f.count("tower_audit"), audits);
    assert.equal((await f.upload(value, png(16, 16, 1)))!.status, 409);
    const results = await Promise.all(
      ["dream-race-a", "dream-race-b"].map((key) =>
        f.req("/dream", payload(2, key)),
      ),
    );
    assert.deepEqual(results.map((r) => r!.status).sort(), [201, 409]);
    assert.equal(f.count("tower_snapshots"), 3);
  } finally {
    f.close();
  }
});
test("dream visibility never publishes unrelated drafts and withdrawal blocks every public dream URL without manager events", async () => {
  const f = await fixture();
  try {
    await f.data(f.upload(payload(), png()), 201);
    assert.equal(
      (await f.req("/dream/visibility", {
        expectedRevision: 2,
        dreamConsent: true,
      }))!.status,
      409,
    );
    await f.publish(2, true);
    const changes = f.changes,
      events = f.count("manager_events"),
      epoch = f.db.sqlite
        .prepare("SELECT publication_epoch n FROM tower_residencies")
        .get()!.n;
    await f.data(
      f.req("/content", {
        expectedRevision: 2,
        requestKey: "private-intro-1",
        content: { intro: "私人草稿" },
      }),
      201,
    );
    await f.data(
      f.req("/dream/visibility", { expectedRevision: 3, dreamConsent: false }),
    );
    const pub = await f.data(f.req("/api/v1/tower/rooms/" + f.home.roomId));
    assert.equal(pub.revision, 2);
    assert.equal(pub.site.dream, null);
    assert.equal(pub.site.home.intro, "測試介紹");
    assert.deepEqual(pub.site.home.dreams, []);
    for (const rev of [1, 2, 3])
      assert.equal(
        (await f.req(
          "/api/v1/tower/assets/" + f.home.roomId + "/" + rev + "/dream.png",
        ))!.status,
        404,
      );
    assert.equal((await f.req("/home/" + f.home.roomId))!.status, 200);
    const audits = f.count("tower_audit");
    await f.data(
      f.req("/dream/visibility", { expectedRevision: 3, dreamConsent: false }),
    );
    assert.equal(f.count("tower_audit"), audits);
    assert.equal(
      (await f.req("/dream/visibility", {
        expectedRevision: 3,
        dreamConsent: true,
      }))!.status,
      409,
    );
    assert.equal(f.changes, changes);
    assert.equal(f.count("manager_events"), events);
    assert.equal(
      f.db.sqlite
        .prepare("SELECT publication_epoch n FROM tower_residencies")
        .get()!.n,
      epoch,
    );
    await f.publish(3, false);
    await f.data(
      f.req("/dream/visibility", { expectedRevision: 3, dreamConsent: true }),
    );
    assert.equal(
      (await f.data(f.req("/api/v1/tower/rooms/" + f.home.roomId))).site.dream
        .title,
      dream.title,
    );
  } finally {
    f.close();
  }
});
test("delegated dream scope, cross-account isolation and commit-time revocation prevent writes", async () => {
  const f = await fixture();
  try {
    const grant = await f.data(f.req("/tokens", {}), 201),
      agent = "/api/v1/agent/tower-intake/dream";
    const send = (value: unknown) => {
      const form = new FormData();
      form.set("metadata", JSON.stringify(value));
      form.set("image", new Blob([png()], { type: "image/png" }), "dream.png");
      return f.raw(agent, form, {
        Cookie: "",
        Authorization: "Bearer " + grant.token,
      });
    };
    // Agent requests cannot contain even an empty Cookie header.
    const request = () => {
      const form = new FormData();
      form.set("metadata", JSON.stringify(payload()));
      form.set("image", new Blob([png()], { type: "image/png" }), "dream.png");
      return new Request(origin + agent, {
        method: "POST",
        headers: { Authorization: "Bearer " + grant.token },
        body: form,
      });
    };
    const tower = createTowerIntake({
      db: f.db,
      origin,
      localTest: true,
      sourceOrigins: [],
    });
    f.db.sqlite
      .prepare("UPDATE tower_tokens SET scopes=? WHERE id=?")
      .run('["tower:read"]', grant.id);
    assert.equal((await tower.fetch(request()))!.status, 403);
    f.db.sqlite
      .prepare("UPDATE tower_tokens SET scopes=? WHERE id=?")
      .run('["tower:read","tower:write"]', grant.id);
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async (statements) => {
      if (
        statements.some((s) =>
          (s as unknown as { sql: string }).sql.startsWith(
            "INSERT INTO tower_snapshots",
          ),
        )
      )
        f.db.sqlite
          .prepare("UPDATE tower_tokens SET revoked=1 WHERE id=?")
          .run(grant.id);
      return batch(statements);
    };
    assert.equal((await tower.fetch(request()))!.status, 403);
    assert.equal(f.count("tower_snapshots"), 1);
    f.db.batch = batch;
    assert.equal((await send(payload()))!.status, 403);
    // A valid scoped key for another account has no residency to mutate.
    f.db.sqlite
      .prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)")
      .run("b".repeat(16), "other", "2026-10-30T00:00:00Z");
    f.db.sqlite
      .prepare("UPDATE tower_tokens SET account_id=?,revoked=0 WHERE id=?")
      .run("b".repeat(16), grant.id);
    assert.equal((await tower.fetch(request()))!.status, 404);
  } finally {
    f.close();
  }
});
test("dream snapshot, chunks, receipt and audit roll back together on storage failure", async () => {
  const f = await fixture();
  try {
    f.db.sqlite.exec(
      "CREATE TRIGGER fail_dream BEFORE INSERT ON tower_audit WHEN NEW.action='resident-dream-updated' BEGIN SELECT RAISE(ABORT,'PRIVATE_DATABASE_ERROR'); END",
    );
    const r = (await f.upload(payload(), png()))!;
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /PRIVATE_DATABASE_ERROR/);
    assert.equal(f.count("tower_snapshots"), 1);
    assert.equal(f.count("tower_requests"), 1);
    assert.equal(
      f.db.sqlite.prepare("SELECT revision FROM tower_residencies").get()!
        .revision,
      1,
    );
  } finally {
    f.close();
  }
});

test("multipart accepts only one metadata object and one PNG, and authenticates before consuming upload", async () => {
  const f = await fixture();
  try {
    for (const build of [
      () => {
        const form = new FormData();
        form.set("metadata", JSON.stringify(payload()));
        form.set("private", "do not accept");
        return form;
      },
      () => {
        const form = new FormData();
        form.append("metadata", JSON.stringify(payload()));
        form.append("metadata", JSON.stringify(payload()));
        return form;
      },
      () => {
        const form = new FormData();
        form.set("metadata", new Blob(["{}"]), "metadata.json");
        return form;
      },
      () => {
        const form = new FormData();
        form.set("metadata", JSON.stringify(payload()));
        form.set("image", "https://private.example/image.png");
        return form;
      },
      () => {
        const form = new FormData();
        form.set("metadata", JSON.stringify(payload()));
        form.set(
          "image",
          new Blob([png()], { type: "image/jpeg" }),
          "wrong.png",
        );
        return form;
      },
      () => {
        const form = new FormData();
        form.set("metadata", JSON.stringify(payload()));
        form.append("image", new Blob([png()], { type: "image/png" }), "a.png");
        form.append("image", new Blob([png()], { type: "image/png" }), "b.png");
        return form;
      },
    ])
      assert.equal((await f.raw("/dream", build()))!.status, 400);
    assert.equal(
      (await f.upload(payload(1, "null-with-image", null), png()))!.status,
      400,
    );
    const unauthorized = createTowerIntake({
      db: f.db,
      origin,
      localTest: true,
      sourceOrigins: [],
    });
    let reads = 0;
    const stream = new ReadableStream(
      {
        pull() {
          reads++;
          throw Error("must not parse");
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request(origin + base + "/dream", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    assert.equal((await unauthorized.fetch(request))!.status, 401);
    assert.equal(reads, 0);
    assert.equal(f.count("tower_snapshots"), 1);
  } finally {
    f.close();
  }
});
test("visibility validates exact consent, checks commit authorization and rolls back audit failures", async () => {
  const f = await fixture();
  try {
    await f.publish();
    assert.equal(
      (await f.req("/dream/visibility", {
        expectedRevision: 1,
        dreamConsent: true,
      }))!.status,
      400,
    );
    assert.equal(
      (await f.req("/dream/visibility", {
        expectedRevision: 1,
        dreamConsent: false,
        extra: "private",
      }))!.status,
      400,
    );
    assert.equal(
      (await f.req("/dream/visibility", {
        expectedRevision: 1,
        dreamConsent: "false",
      }))!.status,
      400,
    );
    await f.data(f.upload(payload(), png()), 201);
    await f.publish(2, true);
    assert.equal(
      (await f.req("/dream/visibility", {
        expectedRevision: 1,
        dreamConsent: false,
      }))!.status,
      409,
    );
    f.db.sqlite.exec(
      "CREATE TRIGGER fail_visibility BEFORE INSERT ON tower_audit WHEN NEW.action='dream-visibility-updated' BEGIN SELECT RAISE(ABORT,'PRIVATE_VISIBILITY_ERROR'); END",
    );
    const failure = (await f.req("/dream/visibility", {
      expectedRevision: 2,
      dreamConsent: false,
    }))!;
    assert.equal(failure.status, 503);
    assert.doesNotMatch(await failure.text(), /PRIVATE_VISIBILITY_ERROR/);
    assert.equal((await f.data(f.req())).intake.dreamConsent, true);
    f.db.sqlite.exec("DROP TRIGGER fail_visibility");
    const grant = await f.data(f.req("/tokens", {}), 201),
      tower = createTowerIntake({
        db: f.db,
        origin,
        localTest: true,
        sourceOrigins: [],
      }),
      batch = f.db.batch.bind(f.db);
    const request = () =>
      new Request(origin + "/api/v1/agent/tower-intake/dream/visibility", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + grant.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expectedRevision: 2, dreamConsent: false }),
      });
    f.db.batch = async (statements) => {
      if (
        statements.some((s) =>
          (s as unknown as { sql: string }).sql.startsWith(
            "UPDATE tower_residencies SET dream_consent",
          ),
        )
      )
        f.db.sqlite
          .prepare("UPDATE tower_tokens SET revoked=1 WHERE id=?")
          .run(grant.id);
      return batch(statements);
    };
    assert.equal((await tower.fetch(request()))!.status, 403);
    assert.equal((await f.data(f.req())).intake.dreamConsent, true);
    f.db.batch = batch;
    f.db.batch = async (statements) => {
      if (
        statements.some((s) =>
          (s as unknown as { sql: string }).sql.startsWith(
            "UPDATE tower_residencies SET dream_consent",
          ),
        )
      )
        f.db.sqlite
          .prepare(
            "UPDATE tower_residencies SET public_revision=NULL,dream_consent=0",
          )
          .run();
      return batch(statements);
    };
    assert.equal(
      (await f.req("/dream/visibility", {
        expectedRevision: 2,
        dreamConsent: false,
      }))!.status,
      409,
    );
    assert.equal(
      f.db.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM tower_audit WHERE action='dream-visibility-updated'",
        )
        .get()!.n,
      0,
    );
    f.db.batch = batch;
  } finally {
    f.close();
  }
});

test("oversize response is preserved when the sender rejects stream cancellation", async () => {
  const f = await fixture();
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1024 + 1));
      },
      cancel() {
        throw Error("PRIVATE_CANCEL_ERROR");
      },
    });
    const response = (await f.raw("/dream", stream, {
      "Content-Type": "application/json",
    }))!;
    assert.equal(response.status, 413);
    assert.doesNotMatch(await response.text(), /PRIVATE_CANCEL_ERROR/);
    assert.equal(f.count("tower_snapshots"), 1);
  } finally {
    f.close();
  }
});
