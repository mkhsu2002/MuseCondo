/* global Response, TextEncoder, Blob, AbortController */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { runInNewContext } from "node:vm";
const origin = "https://identity.example",
  code = "c".repeat(64),
  invite = "a".repeat(32),
  agent = "mcid:" + "a".repeat(64);
const time = "2026-10-31T00:00:00.000Z";
const options = {
  challengeId: "d".repeat(32),
  agentId: agent,
  expiresAt: "2026-10-31T00:05:00.000Z",
  options: {
    challenge: "AQIDBA",
    rp: { id: "identity.example", name: "MuseCondo" },
    user: { id: "BQYHCA", name: "guardian-a", displayName: "Test 的監護人" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    excludeCredentials: [{ id: "CQoL", type: "public-key" }],
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    attestation: "none",
  },
};
const completed = {
  agentId: agent,
  state: "active",
  recoveryConfigured: true,
  issuanceReady: false,
};
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });
class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.events = {};
    this.value = "";
    this.type = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.children = [];
    this.attributes = {};
  }
  addEventListener(type, fn) {
    this.events[type] = fn;
  }
  async fire(type, force = false) {
    if (this.disabled && !force) return;
    await this.events[type]?.({ preventDefault() {} });
  }
  append(...children) {
    this.children.push(...children);
  }
  remove() {
    this.removed = true;
  }
  focus() {
    this.focused = true;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}
