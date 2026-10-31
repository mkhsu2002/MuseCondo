/* global Response, TextEncoder, Blob, AbortController */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { Buffer } from "node:buffer";
import { runInNewContext } from "node:vm";
const origin = "https://identity.example",
  requestId = "a".repeat(32),
  agentId = "mcid:" + "b".repeat(64),
  fingerprint = "c".repeat(64),
  oldCode = "d".repeat(64);
const context = {
  requestId,
  agentId,
  candidateFingerprint: fingerprint,
  state: "pending",
  expiresAt: "2026-10-31T01:00:00.000Z",
};
const assertionOptions = {
  challenge: "AQIDBA",
  rpId: "identity.example",
  userVerification: "required",
  allowCredentials: [],
};
const creationOptions = {
  challenge: "AQIDBA",
  rp: { id: "identity.example", name: "MuseCondo" },
  user: { id: "BQYHCA", name: "guardian", displayName: "監護人" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  authenticatorSelection: {
    residentKey: "required",
    userVerification: "required",
  },
  attestation: "none",
};
const options = (method = "passkey", decision = "continue") => ({
  ...context,
  challengeId: "e".repeat(32),
  decision,
  method,
  challengeExpiresAt: "2026-10-31T00:05:00.000Z",
  options: method === "offline" ? creationOptions : assertionOptions,
});
const complete = (decision = "continue") => ({
  requestId,
  agentId,
  state: decision === "continue" ? "continued" : "new-admission-required",
  ...(decision === "continue"
    ? { authorityEpoch: 2, instanceId: "f".repeat(32) }
    : {}),
});
const response = (v, status = 200) =>
  new Response(JSON.stringify(v), { status });
class Element {
  constructor() {
    this.events = {};
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.textContent = "";
    this.children = [];
  }
  addEventListener(t, f) {
    this.events[t] = f;
  }
  async fire(t, force = false) {
    if (!force && this.disabled) return;
    await this.events[t]?.({ preventDefault() {} });
  }
  append(...v) {
    this.children.push(...v);
  }
  remove() {
    this.removed = true;
  }
  focus() {
    if (!this.disabled) this.focused = true;
  }
}
async function harness({
  method = "passkey",
  decision = "continue",
  fetcher,
  supported = true,
  nativeJSON = false,
  parseFailure = false,
  nativeError,
  downloadError = false,
  randomOldFirst = false,
} = {}) {
  assert(
    existsSync(new URL("../public/identity-recovery.html", import.meta.url)),
    "recovery UI is implemented",
  );
  const html = readFileSync(
    new URL("../public/identity-recovery.html", import.meta.url),
    "utf8",
  );
  const elements = Object.fromEntries(
    [...html.matchAll(/id="([^"]+)"/g)].map((m) => [m[1], new Element()]),
  );
  for (const m of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)) {
    let e = elements[m[1]];
    e.hidden = /\bhidden\b/.test(m[0]);
    e.disabled = /\bdisabled\b/.test(m[0]);
    e.checked = /\bchecked\b/.test(m[0]);
    e.type = m[0].match(/type="([^"]+)"/)?.[1] ?? "";
  }
  const calls = [],
    natives = [],
    downloads = [],
    urls = [],
    revoked = [],
    writes = [],
    timers = new Map(),
    events = {};
  let sequence = 0,
    random = 0,
    now = "2026-10-31T00:00:00.000Z",
    timerId = 0,
    fail = Number(parseFailure);
  const bytes = (v) => new Uint8Array(v).buffer;
  const clientBytes = new TextEncoder().encode(
    '{ "type":"webauthn.get", "extra":"browser field" }',
  ).buffer;
  const credential = {
    id: "AQIDBA",
    rawId: bytes([1, 2, 3, 4]),
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: clientBytes,
      authenticatorData: bytes([5, 6]),
      signature: bytes([7, 8]),
      userHandle: bytes([9]),
      attestationObject: bytes([0xa0]),
      getTransports: () => ["internal"],
    },
    getClientExtensionResults: () => ({
      credProps: { rk: true },
      secretExtra: "PRIVATE_EXTENSION",
    }),
    toJSON() {
      throw Error("no toJSON");
    },
  };
  const Native = class {};
  if (nativeJSON)
    for (const name of [
      "parseRequestOptionsFromJSON",
      "parseCreationOptionsFromJSON",
    ])
      Native[name] = (v) => {
        if (fail-- > 0) throw Error("PRIVATE_PARSER");
        return { ...v, nativeParsed: true };
      };
  const body = new Element();
  const sandbox = {
    document: {
      querySelector: (s) => elements[s.slice(1)],
      createElement: () => {
        const e = new Element();
        e.click = () => {
          if (downloadError) throw Error("PRIVATE_DOWNLOAD");
          downloads.push({ href: e.href, name: e.download });
        };
        return e;
      },
      body,
    },
    addEventListener: (t, f) => {
      events[t] = f;
    },
    navigator: {
      credentials: supported
        ? {
            get: async (v) => {
              natives.push({ kind: "get", ...v });
              if (nativeError) throw nativeError;
              return credential;
            },
            create: async (v) => {
              natives.push({ kind: "create", ...v });
              if (nativeError) throw nativeError;
              return credential;
            },
          }
        : undefined,
    },
    PublicKeyCredential: supported ? Native : undefined,
    isSecureContext: true,
    location: { origin, hostname: "identity.example" },
    crypto: {
      randomUUID: () => `synthetic-key-${++sequence}`,
      getRandomValues: (v) => {
        v.fill(randomOldFirst && random++ === 0 ? 0xdd : 0xee);
        return v;
      },
    },
    Date: class extends Date {
      constructor(v) {
        super(v === undefined ? now : v);
      }
      static now() {
        return new Date(now).getTime();
      }
    },
    Uint8Array,
    ArrayBuffer,
    TextEncoder,
    Blob,
    URL: {
      createObjectURL: (blob) => {
        const url = "blob:private-" + urls.length;
        urls.push({ url, blob });
        return url;
      },
      revokeObjectURL: (url) => revoked.push(url),
    },
    atob: (v) => Buffer.from(v, "base64").toString("binary"),
    btoa: (v) => Buffer.from(v, "binary").toString("base64"),
    fetch: async (path, init) => {
      const c = { path, init, body: JSON.parse(init.body) };
      calls.push(c);
      return fetcher
        ? fetcher(c, calls.length)
        : response(
            path.endsWith("/context")
              ? context
              : path.endsWith("/options")
                ? options(method, decision)
                : complete(decision),
          );
    },
    AbortController,
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    console: {
      log() {
        throw Error("no log");
      },
      error() {
        throw Error("no log");
      },
    },
  };
  for (const name of ["localStorage", "sessionStorage"])
    Object.defineProperty(sandbox, name, {
      get() {
        throw Error("no storage");
      },
    });
  for (const [id, e] of Object.entries(elements)) {
    let text = "";
    Object.defineProperty(e, "textContent", {
      get: () => text,
      set: (v) => {
        text = String(v);
        writes.push({ id, text });
      },
    });
  }
  runInNewContext(
    readFileSync(
      new URL("../public/identity-recovery.js", import.meta.url),
      "utf8",
    ),
    sandbox,
  );
  elements["request-id"].value = requestId;
  const click = (id) => elements[id].fire("click"),
    change = async (id, value = true) => {
      elements[id].checked = value;
      await elements[id].fire("change");
    };
  const load = () => elements["recovery-form"].fire("submit");
  const select = async () => {
    await change("fingerprint-confirmed");
    await change("decision-" + decision);
    if (method === "offline") {
      await change("method-offline");
      elements["current-offline-code"].value = oldCode;
    }
  };
  const prepare = () => click("prepare-recovery"),
    verify = () => click("verify-guardian"),
    download = () => click("download-recovery"),
    ack = () => change("backup-confirmed"),
    finish = () => click("complete-recovery");
  return {
    elements,
    calls,
    natives,
    downloads,
    urls,
    revoked,
    writes,
    clientBytes,
    load,
    select,
    prepare,
    verify,
    download,
    ack,
    finish,
    click,
    change,
    setTime: (v) => {
      now = v;
    },
    expire: () => {
      for (const f of [...timers.values()]) f();
    },
    pagehide: () => events.pagehide?.(),
    ready: async () => {
      await load();
      await select();
      await prepare();
      await verify();
    },
  };
}
for (const method of ["passkey", "offline"])
  for (const decision of ["continue", "new"])
    test(`${method} ${decision}: explicit verification, correct payload and secret cleanup`, async () => {
      const h = await harness({
        method,
        decision,
        randomOldFirst: method === "offline",
      });
      await h.load();
      assert.equal(h.natives.length, 0);
      assert.equal(h.elements["agent-id"].textContent, agentId);
      assert.equal(
        h.elements["candidate-fingerprint"].textContent,
        fingerprint,
      );
      assert.equal(h.elements["context-request-id"].textContent, requestId);
      await h.select();
      await h.prepare();
      assert.equal(h.natives.length, 0);
      await h.verify();
      assert.equal(h.natives.length, 1);
      assert.equal(h.natives[0].kind, method === "offline" ? "create" : "get");
      const backup = method === "offline" || decision === "continue";
      if (backup) {
        h.elements["backup-confirmed"].checked = true;
        await h.elements["complete-recovery"].fire("click", true);
        assert.equal(h.calls.length, 2);
        await h.download();
        await h.ack();
      }
      await h.finish();
      assert.equal(h.calls.length, 3);
      const b = h.calls[2].body;
      assert.deepEqual(
        Object.keys(b).sort(),
        [
          "requestKey",
          "requestId",
          "challengeId",
          "response",
          ...(method === "offline" ? ["currentOfflineRecoveryCode"] : []),
          ...(backup ? ["offlineRecoveryCode", "backupConfirmed"] : []),
        ].sort(),
      );
      assert.equal(b.requestId, requestId);
      assert.equal(
        b.response.response.clientDataJSON,
        Buffer.from(h.clientBytes).toString("base64url"),
      );
      assert.equal(b.response.rawId, "AQIDBA");
      assert(!JSON.stringify(b.response).includes("PRIVATE_EXTENSION"));
      if (method === "passkey") {
        assert.deepEqual(b.response.clientExtensionResults, {});
        assert.deepEqual(
          Object.keys(b.response.response).sort(),
          [
            "clientDataJSON",
            "authenticatorData",
            "signature",
            "userHandle",
          ].sort(),
        );
      } else {
        assert.equal(b.currentOfflineRecoveryCode, oldCode);
        assert.deepEqual(b.response.clientExtensionResults, {
          credProps: { rk: true },
        });
      }
      if (backup) {
        assert.equal(b.offlineRecoveryCode, "e".repeat(64));
        assert.notEqual(b.offlineRecoveryCode, oldCode);
        assert.equal(b.backupConfirmed, true);
        const file = await h.urls[0].blob.text();
        assert(
          file.includes(agentId) &&
            file.includes(origin) &&
            file.includes(b.offlineRecoveryCode),
        );
        assert(!file.includes(oldCode) && !file.includes(fingerprint));
        assert.equal(h.revoked.length, h.urls.length);
      }
      assert.equal(h.elements["current-offline-code"].value, "");
      assert.equal(h.elements["complete-recovery"].disabled, true);
      assert.match(
        h.elements["recovery-status"].textContent,
        decision === "continue"
          ? /曾完成.*目前.*權限/
          : /新入住.*尚未建立.*身份/,
      );
      assert(
        h.writes.every(
          (v) => !v.text.includes(oldCode) && !v.text.includes("e".repeat(64)),
        ),
      );
      for (const c of h.calls) {
        assert.equal(c.init.credentials, "omit");
        assert.equal(c.init.cache, "no-store");
        assert.equal(c.init.redirect, "error");
        assert.equal(c.path.includes(oldCode), false);
        assert.equal(c.init.referrerPolicy, "no-referrer");
      }
    });
