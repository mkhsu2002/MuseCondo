import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {admissionSecurityStatus} from '../server/live/admission-security-status.ts';

const now = new Date('2026-10-31T06:30:00.000Z');
function fixture() {
    const db = new LocalDatabase(':memory:');
    // Use the deployed table definitions. Remove write guards only to seed an
    // aggregate snapshot without executing review, provider, or admission work.
    for (const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())
        db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
    for (const trigger of db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all())
        db.sqlite.exec('DROP TRIGGER "'+String(trigger.name).replaceAll('"','""')+'"');
    db.sqlite.exec('PRAGMA foreign_keys=OFF');
    const job = (id:string,state:string,error:string|null=null,source='https://private-source.example/profile.json') =>
        db.sqlite.prepare('INSERT INTO manager_admission_jobs(id,case_id,case_version,policy_version,snapshot_json,state,error_code,created_at) VALUES(?,?,1,1,?,?,?,?)')
            .run(id,'private-case-'+id,JSON.stringify({sourceURL:source,residentId:'private-resident-'+id,contact:'secret-contact'}),state,error,now.toISOString());
    let seq = 0;
    const call = (jobId:string,state:string,reserved:number,actual:number|null,day='2026-10-30',createdAt=now.toISOString()) =>
        db.sqlite.prepare('INSERT INTO manager_admission_calls(id,job_id,case_id,phase,billing_day,state,reserved_micro,actual_micro,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
            .run('private-call-'+seq++,jobId,'private-case-'+jobId,'review',day,state,reserved,actual,createdAt);
    const rate = (bucket:string,count:number,hour=Math.floor(now.getTime()/3_600_000)) =>
        db.sqlite.prepare('INSERT INTO rate_limits VALUES(?,?,?)').run('reception:'+bucket+':'+hour,count,new Date((hour+1)*3_600_000).toISOString());
    return {db,job,call,rate};
}

test('status uses SELECT only and counts current-hour counter exceedances without identifying callers',async()=>{
    const f = fixture();
    try {
        f.rate('global-read',12002); f.rate('read-ip:private-ip-hash',603); f.rate('read-case:private-case-key',120);
        f.rate('case:private-case-key',25); f.rate('global-write',1000); f.rate('global-open',101); f.rate('ip:private-other-hash',7);
        f.rate('read-case:old-private-case',999,Math.floor(now.getTime()/3_600_000)-1);
        f.rate('unrecognized',99999);
        const prepare = f.db.prepare.bind(f.db);
        f.db.prepare = (sql:string) => { assert.match(sql,/^SELECT\s/); return prepare(sql); };
        const result = await admissionSecurityStatus(f.db,now);
        assert.deepEqual(result.throttles,{
            windowStart:'2026-10-31T06:00:00.000Z',windowEnd:'2026-10-31T07:00:00.000Z',unit:'counter_exceedances',
            read:{global:2,ip:3,case:0},write:{global:0,case:5},open:{global:1,ip:2},
        });
        assert.deepEqual(result.alerts,['rate_limit_exceeded']);
        assert.doesNotMatch(JSON.stringify(result),/private-|sourceURL|contact|token_hash/);
        const next = await admissionSecurityStatus(f.db,new Date('2026-10-31T07:00:00.000Z'));
        assert.deepEqual(next.throttles.read,{global:0,ip:0,case:0});
        assert.deepEqual(next.alerts,[]);
    } finally { f.db.close(); }
});

test('budget uses settled actuals or outstanding reservations and local billing day with stable alerts',async()=>{
    const f = fixture();
    try {
        f.job('running','running'); f.job('cooldown','queued','review_source_cooldown');
        f.job('stale','queued','review_source_cooldown','https://other-private.example/home.json');
        f.job('blocked','blocked');
        f.call('running','unknown',30000,null);
        f.job('settled','complete'); f.call('settled','received',30000,7_970_000);
        f.job('zero','complete'); f.call('zero','rejected',30000,0);
        f.job('old','complete'); f.call('old','received',30000,50000,'2026-10-29','2026-10-30T05:00:00.000Z');
        const result = await admissionSecurityStatus(f.db,now);
        assert.deepEqual(result.jobs,{queued:2,running:1,blocked:1,cooldown:1});
        assert.deepEqual(result.calls,{unknown:1});
        assert.equal(result.budgets.billingDay,'2026-10-30');
        assert.deepEqual(result.budgets.daily,{reservedMicro:90000,actualMicro:7970000,committedMicro:8000000,capMicro:10000000});
        assert.deepEqual(result.budgets.lifetime,{reservedMicro:120000,actualMicro:8020000,committedMicro:8050000,capMicro:10000000});
        assert.deepEqual(result.budgets.perCase,{capMicro:1000000,nearLimitCases:1});
        assert.deepEqual(result.alerts,['admission_result_unknown','review_budget_near_limit','admission_review_blocked']);
        assert.doesNotMatch(JSON.stringify(result),/private-|sourceURL|secret-contact/);
        const afterCooldown = await admissionSecurityStatus(f.db,new Date(now.getTime()+15*60_000));
        assert.equal(afterCooldown.jobs.cooldown,0);
    } finally { f.db.close(); }
});

test('below 80 percent does not raise a budget alert and prior-day lifetime pressure remains visible',async()=>{
    const f = fixture();
    try {
        for (let i=0;i<10;i++) { f.job('low-'+i,'complete'); f.call('low-'+i,'received',30000,799999,'2026-10-29'); }
        let result = await admissionSecurityStatus(f.db,now);
        assert.deepEqual(result.alerts,[]);
        assert.equal(result.budgets.daily.committedMicro,0);
        f.job('threshold','complete'); f.call('threshold','received',30000,10,'2026-10-29');
        result = await admissionSecurityStatus(f.db,now);
        assert.equal(result.budgets.lifetime.committedMicro,8000000);
        assert.deepEqual(result.alerts,['review_budget_near_limit']);
    } finally { f.db.close(); }
});
