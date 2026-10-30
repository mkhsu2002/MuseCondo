import type { Database, Statement } from "./db.ts";
import { validatePNG } from "./png.ts";
import { sanitizePublicPNG } from "../framework/png-public.ts";
import {
  renderCondo,
  type CondoPage,
} from "../../src/framework/condo-render.ts";
import {
  CONDO_PROFILE_FIELDS,
  type PublicCondoSite,
} from "../../src/framework/condo.ts";
import type { PublicDailyEntry } from "../../src/framework/types.ts";
export interface TowerIntakeEnvironment {
  db: Database;
  origin: string;
  localTest: boolean;
  sourceOrigins: string[];
  now?: () => Date;
  fetcher?: typeof fetch;
  /** Operator attestation supplements an existing authenticated cookie and CSRF. Never a public boolean. */
  ownerAttestation?: (
    request: Request,
    accountId: string,
    sourceURL: string,
  ) => Promise<boolean>;
  onChange?: (roomId: string) => Promise<void>;
}
interface Residency {
  room_id: string;
  account_id: string;
  resident_id: string;
  source_url: string;
  proof_method: "challenge" | "owner-attested";
  revision: number;
  public_revision: number | null;
  publication_epoch:number;
  published_at:string|null;
  directory_consent: number;
  announcement_consent: number;
  dream_consent: number;
  snapshot_consent: number;
  created_at: string;
  updated_at: string;
}
interface Identity {
  accountId: string;
  guard: () => Promise<Statement>;
  delegated: boolean;
}
interface Claim {
  id: string;
  account_id: string;
  resident_id: string;
  source_url: string;
  challenge: string;
  expires_at: string;
  verified: number;
}
class TowerError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
function fail(status: number, code: string): never {
  throw new TowerError(status, code);
}
const random = (n = 32) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
async function hash(value: string | Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(
          typeof value === "string" ? new TextEncoder().encode(value) : value,
        ),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
function object(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail(400, "invalid_public_snapshot");
  return v as Record<string, unknown>;
}
function string(v: unknown, max = 2000): string {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    Array.from(v).some(
      (c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)),
    )
  )
    fail(400, "invalid_public_snapshot");
  return v as string;
}
function id(v: unknown) {
  const s = string(v, 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(s))
    fail(400, "invalid_identity");
  return s;
}
function revision(v: unknown) {
  if (!Number.isSafeInteger(v) || (v as number) < 1)
    fail(400, "expected_revision_required");
  return v as number;
}
function requestKey(v: unknown) {
  const s = string(v, 80);
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(s)) fail(400, "idempotency_key_required");
  return s;
}
function date(v: unknown) {
  const s = string(v, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(s) || !Number.isFinite(Date.parse(s)))
    fail(400, "invalid_public_snapshot");
  return s;
}
/** The intake accepts only the versioned public export. Never accept a framework seed or source HTML. */
export function validateTowerSnapshot(
  value: unknown,
  residentId: string,
): PublicCondoSite {
  const root = object(value, [
    "templateVersion",
    "home",
    "homeAlt",
    "profile",
    "dream",
    "example",
  ]);
  if (root.templateVersion !== "muse-condo-1" || root.example !== false)
    fail(400, "unsupported_public_snapshot");
  const home = object(root.home, [
    "frameworkVersion",
    "id",
    "name",
    "intro",
    "assets",
    "routes",
    "daily",
    "dreams",
  ]);
  if (home.frameworkVersion !== "0.01" || home.id !== residentId)
    fail(409, "source_identity_changed");
  const assets = object(home.assets, ["desktop"]);
  if (assets.desktop !== "./assets/home.png") fail(400, "invalid_image_source");
  const routes = object(home.routes, ["home", "inside", "dreams"]);
  if (
    routes.home !== "./index.html" ||
    routes.inside !== "./inside.html" ||
    routes.dreams !== "./dreams.html"
  )
    fail(400, "unsupported_public_snapshot");
  const profile = object(root.profile, CONDO_PROFILE_FIELDS),
    projected = Object.fromEntries(
      CONDO_PROFILE_FIELDS.map((k) => [k, string(profile[k])]),
    ) as PublicCondoSite["profile"];
  if (
    !Array.isArray(home.daily) ||
    home.daily.length > 100 ||
    !Array.isArray(home.dreams) ||
    home.dreams.length > 1
  )
    fail(400, "invalid_public_snapshot");
  const daily = home.daily.map((v): PublicDailyEntry => {
    const e = object(v, ["id", "type", "title", "body", "occurredAt"]);
    if (
      !["journal", "status", "seeking", "artwork", "observation"].includes(
        String(e.type),
      )
    )
      fail(400, "invalid_public_snapshot");
    return {
      id: id(e.id),
      type: e.type as PublicDailyEntry["type"],
      title: string(e.title, 120),
      body: string(e.body, 5000),
      occurredAt: date(e.occurredAt),
    };
  });
  let dream: PublicCondoSite["dream"] = null;
  if (root.dream !== null) {
    const d = object(root.dream, [
        "id",
        "title",
        "body",
        "occurredAt",
        "reflection",
        "wish",
        "image",
      ]),
      im = object(d.image, ["src", "alt"]);
    if (im.src !== "./assets/dream.png") fail(400, "invalid_image_source");
    dream = {
      id: id(d.id),
      title: string(d.title, 120),
      body: string(d.body, 5000),
      occurredAt: date(d.occurredAt),
      ...(d.reflection === undefined
        ? {}
        : { reflection: string(d.reflection) }),
      wish: string(d.wish),
      image: { src: "./assets/dream.png", alt: string(im.alt, 500) },
    };
  }
  // Duplicate legacy dream entries must agree exactly; they cannot hide extra private fields.
  const dreams = home.dreams.map((v) => {
    const d = object(v, [
      "id",
      "type",
      "title",
      "body",
      "occurredAt",
      "image",
      "reflection",
    ]);
    if (
      d.type !== "dream" ||
      d.image !== "./assets/dream.png" ||
      !dream ||
      d.id !== dream.id ||
      d.title !== dream.title ||
      d.body !== dream.body ||
      d.occurredAt !== dream.occurredAt ||
      d.reflection !== dream.reflection
    )
      fail(400, "inconsistent_dream");
    return {
      id: dream.id,
      type: "dream" as const,
      title: dream.title,
      body: dream.body,
      occurredAt: dream.occurredAt,
      image: "./assets/dream.png",
      ...(dream.reflection ? { reflection: dream.reflection } : {}),
    };
  });
  if (!!dream !== (dreams.length === 1)) fail(400, "inconsistent_dream");
  const result: PublicCondoSite = {
    templateVersion: "muse-condo-1",
    home: {
      frameworkVersion: "0.01",
      id: residentId,
      name: string(home.name, 100),
      intro: string(home.intro, 1000),
      assets: { desktop: "./assets/home.png" },
      routes: {
        home: "./index.html",
        inside: "./inside.html",
        dreams: "./dreams.html",
      },
      daily,
      dreams,
    },
    homeAlt: string(root.homeAlt, 500),
    profile: projected,
    dream,
    example: false,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 128000)
    fail(413, "snapshot_too_large");
  return result;
}
/** Preserve image pixels and essential transparency only; metadata never reaches a public asset. */
async function cleanPNG(bytes: Uint8Array, purpose: "home" | "dream") {
  let dimensions;
  try {
    dimensions = await validatePNG(bytes);
  } catch {
    fail(400, "invalid_source_image");
  }
  const expected = purpose === "home" ? 16 / 9 : 1;
  if (
    (purpose === "dream" && dimensions!.width !== dimensions!.height) ||
    Math.abs(dimensions!.width / dimensions!.height - expected) > 0.01
  )
    fail(400, "image_ratio_rejected");
  return sanitizePublicPNG(bytes);
}
export function createTowerIntake(env: TowerIntakeEnvironment) {
  const db = env.db,
    now = () => env.now?.() ?? new Date(),
    stamp = () => now().toISOString();
  const one = <T>(sql: string, ...args: unknown[]) =>
    db
      .prepare(sql)
      .bind(...args)
      .first<T>();
  const all = async <T>(sql: string, ...args: unknown[]) =>
    (
      await db
        .prepare(sql)
        .bind(...args)
        .all<T>()
    ).results;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  const safe = (r: Residency) => ({
    roomId: r.room_id,
    door: `/home/${r.room_id}`,
    residentId: r.resident_id,
    sourceURL: r.source_url,
    revision: r.revision,
    publicRevision: r.public_revision,
    proofMethod: r.proof_method,
    published: r.public_revision !== null,
    directoryConsent: !!r.directory_consent,
    announcementConsent: !!r.announcement_consent,
    dreamConsent: !!r.dream_consent,
    snapshotConsent: !!r.snapshot_consent,
  });
  const residency = (accountId: string) =>
    one<Residency>(
      "SELECT * FROM tower_residencies WHERE account_id=?",
      accountId,
    );
  const audit = (
    accountId: string,
    roomId: string | null,
    action: string,
    rev: number | null,
    detail: unknown = {},
  ) =>
    db
      .prepare(
        "INSERT INTO tower_audit(id,account_id,room_id,action,revision,detail_json,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        random(16),
        accountId,
        roomId,
        action,
        rev,
        JSON.stringify(detail),
        stamp(),
      );
  function source(value: unknown) {
    const raw = string(value, 1000);
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      fail(400, "source_url_rejected");
    }
    if (
      url!.protocol !== "https:" ||
      raw.includes("?") ||
      raw.includes("#") ||
      url!.username ||
      url!.password ||
      url!.port ||
      url!.hash ||
      url!.search ||
      !env.sourceOrigins.includes(url!.origin) ||
      !url!.hostname.includes(".") ||
      /[\]:]/.test(url!.hostname) ||
      url!.hostname.includes("[") ||
      /^\d+(?:\.\d+)*$/.test(url!.hostname) ||
      /(?:^|\.)(localhost|local|internal)$/.test(url!.hostname) ||
      !/^\/(?:[A-Za-z0-9_-]+\/)*condo\.json$/.test(url!.pathname) ||
      raw !== url!.href
    )
      fail(400, "source_url_rejected");
    return url!;
  }
  async function remote(url: URL, mime: string, max: number) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await (env.fetcher ?? fetch)(url.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: mime, "User-Agent":"MuseCondo-Tower-Intake/1.0", "Cache-Control":"no-cache" },
      });
      if(!response.ok)fail(400,"source_http_"+response.status);
      if(response.headers.get("Content-Type")?.split(";")[0].trim()!==mime)fail(400,"source_type_rejected");
      if (Number(response.headers.get("Content-Length") ?? 0) > max)
        fail(413, "source_too_large");
      const reader = response.body?.getReader();
      if (!reader) fail(400, "source_unavailable");
      const parts: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader!.read();
        if (done) break;
        size += value.length;
        if (size > max) {
          await reader!.cancel();
          fail(413, "source_too_large");
        }
        parts.push(value);
      }
      const bytes = new Uint8Array(size);
      let p = 0;
      for (const b of parts) {
        bytes.set(b, p);
        p += b.length;
      }
      return bytes;
    } catch (e) {
      if (e instanceof TowerError) throw e;
      fail(400, controller.signal.aborted?"source_timeout":"source_network_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
  async function remoteJSON(url: URL, max = 128000): Promise<unknown> {
    const bytes = await remote(url, "application/json", max);
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      fail(400, "invalid_source_json");
    }
  }
  async function body(req: Request) {
    if (!req.headers.get("Content-Type")?.startsWith("application/json"))
      fail(415, "json_required");
    const reader = req.body?.getReader();
    if (!reader) fail(400, "body_required");
    let size = 0;
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader!.read();
      if (done) break;
      size += value.length;
      if (size > 12000) {
        await reader!.cancel();
        fail(413, "body_too_large");
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let p = 0;
    for (const b of parts) {
      bytes.set(b, p);
      p += b.length;
    }
    try {
      return object(JSON.parse(new TextDecoder().decode(bytes)), [
        "sourceURL",
        "residentId",
        "requestKey",
        "proof",
        "claimId",
        "expectedRevision",
        "published",
        "directoryConsent",
        "announcementConsent",
        "dreamConsent",
        "snapshotConsent",
        "rotate",
      ]);
    } catch (e) {
      if (e instanceof TowerError) throw e;
      fail(400, "invalid_json");
    }
  }
  async function authenticate(
    req: Request,
    delegated: boolean,
    mutate: boolean,
  ): Promise<Identity> {
    if (
      req.headers.get("Sec-Fetch-Site") === "cross-site" ||
      (req.headers.has("Origin") && req.headers.get("Origin") !== env.origin)
    )
      fail(403, "origin_rejected");
    if (delegated) {
      if (req.headers.has("Cookie"))
        fail(403, "use_separate_agent_authorization");
      const token = req.headers
        .get("Authorization")
        ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      if (!token) fail(401, "tower_token_required");
      const digest = await hash(token!);
      const sql =
          "SELECT account_id FROM tower_tokens WHERE token_hash=? AND revoked=0 AND expires_at>? AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value=?)",
        scope = mutate ? "tower:write" : "tower:read";
      const row = await one<{ account_id: string }>(
        sql,
        digest,
        stamp(),
        scope,
      );
      if (!row) fail(403, "tower_scope_rejected");
      return {
        accountId: row!.account_id,
        delegated: true,
        guard: async () =>
          db
            .prepare(
              "SELECT CASE WHEN EXISTS(" +
                sql +
                ") THEN 1 ELSE json('tower-auth-revoked') END",
            )
            .bind(digest, stamp(), scope),
      };
    }
    const cookie = req.headers
      .get("Cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("muse_session="))
      ?.slice(13);
    if (!cookie || !/^[a-f0-9]{64}$/.test(cookie))
      fail(401, "sign_in_required");
    const digest = await hash(cookie!),
      session = await one<{ account_id: string; csrf: string }>(
        "SELECT account_id,csrf FROM sessions WHERE token_hash=? AND expires_at>?",
        digest,
        stamp(),
      );
    if (!session) fail(401, "sign_in_required");
    // The independent operator header is checked only by the server callback. Generic account/agent bearers never mix with cookies.
    if (req.headers.has("Authorization")) fail(403, "use_explicit_agent_route");
    if (mutate) {
      if (req.headers.get("Origin") !== env.origin)
        fail(403, "origin_rejected");
      if (req.headers.get("X-CSRF-Token") !== session!.csrf)
        fail(403, "csrf_rejected");
    }
    return {
      accountId: session!.account_id,
      delegated: false,
      guard: async () =>
        db
          .prepare(
            "SELECT CASE WHEN EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND account_id=? AND expires_at>?) THEN 1 ELSE json('tower-session-expired') END",
          )
          .bind(digest, session!.account_id, stamp()),
    };
  }
  async function write(identity: Identity, statements: Statement[]) {
    try {
      await db.batch([await identity.guard(), ...statements]);
    } catch (error) {
      try {
        await (await identity.guard()).first();
      } catch {
        fail(403, "authorization_changed");
      }
      throw error;
    }
  }
  async function prior(
    identity: Identity,
    key: string,
    operation: string,
    inputHash: string,
  ) {
    const row = await one<{
      operation: string;
      input_hash: string;
      response_json: string;
    }>(
      "SELECT operation,input_hash,response_json FROM tower_requests WHERE account_id=? AND request_key=?",
      identity.accountId,
      key,
    );
    if (row && (row.operation !== operation || row.input_hash !== inputHash))
      fail(409, "idempotency_conflict");
    return row ? JSON.parse(row.response_json) : null;
  }
  const receipt = (
    identity: Identity,
    key: string,
    operation: string,
    inputHash: string,
    response: unknown,
  ) =>
    db
      .prepare(
        "INSERT INTO tower_requests(account_id,request_key,operation,input_hash,response_json,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        identity.accountId,
        key,
        operation,
        inputHash,
        JSON.stringify(response),
        stamp(),
      );
  async function snapshot(url: URL, residentId: string) {
    const site = validateTowerSnapshot(await remoteJSON(url), residentId),
      images: {
        purpose: "home" | "dream";
        bytes: Uint8Array;
        digest: string;
      }[] = [];
    for (const purpose of (site.dream ? ["home", "dream"] : ["home"]) as (
      | "home"
      | "dream"
    )[]) {
      const imageURL = new URL(`./assets/${purpose}.png`, url);
      const bytes = await cleanPNG(
        await remote(imageURL, "image/png", 8 * 1024 * 1024),
        purpose,
      );
      images.push({ purpose, bytes, digest: await hash(bytes) });
    }
    return { site, images };
  }
  function snapshotStatements(
    roomId: string,
    rev: number,
    data: Awaited<ReturnType<typeof snapshot>>,
    digest: string,
  ) {
    const statements = [
      db
        .prepare(
          "INSERT INTO tower_snapshots(room_id,revision,public_json,content_digest,created_at) VALUES(?,?,?,?,?)",
        )
        .bind(roomId, rev, JSON.stringify(data.site), digest, stamp()),
    ];
    for (const im of data.images)
      for (let p = 0; p < im.bytes.length; p += 524288)
        statements.push(
          db
            .prepare(
              "INSERT INTO tower_asset_chunks(room_id,revision,purpose,sequence,data,digest) VALUES(?,?,?,?,?,?)",
            )
            .bind(
              roomId,
              rev,
              im.purpose,
              p / 524288,
              im.bytes.slice(p, p + 524288).buffer,
              im.digest,
            ),
        );
    return statements;
  }
  async function change(roomId: string) {
    try {
      await env.onChange?.(roomId);
    } catch {
      /* The committed publication remains authoritative; community rebuild is independently recoverable. */
    }
  }
  async function publicState(roomId: string) {
    return one<Residency>(
      "SELECT * FROM tower_residencies WHERE room_id=? AND public_revision IS NOT NULL AND snapshot_consent=1",
      roomId,
    );
  }
  async function getSite(r: Residency, publicView = true) {
    const row = await one<{ public_json: string }>(
      "SELECT public_json FROM tower_snapshots WHERE room_id=? AND revision=?",
      r.room_id,
      publicView ? r.public_revision : r.revision,
    );
    if (!row) fail(404, "home_not_found");
    const site = JSON.parse(row!.public_json) as PublicCondoSite;
    if (publicView && !r.dream_consent) {
      site.dream = null;
      site.home.dreams = [];
    }
    return site;
  }
  function rendered(
    site: PublicCondoSite,
    page: CondoPage,
    r: Residency,
    rev: number,
    privatePrefix?: string,
  ) {
    const base = privatePrefix
        ? privatePrefix + "/preview/home"
        : `/home/${r.room_id}`,
      assets = privatePrefix
        ? `${privatePrefix}/assets/${rev}`
        : `/api/v1/tower/assets/${r.room_id}/${rev}`;
    return renderCondo(site, page)
      .replaceAll("./index.html", base)
      .replaceAll(
        "./inside.html",
        privatePrefix ? privatePrefix + "/preview/inside" : base + "/inside",
      )
      .replaceAll(
        "./dreams.html",
        privatePrefix ? privatePrefix + "/preview/dreams" : base + "/dreams",
      )
      .replaceAll("./assets/home.png", assets + "/home.png")
      .replaceAll("./assets/dream.png", assets + "/dream.png")
      .replaceAll("./assets/condo.css", "/condo-template.css");
  }
  return {
    async fetch(req: Request): Promise<Response | null> {
      const url = new URL(req.url),
        path = url.pathname.replace(/\/$/, "");
      const owner = path.match(
          /^\/api\/v1\/(me|agent)\/tower-intake(?:\/(.*))?$/,
        ),
        home = path.match(/^\/home\/([a-f0-9]{16})(?:\/(inside|dreams))?$/),
        pub = path.match(/^\/api\/v1\/tower\/rooms\/([a-f0-9]{16})$/),
        asset = path.match(
          /^\/api\/v1\/tower\/assets\/([a-f0-9]{16})\/([1-9][0-9]*)\/(home|dream)\.png$/,
        );
      if (!owner && !home && !pub && !asset) return null;
      try {
        if (url.origin !== env.origin) fail(403, "host_rejected");
        if (!env.localTest && url.protocol !== "https:")
          fail(400, "https_required");
        if (home || pub || asset) {
          if (!["GET", "HEAD"].includes(req.method))
            fail(405, "method_not_allowed");
          const roomId = (home ?? pub ?? asset)![1];
          if (
            home &&
            !(await one(
              "SELECT room_id FROM tower_residencies WHERE room_id=?",
              roomId,
            ))
          )
            return null;
          const r = await publicState(roomId);
          if (!r) fail(404, "home_not_found");
          if (asset) {
            if (
              Number(asset[2]) !== r!.public_revision ||
              (asset[3] === "dream" && !r!.dream_consent)
            )
              fail(404, "asset_not_found");
            const chunks = await all<{
              data: ArrayBuffer | Uint8Array;
              digest: string;
            }>(
              "SELECT data,digest FROM tower_asset_chunks WHERE room_id=? AND revision=? AND purpose=? ORDER BY sequence",
              roomId,
              r!.public_revision,
              asset[3],
            );
            if (!chunks.length) fail(404, "asset_not_found");
            const parts = chunks.map((c) => new Uint8Array(c.data)),
              bytes = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
            let p = 0;
            for (const b of parts) {
              bytes.set(b, p);
              p += b.length;
            }
            return new Response(req.method === "HEAD" ? null : bytes, {
              headers: {
                "Content-Type": "image/png",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
              },
            });
          }
          const site = await getSite(r!);
          if (pub) {
            site.home.id = roomId;
            site.home.routes = {
              home: `/home/${roomId}`,
              inside: `/home/${roomId}/inside`,
              dreams: `/home/${roomId}/dreams`,
            };
            site.home.assets.desktop = `/api/v1/tower/assets/${roomId}/${r!.public_revision}/home.png`;
            if (site.dream) {
              site.dream.image.src = `/api/v1/tower/assets/${roomId}/${r!.public_revision}/dream.png`;
              site.home.dreams = site.home.dreams.map((d) => ({
                ...d,
                image: site.dream!.image.src,
              }));
            }
            return json({ roomId, revision: r!.public_revision, site });
          }
          const page = (home![2] ?? "home") as CondoPage;
          return new Response(
            req.method === "HEAD"
              ? null
              : rendered(site, page, r!, r!.public_revision!),
            {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Content-Security-Policy":
                  "default-src 'none'; img-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
              },
            },
          );
        }
        const route = owner![2] ?? "",
          identity = await authenticate(
            req,
            owner![1] === "agent",
            !["GET", "HEAD"].includes(req.method),
          ),
          accountId = identity.accountId,
          r = await residency(accountId);
        if (route === "" && req.method === "GET")
          return json({ intake: r ? safe(r) : null });
        if (route === "preview" && req.method === "GET") {
          if (!r) fail(404, "no_home");
          const site = await getSite(r!, false),
            prefix = `/api/v1/${identity.delegated ? "agent" : "me"}/tower-intake`;
          site.home.assets.desktop = `${prefix}/assets/${r.revision}/home.png`;
          site.home.routes = {
            home: prefix + "/preview/home",
            inside: prefix + "/preview/inside",
            dreams: prefix + "/preview/dreams",
          };
          if (site.dream) {
            site.dream.image.src = `${prefix}/assets/${r.revision}/dream.png`;
            site.home.dreams = site.home.dreams.map((d) => ({
              ...d,
              image: site.dream!.image.src,
            }));
          }
          return json({ intake: safe(r!), site });
        }
        const privateAsset = route.match(
          /^assets\/([1-9][0-9]*)\/(home|dream)\.png$/,
        );
        if (privateAsset && req.method === "GET") {
          if (!r || Number(privateAsset[1]) !== r.revision)
            fail(404, "asset_not_found");
          const chunks = await all<{ data: ArrayBuffer | Uint8Array }>(
            "SELECT data FROM tower_asset_chunks WHERE room_id=? AND revision=? AND purpose=? ORDER BY sequence",
            r.room_id,
            r.revision,
            privateAsset[2],
          );
          if (!chunks.length) fail(404, "asset_not_found");
          const parts = chunks.map((c) => new Uint8Array(c.data)),
            bytes = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
          let p = 0;
          for (const b of parts) {
            bytes.set(b, p);
            p += b.length;
          }
          return new Response(bytes, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
              "Referrer-Policy": "no-referrer",
            },
          });
        }
        const privatePage = route.match(/^preview\/(home|inside|dreams)$/);
        if (privatePage && req.method === "GET") {
          if (!r) fail(404, "no_home");
          return new Response(
            rendered(
              await getSite(r!, false),
              privatePage[1] as CondoPage,
              r!,
              r!.revision,
              `/api/v1/${identity.delegated ? "agent" : "me"}/tower-intake`,
            ),
            {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy":
                  "default-src 'none'; img-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
              },
            },
          );
        }

        if (route === "tokens" && req.method === "POST") {
          if (identity.delegated) fail(403, "owner_session_required");
          await body(req);
          const token = random(),
            tokenId = random(16),
            expiresAt = new Date(now().getTime() + 30 * 86400000).toISOString();
          await write(identity, [
            db
              .prepare("UPDATE tower_tokens SET revoked=1 WHERE account_id=?")
              .bind(accountId),
            db
              .prepare(
                "INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)",
              )
              .bind(
                tokenId,
                accountId,
                await hash(token),
                '["tower:read","tower:write"]',
                expiresAt,
                stamp(),
              ),
            audit(
              accountId,
              r?.room_id ?? null,
              "token-rotated",
              r?.revision ?? null,
            ),
          ]);
          return json(
            {
              id: tokenId,
              token,
              expiresAt,
              scopes: ["tower:read", "tower:write"],
            },
            201,
          );
        }
        if (/^tokens\/[a-f0-9]{32}$/.test(route) && req.method === "DELETE") {
          if (identity.delegated) fail(403, "owner_session_required");
          await write(identity, [
            db
              .prepare(
                "UPDATE tower_tokens SET revoked=1 WHERE id=? AND account_id=?",
              )
              .bind(route.slice(7), accountId),
            audit(
              accountId,
              r?.room_id ?? null,
              "token-revoked",
              r?.revision ?? null,
            ),
          ]);
          return json({ revoked: true });
        }
        if (route === "prepare" && req.method === "POST") {
          const input = await body(req),
            sourceURL = source(input.sourceURL).href,
            residentId = id(input.residentId),
            key = requestKey(input.requestKey),
            inputHash = await hash(JSON.stringify({ sourceURL, residentId })),
            duplicate = await prior(identity, key, "prepare", inputHash);
          if (duplicate) return json(duplicate, 201);
          const claimId = random(16),
            challenge = random(),
            expiresAt = new Date(now().getTime() + 3600000).toISOString(),
            claim = {
              version: 1,
              tower: env.origin,
              residentId,
              challenge,
              expiresAt,
            },
            result = {
              claimId,
              claimURL: new URL("./muse-tower-claim.json", sourceURL).href,
              claim,
            };
          await write(identity, [
            db
              .prepare(
                "INSERT INTO tower_claims(id,account_id,resident_id,source_url,challenge,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
              )
              .bind(
                claimId,
                accountId,
                residentId,
                sourceURL,
                challenge,
                expiresAt,
                stamp(),
              ),
            receipt(identity, key, "prepare", inputHash, result),
            audit(accountId, null, "claim-prepared", null),
          ]);
          return json(result, 201);
        }
        if (route === "claim" && req.method === "POST") {
          const input = await body(req),
            claim = await one<Claim>(
              "SELECT * FROM tower_claims WHERE id=? AND account_id=? AND expires_at>?",
              id(input.claimId),
              accountId,
              stamp(),
            );
          if (!claim) fail(403, "claim_rejected");
          const expected = {
              version: 1,
              tower: env.origin,
              residentId: claim!.resident_id,
              challenge: claim!.challenge,
              expiresAt: claim!.expires_at,
            },
            remoteClaim = object(
              await remoteJSON(
                new URL("./muse-tower-claim.json", source(claim!.source_url)),
                4096,
              ),
              Object.keys(expected),
            );
          if (Object.entries(expected).some(([k, v]) => remoteClaim[k] !== v))
            fail(403, "claim_rejected");
          await write(identity, [
            db
              .prepare(
                "SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_claims WHERE id=? AND expires_at>?) THEN 1 ELSE json('claim-expired') END",
              )
              .bind(claim!.id, stamp()),
            db
              .prepare(
                "UPDATE tower_claims SET verified=1 WHERE id=? AND account_id=?",
              )
              .bind(claim!.id, accountId),
            audit(accountId, null, "claim-verified", null),
          ]);
          return json({ verified: true, claimId: claim!.id });
        }
        if (
          (route === "import" || route === "snapshot") &&
          req.method === "POST"
        ) {
          const input = await body(req),
            updating = route === "snapshot";
          if (updating && !r) fail(404, "no_home");
          const sourceURL = updating
              ? source(r!.source_url)
              : source(input.sourceURL),
            residentId = updating ? r!.resident_id : id(input.residentId),
            key = requestKey(input.requestKey),
            expected = updating ? revision(input.expectedRevision) : null,
            proof = updating ? r!.proof_method : input.proof;
          if (!["challenge", "owner-attested"].includes(String(proof)))
            fail(400, "proof_required");
          const inputHash = await hash(
              JSON.stringify({
                sourceURL: sourceURL.href,
                residentId,
                expected,
                proof,
              }),
            ),
            duplicate = await prior(identity, key, route, inputHash);
          if (duplicate) return json(duplicate, 201);
          if (r && !updating) {
            if (r.resident_id !== residentId || r.source_url !== sourceURL.href)
              fail(409, "resident_identity_locked");
            const result = {
              roomId: r.room_id,
              door: `/home/${r.room_id}`,
              residentId: r.resident_id,
              sourceURL: r.source_url,
              revision: r.revision,
              proofMethod: r.proof_method,
              published: r.public_revision !== null,
            };
            await write(identity, [
              receipt(identity, key, route, inputHash, result),
            ]);
            return json(result, 201);
          }
          if (updating && r!.revision !== expected)
            fail(409, "revision_conflict");
          if (!updating) {
            if (
              await one(
                "SELECT room_id FROM tower_residencies WHERE resident_id=? OR source_url=?",
                residentId,
                sourceURL.href,
              )
            )
              fail(409, "resident_already_claimed");
            if (await one("SELECT id FROM rooms WHERE account_id=?", accountId))
              fail(409, "account_already_has_home");
            if (proof === "owner-attested") {
              if (
                identity.delegated ||
                !(await env.ownerAttestation?.(req, accountId, sourceURL.href))
              )
                fail(403, "owner_attestation_required");
            } else if (
              !(await one(
                "SELECT id FROM tower_claims WHERE account_id=? AND resident_id=? AND source_url=? AND verified=1 AND expires_at>?",
                accountId,
                residentId,
                sourceURL.href,
                stamp(),
              ))
            )
              fail(403, "verified_claim_required");
          }
          const data = await snapshot(sourceURL, residentId),
            roomId = r?.room_id ?? random(8),
            rev = (r?.revision ?? 0) + 1,
            result = {
              roomId,
              door: `/home/${roomId}`,
              residentId,
              sourceURL: sourceURL.href,
              revision: rev,
              proofMethod: proof,
              published: false,
            },
            statements: Statement[] = [];
          if (updating)
            statements.push(
              db
                .prepare(
                  "SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_residencies WHERE room_id=? AND account_id=? AND revision=?) THEN 1 ELSE json('tower-revision-conflict') END",
                )
                .bind(roomId, accountId, expected),
              db
                .prepare(
                  "UPDATE tower_residencies SET revision=?,updated_at=? WHERE room_id=?",
                )
                .bind(rev, stamp(), roomId),
            );
          else {
            if (proof === "challenge")
              statements.push(
                db
                  .prepare(
                    "SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_claims WHERE account_id=? AND resident_id=? AND source_url=? AND verified=1 AND expires_at>?) THEN 1 ELSE json('tower-claim-expired') END",
                  )
                  .bind(accountId, residentId, sourceURL.href, stamp()),
              );
            statements.push(
              db
                .prepare(
                  "INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES(?,?,?,?,?,0,'external-ready',?,?)",
                )
                .bind(
                  roomId,
                  accountId,
                  data.site.home.name,
                  data.site.home.intro,
                  "resident",
                  stamp(),
                  env.localTest ? 1 : 0,
                ),
              db
                .prepare(
                  "INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                )
                .bind(
                  roomId,
                  accountId,
                  residentId,
                  sourceURL.href,
                  proof,
                  rev,
                  stamp(),
                  stamp(),
                ),
            );
          }
          statements.push(
            ...snapshotStatements(
              roomId,
              rev,
              data,
              await hash(JSON.stringify(data.site)),
            ),
            receipt(identity, key, route, inputHash, result),
            audit(
              accountId,
              roomId,
              updating ? "snapshot-imported" : "resident-imported",
              rev,
              { proofMethod: proof },
            ),
          );
          try {
            await write(identity, statements);
          } catch (error) {
            if (error instanceof TowerError) throw error;
            const retry = await prior(identity, key, route, inputHash);
            if (retry) return json(retry, 201);
            fail(409, "revision_or_identity_conflict");
          }
          return json(result, 201);
        }
        if (route === "publication" && req.method === "POST") {
          if (!r) fail(404, "no_home");
          const input = await body(req),
            expected = revision(input.expectedRevision);
          if (r!.revision !== expected) fail(409, "revision_conflict");
          for (const k of [
            "published",
            "directoryConsent",
            "announcementConsent",
            "dreamConsent",
            "snapshotConsent",
          ])
            if (typeof input[k] !== "boolean")
              fail(400, "explicit_consent_required");
          const publish = input.published === true;
          if (publish && !input.snapshotConsent)
            fail(400, "snapshot_consent_required");
          if(r!.public_revision===(publish?expected:null)&&r!.directory_consent===(publish&&input.directoryConsent?1:0)&&r!.announcement_consent===(publish&&input.announcementConsent?1:0)&&r!.dream_consent===(publish&&input.dreamConsent?1:0)&&r!.snapshot_consent===(publish?1:0))return json({intake:safe(r!)});
          const site = await getSite(r!, false);
          if (publish && input.dreamConsent && !site.dream)
            fail(400, "no_public_dream");
          await write(identity, [
            db
              .prepare(
                "SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_residencies WHERE room_id=? AND account_id=? AND revision=?) THEN 1 ELSE json('tower-revision-conflict') END",
              )
              .bind(r!.room_id, accountId, expected),
            db
              .prepare(
                "UPDATE tower_residencies SET public_revision=?,directory_consent=?,announcement_consent=?,dream_consent=?,snapshot_consent=?,updated_at=?,published_at=?,publication_epoch=publication_epoch+1 WHERE room_id=?",
              )
              .bind(
                publish ? expected : null,
                publish && input.directoryConsent ? 1 : 0,
                publish && input.announcementConsent ? 1 : 0,
                publish && input.dreamConsent ? 1 : 0,
                publish ? 1 : 0,
                stamp(),
                stamp(),
                r!.room_id,
              ),
            db
              .prepare("UPDATE rooms SET name=?,intro=?,published=? WHERE id=?")
              .bind(
                site.home.name,
                site.home.intro,
                publish && input.directoryConsent ? 1 : 0,
                r!.room_id,
              ),
            db.prepare("DELETE FROM community_current"),
            db.prepare("INSERT INTO manager_events(id,room_id,created_at) VALUES(?,?,?)").bind(random(16),r!.room_id,stamp()),
            audit(
              accountId,
              r!.room_id,
              publish ? "published" : "withdrawn",
              expected,
              {
                directoryConsent: publish && input.directoryConsent,
                announcementConsent: publish && input.announcementConsent,
                dreamConsent: publish && input.dreamConsent,
                snapshotConsent: publish,
              },
            ),
          ]);
          await change(r!.room_id);
          return json({ intake: safe((await residency(accountId))!) });
        }
        fail(405, "method_not_allowed");
      } catch (e) {
        if (e instanceof TowerError) return json({ error: e.code }, e.status);
        return json({ error: "tower_operation_unavailable" }, 503);
      }
    },
  };
}