test("fingerprint acknowledgment and decision have no defaults; inputs lock to the prepared operation", async () => {
  const h = await harness();
  assert.equal(h.elements["decision-continue"].checked, false);
  assert.equal(h.elements["decision-new"].checked, false);
  await h.load();
  await h.elements["prepare-recovery"].fire("click", true);
  assert.equal(h.calls.length, 1);
  await h.change("fingerprint-confirmed");
  await h.elements["prepare-recovery"].fire("click", true);
  assert.equal(h.calls.length, 1);
  await h.change("decision-continue");
  await h.prepare();
  for (const id of [
    "request-id",
    "decision-continue",
    "decision-new",
    "method-passkey",
    "method-offline",
    "current-offline-code",
    "fingerprint-confirmed",
  ])
    assert.equal(h.elements[id].disabled, true, id);
});
test("fallback decodes WebAuthn buffers while native JSON parser is used only on guardian click", async () => {
  for (const method of ["passkey", "offline"])
    for (const nativeJSON of [false, true]) {
      const h = await harness({ method, nativeJSON });
      await h.load();
      await h.select();
      await h.prepare();
      assert.equal(h.natives.length, 0);
      await h.verify();
      const key = h.natives[0].publicKey;
      if (nativeJSON) assert.equal(key.nativeParsed, true);
      else assert.deepEqual([...new Uint8Array(key.challenge)], [1, 2, 3, 4]);
    }
});
test("empty or unsafe options retain identical request key and payload for explicit retry", async () => {
  for (const bad of [
    {},
    { ...assertionOptions, challenge: "AB" },
    { ...assertionOptions, rpId: "evil.example" },
    { ...assertionOptions, userVerification: "preferred" },
  ]) {
    let n = 0;
    const h = await harness({
      fetcher: (c) =>
        response(
          c.path.endsWith("/context")
            ? context
            : c.path.endsWith("/options")
              ? ++n === 1
                ? { ...options(), options: bad }
                : options()
              : complete(),
        ),
    });
    await h.load();
    await h.select();
    await h.prepare();
    assert.equal(h.elements["verify-guardian"].disabled, true);
    assert.match(h.elements["recovery-status"].textContent, /結果尚未確認/);
    assert.equal(h.elements["restart-recovery"].disabled, true);
    await h.prepare();
    assert.equal(h.calls[1].init.body, h.calls[2].init.body);
    await h.verify();
    assert.equal(h.natives.length, 1);
  }
});
test("native parser error returns to same options retry without unsupported-device claim", async () => {
  const h = await harness({ nativeJSON: true, parseFailure: true });
  await h.load();
  await h.select();
  await h.prepare();
  await h.verify();
  assert.equal(h.natives.length, 0);
  assert.match(h.elements["recovery-status"].textContent, /結果尚未確認/);
  assert.doesNotMatch(
    h.elements["recovery-status"].textContent,
    /裝置.*無法|不支援/,
  );
  await h.prepare();
  assert.equal(h.calls[1].init.body, h.calls[2].init.body);
  await h.verify();
  assert.equal(h.natives.length, 1);
});
for (const failure of [
  "network",
  "malformed-json",
  "invalid-200",
  "timeout",
  "503",
  "429",
])
  test(`unknown/temporary completion ${failure} retries exact body even after expiry without a new credential`, async () => {
    let attempts = 0;
    const h = await harness({
      fetcher: (c) => {
        if (c.path.endsWith("/context")) return response(context);
        if (c.path.endsWith("/options")) return response(options());
        if (++attempts > 1) return response(complete());
        if (failure === "network") throw Error("PRIVATE_SQL");
        if (failure === "malformed-json") return new Response("{bad");
        if (failure === "invalid-200") return response({ state: "continued" });
        if (failure === "timeout")
          return new Promise((_, reject) =>
            c.init.signal.addEventListener("abort", () =>
              reject(Error("PRIVATE_TIMEOUT")),
            ),
          );
        return response({ error: "PRIVATE_PROVIDER" }, Number(failure));
      },
    });
    await h.ready();
    await h.download();
    await h.ack();
    const pending = h.finish();
    if (failure === "timeout") h.expire();
    await pending;
    assert.equal(h.elements["restart-recovery"].disabled, true);
    await h.elements["restart-recovery"].fire("click", true);
    h.setTime("2026-11-03T00:00:00.000Z");
    await h.finish();
    assert.equal(h.calls[2].init.body, h.calls[3].init.body);
    assert.equal(h.natives.length, 1);
    assert.match(h.elements["recovery-status"].textContent, /曾完成/);
    assert.doesNotMatch(h.elements["recovery-status"].textContent, /PRIVATE/);
  });
