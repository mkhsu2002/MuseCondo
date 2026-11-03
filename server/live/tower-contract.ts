import { CONDO_PROFILE_FIELDS, CONDO_OPTIONAL_PROFILE_FIELDS, CONDO_PORTRAIT_CROP_FIELDS, parsePortraitCrop, CONDO_ALL_PROFILE_FIELDS, type PublicCondoSite, } from "../../src/framework/condo.ts";
import type { PublicDailyEntry } from "../../src/framework/types.ts";
export interface SnapshotValidation {
    path: string;
    reason: string;
    stage?: "request" | "stored_snapshot" | "content";
}
export class TowerError extends Error {
    status: number;
    code: string;
    validation?: SnapshotValidation;
    constructor(status: number, code: string, validation?: SnapshotValidation) {
        super(code);
        this.status = status;
        this.code = code;
        this.validation = validation;
    }
}
export function fail(status: number, code: string, validation?: SnapshotValidation): never {
    throw new TowerError(status, code, validation);
}
export function object(v: unknown, keys: readonly string[], path = "snapshot"): Record<string, unknown> {
    if (!v || typeof v !== "object" || Array.isArray(v))
        fail(400, "invalid_public_snapshot", { path, reason: "object_required" });
    if (Object.keys(v).some(k => !keys.includes(k)))
        fail(400, "invalid_public_snapshot", { path, reason: "unsupported_fields" });
    return v as Record<string, unknown>;
}
export function string(v: unknown, max = 2000, path = "snapshot"): string {
    if (typeof v !== "string" || !v.trim())
        fail(400, "invalid_public_snapshot", { path, reason: "nonempty_string_required" });
    if ((v as string).length > max)
        fail(400, "invalid_public_snapshot", { path, reason: "string_too_long" });
    if (Array.from(v as string).some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0))))
        fail(400, "invalid_public_snapshot", { path, reason: "control_characters_not_allowed" });
    return v as string;
}
export function id(v: unknown, path = "snapshot") {
    const value = string(v, 64, path);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value))
        fail(400, "invalid_identity", { path, reason: "invalid_id" });
    return value;
}
export function revision(v: unknown) {
    if (!Number.isSafeInteger(v) || (v as number) < 1)
        fail(400, "expected_revision_required");
    return v as number;
}
export function requestKey(v: unknown) {
    const s = string(v, 80);
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(s))
        fail(400, "idempotency_key_required");
    return s;
}
export function date(v: unknown, path = "snapshot") {
    const s = string(v, 40, path);
    if (!/^\d{4}-\d\d-\d\dT/.test(s) || !Number.isFinite(Date.parse(s)))
        fail(400, "invalid_public_snapshot", { path, reason: "datetime_required" });
    return s;
}
/** Validate the versioned public projection, including native HTML mapped by the source adapter. */
export function validateTowerSnapshot(value: unknown, residentId: string): PublicCondoSite {
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
    if (assets.desktop !== "./assets/home.png")
        fail(400, "invalid_image_source");
    const routes = object(home.routes, ["home", "inside", "dreams"]);
    if (routes.home !== "./index.html" ||
        routes.inside !== "./inside.html" ||
        routes.dreams !== "./dreams.html")
        fail(400, "unsupported_public_snapshot");
    const profile = object(root.profile, CONDO_ALL_PROFILE_FIELDS, "snapshot.profile"), projected = Object.fromEntries(CONDO_PROFILE_FIELDS.map((k) => [k, string(profile[k], 2000, "snapshot.profile." + k)])) as PublicCondoSite["profile"];
    for (const key of CONDO_OPTIONAL_PROFILE_FIELDS)
        if (profile[key] !== undefined)
            projected[key] = string(profile[key], 2000, "snapshot.profile." + key);
    for (const key of CONDO_PORTRAIT_CROP_FIELDS)
        if (projected[key] !== undefined) {
            try {
                parsePortraitCrop(projected[key]);
            }
            catch {
                fail(400, "invalid_portrait_crop");
            }
        }
    if (!Array.isArray(home.daily) ||
        home.daily.length > 100 ||
        !Array.isArray(home.dreams) ||
        home.dreams.length > 1)
        fail(400, "invalid_public_snapshot");
    const daily = home.daily.map((v, index): PublicDailyEntry => {
        const path = "snapshot.home.daily[" + index + "]", e = object(v, [
            "id", "type", "title", "body", "occurredAt"
        ], path);
        if (![
            "journal", "status", "seeking", "artwork", "observation"
        ].includes(String(e.type)))
            fail(400, "invalid_public_snapshot", { path: path + ".type", reason: "unsupported_entry_type" });
        return {
            id: id(e.id, path + ".id"),
            type: e.type as PublicDailyEntry["type"],
            title: string(e.title, 120, path + ".title"),
            body: string(e.body, 5000, path + ".body"),
            occurredAt: date(e.occurredAt, path + ".occurredAt"),
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
        ]), im = object(d.image, ["src", "alt"]);
        if (im.src !== "./assets/dream.png")
            fail(400, "invalid_image_source");
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
        if (d.type !== "dream" ||
            d.image !== "./assets/dream.png" ||
            !dream ||
            d.id !== dream.id ||
            d.title !== dream.title ||
            d.body !== dream.body ||
            d.occurredAt !== dream.occurredAt ||
            d.reflection !== dream.reflection)
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
    if (!!dream !== (dreams.length === 1))
        fail(400, "inconsistent_dream");
    const result: PublicCondoSite = {
        templateVersion: "muse-condo-1",
        home: {
            frameworkVersion: "0.01",
            id: residentId,
            name: string(home.name, 100, "snapshot.home.name"),
            intro: string(home.intro, 1000, "snapshot.home.intro"),
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
