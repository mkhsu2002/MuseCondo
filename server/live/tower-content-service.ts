import type { TowerIntakeRepository } from './tower-intake-repository.ts';
import type { createTowerIntakeAuthorization } from './tower-intake-auth.ts';
import type { TowerIntakeRequest } from './tower-intake-request.ts';
import type { Residency, Identity } from './tower-intake-types.ts';
import { fail, revision, requestKey, object, TowerError, validateTowerSnapshot, id, string, date } from './tower-contract.ts';
import type { PublicCondoSite } from '../../src/framework/condo.ts';
import { hash } from './tower-crypto.ts';
import { cloneAssetStatements, readTowerAsset } from './tower-asset-storage.ts';
import { cleanPNG } from './tower-source-reader.ts';
type Authorization = Pick<ReturnType<typeof createTowerIntakeAuthorization>, 'write'>;
type JSONResponse = (value: unknown, status?: number) => Response;
/** Each branch builds a full command batch; authorization owns the single commit. */
export function createTowerContentService(ports: {
    repository: TowerIntakeRepository;
    authorization: Authorization;
    request: TowerIntakeRequest;
    json: JSONResponse;
}) {
    const { db, stamp, prior, receipt, audit, residency, getSite, snapshotStatements, safe } = ports.repository;
    const { write } = ports.authorization;
    const { body, dreamBody } = ports.request;
    const { json } = ports;
    return async function contentCommand(req: Request, route: string, identity: Identity, r: Residency | null): Promise<Response | null> {
        const accountId = identity.accountId;
        if ((route === "content" || route === "content/validate") && req.method === "POST") {
            if (!r)
                fail(404, "no_home");
            const validationOnly = route === "content/validate";
            let input: Record<string, unknown>, expected: number, key: string, content: Record<string, unknown>;
            try {
                input = await body(req, ["expectedRevision", "requestKey", "content"], 12000, "request");
                expected = revision(input.expectedRevision);
                key = requestKey(input.requestKey);
                content = object(input.content, ["intro", "profile", "daily"], "content");
                if (!Object.keys(content).length)
                    fail(400, "content_required", { path: "content", reason: "at_least_one_field_required" });
            }
            catch (error) {
                if (error instanceof TowerError)
                    error.validation = { ...(error.validation ?? { path: error.code === "expected_revision_required" ? "request.expectedRevision" : error.code === "idempotency_key_required" ? "request.requestKey" : "request", reason: error.code }), stage: "request" };
                throw error;
            }
            const inputHash = await hash(JSON.stringify({ expected, content }));
            if (!validationOnly) {
                const replay = await prior(identity, key, "content", inputHash);
                if (replay)
                    return json(replay, 201);
            }
            if (r!.revision !== expected)
                fail(409, "revision_conflict");
            const previous = await getSite(r!, false);
            try {
                validateTowerSnapshot(previous, r!.resident_id);
            }
            catch (error) {
                if (error instanceof TowerError)
                    fail(409, "stored_snapshot_invalid", { ...(error.validation ?? { path: "snapshot", reason: error.code }), stage: "stored_snapshot" });
                throw error;
            }
            let site: PublicCondoSite;
            try {
                site = validateTowerSnapshot({
                    ...previous, home: {
                        ...previous.home, ...(content.intro === undefined ? {} : { intro: content.intro }), ...(content.daily === undefined ? {} : { daily: content.daily })
                    }, ...(content.profile === undefined ? {} : { profile: content.profile })
                }, r!.resident_id);
            }
            catch (error) {
                if (error instanceof TowerError) {
                    const detail = error.validation ?? { path: "snapshot", reason: error.code };
                    error.validation = {
                        ...detail, path: detail.path.replace(/^snapshot\.home\.(daily|intro)/, "content.$1").replace(/^snapshot\.profile/, "content.profile"), stage: "content"
                    };
                }
                throw error;
            }
            if (validationOnly)
                return json({
                    valid: true, baseRevision: expected, changedFields: Object.keys(content).filter(field => JSON.stringify(field === "profile" ? previous.profile : previous.home[field as "intro" | "daily"]) !== JSON.stringify(content[field]))
                });
            const rev = expected + 1;
            const result = {
                roomId: r!.room_id, door: `/home/${r!.room_id}`, residentId: r!.resident_id, revision: rev, published: false
            };
            try {
                await write(identity, [
                    db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_residencies WHERE room_id=? AND account_id=? AND revision=?) THEN 1 ELSE json('tower-revision-conflict') END").bind(r!.room_id, accountId, expected),
                    db.prepare("INSERT INTO tower_snapshots(room_id,revision,public_json,content_digest,created_at) VALUES(?,?,?,?,?)").bind(r!.room_id, rev, JSON.stringify(site), await hash(JSON.stringify(site)), stamp()),
                    ...await cloneAssetStatements(db, r!.room_id, expected, rev, site.dream ? ["home", "dream"] : ["home"]),
                    db.prepare("UPDATE tower_residencies SET revision=?,updated_at=? WHERE room_id=? AND account_id=? AND revision=?").bind(rev, stamp(), r!.room_id, accountId, expected),
                    receipt(identity, key, "content", inputHash, result), audit(accountId, r!.room_id, "resident-content-updated", rev, { fields: Object.keys(content) }),
                ]);
            }
            catch (error) {
                if (error instanceof TowerError)
                    throw error;
                const saved = await prior(identity, key, "content", inputHash);
                if (saved)
                    return json(saved, 201);
                const latest = await residency(accountId);
                if (latest?.revision !== expected)
                    fail(409, "revision_conflict");
                fail(503, "tower_storage_unavailable");
            }
            return json(result, 201);
        }
        if (route === "dream" && req.method === "POST") {
            if (!r)
                fail(404, "no_home");
            const { input, image } = await dreamBody(req), expected = revision(input.expectedRevision), key = requestKey(input.requestKey);
            if (input.sourceAuthorized !== true)
                fail(400, "source_authorization_required");
            let dream: PublicCondoSite["dream"] = null;
            if (input.dream !== null) {
                const d = object(input.dream, [
                    "id",
                    "title",
                    "body",
                    "wish",
                    "occurredAt",
                    "reflection",
                    "image",
                ]), im = object(d.image, ["alt"]);
                dream = {
                    id: id(d.id),
                    title: string(d.title, 120),
                    body: string(d.body, 5000),
                    wish: string(d.wish),
                    occurredAt: date(d.occurredAt),
                    ...(d.reflection === undefined
                        ? {}
                        : { reflection: string(d.reflection) }),
                    image: { src: "./assets/dream.png", alt: string(im.alt, 500) },
                };
            }
            else if (image !== null)
                fail(400, "unexpected_dream_image");
            const inputHash = await hash(JSON.stringify({
                expected,
                dream,
                sourceAuthorized: true,
                imageDigest: image === null ? null : await hash(image),
            })), replay = await prior(identity, key, "dream", inputHash);
            if (replay)
                return json(replay, 201);
            if (r!.revision !== expected)
                fail(409, "revision_conflict");
            const previous = await getSite(r!, false);
            if (dream &&
                image === null &&
                (!previous.dream ||
                    !(await readTowerAsset(db, r!.room_id, expected, "dream"))))
                fail(400, "dream_image_required");
            const site = validateTowerSnapshot({
                ...previous,
                dream,
                home: {
                    ...previous.home,
                    dreams: dream
                        ? [
                            {
                                id: dream.id,
                                type: "dream",
                                title: dream.title,
                                body: dream.body,
                                occurredAt: dream.occurredAt,
                                image: "./assets/dream.png",
                                ...(dream.reflection === undefined
                                    ? {}
                                    : { reflection: dream.reflection }),
                            },
                        ]
                        : [],
                },
            }, r!.resident_id), rev = expected + 1, cleaned = image === null ? null : await cleanPNG(image, "dream"), result = {
                roomId: r!.room_id,
                door: `/home/${r!.room_id}`,
                residentId: r!.resident_id,
                revision: rev,
                published: false,
            };
            const retainedHome = await readTowerAsset(db, r!.room_id, expected, "home"), retainedDream = dream !== null && cleaned === null ? await readTowerAsset(db, r!.room_id, expected, "dream") : null;
            if ((retainedHome?.size ?? 0) + (dream === null ? 0 : cleaned?.length ?? retainedDream?.size ?? 0) > 12 * 1024 * 1024)
                fail(413, "source_images_too_large");
            const statements = [
                db
                    .prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_residencies WHERE room_id=? AND account_id=? AND revision=?) THEN 1 ELSE json('tower-revision-conflict') END")
                    .bind(r!.room_id, accountId, expected),
                ...await snapshotStatements(r!.room_id, rev, {
                    site,
                    images: cleaned === null
                        ? []
                        : [
                            {
                                purpose: "dream",
                                bytes: cleaned,
                                digest: await hash(cleaned),
                            },
                        ],
                }, await hash(JSON.stringify(site))),
                ...await cloneAssetStatements(db, r!.room_id, expected, rev, dream !== null && cleaned === null ? ["home", "dream"] : ["home"]),
                db
                    .prepare("UPDATE tower_residencies SET revision=?,updated_at=? WHERE room_id=? AND account_id=? AND revision=?")
                    .bind(rev, stamp(), r!.room_id, accountId, expected),
                receipt(identity, key, "dream", inputHash, result),
                audit(accountId, r!.room_id, "resident-dream-updated", rev, {
                    sourceAuthorized: true,
                    removed: dream === null,
                    imageReplaced: cleaned !== null,
                }),
            ];
            try {
                await write(identity, statements);
            }
            catch (error) {
                if (error instanceof TowerError)
                    throw error;
                const saved = await prior(identity, key, "dream", inputHash);
                if (saved)
                    return json(saved, 201);
                if ((await residency(accountId))?.revision !== expected)
                    fail(409, "revision_conflict");
                fail(503, "tower_storage_unavailable");
            }
            return json(result, 201);
        }
        if (route === "dream/visibility" && req.method === "POST") {
            if (!r)
                fail(404, "no_home");
            const input = await body(req, ["expectedRevision", "dreamConsent"]), expected = revision(input.expectedRevision);
            if (typeof input.dreamConsent !== "boolean")
                fail(400, "explicit_consent_required");
            if (r!.revision !== expected)
                fail(409, "revision_conflict");
            if (input.dreamConsent) {
                if (r!.public_revision !== expected || !r!.snapshot_consent)
                    fail(409, "publish_draft_first");
                if (!(await getSite(r!, false)).dream ||
                    !(await readTowerAsset(db, r!.room_id, expected, "dream")))
                    fail(400, "no_public_dream");
            }
            if (!!r!.dream_consent === input.dreamConsent)
                return json({ intake: safe(r!) });
            try {
                await write(identity, [
                    // A concurrent publication must not make a visibility approval apply
                    // to a different public snapshot while retaining the same revision.
                    db
                        .prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_residencies WHERE room_id=? AND account_id=? AND revision=? AND public_revision IS ? AND dream_consent=?) THEN 1 ELSE json('tower-revision-conflict') END")
                        .bind(r!.room_id, accountId, expected, r!.public_revision, r!.dream_consent),
                    db
                        .prepare("UPDATE tower_residencies SET dream_consent=?,updated_at=? WHERE room_id=?")
                        .bind(input.dreamConsent ? 1 : 0, stamp(), r!.room_id),
                    audit(accountId, r!.room_id, "dream-visibility-updated", expected, {
                        dreamConsent: input.dreamConsent,
                    }),
                ]);
            }
            catch (error) {
                if (error instanceof TowerError)
                    throw error;
                const latest = await residency(accountId);
                if (latest?.revision !== expected ||
                    latest.public_revision !== r!.public_revision ||
                    latest.dream_consent !== r!.dream_consent)
                    fail(409, "revision_conflict");
                fail(503, "tower_storage_unavailable");
            }
            return json({ intake: safe((await residency(accountId))!) });
        }
        return null;
    };
}
