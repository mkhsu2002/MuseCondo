import type {Database} from './db.ts';
import {managerLocalDay} from './tower-calendar.ts';

const DAILY_CAP_MICRO = 10_000_000, LIFETIME_CAP_MICRO = 10_000_000, CASE_CAP_MICRO = 1_000_000;
interface BudgetTotals {reservedMicro:number;actualMicro:number;committedMicro:number}

/** Read-only operator aggregate. Counter exceedances are not unique users or cases. */
export async function admissionSecurityStatus(db:Database, now = new Date()) {
    const hour = Math.floor(now.getTime() / 3_600_000), billingDay = managerLocalDay(now);
    const windowStart = new Date(hour * 3_600_000).toISOString();
    const windowEnd = new Date((hour + 1) * 3_600_000).toISOString();
    const rates = (await db.prepare(`SELECT
        CASE
          WHEN key LIKE 'reception:global-read:%' THEN 'readGlobal'
          WHEN key LIKE 'reception:read-ip:%' THEN 'readIP'
          WHEN key LIKE 'reception:read-case:%' THEN 'readCase'
          WHEN key LIKE 'reception:global-write:%' THEN 'writeGlobal'
          WHEN key LIKE 'reception:case:%' THEN 'writeCase'
          WHEN key LIKE 'reception:global-open:%' THEN 'openGlobal'
          WHEN key LIKE 'reception:ip:%' THEN 'openIP'
        END AS category,
        SUM(MAX(0,count-CASE
          WHEN key LIKE 'reception:global-read:%' THEN 12000
          WHEN key LIKE 'reception:read-ip:%' THEN 600
          WHEN key LIKE 'reception:read-case:%' THEN 120
          WHEN key LIKE 'reception:global-write:%' THEN 1000
          WHEN key LIKE 'reception:case:%' THEN 20
          WHEN key LIKE 'reception:global-open:%' THEN 100
          WHEN key LIKE 'reception:ip:%' THEN 5
          ELSE count END)) AS exceeded
        FROM rate_limits WHERE key LIKE ? AND expires_at>? GROUP BY category`)
        .bind('reception:%:' + hour, windowStart).all<{category:string|null;exceeded:number}>()).results;
    const count = (category:string) => rates.find(r => r.category === category)?.exceeded ?? 0;
    const throttles = {
        windowStart, windowEnd, unit:'counter_exceedances',
        read:{global:count('readGlobal'),ip:count('readIP'),case:count('readCase')},
        write:{global:count('writeGlobal'),case:count('writeCase')},
        open:{global:count('openGlobal'),ip:count('openIP')},
    };
    const jobs = (await db.prepare(`SELECT
        COALESCE(SUM(state='queued'),0) AS queued,
        COALESCE(SUM(state='running'),0) AS running,
        COALESCE(SUM(state='blocked'),0) AS blocked,
        COALESCE(SUM(state='queued' AND error_code='review_source_cooldown' AND EXISTS(
          SELECT 1 FROM manager_admission_calls p JOIN manager_admission_jobs old ON old.id=p.job_id
          WHERE old.id!=j.id AND p.phase='review' AND p.created_at>? AND
            (json_extract(old.snapshot_json,'$.sourceURL')=json_extract(j.snapshot_json,'$.sourceURL') OR
             json_extract(old.snapshot_json,'$.residentId')=json_extract(j.snapshot_json,'$.residentId'))
        )),0) AS cooldown
        FROM manager_admission_jobs j`).bind(new Date(now.getTime()-15*60_000).toISOString())
        .first<{queued:number;running:number;blocked:number;cooldown:number}>())!;
    const calls = (await db.prepare("SELECT COUNT(*) AS unknown FROM manager_admission_calls WHERE state='unknown'")
        .first<{unknown:number}>())!;
    const budgetSQL = 'SELECT COALESCE(SUM(reserved_micro),0) AS reservedMicro, COALESCE(SUM(actual_micro),0) AS actualMicro, COALESCE(SUM(COALESCE(actual_micro,reserved_micro)),0) AS committedMicro FROM manager_admission_calls';
    const daily = (await db.prepare(budgetSQL + ' WHERE billing_day=?').bind(billingDay).first<BudgetTotals>())!;
    const lifetime = (await db.prepare(budgetSQL).first<BudgetTotals>())!;
    const caseUsage = (await db.prepare('SELECT COUNT(*) AS nearLimit FROM (SELECT case_id FROM manager_admission_calls GROUP BY case_id HAVING SUM(COALESCE(actual_micro,reserved_micro))>=?)')
        .bind(CASE_CAP_MICRO*0.8).first<{nearLimit:number}>())!;
    const alerts:string[] = [];
    if ([...Object.values(throttles.read),...Object.values(throttles.write),...Object.values(throttles.open)].some(v=>v>0)) alerts.push('rate_limit_exceeded');
    if (calls.unknown>0) alerts.push('admission_result_unknown');
    if (daily.committedMicro>=DAILY_CAP_MICRO*0.8 || lifetime.committedMicro>=LIFETIME_CAP_MICRO*0.8 || caseUsage.nearLimit>0) alerts.push('review_budget_near_limit');
    if (jobs.blocked>0) alerts.push('admission_review_blocked');
    return {
        checkedAt:now.toISOString(), throttles, jobs:{...jobs}, calls:{...calls},
        budgets:{unit:'usd_micro',billingDay,billingTimeZone:'America/Vancouver',
            daily:{...daily,capMicro:DAILY_CAP_MICRO},lifetime:{...lifetime,capMicro:LIFETIME_CAP_MICRO},
            perCase:{capMicro:CASE_CAP_MICRO,nearLimitCases:caseUsage.nearLimit}},
        alerts,
    };
}
