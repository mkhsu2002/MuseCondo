import type { Database } from './db.ts';
import type { Identity, Residency } from './tower-intake-types.ts';
import type { PublicCondoSite } from '../../src/framework/condo.ts';
import type { createTowerSourceReader } from './tower-source-reader.ts';
import { assetStatements, storedTowerImages } from './tower-asset-storage.ts';
import { fail } from './tower-contract.ts';
import { random } from './tower-crypto.ts';
type Snapshot = Awaited<ReturnType<ReturnType<typeof createTowerSourceReader>['snapshot']>>;
/** Queries and statement builders only. The command owns each guarded commit. */
export function createTowerIntakeRepository(db: Database, stamp: () => string) {
    const one = <T>(sql: string, ...args: unknown[]) => db
        .prepare(sql)
        .bind(...args)
        .first<T>();
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
    const residency = (accountId: string) => one<Residency>("SELECT * FROM tower_residencies WHERE account_id=?", accountId);
    const audit = (accountId: string, roomId: string | null, action: string, rev: number | null, detail: unknown = {}) => db
        .prepare("INSERT INTO tower_audit(id,account_id,room_id,action,revision,detail_json,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind(random(16), accountId, roomId, action, rev, JSON.stringify(detail), stamp());
    async function prior(identity: Identity, key: string, operation: string, inputHash: string) {
        const row = await one<{
            operation: string;
            input_hash: string;
            response_json: string;
        }>("SELECT operation,input_hash,response_json FROM tower_requests WHERE account_id=? AND request_key=?", identity.accountId, key);
        if (row && (row.operation !== operation || row.input_hash !== inputHash))
            fail(409, "idempotency_conflict");
        return row ? JSON.parse(row.response_json) : null;
    }
    const receipt = (identity: Identity, key: string, operation: string, inputHash: string, response: unknown) => db
        .prepare("INSERT INTO tower_requests(account_id,request_key,operation,input_hash,response_json,created_at) VALUES(?,?,?,?,?,?)")
        .bind(identity.accountId, key, operation, inputHash, JSON.stringify(response), stamp());
    // Successful source receipts are permanent and append-only. Their count is
    // a source generation even when URLs return to an old value and time stands
    // still. Replays never insert another receipt or advance this generation.
    const sourceGenerationSQL = "SELECT COUNT(*) AS generation FROM tower_requests WHERE account_id=? AND operation='source'";
    const sourceGeneration = async (accountId: string) => (await one<{
        generation: number;
    }>(sourceGenerationSQL, accountId))!.generation;
    const sourceGenerationGuard = (accountId: string, generation: number) => db.prepare("SELECT CASE WHEN (" + sourceGenerationSQL + ")=? THEN 1 ELSE json('tower-source-conflict') END")
        .bind(accountId, generation);
    async function snapshotStatements(roomId: string, rev: number, data: Snapshot, digest: string) {
        const statements = [
            db
                .prepare("INSERT INTO tower_snapshots(room_id,revision,public_json,content_digest,created_at) VALUES(?,?,?,?,?)")
                .bind(roomId, rev, JSON.stringify(data.site), digest, stamp()),
        ];
        statements.push(...await assetStatements(db, roomId, rev, data.images));
        return statements;
    }
    const revisionGuard = (r: Residency) => db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_residencies WHERE room_id=? AND account_id=? AND resident_id=? AND revision=? AND source_url=?) THEN 1 ELSE json('tower-revision-conflict') END").bind(r.room_id, r.account_id, r.resident_id, r.revision, r.source_url);
    const storedImages = (r: Residency) => storedTowerImages(db, r.room_id, r.revision);
    async function publicState(roomId: string) {
        return one<Residency>("SELECT * FROM tower_residencies WHERE room_id=? AND public_revision IS NOT NULL AND snapshot_consent=1", roomId);
    }
    async function getSite(r: Residency, publicView = true) {
        const row = await one<{
            public_json: string;
        }>("SELECT public_json FROM tower_snapshots WHERE room_id=? AND revision=?", r.room_id, publicView ? r.public_revision : r.revision);
        if (!row)
            fail(404, "home_not_found");
        const site = JSON.parse(row!.public_json) as PublicCondoSite;
        if (publicView && !r.dream_consent) {
            site.dream = null;
            site.home.dreams = [];
        }
        return site;
    }
    return {
        db, stamp, one, safe, residency, audit, prior, receipt, sourceGeneration, sourceGenerationGuard, snapshotStatements, revisionGuard, storedImages, publicState, getSite
    };
}
export type TowerIntakeRepository = ReturnType<typeof createTowerIntakeRepository>;
