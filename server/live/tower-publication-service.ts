import type { TowerIntakeRepository } from './tower-intake-repository.ts';
import type { createTowerIntakeAuthorization } from './tower-intake-auth.ts';
import type { TowerIntakeRequest } from './tower-intake-request.ts';
import type { Residency, Identity } from './tower-intake-types.ts';
import { fail, revision } from './tower-contract.ts';
import { random } from './tower-crypto.ts';
type Authorization = Pick<ReturnType<typeof createTowerIntakeAuthorization>, 'write'>;
type JSONResponse = (value: unknown, status?: number) => Response;
/** Publication, directory visibility and recovery event are one guarded transaction. */
export function createTowerPublicationService(ports: {
    repository: TowerIntakeRepository;
    authorization: Authorization;
    request: TowerIntakeRequest;
    json: JSONResponse;
    onChange: (roomId: string) => Promise<void>;
}) {
    const { db, stamp, residency, audit, getSite, safe } = ports.repository;
    const { write } = ports.authorization;
    const { body } = ports.request;
    const { json, onChange: change } = ports;
    return async function publicationCommand(req: Request, route: string, identity: Identity, r: Residency | null): Promise<Response | null> {
        const accountId = identity.accountId;
        if (route === "publication" && req.method === "POST") {
            if (!r)
                fail(404, "no_home");
            const input = await body(req), expected = revision(input.expectedRevision);
            if (r!.revision !== expected)
                fail(409, "revision_conflict");
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
            if (r!.public_revision === (publish ? expected : null) && r!.directory_consent === (publish && input.directoryConsent ? 1 : 0) && r!.announcement_consent === (publish && input.announcementConsent ? 1 : 0) && r!.dream_consent === (publish && input.dreamConsent ? 1 : 0) && r!.snapshot_consent === (publish ? 1 : 0))
                return json({ intake: safe(r!) });
            const site = await getSite(r!, false);
            if (publish && input.dreamConsent && !site.dream)
                fail(400, "no_public_dream");
            await write(identity, [
                db
                    .prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_residencies WHERE room_id=? AND account_id=? AND revision=?) THEN 1 ELSE json('tower-revision-conflict') END")
                    .bind(r!.room_id, accountId, expected),
                db
                    .prepare("UPDATE tower_residencies SET public_revision=?,directory_consent=?,announcement_consent=?,dream_consent=?,snapshot_consent=?,updated_at=?,published_at=?,publication_epoch=publication_epoch+1 WHERE room_id=?")
                    .bind(publish ? expected : null, publish && input.directoryConsent ? 1 : 0, publish && input.announcementConsent ? 1 : 0, publish && input.dreamConsent ? 1 : 0, publish ? 1 : 0, stamp(), stamp(), r!.room_id),
                db
                    .prepare("UPDATE rooms SET name=?,intro=?,published=? WHERE id=?")
                    .bind(site.home.name, site.home.intro, publish && input.directoryConsent ? 1 : 0, r!.room_id),
                db.prepare("DELETE FROM community_current"),
                db.prepare("INSERT INTO manager_events(id,room_id,created_at) VALUES(?,?,?)").bind(random(16), r!.room_id, stamp()),
                audit(accountId, r!.room_id, publish ? "published" : "withdrawn", expected, {
                    directoryConsent: publish && input.directoryConsent,
                    announcementConsent: publish && input.announcementConsent,
                    dreamConsent: publish && input.dreamConsent,
                    snapshotConsent: publish,
                }),
            ]);
            await change(r!.room_id);
            return json({ intake: safe((await residency(accountId))!) });
        }
        return null;
    };
}