test("known expired/conflicting operation clears secrets and allows fresh context rather than auto restart", async () => {
  const h = await harness({
    fetcher: (c) =>
      response(
        c.path.endsWith("/context")
          ? context
          : c.path.endsWith("/options")
            ? options()
            : { error: "PRIVATE_CONFLICT" },
        c.path.endsWith("/complete") ? 409 : 200,
      ),
  });
  await h.ready();
  await h.download();
  await h.ack();
  await h.finish();
  assert.equal(h.elements["current-offline-code"].value, "");
  assert.match(h.elements["recovery-status"].textContent, /到期|變更/);
  assert.equal(h.elements["restart-recovery"].disabled, false);
  assert.equal(h.calls.length, 3);
  await h.click("restart-recovery");
  await h.load();
  assert.equal(h.calls.length, 4);
});
test("local expiry and pagehide remove backup and revoke object URLs; unknown completion remains retriable", async () => {
  const h = await harness();
  await h.ready();
  await h.download();
  h.setTime("2026-10-31T00:05:00.000Z");
  await h.ack();
  await h.finish();
  assert.equal(h.calls.length, 2);
  assert.match(h.elements["recovery-status"].textContent, /到期/);
  assert.equal(h.revoked.length, h.urls.length);
  const p = await harness({ method: "offline" });
  await p.ready();
  await p.download();
  p.pagehide();
  assert.equal(p.elements["current-offline-code"].value, "");
  assert.equal(p.revoked.length, p.urls.length);
  await p.elements["complete-recovery"].fire("click", true);
  assert.equal(p.calls.length, 2);
});
test("terminal historical context never implies current authority or a new identity", async () => {
  for (const state of ["continued", "new-admission-required"]) {
    const h = await harness({ fetcher: () => response({ ...context, state }) });
    await h.load();
    assert.equal(h.elements["prepare-recovery"].disabled, true);
    assert.equal(h.natives.length, 0);
    assert.match(
      h.elements["recovery-status"].textContent,
      state === "continued" ? /曾完成.*目前.*權限/ : /尚未建立.*身份/,
    );
  }
  const h = await harness({
    fetcher: () =>
      response({ ...context, expiresAt: "2026-10-30T00:00:00.000Z" }),
  });
  await h.load();
  assert.match(h.elements["recovery-status"].textContent, /到期.*新.*申請/);
  assert.equal(h.elements["prepare-recovery"].disabled, true);
});
test("unsupported, cancellation, rejected code, quota and temporary service errors have actionable safe copy", async () => {
  const u = await harness({ supported: false });
  await u.load();
  await u.select();
  await u.prepare();
  assert.equal(u.natives.length, 0);
  assert.match(u.elements["recovery-status"].textContent, /支援.*Passkey/);
  const c = await harness({
    nativeError: { name: "NotAllowedError", message: "PRIVATE" },
  });
  await c.ready();
  assert.match(c.elements["recovery-status"].textContent, /取消.*再試/);
  assert.equal(c.elements["verify-guardian"].disabled, false);
  for (const status of [403, 404, 429, 503]) {
    const h = await harness({
      method: "offline",
      fetcher: (c) =>
        c.path.endsWith("/context")
          ? response(context)
          : response({ error: "PRIVATE_SQL" }, status),
    });
    await h.load();
    await h.select();
    await h.prepare();
    assert.doesNotMatch(
      h.elements["recovery-status"].textContent,
      /PRIVATE|曾完成/,
    );
    assert.equal(h.natives.length, 0);
  }
});
test("failed download never enables safety acknowledgment or final submission", async () => {
  const h = await harness({ downloadError: true });
  await h.ready();
  await h.download();
  assert.equal(h.elements["backup-confirmed"].disabled, true);
  h.elements["backup-confirmed"].checked = true;
  await h.elements["complete-recovery"].fire("click", true);
  assert.equal(h.calls.length, 2);
  assert.equal(h.revoked.length, 1);
});
test("malicious context never renders data or leaks raw errors; no URL/storage/inline code and POST-only no-JS form", async () => {
  const h = await harness({
    fetcher: () =>
      response({ ...context, agentId: "<img src=x onerror=PRIVATE_XSS>" }),
  });
  await h.load();
  assert(h.writes.every((x) => !x.text.includes("PRIVATE_XSS")));
  assert.equal(h.natives.length, 0);
  const html = readFileSync(
      new URL("../public/identity-recovery.html", import.meta.url),
      "utf8",
    ),
    js = readFileSync(
      new URL("../public/identity-recovery.js", import.meta.url),
      "utf8",
    );
  assert.match(html, /<form[^>]*method="post"[^>]*>/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /on(?:click|submit|change)=/);
  for (const id of ["request-id", "current-offline-code"]) {
    const field = html.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'))[0];
    assert.doesNotMatch(field, /\bname=/);
    assert.match(field, /autocomplete="off"/);
  }
  assert.doesNotMatch(
    js,
    /localStorage|sessionStorage|console\.|innerHTML|\.toJSON\(/,
  );
});
test("recovery routes and capability are declared without implying credential issuance", () => {
  const headers = readFileSync(
    new URL("../public/_headers", import.meta.url),
    "utf8",
  );
  for (const path of [
    "/identity/recover",
    "/identity/recover/",
    "/identity-recovery.html",
  ]) {
    const block = headers
      .split(/\n(?=\/)/)
      .find((b) => b.split("\n")[0] === path);
    assert(block, path);
    for (const text of [
      "Cache-Control: no-store",
      "X-Robots-Tag: noindex, nofollow",
      "Referrer-Policy: no-referrer",
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ])
      assert(block.includes(text), path + " " + text);
  }
  const machine = JSON.parse(
    readFileSync(
      new URL("../public/identity-onboarding.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(machine.modeScope, "enrollment");
  assert.equal(machine.recovery.recoveryAvailable, true);
  assert.equal(machine.recovery.uiAvailable, true);
  assert.equal(machine.recovery.uiPath, "/identity/recover");
  assert.equal(machine.status.issuanceReady, false);
  assert.match(
    readFileSync(new URL("../public/identity.html", import.meta.url), "utf8"),
    /href="\/identity\/recover"/,
  );
});

test("offline unknown options and completion retain the original private proof and decision after input changes", async () => {
  let optionAttempts = 0,
    completeAttempts = 0;
  const h = await harness({
    method: "offline",
    decision: "new",
    fetcher: (c) => {
      if (c.path.endsWith("/context")) return response(context);
      if (c.path.endsWith("/options")) {
        if (++optionAttempts === 1) throw Error("PRIVATE_OPTIONS_NETWORK");
        return response(options("offline", "new"));
      }
      if (++completeAttempts === 1) throw Error("PRIVATE_COMPLETE_NETWORK");
      return response(complete("new"));
    },
  });
  await h.load();
  await h.select();
  await h.prepare();
  assert.equal(h.elements["restart-recovery"].disabled, true);
  h.elements["current-offline-code"].value = "9".repeat(64);
  h.elements["decision-continue"].checked = true;
  await h.prepare();
  assert.equal(h.calls[1].init.body, h.calls[2].init.body);
  await h.verify();
  await h.download();
  await h.ack();
  await h.finish();
  assert.equal(h.elements["restart-recovery"].disabled, true);
  h.setTime("2026-11-03T00:00:00.000Z");
  h.elements["current-offline-code"].value = "8".repeat(64);
  await h.finish();
  assert.equal(h.calls[3].init.body, h.calls[4].init.body);
  assert.equal(h.calls[4].body.currentOfflineRecoveryCode, oldCode);
  assert.equal(h.natives.length, 1);
  assert.match(h.elements["recovery-status"].textContent, /尚未建立新的身份/);
});

test("options cannot change the verified request tuple, method or explicit decision", async () => {
  for (const changed of [
    { requestId: "0".repeat(32) },
    { agentId: "mcid:" + "0".repeat(64) },
    { candidateFingerprint: "0".repeat(64) },
    { method: "offline" },
    { decision: "new" },
    {
      options: {
        ...assertionOptions,
        allowCredentials: [{ id: "AB", type: "public-key" }],
      },
    },
  ]) {
    const h = await harness({
      fetcher: (c) =>
        response(
          c.path.endsWith("/context") ? context : { ...options(), ...changed },
        ),
    });
    await h.load();
    await h.select();
    await h.prepare();
    assert.match(h.elements["recovery-status"].textContent, /結果尚未確認/);
    assert.equal(h.elements["verify-guardian"].disabled, true);
    assert.equal(h.elements["restart-recovery"].disabled, true);
    assert.equal(h.natives.length, 0);
  }
});

test("discoverable assertion options allow omitted allowCredentials", async () => {
  const withoutAllow = { ...assertionOptions };
  delete withoutAllow.allowCredentials;
  const h = await harness({
    fetcher: (c) =>
      response(
        c.path.endsWith("/context")
          ? context
          : c.path.endsWith("/options")
            ? { ...options(), options: withoutAllow }
            : complete(),
      ),
  });
  await h.ready();
  assert.equal(h.natives.length, 1);
  assert.equal(h.natives[0].publicKey.allowCredentials, undefined);
});

test("successful steps focus the next enabled action for keyboard users", async () => {
  const h = await harness();
  await h.load();
  assert.equal(h.elements["fingerprint-confirmed"].focused, true);
  await h.select();
  await h.prepare();
  assert.equal(h.elements["verify-guardian"].focused, true);
  await h.verify();
  assert.equal(h.elements["download-recovery"].focused, true);
});

for (const cause of ["known-409", "local-expiry"])
  test(`${cause}: directly loading a different request requires fresh fingerprint acknowledgment and decision`, async () => {
    const nextContext = {
      ...context,
      requestId: "1".repeat(32),
      agentId: "mcid:" + "2".repeat(64),
      candidateFingerprint: "3".repeat(64),
      expiresAt: "2026-10-31T02:00:00.000Z",
    };
    const h = await harness({
      method: "offline",
      fetcher: (c) => {
        if (c.path.endsWith("/context"))
          return response(
            c.body.requestId === requestId ? context : nextContext,
          );
        if (c.path.endsWith("/options"))
          return response(
            c.body.requestId === requestId
              ? options("offline")
              : {
                  ...options(),
                  ...nextContext,
                  challengeExpiresAt: "2026-10-31T00:10:00.000Z",
                },
          );
        return response({ error: "PRIVATE_CONFLICT" }, 409);
      },
    });
    await h.ready();
    await h.download();
    await h.ack();
    if (cause === "local-expiry") h.setTime("2026-10-31T00:05:00.000Z");
    await h.finish();
    assert.match(h.elements["recovery-status"].textContent, /到期|變更/);
    assert.equal(h.elements["current-offline-code"].value, "");
    assert.equal(h.elements["backup-confirmed"].checked, false);
    assert.equal(h.elements["download-recovery"].disabled, true);
    h.elements["request-id"].value = nextContext.requestId;
    await h.load();
    assert.equal(h.elements["agent-id"].textContent, nextContext.agentId);
    assert.equal(
      h.elements["candidate-fingerprint"].textContent,
      nextContext.candidateFingerprint,
    );
    assert.equal(h.elements["fingerprint-confirmed"].checked, false);
    assert.equal(h.elements["decision-continue"].checked, false);
    assert.equal(h.elements["decision-new"].checked, false);
    assert.equal(h.elements["prepare-recovery"].disabled, true);
    const count = h.calls.length;
    await h.elements["prepare-recovery"].fire("click", true);
    assert.equal(h.calls.length, count);
    await h.change("fingerprint-confirmed");
    await h.elements["prepare-recovery"].fire("click", true);
    assert.equal(h.calls.length, count);
    await h.change("decision-new");
    assert.equal(h.elements["prepare-recovery"].disabled, false);
  });

test("a rejected subject response cannot carry consent into a replacement context", async () => {
  let contextAttempts = 0;
  const h = await harness({
    fetcher: (c) => {
      if (c.path.endsWith("/context")) {
        return response(
          ++contextAttempts === 1
            ? context
            : {
                ...context,
                agentId: "mcid:" + "8".repeat(64),
                candidateFingerprint: "9".repeat(64),
              },
        );
      }
      return response({ error: "PRIVATE_REJECTED" }, 403);
    },
  });
  await h.load();
  await h.select();
  await h.prepare();
  await h.load();
  assert.equal(h.elements["agent-id"].textContent, "mcid:" + "8".repeat(64));
  assert.equal(h.elements["candidate-fingerprint"].textContent, "9".repeat(64));
  assert.equal(h.elements["fingerprint-confirmed"].checked, false);
  assert.equal(h.elements["decision-continue"].checked, false);
  assert.equal(h.elements["decision-new"].checked, false);
  const count = h.calls.length;
  await h.elements["prepare-recovery"].fire("click", true);
  assert.equal(h.calls.length, count);
});
