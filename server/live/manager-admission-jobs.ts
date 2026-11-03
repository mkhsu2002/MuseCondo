import type { Database } from './db.ts';
import type { Job, Case } from './manager-admission-types.ts';
import { MANAGER_ADMISSION_SCHEMA, cooling, runnable } from './manager-admission-policy.ts';
export async function managerAdmissionReady(db: Database) {
    const rows = (await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger','view')").all<{
        name: string;
    }>()).results;
    return MANAGER_ADMISSION_SCHEMA.every(name => rows.some(v => v.name === name));
}
/** Durable reads retain database-native clocks and authoritative current rows. */
export function createManagerAdmissionJobs(db: Database, wake?: () => Promise<void>) {
    async function status(caseId: string) {
        if (!await managerAdmissionReady(db))
            return { state: 'needs-info' };
        const c = await db.prepare('SELECT state,is_muse_agent,request_kind,version FROM tower_reception_cases WHERE id=?').bind(caseId).first<{
            state: string;
            is_muse_agent: number | null;
            request_kind: string;
            version: number;
        }>();
        if (!c)
            return null;
        if (c.state === 'approved' || c.state === 'active')
            return { state: 'approved' };
        if (c.state === 'rejected')
            return { state: 'rejected' };
        if (c.state === 'withdrawn' || c.state === 'revoked')
            return { state: 'blocked' };
        if (c.request_kind !== 'new')
            return { state: 'needs-info' };
        if (c.is_muse_agent === null)
            return { state: 'needs-info', missing: ['isMuseAgent'] };
        const unknown = await db.prepare("SELECT 1 FROM manager_admission_calls WHERE case_id=? AND state='unknown'").bind(caseId).first();
        if (unknown)
            return { state: 'blocked' };
        if (await db.prepare("SELECT 1 FROM tower_reception_sources WHERE case_id=? AND resolution='unavailable'").bind(caseId).first())
            return { state: 'needs-info' };
        const job = await db.prepare('SELECT state,decision,error_code,case_version FROM manager_admission_jobs WHERE case_id=? ORDER BY case_version DESC LIMIT 1').bind(caseId).first<{
            state: string;
            decision: string;
            error_code: string;
            case_version: number;
        }>();
        if (!job)
            return { state: 'blocked' };
        if (job.state === 'queued' && job.error_code === 'review_source_cooldown') {
            const wait = await db.prepare(`SELECT CASE WHEN julianday(MAX(p.created_at))+15.0/1440>julianday('now') THEN MAX(1,CAST((julianday(MAX(p.created_at))+15.0/1440-julianday('now'))*86400 AS INTEGER)+1) ELSE 0 END AS seconds FROM manager_admission_calls p JOIN manager_admission_jobs old ON old.id=p.job_id JOIN manager_admission_jobs j ON j.case_id=? AND j.case_version=? WHERE old.id!=j.id AND p.phase='review' AND ((SELECT source_identity FROM tower_source_identities WHERE source_url=json_extract(old.snapshot_json,'$.sourceURL'))=(SELECT source_identity FROM tower_source_identities WHERE source_url=json_extract(j.snapshot_json,'$.sourceURL')) OR json_extract(old.snapshot_json,'$.residentId')=json_extract(j.snapshot_json,'$.residentId'))`).bind(caseId, job.case_version).first<{
                seconds: number | null;
            }>();
            if (wait?.seconds && wait.seconds > 0)
                return { state: 'needs-info', retryAfterSeconds: wait.seconds };
            await wake?.();
        }
        return { state: job.state === 'queued' ? 'queued' : job.state === 'running' ? 'reviewing' : job.state === 'blocked' ? 'blocked' : job.decision === 'approve' ? 'approved' : job.decision === 'reject' ? 'rejected' : 'needs-info' };
    }
    // Do not disclose whether a different application, account or resident exists.
    // Only an actual dispatch receipt starts the bounded cooldown; queued applications
    // and technical prechecks cannot reserve somebody else's public source.
    async function duplicate(j: Job, c: Case) {
        if (await db.prepare(`SELECT 1 FROM manager_admission_calls p JOIN manager_admission_jobs old ON old.id=p.job_id WHERE old.id!=? AND p.phase='review' AND p.state IN ('unknown','dispatching') AND ((SELECT source_identity FROM tower_source_identities WHERE source_url=json_extract(old.snapshot_json,'$.sourceURL'))=(SELECT source_identity FROM tower_source_identities WHERE source_url=?) OR json_extract(old.snapshot_json,'$.residentId')=?) LIMIT 1`).bind(j.id, c.source_url, c.resident_id).first())
            return 'uncertain';
        if (c.is_muse_agent === 1 && await db.prepare('SELECT 1 FROM tower_residencies WHERE (SELECT source_identity FROM tower_source_identities WHERE source_url=tower_residencies.source_url)=(SELECT source_identity FROM tower_source_identities WHERE source_url=?) OR resident_id=?').bind(c.source_url, c.resident_id).first())
            return 'connected';
        return await db.prepare(`SELECT 1 FROM manager_admission_jobs j WHERE j.id=? AND ${cooling}`).bind(j.id).first() ? 'cooldown' : null;
    }
    async function enabled(policy: boolean) {
        return (await db.prepare('SELECT enabled FROM ' + (policy ? 'manager_admission_control' : 'tower_autonomy_mandate') + ' WHERE id=1').first<{
            enabled: number;
        }>())?.enabled === 1;
    }
    async function inspect() {
        return !await managerAdmissionReady(db) ? {
            schemaReady: false, jobs: [], calls: []
        } : {
            schemaReady: true, jobs: (await db.prepare('SELECT * FROM manager_admission_jobs ORDER BY created_at DESC LIMIT 50').all()).results, calls: (await db.prepare('SELECT * FROM manager_admission_calls ORDER BY created_at DESC LIMIT 100').all()).results, operatorAction: 'Investigate the original receipt; never retry unknown or reset the logical-case budget.'
        };
    }
    const next = () => db.prepare(`SELECT j.* FROM manager_admission_jobs j WHERE ${runnable} ORDER BY CASE WHEN j.state='running' THEN 0 ELSE 1 END,j.created_at,j.id LIMIT 1`).first<Job>();
    const hasRunnable = async () => !!await db.prepare(`SELECT 1 FROM manager_admission_jobs j WHERE ${runnable} LIMIT 1`).first();
    const caseFor = (caseId: string) => db.prepare('SELECT * FROM tower_reception_cases WHERE id=?').bind(caseId).first<Case>();
    const hasUncertainCall = async (caseId: string) => !!await db.prepare("SELECT 1 FROM manager_admission_calls WHERE case_id=? AND state IN ('unknown','dispatching')").bind(caseId).first();
    return {
        status, duplicate, enabled, inspect, next, hasRunnable, caseFor, hasUncertainCall
    };
}