async function harness({
  nativeJSON = false,
  supported = true,
  createError = null,
  downloadError = false,
  fetcher,
} = {}) {
  assert(
    existsSync(new URL("../public/identity.js", import.meta.url)),
    "identity UI is implemented",
  );
  const html = readFileSync(
      new URL("../public/identity.html", import.meta.url),
      "utf8",
    ),
    elements = Object.fromEntries(
      [...html.matchAll(/id="([^"]+)"/g)].map((m) => [m[1], new Element()]),
    );
  for (const m of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)) {
    const e = elements[m[1]];
    e.hidden = /\bhidden\b/.test(m[0]);
    e.disabled = /\bdisabled\b/.test(m[0]);
    e.type = m[0].match(/type="([^"]+)"/)?.[1] ?? "";
  }
  const calls = [],
    creates = [],
    downloads = [],
    urls = [],
    revoked = [],
    domWrites = [],
    timers = new Map();
  let timerId = 0;
  let now = time,
    sequence = 0,
    randomCalls = 0;
  const rawId = new Uint8Array([1, 2, 3, 4]).buffer;
  const credential = {
    id: "AQIDBA",
    rawId,
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: new TextEncoder().encode('{"type":"webauthn.create"}')
        .buffer,
      attestationObject: new Uint8Array([0xa0]).buffer,
      getTransports: () => ["internal"],
      getPublicKey: () => {
        throw new Error("not part of the response contract");
      },
    },
    getClientExtensionResults: () => ({
      credProps: { rk: true },
      secretExtra: "never-project",
    }),
    toJSON() {
      throw new Error("native toJSON must not be forwarded");
    },
  };
  const body = new Element("body");
  const makeNode = (tag) => {
    const el = new Element(tag);
    if (tag === "a")
      el.click = () => {
        if (downloadError) throw new Error("private download failure");
        downloads.push({ href: el.href, name: el.download });
      };
    return el;
  };
  const ClockDate = class extends Date {
    constructor(value) {
      super(value === undefined ? now : value);
    }
    static now() {
      return new Date(now).getTime();
    }
  };
  const nativeClass = class {};
  if (nativeJSON)
    nativeClass.parseCreationOptionsFromJSON = (v) => ({
      nativeParsed: true,
      ...v,
    });
  const crypto = {
    randomUUID: () => `synthetic-key-${++sequence}`,
    getRandomValues(bytes) {
      randomCalls++;
      bytes.fill(randomCalls === 1 ? 0xcc : 0xee);
      return bytes;
    },
  };
  const sandbox = {
    document: {
      querySelector: (selector) => elements[selector.replace(/^#/, "")],
      createElement: makeNode,
      body,
    },
    navigator: {
      credentials: supported
        ? {
            async create(value) {
              creates.push(value);
              if (createError) throw createError;
              return credential;
            },
          }
        : undefined,
    },
    PublicKeyCredential: supported ? nativeClass : undefined,
    isSecureContext: true,
    location: { origin, protocol: "https:" },
    crypto,
    Date: ClockDate,
    Uint8Array,
    ArrayBuffer,
    TextEncoder,
    Blob,
    URL: {
      createObjectURL(blob) {
        const url = "blob:private-" + urls.length;
        urls.push({ url, blob });
        return url;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
    atob: (v) => Buffer.from(v, "base64").toString("binary"),
    btoa: (v) => Buffer.from(v, "binary").toString("base64"),
    fetch: async (path, init) => {
      const call = { path, init, body: JSON.parse(init.body) };
      calls.push(call);
      return fetcher
        ? fetcher(call, calls.length)
        : response(path.endsWith("/options") ? options : completed);
    },
    console: {
      log() {
        throw new Error("no logs");
      },
      error() {
        throw new Error("no logs");
      },
    },
    AbortController,
    setTimeout(fn) {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  Object.defineProperty(sandbox, "localStorage", {
    get() {
      throw new Error("no persistent secret storage");
    },
  });
  Object.defineProperty(sandbox, "sessionStorage", {
    get() {
      throw new Error("no persistent secret storage");
    },
  });
  for (const [id, e] of Object.entries(elements)) {
    let text = "";
    Object.defineProperty(e, "textContent", {
      get() {
        return text;
      },
      set(v) {
        text = String(v);
        domWrites.push({ id, text });
      },
    });
  }
  runInNewContext(
    readFileSync(new URL("../public/identity.js", import.meta.url), "utf8"),
    sandbox,
  );
  elements["invitation-id"].value = invite;
  elements["confirmation-code"].value = code;
  const start = () => elements["identity-form"].fire("submit"),
    create = () => elements["create-passkey"].fire("click"),
    download = () => elements["download-recovery"].fire("click"),
    confirm = async () => {
      elements["backup-confirmed"].checked = true;
      await elements["backup-confirmed"].fire("change");
    },
    finish = () => elements["complete-registration"].fire("click");
  return {
    elements,
    calls,
    creates,
    downloads,
    urls,
    revoked,
    domWrites,
    body,
    start,
    create,
    download,
    confirm,
    finish,
    setTime: (v) => {
      now = v;
    },
    randomCalls: () => randomCalls,
    expireRequests: () => {
      for (const fn of [...timers.values()]) fn();
    },
  };
}

test("guardian UI requires explicit Passkey creation, private download and backup confirmation before one completion", async () => {
  const h = await harness();
  assert.equal(h.calls.length, 0);
  await h.start();
  assert.equal(h.creates.length, 0);
  assert.equal(h.calls.length, 1);
  assert.match(h.elements["agent-id"].textContent, new RegExp(agent));
  assert.match(h.elements["challenge-expiry"].textContent, /2026/);
  await h.create();
  assert.equal(h.creates.length, 1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.elements["complete-registration"].disabled, true);
  await h.finish();
  assert.equal(h.calls.length, 1);
  h.elements["backup-confirmed"].checked = true;
  await h.elements["complete-registration"].fire("click", true);
  assert.equal(h.calls.length, 1);
  h.elements["backup-confirmed"].checked = false;
  await h.download();
  assert.equal(h.downloads.length, 1);
  assert.equal(h.elements["complete-registration"].disabled, true);
  await h.confirm();
  await h.finish();
  assert.equal(h.calls.length, 2);
  const sent = h.calls[1];
  assert.deepEqual(
    Object.keys(sent.body).sort(),
    [
      "requestKey",
      "invitationId",
      "confirmationCode",
      "challengeId",
      "response",
      "offlineRecoveryCode",
      "backupConfirmed",
    ].sort(),
  );
  assert.equal(sent.body.backupConfirmed, true);
  assert.equal(sent.body.offlineRecoveryCode, "e".repeat(64));
  assert.notEqual(sent.body.offlineRecoveryCode, code);
  assert.equal(h.randomCalls(), 2);
  for (const c of h.calls) {
    assert.equal(c.init.credentials, "omit");
    assert.equal(c.init.cache, "no-store");
    assert.equal(c.init.redirect, "error");
    assert.equal(c.path.includes(code), false);
  }
  assert.match(h.elements["identity-status"].textContent, /設定完成/);
  assert.equal(h.elements["confirmation-code"].value, "");
  assert.equal(h.elements["invitation-id"].value, "");
  assert.equal(h.elements["download-recovery"].disabled, true);
  assert.equal(h.elements["backup-confirmed"].checked, false);
  assert.equal(h.elements["agent-id"].textContent, agent);
  assert.equal(h.elements["identity-form"].hidden, true);
  assert.equal(h.elements["passkey-section"]?.hidden, true);
  const file = await h.urls[0].blob.text();
  assert(file.includes(origin));
  assert(file.includes(agent));
  assert(file.includes("e".repeat(64)));
  assert(!file.includes(code));
  assert.match(h.downloads[0].name, /private.*\.txt$/);
  assert.deepEqual(h.revoked, [h.urls[0].url]);
  assert(h.domWrites.every((x) => !x.text.includes("e".repeat(64))));
});

test("fallback WebAuthn decoding projects native public fields and excludes toJSON extras", async () => {
  const h = await harness();
  await h.start();
  await h.create();
  const publicKey = h.creates[0].publicKey;
  assert.deepEqual([...new Uint8Array(publicKey.challenge)], [1, 2, 3, 4]);
  assert.deepEqual([...new Uint8Array(publicKey.user.id)], [5, 6, 7, 8]);
  assert.deepEqual(
    [...new Uint8Array(publicKey.excludeCredentials[0].id)],
    [9, 10, 11],
  );
  await h.download();
  await h.confirm();
  await h.finish();
  const c = h.calls[1].body.response;
  assert.deepEqual(Object.keys(c.response).sort(), [
    "attestationObject",
    "clientDataJSON",
    "transports",
  ]);
  assert.equal(c.id, c.rawId);
  assert.deepEqual(c.clientExtensionResults, { credProps: { rk: true } });
  assert.equal(c.authenticatorAttachment, "platform");
  assert(!JSON.stringify(c).includes("never-project"));
});

test("native creation-options parser is used only after an explicit Passkey click", async () => {
  const h = await harness({ nativeJSON: true });
  await h.start();
  assert.equal(h.creates.length, 0);
  await h.create();
  assert.equal(h.creates[0].publicKey.nativeParsed, true);
});

test("unknown options and completion outcomes retain the same request key and byte-identical body until explicit retry", async () => {
  let optionCalls = 0,
    completeCalls = 0;
  const h = await harness({
    fetcher: (call) => {
      if (call.path.endsWith("/options")) {
        if (++optionCalls === 1) throw new Error("network PRIVATE_SQL");
        return response(options);
      }
      if (++completeCalls === 1) throw new Error("network PRIVATE_SQL");
      return response(completed);
    },
  });
  await h.start();
  assert.match(h.elements["identity-status"].textContent, /結果尚未確認/);
  h.elements["confirmation-code"].value = "f".repeat(64);
  await h.start();
  assert.equal(h.calls[0].init.body, h.calls[1].init.body);
  await h.create();
  await h.download();
  await h.confirm();
  await h.finish();
  assert.match(h.elements["identity-status"].textContent, /結果尚未確認/);
  assert.equal(h.elements["restart-registration"].disabled, true);
  h.elements["backup-confirmed"].checked = false;
  await h.finish();
  assert.equal(h.calls[2].init.body, h.calls[3].init.body);
  assert.match(h.elements["identity-status"].textContent, /設定完成/);
  assert(!h.elements["identity-status"].textContent.includes("PRIVATE_SQL"));
});

test("known rejection, quota, unsupported browsers and cancellation never claim success or show raw errors", async () => {
  for (const status of [403, 409, 429, 503]) {
    const h = await harness({
      fetcher: () => response({ error: "RAW_SQL_PRIVATE" }, status),
    });
    await h.start();
    assert(!h.elements["identity-status"].textContent.includes("RAW_SQL"));
    assert.doesNotMatch(h.elements["identity-status"].textContent, /設定完成/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.creates.length, 0);
  }
  const unsupported = await harness({ supported: false });
  await unsupported.start();
  assert.equal(unsupported.calls.length, 0);
  assert.match(
    unsupported.elements["identity-status"].textContent,
    /支援.*Passkey/,
  );
  const cancelled = await harness({
    createError: Object.assign(new Error("PRIVATE_RAW_STACK"), {
      name: "NotAllowedError",
    }),
  });
  await cancelled.start();
  await cancelled.create();
  assert.match(cancelled.elements["identity-status"].textContent, /已取消/);
  assert(
    !cancelled.elements["identity-status"].textContent.includes("PRIVATE_RAW"),
  );
  assert.equal(cancelled.downloads.length, 0);
  assert.equal(cancelled.calls.length, 1);
});

test("expired options require explicit restart and clear old credential before a fresh challenge", async () => {
  const h = await harness();
  await h.start();
  await h.create();
  await h.download();
  await h.confirm();
  h.setTime("2026-10-31T00:05:00.000Z");
  await h.finish();
  assert.equal(h.calls.length, 1);
  assert.match(h.elements["identity-status"].textContent, /到期/);
  assert.equal(h.elements["complete-registration"].disabled, true);
  await h.elements["restart-registration"].fire("click");
  await h.start();
  assert.notEqual(h.calls[0].body.requestKey, h.calls[1].body.requestKey);
  assert.equal(h.elements["backup-confirmed"].checked, false);
  assert.equal(h.elements["download-recovery"].disabled, true);
});

test("untrusted API data remains text, never secret-bearing links or injected markup", async () => {
  const h = await harness({
    fetcher: () =>
      response({ ...options, agentId: "<img src=x onerror=PRIVATE_XSS>" }),
  });
  await h.start();
  assert.equal(h.creates.length, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.downloads.length, 0);
  assert(h.domWrites.every((x) => !x.text.includes("PRIVATE_XSS")));
  const html = readFileSync(
    new URL("../public/identity.html", import.meta.url),
    "utf8",
  );
  assert(!html.includes(code));
  assert(!html.includes("e".repeat(64)));
  assert.doesNotMatch(
    html,
    /on(?:click|submit|change)=|<script[^>]*>[^<]+<\/script>/i,
  );
  assert.match(html, /aria-live="polite"/);
  for (const id of ["invitation-id", "confirmation-code"])
    assert.match(html, new RegExp('for="' + id + '"'));
});

test("all identity entries have private cache, indexing and same-origin CSP rules with no inline code", () => {
  const headers = readFileSync(
    new URL("../public/_headers", import.meta.url),
    "utf8",
  );
  for (const entry of ["/identity", "/identity/", "/identity.html"]) {
    const block = headers
      .split(/\n(?=\/)/)
      .find((b) => b.split("\n")[0] === entry);
    assert(block, entry);
    for (const header of [
      "Cache-Control: no-store",
      "X-Robots-Tag: noindex, nofollow",
      "Referrer-Policy: no-referrer",
      "X-Content-Type-Options: nosniff",
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ])
      assert(block.includes(header), entry + " " + header);
    assert(!block.includes("unsafe-inline"));
  }
  const machine = JSON.parse(
    readFileSync(
      new URL("../public/identity-onboarding.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(machine.guardianRegistration.uiPath, "/identity");
  assert.equal(machine.guardianRegistration.issuanceReady, false);
  assert.equal(machine.mode, "provisional-only");
  assert.equal(machine.status.recoveryConfigured, false);
  assert(!JSON.stringify(machine).includes("確認碼兌換尚未開放"));
});

test("server quota or temporary completion failures preserve one body; known invalidation clears the prepared secrets", async () => {
  for (const status of [429, 503]) {
    let attempts = 0;
    const h = await harness({
      fetcher: (call) =>
        call.path.endsWith("/options")
          ? response(options)
          : ++attempts === 1
            ? response({ error: "PRIVATE_PROVIDER_TRACE" }, status)
            : response(completed),
    });
    await h.start();
    await h.create();
    await h.download();
    await h.confirm();
    await h.finish();
    assert.doesNotMatch(
      h.elements["identity-status"].textContent,
      /設定完成|PRIVATE_PROVIDER/,
    );
    assert.equal(h.elements["restart-registration"].disabled, true);
    await h.elements["restart-registration"].fire("click", true);
    assert.equal(h.elements["restart-registration"].disabled, true);
    await h.finish();
    assert.equal(h.calls[1].init.body, h.calls[2].init.body);
    assert.match(h.elements["identity-status"].textContent, /設定完成/);
  }
  for (const status of [400, 403, 409]) {
    const h = await harness({
      fetcher: (call) =>
        response(
          call.path.endsWith("/options") ? options : { error: "PRIVATE_SQL" },
          call.path.endsWith("/options") ? 200 : status,
        ),
    });
    await h.start();
    await h.create();
    await h.download();
    await h.confirm();
    await h.finish();
    assert.doesNotMatch(
      h.elements["identity-status"].textContent,
      /設定完成|PRIVATE_SQL/,
    );
    assert.equal(h.elements["download-recovery"].disabled, true);
    assert.equal(h.elements["complete-registration"].disabled, true);
    assert.equal(h.elements["backup-confirmed"].checked, false);
    await h.elements["complete-registration"].fire("click", true);
    assert.equal(h.calls.length, 2);
  }
});

test("a blocked private download never enables acknowledgment or completion", async () => {
  const h = await harness({ downloadError: true });
  await h.start();
  await h.create();
  await h.download();
  assert.equal(h.downloads.length, 0);
  assert.equal(h.elements["backup-confirmed"].disabled, true);
  assert.equal(h.elements["complete-registration"].disabled, true);
  h.elements["backup-confirmed"].checked = true;
  await h.elements["complete-registration"].fire("click", true);
  assert.equal(h.calls.length, 1);
  assert.match(h.elements["identity-status"].textContent, /未能開始下載/);
  assert.equal(h.revoked.length, 1);
});

test("malformed success cannot claim activation, and actual success disables every private operation", async () => {
  let attempts = 0;
  const h = await harness({
    fetcher: (call) =>
      call.path.endsWith("/options")
        ? response(options)
        : ++attempts === 1
          ? response({ ...completed, recoveryConfigured: false })
          : response(completed),
  });
  await h.start();
  await h.create();
  await h.download();
  await h.confirm();
  await h.finish();
  assert.match(h.elements["identity-status"].textContent, /結果尚未確認/);
  assert.equal(h.elements["restart-registration"].disabled, true);
  await h.finish();
  assert.equal(h.calls[1].init.body, h.calls[2].init.body);
  assert.match(h.elements["identity-status"].textContent, /設定完成/);
  const count = h.calls.length;
  for (const id of [
    "create-passkey",
    "download-recovery",
    "complete-registration",
    "restart-registration",
  ])
    await h.elements[id].fire("click", true);
  await h.elements["identity-form"].fire("submit");
  assert.equal(h.calls.length, count);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.elements["confirmation-code"].value, "");
  assert(
    !JSON.stringify(h.body.children.map((c) => c.href ?? "")).includes(code),
  );
});

test("native form fallback cannot serialize private invitation fields into a URL when JavaScript is unavailable", () => {
  const html = readFileSync(
      new URL("../public/identity.html", import.meta.url),
      "utf8",
    ),
    form = html.match(/<form[^>]+id="identity-form"[^>]*>/)?.[0];
  assert(form);
  assert.match(form, /method="post"/);
  assert.match(form, /action="\/identity"/);
  for (const id of ["invitation-id", "confirmation-code"]) {
    const field = html.match(
      new RegExp('<input[^>]+id="' + id + '"[^>]*>'),
    )?.[0];
    assert(field);
    assert.doesNotMatch(field, /\bname=/);
    assert.match(field, /autocomplete="off"/);
    assert.match(field, /spellcheck="false"/);
  }
});

test("a stalled HTTP request becomes an unknown result through cancellation and retries its unchanged body", async () => {
  let requests = 0;
  const h = await harness({
    fetcher: (call) => {
      if (++requests > 1) return response(options);
      if (!call.init.signal) throw new Error("missing bounded cancellation");
      return new Promise((_, reject) =>
        call.init.signal.addEventListener(
          "abort",
          () => reject(new Error("private timeout detail")),
          { once: true },
        ),
      );
    },
  });
  const first = h.start();
  assert.equal(h.calls.length, 1);
  assert(h.calls[0].init.signal, "HTTP request must have bounded cancellation");
  h.expireRequests();
  await first;
  assert.match(h.elements["identity-status"].textContent, /結果尚未確認/);
  assert.equal(h.elements["restart-registration"].disabled, true);
  await h.start();
  assert.equal(h.calls[0].init.body, h.calls[1].init.body);
  assert.match(h.elements["identity-status"].textContent, /邀請已確認/);
});

test("an unknown completion keeps its historical replay even after the displayed challenge expires", async () => {
  let attempts = 0;
  const h = await harness({
    fetcher: (call) => {
      if (call.path.endsWith("/options")) return response(options);
      if (++attempts === 1) throw new Error("unknown committed result");
      return response(completed);
    },
  });
  await h.start();
  await h.create();
  await h.download();
  await h.confirm();
  await h.finish();
  h.setTime("2026-11-03T00:00:00.000Z");
  await h.finish();
  assert.equal(h.calls[1].init.body, h.calls[2].init.body);
  assert.match(h.elements["identity-status"].textContent, /設定完成/);
  assert.equal(h.elements["confirmation-code"].value, "");
});
