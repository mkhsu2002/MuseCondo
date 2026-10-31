import type {LocalDatabase} from '../../server/live/local-db.ts';
/** Independent synthetic Tower. No official Muse eligibility or real resident is inferred. */
export function openSyntheticTower(db:LocalDatabase){
 if(!db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='tower_admission_policies'").get())return;
 db.sqlite.prepare("INSERT INTO tower_admission_policies VALUES(2,'[\"*\"]',0,'2026-10-31T00:00:00.000Z')").run();
 db.sqlite.prepare('INSERT INTO tower_admission_current VALUES(1,2) ON CONFLICT(id) DO UPDATE SET policy_version=2').run();
}
