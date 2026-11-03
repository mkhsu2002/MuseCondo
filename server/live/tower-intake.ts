import { createTowerContentService } from './tower-content-service.ts';
import { createTowerPublicationService } from './tower-publication-service.ts';
import { createTowerIntakeRequest } from './tower-intake-request.ts';
import { createTowerIntakeRepository } from "./tower-intake-repository.ts";
import { fail, TowerError, object, validateTowerSnapshot, id, revision, requestKey } from './tower-contract.ts';
export { validateTowerSnapshot } from './tower-contract.ts';
import { random, hash } from './tower-crypto.ts';
import type { Claim, Residency } from './tower-intake-types.ts';
import type { PublicCondoSite } from '../../src/framework/condo.ts';
import { createTowerSourceReader } from './tower-source-reader.ts';
import { createTowerIntakeAuthorization } from './tower-intake-auth.ts';
import { cloneAssetStatements, readTowerAsset, type AssetPurpose } from './tower-asset-storage.ts';
import { authorizedTowerAssetResponse } from './tower-asset-delivery.ts';
import { homeSourceURL, homeSourceIdentity, isMuseShareURL } from './home-source.ts';
import type { Database, Statement } from "./db.ts";
import { createTowerActivities } from "./tower-activities.ts";
import { createTowerVisits } from "./tower-visits.ts";
import type { CondoPage } from "../../src/framework/condo-render.ts";
import { renderTowerHome } from "./tower-home-render.ts";
export interface TowerIntakeEnvironment {
    db: Database;
    origin: string;
    localTest: boolean;
    sourceOrigins: string[];
    now?: () => Date;
    fetcher?: typeof fetch;
    /** Operator attestation supplements an existing authenticated cookie and CSRF. Never a public boolean. */
    ownerAttestation?: (request: Request, accountId: string, sourceURL: string) => Promise<boolean>;
    onChange?: (roomId: string) => Promise<void>;
    onProgress?: (accountId: string) => Promise<void>;
    operator?: (request: Request) => Promise<boolean>;
}
export function createTowerIntake(env: TowerIntakeEnvironment) {
    const db = env.db, now = () => env.now?.() ?? new Date(), stamp = () => now().toISOString();
    const { remoteJSON, claimProof, snapshot, nativeHome, staticHome } = createTowerSourceReader(env.fetcher);
    const authorization = createTowerIntakeAuthorization({
        db, origin: env.origin, stamp, onProgress: env.onProgress
    });
    const { authenticate, write } = authorization;
    const repository = createTowerIntakeRepository(db, stamp);
    const { one, safe, residency, audit, prior, receipt, sourceGeneration, sourceGenerationGuard, snapshotStatements, revisionGuard, storedImages, publicState, getSite } = repository;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    });
    async function source(value: unknown, accountId: string) {
        let url: URL;
        try {
            url = homeSourceURL(value);
        }
        catch {
            return fail(400, 'source_url_rejected');
        }
        if (!env.sourceOrigins.includes(url.origin)) {
            const grant = await one(`SELECT 1 FROM tower_admission_eligible d WHERE d.account_id=? AND d.source_url=? AND (
       EXISTS(SELECT 1 FROM tower_reception_cases c WHERE c.id=d.case_id AND c.account_id=d.account_id AND c.resident_id=d.resident_id AND c.source_url=d.source_url AND c.state='active' AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND c.approval_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       OR EXISTS(SELECT 1 FROM tower_residencies r WHERE r.account_id=d.account_id AND r.resident_id=d.resident_id AND r.source_url=d.source_url))`, accountId, url.href);
            // An existing household may prove control of a rotated share key for the
            // same native asset. Current admission eligibility remains required;
            // a readable native URL never authorizes a new household or another asset.
            const nativeAlias = !grant && isMuseShareURL(url.href)
                ? await one(`SELECT 1 FROM tower_admission_eligible d
          JOIN tower_residencies r ON r.account_id=d.account_id AND r.resident_id=d.resident_id
          JOIN tower_source_identities i ON i.source_url=r.source_url
          WHERE d.account_id=? AND i.source_identity=? AND (
            EXISTS(SELECT 1 FROM tower_admission_native_alias a WHERE a.decision_id=d.id AND a.account_id=r.account_id AND a.room_id=r.room_id AND a.resident_id=r.resident_id)
            OR EXISTS(SELECT 1 FROM tower_admission_continuity k WHERE k.decision_id=d.id AND k.account_id=r.account_id AND k.room_id=r.room_id AND k.resident_id=r.resident_id)
          )`, accountId, homeSourceIdentity(url.href))
                : null;
            if (!grant && !nativeAlias)
                fail(400, 'source_url_rejected');
        }
        return url;
    }
    const firstImportGrantSQL = `SELECT 1 FROM tower_admission_eligible d
    JOIN tower_reception_cases c ON c.id=d.case_id
    WHERE d.account_id=? AND d.resident_id=? AND d.source_url=?
      AND c.account_id=d.account_id AND c.resident_id=d.resident_id AND c.source_url=d.source_url
      AND c.state='active' AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND c.approval_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
    const syncGroups = [
        "intro", "profile", "daily", "home", "dream"
    ] as const;
    type SyncGroup = typeof syncGroups[number];
    function applyGroups(value: unknown): SyncGroup[] {
        if (!Array.isArray(value) || !value.length || new Set(value).size !== value.length ||
            value.some(v => !syncGroups.includes(v as SyncGroup)))
            fail(400, "source_fields_required");
        return syncGroups.filter(group => (value as unknown[]).includes(group));
    }
    async function sourceDigest(r: Residency, generation: number, data: Awaited<ReturnType<typeof snapshot>>) {
        return hash(JSON.stringify({
            sourceURL: r.source_url, sourceGeneration: generation,
            baseRevision: r.revision, site: data.site,
            images: data.images.map(image => ({ purpose: image.purpose, digest: image.digest }))
        }));
    }
    function syncValues(site: PublicCondoSite, images: {
        purpose: string;
        digest: string;
    }[]) {
        const image = (purpose: string) => images.find(i => i.purpose === purpose)?.digest ?? null;
        return {
            intro: { name: site.home.name, intro: site.home.intro },
            profile: site.profile, daily: site.home.daily,
            home: { homeAlt: site.homeAlt, imageDigest: image("home") },
            dream: {
                dream: site.dream, dreams: site.home.dreams, imageDigest: image("dream")
            },
        };
    }
    async function change(roomId: string) {
        try {
            await env.onChange?.(roomId);
        }
        catch {
            /* The committed publication remains authoritative; community rebuild is independently recoverable. */
        }
    }
    const request = createTowerIntakeRequest();
    const { body } = request;
    const contentCommand = createTowerContentService({
        repository, authorization, request, json
    });
    const publicationCommand = createTowerPublicationService({
        repository, authorization, request, json, onChange: change
    });
    const activities = createTowerActivities({
        db, origin: env.origin, operator: env.operator, stamp, random, hash, fail, body, requestKey, revision, write, prior, receipt, audit, json
    });
    const visits = createTowerVisits({
        db, stamp, random, hash, fail, body, requestKey, revision, write, prior, receipt, audit, json
    });
    return {
        async fetch(req: Request): Promise<Response | null> {
            const url = new URL(req.url), path = url.pathname.replace(/\/$/, "");
            const owner = path.match(/^\/api\/v1\/(me|agent)\/tower-intake(?:\/(.*))?$/), home = path.match(/^\/home\/([a-f0-9]{16})(?:\/(inside|dreams))?$/), publicActivities = path.match(/^\/api\/v1\/tower\/activities(?:\/([a-z0-9][a-z0-9-]{0,63}))?$/), operatorActivities = path.match(/^\/api\/v1\/operator\/tower\/activities(?:\/([a-z0-9][a-z0-9-]{0,63}))?$/), publicVisits = path.match(/^\/api\/v1\/tower\/rooms\/([a-f0-9]{16})\/visits$/), pub = path.match(/^\/api\/v1\/tower\/rooms\/([a-f0-9]{16})$/), asset = path.match(/^\/api\/v1\/tower\/assets\/([a-f0-9]{16})\/([1-9][0-9]*)\/(home|dream)\.png$/);
            if (!owner && !home && !pub && !asset && !publicVisits && !publicActivities && !operatorActivities)
                return null;
            try {
                if (url.origin !== env.origin)
                    fail(403, "host_rejected");
                if (!env.localTest && url.protocol !== "https:")
                    fail(400, "https_required");
                if (publicActivities)
                    return await activities.public(req, publicActivities[1]);
                if (operatorActivities)
                    return await activities.operator(req, operatorActivities[1]);
                if (publicVisits)
                    return await visits.publicList(req, publicVisits[1]);
                if (home || pub || asset) {
                    if (!["GET", "HEAD"].includes(req.method))
                        fail(405, "method_not_allowed");
                    const roomId = (home ?? pub ?? asset)![1];
                    if (home &&
                        !(await one("SELECT room_id FROM tower_residencies WHERE room_id=?", roomId)))
                        return null;
                    const r = await publicState(roomId);
                    if (!r)
                        fail(404, "home_not_found");
                    if (asset) {
                        if (Number(asset[2]) !== r!.public_revision ||
                            (asset[3] === "dream" && !r!.dream_consent))
                            fail(404, "asset_not_found");
                        const response = await authorizedTowerAssetResponse(req, db, roomId, r!.public_revision!, asset[3] as AssetPurpose);
                        if (!response)
                            fail(404, "asset_not_found");
                        return response;
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
                        return json({
                            roomId, revision: r!.public_revision, site
                        });
                    }
                    const page = (home![2] ?? "home") as CondoPage;
                    return new Response(req.method === "HEAD"
                        ? null
                        : renderTowerHome(site, page, {
                            kind: "public", origin: env.origin, roomId: r!.room_id, revision: r!.public_revision!
                        }, r!.source_url), {
                        headers: {
                            "Content-Type": "text/html; charset=utf-8",
                            "Cache-Control": "no-store",
                            "X-Content-Type-Options": "nosniff",
                            "Referrer-Policy": "no-referrer",
                            "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
                        },
                    });
                }
                const route = owner![2] ?? "", identity = await authenticate(req, owner![1] === "agent", !["GET", "HEAD"].includes(req.method), route === "source-preview" || route === "content/validate"), accountId = identity.accountId, r = await residency(accountId);
                if (route === "activities" || route.startsWith("activities/"))
                    return await activities.owner(req, route, identity);
                if (route === "visits" || route.startsWith("visits/"))
                    return await visits.owner(req, route, identity);
                if (route === "" && req.method === "GET")
                    return json({ intake: r ? safe(r) : null });
                if (route === "preview" && req.method === "GET") {
                    if (!r)
                        fail(404, "no_home");
                    const site = await getSite(r!, false), prefix = `/api/v1/${identity.delegated ? "agent" : "me"}/tower-intake`;
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
                    const response = json({ intake: safe(r!), site });
                    response.headers.set("X-Robots-Tag", "noindex, nofollow");
                    return response;
                }
                const privateAsset = route.match(/^assets\/([1-9][0-9]*)\/(home|dream)\.png$/);
                if (privateAsset && req.method === "GET") {
                    if (!r || Number(privateAsset[1]) !== r.revision)
                        fail(404, "asset_not_found");
                    const stored = await readTowerAsset(db, r.room_id, r.revision, privateAsset[2] as AssetPurpose);
                    if (!stored)
                        fail(404, "asset_not_found");
                    const bytes = stored!.bytes;
                    return new Response(bytes, {
                        headers: {
                            "X-Robots-Tag": "noindex, nofollow",
                            "Content-Type": "image/png",
                            "Cache-Control": "no-store",
                            "X-Content-Type-Options": "nosniff",
                            "Referrer-Policy": "no-referrer",
                        },
                    });
                }
                const privatePage = route.match(/^preview\/(home|inside|dreams)$/);
                if (privatePage && ["GET", "HEAD"].includes(req.method)) {
                    if (!r)
                        fail(404, "no_home");
                    return new Response(req.method === "HEAD" ? null : renderTowerHome(await getSite(r!, false), privatePage[1] as CondoPage, {
                        kind: "private", revision: r!.revision, prefix: `/api/v1/${identity.delegated ? "agent" : "me"}/tower-intake`
                    }, r!.source_url), {
                        headers: {
                            "Content-Type": "text/html; charset=utf-8",
                            "Cache-Control": "no-store",
                            "X-Content-Type-Options": "nosniff",
                            "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
                            "X-Robots-Tag": "noindex, nofollow",
                        },
                    });
                }
                if (route === "tokens" && req.method === "POST") {
                    if (identity.delegated)
                        fail(403, "owner_session_required");
                    await body(req);
                    const token = random(), tokenId = random(16), expiresAt = new Date(now().getTime() + 30 * 86400000).toISOString();
                    await write(identity, [
                        db
                            .prepare("UPDATE tower_tokens SET revoked=1 WHERE account_id=?")
                            .bind(accountId),
                        db
                            .prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)")
                            .bind(tokenId, accountId, await hash(token), '["tower:read","tower:write"]', expiresAt, stamp()),
                        audit(accountId, r?.room_id ?? null, "token-rotated", r?.revision ?? null),
                    ]);
                    return json({
                        id: tokenId,
                        token,
                        expiresAt,
                        scopes: ["tower:read", "tower:write"],
                    }, 201);
                }
                if (/^tokens\/[a-f0-9]{32}$/.test(route) && req.method === "DELETE") {
                    if (identity.delegated)
                        fail(403, "owner_session_required");
                    await write(identity, [
                        db
                            .prepare("UPDATE tower_tokens SET revoked=1 WHERE id=? AND account_id=?")
                            .bind(route.slice(7), accountId),
                        audit(accountId, r?.room_id ?? null, "token-revoked", r?.revision ?? null),
                    ]);
                    return json({ revoked: true });
                }
                if (route === "prepare" && req.method === "POST") {
                    const input = await body(req), sourceURL = (await source(input.sourceURL, accountId)).href, residentId = id(input.residentId), key = requestKey(input.requestKey), inputHash = await hash(JSON.stringify({ sourceURL, residentId })), duplicate = await prior(identity, key, "prepare", inputHash);
                    if (duplicate)
                        return json(duplicate, 201);
                    const claimId = random(16), challenge = random(), expiresAt = new Date(now().getTime() + 3600000).toISOString(), claim = {
                        version: 1,
                        tower: env.origin,
                        residentId,
                        challenge,
                        expiresAt,
                        ...(isMuseShareURL(sourceURL) ? { sourceIdentity: homeSourceIdentity(sourceURL) } : {}),
                    }, result = {
                        claimId,
                        claimURL: isMuseShareURL(sourceURL) ? sourceURL : new URL("./muse-tower-claim.json", sourceURL).href,
                        ...(isMuseShareURL(sourceURL) ? { claimPlacement: {
                                kind: "html-json-script", elementId: "musecondo-claim", contentType: "application/json"
                            } } : {}),
                        claim,
                    };
                    await write(identity, [
                        db
                            .prepare("INSERT INTO tower_claims(id,account_id,resident_id,source_url,challenge,expires_at,created_at) VALUES(?,?,?,?,?,?,?)")
                            .bind(claimId, accountId, residentId, sourceURL, challenge, expiresAt, stamp()),
                        receipt(identity, key, "prepare", inputHash, result),
                        audit(accountId, null, "claim-prepared", null),
                    ]);
                    return json(result, 201);
                }
                if (route === "claim" && req.method === "POST") {
                    const input = await body(req), claim = await one<Claim>("SELECT * FROM tower_claims WHERE id=? AND account_id=? AND expires_at>?", id(input.claimId), accountId, stamp());
                    if (!claim)
                        fail(403, "claim_rejected");
                    const expected = {
                        version: 1,
                        tower: env.origin,
                        residentId: claim!.resident_id,
                        challenge: claim!.challenge,
                        expiresAt: claim!.expires_at,
                        ...(isMuseShareURL(claim!.source_url) ? { sourceIdentity: homeSourceIdentity(claim!.source_url) } : {}),
                    }, remoteClaim = object(await claimProof(await source(claim!.source_url, accountId)), Object.keys(expected));
                    if (claim!.expires_at <= stamp() || Object.entries(expected).some(([k, v]) => remoteClaim[k] !== v))
                        fail(403, "claim_rejected");
                    await write(identity, [
                        db
                            .prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_claims WHERE id=? AND account_id=? AND resident_id=? AND source_url=? AND challenge=? AND expires_at=? AND expires_at>?) THEN 1 ELSE json('claim-expired') END")
                            .bind(claim!.id, accountId, claim!.resident_id, claim!.source_url, claim!.challenge, claim!.expires_at, stamp()),
                        db
                            .prepare("UPDATE tower_claims SET verified=1 WHERE id=? AND account_id=?")
                            .bind(claim!.id, accountId),
                        audit(accountId, null, "claim-verified", null),
                    ]);
                    return json({ verified: true, claimId: claim!.id });
                }
                if (route === "source" && req.method === "POST") {
                    if (!r)
                        fail(404, "no_home");
                    const input = await body(req, [
                        "expectedRevision", "requestKey", "sourceURL", "claimId",
                    ]), expected = revision(input.expectedRevision), key = requestKey(input.requestKey), sourceURL = await source(input.sourceURL, accountId), claimId = id(input.claimId),
                    // Only client input identifies the request. The old source changes on
                    // success, and must never invalidate a saved receipt on replay.
                    inputHash = await hash(JSON.stringify({
                        expected, sourceURL: sourceURL.href, claimId
                    })), replay = await prior(identity, key, "source", inputHash);
                    if (replay)
                        return json(replay);
                    if (r!.revision !== expected)
                        fail(409, "revision_conflict");
                    const generation = await sourceGeneration(accountId), claimSQL = "SELECT id FROM tower_claims WHERE id=? AND account_id=? AND resident_id=? AND source_url=? AND verified=1 AND expires_at>?", claimArgs = () => [
                        claimId, accountId, r!.resident_id, sourceURL.href, stamp()
                    ], occupied = () => isMuseShareURL(sourceURL.href)
                        ? one("SELECT r.room_id FROM tower_residencies r JOIN tower_source_identities i ON i.source_url=r.source_url WHERE i.source_identity=? AND r.room_id<>?", homeSourceIdentity(sourceURL.href), r!.room_id)
                        : one("SELECT room_id FROM tower_residencies WHERE source_url=? AND room_id<>?", sourceURL.href, r!.room_id);
                    if (!(await one(claimSQL, ...claimArgs())))
                        fail(403, "verified_claim_required");
                    if (await occupied())
                        fail(409, "source_already_claimed");
                    // Verify the fresh manifest and stable resident identity only. A move
                    // neither imports its content nor fetches/replaces any saved images.
                    validateTowerSnapshot(isMuseShareURL(sourceURL.href)
                        ? (await nativeHome(sourceURL, r!.resident_id)).site
                        : staticHome(await remoteJSON(sourceURL), r!.resident_id), r!.resident_id);
                    const result = { intake: safe({
                            ...r!, source_url: sourceURL.href, proof_method: "challenge"
                        }) };
                    try {
                        await write(identity, [
                            sourceGenerationGuard(accountId, generation),
                            db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_residencies WHERE room_id=? AND account_id=? AND resident_id=? AND revision=? AND source_url=? AND public_revision IS ? AND directory_consent=? AND announcement_consent=? AND dream_consent=? AND snapshot_consent=?) THEN 1 ELSE json('tower-source-conflict') END").bind(r!.room_id, accountId, r!.resident_id, expected, r!.source_url, r!.public_revision, r!.directory_consent, r!.announcement_consent, r!.dream_consent, r!.snapshot_consent),
                            db.prepare("SELECT CASE WHEN EXISTS(" + claimSQL + ") THEN 1 ELSE json('tower-claim-expired') END").bind(...claimArgs()),
                            db.prepare(isMuseShareURL(sourceURL.href)
                                ? "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tower_residencies r JOIN tower_source_identities i ON i.source_url=r.source_url WHERE i.source_identity=? AND r.room_id<>?) THEN 1 ELSE json('tower-source-occupied') END"
                                : "SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM tower_residencies WHERE source_url=? AND room_id<>?) THEN 1 ELSE json('tower-source-occupied') END").bind(homeSourceIdentity(sourceURL.href), r!.room_id),
                            db.prepare("UPDATE tower_residencies SET source_url=?,proof_method='challenge',updated_at=? WHERE room_id=? AND account_id=? AND revision=? AND source_url=?")
                                .bind(sourceURL.href, stamp(), r!.room_id, accountId, expected, r!.source_url),
                            receipt(identity, key, "source", inputHash, result),
                            audit(accountId, r!.room_id, "resident-source-moved", expected, {
                                oldSourceURL: r!.source_url, sourceURL: sourceURL.href, proofMethod: "challenge",
                            }),
                        ]);
                    }
                    catch (error) {
                        if (error instanceof TowerError)
                            throw error;
                        const saved = await prior(identity, key, "source", inputHash);
                        if (saved)
                            return json(saved);
                        const latest = await residency(accountId);
                        if (!latest || latest.revision !== expected || latest.source_url !== r!.source_url ||
                            latest.public_revision !== r!.public_revision || latest.directory_consent !== r!.directory_consent ||
                            latest.announcement_consent !== r!.announcement_consent || latest.dream_consent !== r!.dream_consent ||
                            latest.snapshot_consent !== r!.snapshot_consent || (await sourceGeneration(accountId)) !== generation)
                            fail(409, "revision_conflict");
                        if (!(await one(claimSQL, ...claimArgs())))
                            fail(403, "verified_claim_required");
                        if (await occupied())
                            fail(409, "source_already_claimed");
                        fail(503, "tower_storage_unavailable");
                    }
                    return json(result);
                }
                if (route === "source-preview" && req.method === "POST") {
                    if (!r)
                        fail(404, "no_home");
                    const input = await body(req, ["expectedRevision"]), expected = revision(input.expectedRevision);
                    if (r!.revision !== expected)
                        fail(409, "revision_conflict");
                    const generation = await sourceGeneration(accountId), previous = await getSite(r!, false), oldImages = await storedImages(r!), data = await snapshot(await source(r!.source_url, accountId), r!.resident_id), digest = await sourceDigest(r!, generation, data), before = syncValues(previous, oldImages), after = syncValues(data.site, data.images);
                    // Read-only preview still revalidates authorization and the source generation
                    // after network I/O. No preview receipt, audit or draft is persisted.
                    try {
                        await write(identity, [sourceGenerationGuard(accountId, generation), revisionGuard(r!)]);
                    }
                    catch (error) {
                        if (error instanceof TowerError)
                            throw error;
                        const latest = await residency(accountId);
                        if (!latest || latest.revision !== expected || latest.source_url !== r!.source_url ||
                            await sourceGeneration(accountId) !== generation)
                            fail(409, "revision_conflict");
                        fail(503, "tower_storage_unavailable");
                    }
                    return json({
                        baseRevision: expected, sourceDigest: digest,
                        groups: syncGroups.map(field => ({
                            field, changed: JSON.stringify(before[field]) !== JSON.stringify(after[field]),
                            before: before[field], after: after[field]
                        }))
                    });
                }
                if (route === "snapshot" && req.method === "POST") {
                    if (!r)
                        fail(404, "no_home");
                    const input = await body(req, [
                        "expectedRevision", "requestKey", "reviewedSourceDigest", "apply"
                    ]);
                    if (typeof input.reviewedSourceDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.reviewedSourceDigest))
                        fail(409, "source_review_required");
                    const expected = revision(input.expectedRevision), key = requestKey(input.requestKey), apply = applyGroups(input.apply), reviewedSourceDigest = input.reviewedSourceDigest, inputHash = await hash(JSON.stringify({
                        expected, reviewedSourceDigest, apply
                    })), replay = await prior(identity, key, "snapshot", inputHash);
                    if (replay)
                        return json(replay, 201);
                    if (r!.revision !== expected)
                        fail(409, "revision_conflict");
                    const generation = await sourceGeneration(accountId), previous = await getSite(r!, false), oldImages = await storedImages(r!), data = await snapshot(await source(r!.source_url, accountId), r!.resident_id);
                    if (await sourceDigest(r!, generation, data) !== reviewedSourceDigest)
                        fail(409, "source_review_changed");
                    const chosen = (group: SyncGroup) => apply.includes(group), site = validateTowerSnapshot({
                        ...previous,
                        home: {
                            ...previous.home,
                            ...(chosen("intro") ? { name: data.site.home.name, intro: data.site.home.intro } : {}),
                            ...(chosen("daily") ? { daily: data.site.home.daily } : {}),
                            ...(chosen("dream") ? { dreams: data.site.home.dreams } : {}),
                        },
                        ...(chosen("profile") ? { profile: data.site.profile } : {}),
                        ...(chosen("home") ? { homeAlt: data.site.homeAlt } : {}),
                        ...(chosen("dream") ? { dream: data.site.dream } : {}),
                    }, r!.resident_id), images = data.images.filter(image => chosen(image.purpose)), preserved = oldImages.filter(image => !chosen(image.purpose)), rev = expected + 1;
                    if (images.reduce((n, image) => n + image.bytes.length, 0) + preserved.reduce((n, image) => n + image.size, 0) > 12 * 1024 * 1024)
                        fail(413, "source_images_too_large");
                    const result = {
                        roomId: r!.room_id, door: `/home/${r!.room_id}`, residentId: r!.resident_id,
                        sourceURL: r!.source_url, revision: rev, proofMethod: r!.proof_method, published: false,
                        reviewedSourceDigest, apply
                    };
                    try {
                        await write(identity, [
                            sourceGenerationGuard(accountId, generation), revisionGuard(r!),
                            ...await snapshotStatements(r!.room_id, rev, { site, images }, await hash(JSON.stringify(site))),
                            ...await cloneAssetStatements(db, r!.room_id, expected, rev, preserved.map(image => image.purpose)),
                            db.prepare("UPDATE tower_residencies SET revision=?,updated_at=? WHERE room_id=? AND account_id=? AND revision=?")
                                .bind(rev, stamp(), r!.room_id, accountId, expected),
                            receipt(identity, key, "snapshot", inputHash, result),
                            audit(accountId, r!.room_id, "snapshot-imported", rev, { reviewedSourceDigest, apply }),
                        ]);
                    }
                    catch (error) {
                        if (error instanceof TowerError)
                            throw error;
                        const saved = await prior(identity, key, "snapshot", inputHash);
                        if (saved)
                            return json(saved, 201);
                        const latest = await residency(accountId);
                        if (!latest || latest.revision !== expected || latest.source_url !== r!.source_url ||
                            await sourceGeneration(accountId) !== generation)
                            fail(409, "revision_conflict");
                        fail(503, "tower_storage_unavailable");
                    }
                    return json(result, 201);
                }
                if (route === "import" &&
                    req.method === "POST") {
                    const input = await body(req), sourceURL = await source(input.sourceURL, accountId), residentId = id(input.residentId), key = requestKey(input.requestKey), proof = input.proof;
                    if (!["challenge", "owner-attested"].includes(String(proof)))
                        fail(400, "proof_required");
                    const inputHash = await hash(JSON.stringify({
                        sourceURL: sourceURL.href,
                        residentId,
                        expected: null,
                        proof,
                    })), duplicate = await prior(identity, key, route, inputHash);
                    if (duplicate)
                        return json(duplicate, 201);
                    if (r) {
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
                    if (await one(isMuseShareURL(sourceURL.href)
                        ? "SELECT r.room_id FROM tower_residencies r JOIN tower_source_identities i ON i.source_url=r.source_url WHERE r.resident_id=? OR i.source_identity=?"
                        : "SELECT room_id FROM tower_residencies WHERE resident_id=? OR source_url=?", residentId, homeSourceIdentity(sourceURL.href)))
                        fail(409, "resident_already_claimed");
                    if (await one("SELECT id FROM rooms WHERE account_id=?", accountId))
                        fail(409, "account_already_has_home");
                    if (proof === "owner-attested") {
                        if (identity.delegated ||
                            !(await env.ownerAttestation?.(req, accountId, sourceURL.href)))
                            fail(403, "owner_attestation_required");
                    }
                    else if (!(await one("SELECT id FROM tower_claims WHERE account_id=? AND resident_id=? AND source_url=? AND verified=1 AND expires_at>?", accountId, residentId, sourceURL.href, stamp())))
                        fail(403, "verified_claim_required");
                    const requiresSourceGrant = !env.sourceOrigins.includes(sourceURL.origin), sourceGrantArgs = [accountId, residentId, sourceURL.href];
                    if (requiresSourceGrant && !await one(firstImportGrantSQL, ...sourceGrantArgs))
                        fail(403, "source_authorization_required");
                    const data = await snapshot(sourceURL, residentId), roomId = random(8), rev = 1, result = {
                        roomId,
                        door: `/home/${roomId}`,
                        residentId,
                        sourceURL: sourceURL.href,
                        revision: rev,
                        proofMethod: proof,
                        published: false,
                    }, statements: Statement[] = [];
                    if (requiresSourceGrant)
                        statements.push(db.prepare("SELECT CASE WHEN EXISTS(" + firstImportGrantSQL + ") THEN 1 ELSE json('source-authorization-expired') END").bind(...sourceGrantArgs));
                    if (proof === "challenge")
                        statements.push(db
                            .prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_claims WHERE account_id=? AND resident_id=? AND source_url=? AND verified=1 AND expires_at>?) THEN 1 ELSE json('tower-claim-expired') END")
                            .bind(accountId, residentId, sourceURL.href, stamp()));
                    statements.push(db
                        .prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES(?,?,?,?,?,0,'external-ready',?,?)")
                        .bind(roomId, accountId, data.site.home.name, data.site.home.intro, "resident", stamp(), env.localTest ? 1 : 0), db
                        .prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
                        .bind(roomId, accountId, residentId, sourceURL.href, proof, rev, stamp(), stamp()));
                    statements.push(...await snapshotStatements(roomId, rev, data, await hash(JSON.stringify(data.site))), receipt(identity, key, route, inputHash, result), audit(accountId, roomId, "resident-imported", rev, { proofMethod: proof }));
                    try {
                        await write(identity, statements);
                    }
                    catch (error) {
                        if (error instanceof TowerError)
                            throw error;
                        const retry = await prior(identity, key, route, inputHash);
                        if (retry)
                            return json(retry, 201);
                        if (requiresSourceGrant && !await one(firstImportGrantSQL, ...sourceGrantArgs))
                            fail(403, "source_authorization_required");
                        const latest = await residency(accountId);
                        if (latest)
                            fail(409, "revision_or_identity_conflict");
                        if (isMuseShareURL(sourceURL.href) && await one("SELECT r.room_id FROM tower_residencies r JOIN tower_source_identities i ON i.source_url=r.source_url WHERE r.resident_id=? OR i.source_identity=?", residentId, homeSourceIdentity(sourceURL.href)))
                            fail(409, "resident_already_claimed");
                        // Operation errors are private audit records, never public SQL/provider payloads.
                        const detail = { error: error instanceof Error ? error.message.slice(0, 500) : "storage-error", cause: error instanceof Error && error.cause instanceof Error ? error.cause.message.slice(0, 500) : null };
                        try {
                            await db.batch([audit(accountId, null, "storage-failed", null, detail)]);
                        }
                        catch { /* Preserve the original safe error if audit storage is unavailable too. */
                        }
                        fail(503, "tower_storage_unavailable");
                    }
                    return json(result, 201);
                }
                const commandResponse = await contentCommand(req, route, identity, r)
                    ?? await publicationCommand(req, route, identity, r);
                if (commandResponse)
                    return commandResponse;
                fail(405, "method_not_allowed");
            }
            catch (e) {
                if (e instanceof TowerError)
                    return json({ error: e.code, ...(e.validation?.stage ? { validation: e.validation } : {}) }, e.status);
                return json({ error: "tower_operation_unavailable" }, 503);
            }
        },
    };
}
