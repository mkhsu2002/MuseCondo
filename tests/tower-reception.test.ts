import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LocalDatabase } from '../server/live/local-db.ts';
import { createTowerReception } from '../server/live/reception.ts';
import { createTowerIntake } from '../server/live/tower-intake.ts';
import { digest } from '../server/live/app.ts';
import { runInNewContext } from 'node:vm';
const origin = 'https://tower.example', key = 'a'.repeat(64), towerKey = 'b'.repeat(64), other = 'c'.repeat(64);
function fixture() {
    const db = new LocalDatabase(':memory:');
    for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort())
        db.sqlite.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
 openSyntheticTower(db);
    let time = new Date('2026-10-30T12:00:00.000Z');
    const api = createTowerReception({ db, origin, now: () => time, operator: async (r) => r.headers.get('X-Tower-Operator-Key') === 'operator' });
    const req = async (path: string, method = 'GET', body?: unknown, secret = key, operator = false, extra: Record<string, string> = {}) => api.fetch(new Request(origin + (operator ? '/api/v1/operator/reception' : '/api/v1/reception') + path, { method, headers: { 'Content-Type': 'application/json', ...(operator ? { 'X-Tower-Operator-Key': 'operator' } : { Authorization: 'Bearer ' + secret }), 'CF-Connecting-IP': '127.0.0.1', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const data = async (p: Promise<Response | null>, status = 200) => { const r = (await p)!; const b = await r.json(); assert.equal(r.status, status, JSON.stringify(b)); return b; };
    const input = { requestKey: 'open-case', name: '新住戶', request: '想申請自己的住所。', requestKind: 'new', authorization: { contact: true, application: true, towerAccess: true }, visitPlan: { mode: 'self-scheduled', intervalHours: 24 }, sharing: { snapshot: false, directory: false, announcement: false, dream: false } };
    const open = () => data(req('/cases', 'POST', input), 201);
    const account = () => db.sqlite.prepare("INSERT INTO accounts(id,login_hash,created_at,test_only) VALUES('account','hash',?,0)").run(time.toISOString());
    const approve = (id: string, version: number) => data(req('/cases/' + id + '/approve', 'POST', { requestKey: 'approve-case', expectedVersion: version, accountId: 'account', residentId: 'new-resident', sourceURL: 'https://source.example/condo.json', approvedDays: 30 }, key, true));
    return { db, req, data, input, open, account, approve, setTime: (v: string) => { time = new Date(v); } };
}
test('case is private, hash-only, idempotent, bounded and does not reveal residents or jobs', async () => {
    const f = fixture();
    try {
        const c = await f.open();
        assert.equal(c.case.version, 1);
        assert.deepEqual(await f.data(f.req('/cases', 'POST', f.input), 201), c);
        assert.equal((await f.req('/cases/' + c.case.id, 'GET', undefined, other))!.status, 404);
        assert.equal((await f.req('/cases/' + c.case.id, 'GET', undefined, key, false, { Cookie: 'session=x' }))!.status, 403);
        assert.equal((await f.req('/cases/' + c.case.id, 'GET', undefined, key, false, { Origin: 'https://evil.example' }))!.status, 403);
        const own = await f.data(f.req('/cases/' + c.case.id));
        assert.equal(own.case.name, '新住戶');
        assert.equal(own.events.length, 1);
        assert(!JSON.stringify(own).includes('accountId'));
        assert.equal((await f.req('/cases', 'POST', { ...f.input, requestKey: 'different', memory: 'private' }))!.status, 400);
        const stored = JSON.stringify(f.db.sqlite.prepare('SELECT * FROM tower_reception_cases').all()) + JSON.stringify(f.db.sqlite.prepare('SELECT * FROM tower_reception_requests').all());
        assert(!stored.includes(key));
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_tokens').get()!.n, 0);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_jobs').get()!.n, 0);
    }
    finally {
        f.db.close();
    }
});
test('operator approval activates only the bound tuple, preserves unrelated token and revokes only case grant', async () => {
    const f = fixture();
    try {
        const c = await f.open();
        f.account();
        f.db.sqlite.prepare('INSERT INTO tower_tokens VALUES(?,?,?,?,?,0,?)').run('old', 'account', await digest(other), '["tower:read"]', '2027-01-01', '2026-10-30');
        assert.equal((await f.req('/cases/' + c.case.id + '/activate', 'POST', { requestKey: 'activate-case', expectedVersion: 1 }, key, false, { 'X-Tower-Agent-Key': towerKey }))!.status, 409);
        const approved = await f.approve(c.case.id, 1);
        assert.equal(approved.case.state, 'approved');
        const a = await f.data(f.req('/cases/' + c.case.id + '/activate', 'POST', { requestKey: 'activate-case', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': towerKey }), 201);
        assert.equal(a.case.state, 'active');
        assert(!JSON.stringify(a).includes(towerKey));
        assert.deepEqual(await f.data(f.req('/cases/' + c.case.id + '/activate', 'POST', { requestKey: 'activate-case', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': towerKey }), 201), a);
        assert.equal((await f.req('/cases/' + c.case.id + '/activate', 'POST', { requestKey: 'other-key', expectedVersion: 3 }, key, false, { 'X-Tower-Agent-Key': other }))!.status, 409);
        await f.data(f.req('/cases/' + c.case.id + '/withdraw', 'POST', { requestKey: 'withdraw-case', expectedVersion: 3 }));
        const tokens = f.db.sqlite.prepare('SELECT id,revoked FROM tower_tokens ORDER BY id').all();
        assert.equal(tokens.find(t => t.id === 'old')!.revoked, 0);
        assert.equal(tokens.find(t => t.id !== 'old')!.revoked, 1);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_audit').get()!.n, 3);
    }
    finally {
        f.db.close();
    }
});
test('takeover requires operator binding and cannot use the case key as a tower key', async () => {
    const f = fixture();
    try {
        f.input.requestKind = 'takeover';
        const c = await f.open();
        f.account();
        assert.equal((await f.req('/cases/' + c.case.id + '/approve', 'POST', { requestKey: 'approve-case', expectedVersion: 1, accountId: 'account', residentId: 'new-resident', sourceURL: 'https://source.example/condo.json', approvedDays: 30 }, key, true))!.status, 409);
    }
    finally {
        f.db.close();
    }
});
test('messages and visit plan use version CAS, permanent receipts, pagination and case scope', async () => {
    const f = fixture();
    try {
        const c = await f.open(), path = '/cases/' + c.case.id;
        const first = await f.data(f.req(path + '/messages', 'POST', { requestKey: 'message-1', expectedVersion: 1, message: '請問需要補交什麼？' }));
        assert.equal(first.case.version, 2);
        assert.deepEqual(await f.data(f.req(path + '/messages', 'POST', { requestKey: 'message-1', expectedVersion: 1, message: '請問需要補交什麼？' })), first);
        assert.equal((await f.req(path + '/messages', 'POST', { requestKey: 'message-1', expectedVersion: 2, message: '改寫' }))!.status, 409);
        const replies = await Promise.all([f.req(path + '/messages', 'POST', { requestKey: 'reply-one', expectedVersion: 2, message: '接待回覆' }, key, true), f.req(path + '/messages', 'POST', { requestKey: 'reply-two', expectedVersion: 2, message: '同時回覆' }, key, true)]);
        assert.deepEqual(replies.map(r => r!.status).sort(), [200, 409]);
        const update = await f.data(f.req(path + '/visit-plan', 'POST', { requestKey: 'visit-plan', expectedVersion: 3, visitPlan: { mode: 'manual-return' } }));
        assert.equal(update.case.version, 4);
        assert.equal(update.case.visitPlan.mode, 'manual-return');
        const p = await f.data(f.req(path + '?after=1'));
        assert.equal(p.events.length, 3);
        assert.equal(p.events[0].sequence, 2);
        assert.equal((await f.req(path + '?after=abc'))!.status, 400);
        assert.equal((await f.req(path + '/messages', 'POST', { requestKey: 'message-x', expectedVersion: 4, message: '不能偷看' }, other))!.status, 404);
    }
    finally {
        f.db.close();
    }
});
test('expired/revoked approvals and cross-purpose keys never activate, including changes during commit', async () => {
    const f = fixture();
    try {
        const c = await f.open();
        f.account();
        await f.approve(c.case.id, 1);
        const path = '/cases/' + c.case.id + '/activate', input = { requestKey: 'activation-one', expectedVersion: 2 };
        assert.equal((await f.req(path, 'POST', input, key, false, { 'X-Tower-Agent-Key': key }))!.status, 400);
        const before = f.db.batch.bind(f.db);
        f.db.batch = async (statements) => {
            if (statements.some(s => (s as unknown as {
                sql: string;
            }).sql.startsWith('INSERT INTO tower_tokens')))
                f.db.sqlite.prepare("UPDATE tower_reception_cases SET state='revoked' WHERE id=?").run(c.case.id);
            return before(statements);
        };
        assert.equal((await f.req(path, 'POST', input, key, false, { 'X-Tower-Agent-Key': towerKey }))!.status, 409);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_tokens').get()!.n, 0);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_reception_requests').get()!.n, 2);
        f.db.batch = before;
        f.db.sqlite.prepare("UPDATE tower_reception_cases SET state='approved' WHERE id=?").run(c.case.id);
        f.setTime('2026-12-01T12:00:00.000Z');
        assert.equal((await f.req(path, 'POST', input, key, false, { 'X-Tower-Agent-Key': towerKey }))!.status, 409);
        f.setTime('2027-03-01T12:00:00.000Z');
        assert.equal((await f.req('/cases/' + c.case.id))!.status, 403);
    }
    finally {
        f.db.close();
    }
});
test('binding changes at commit roll back grant, receipt and event without replacing the existing door or other tokens', async () => {
    const f = fixture();
    try {
        f.input.requestKind = 'takeover';
        const c = await f.open();
        f.account();
        const time = '2026-10-30T12:00:00.000Z';
        f.db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES('0123456789abcdef','account','虛構住戶','introduction','resident',0,'external-ready',?,0)").run(time);
        f.db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES('0123456789abcdef','account','new-resident','https://source.example/condo.json','owner-attested',?,?)").run(time, time);
        await f.approve(c.case.id, 1);
        const batch = f.db.batch.bind(f.db);
        f.db.batch = async (statements) => {
            if (statements.some(s => (s as unknown as {
                sql: string;
            }).sql.startsWith('INSERT INTO tower_tokens')))
                f.db.sqlite.prepare("UPDATE tower_residencies SET source_url='https://changed.example/condo.json'").run();
            return batch(statements);
        };
        assert.equal((await f.req('/cases/' + c.case.id + '/activate', 'POST', { requestKey: 'activation-one', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': towerKey }))!.status, 409);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_tokens').get()!.n, 0);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_reception_events').get()!.n, 2);
        f.db.batch = batch;
        f.db.sqlite.prepare("UPDATE tower_residencies SET source_url='https://source.example/condo.json'").run();
        await f.data(f.req('/cases/' + c.case.id + '/activate', 'POST', { requestKey: 'activation-one', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': towerKey }), 201);
        const resident = f.db.sqlite.prepare('SELECT room_id,resident_id,public_revision FROM tower_residencies').get()!;
        assert.equal(resident.room_id, '0123456789abcdef');
        assert.equal(resident.resident_id, 'new-resident');
        assert.equal(resident.public_revision, null);
        await f.data(f.req('/cases/' + c.case.id + '/revoke', 'POST', { requestKey: 'revoke-case', expectedVersion: 3 }, key, true));
        assert.equal(f.db.sqlite.prepare('SELECT revoked FROM tower_tokens').get()!.revoked, 1);
    }
    finally {
        f.db.close();
    }
});
test('malformed inputs, strict sharing and rate/message caps fail closed before network or grants', async () => {
    const f = fixture();
    const fetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw Error('network forbidden'); };
    try {
        assert.equal((await f.req('/cases', 'POST', { ...f.input, authorization: { ...f.input.authorization, application: false } }, other))!.status, 400);
        assert.equal((await f.req('/cases', 'POST', { ...f.input, sharing: { ...f.input.sharing, dream: true } }, other))!.status, 400);
        assert.equal((await f.req('/cases', 'POST', { ...f.input, visitPlan: { mode: 'self-scheduled', intervalHours: 0 } }, other))!.status, 400);
        const c = await f.open(), path = '/cases/' + c.case.id;
        assert.equal((await f.req('/cases', 'POST', { ...f.input, request: 'x'.repeat(9000) }, other))!.status, 413);
        assert.equal((await f.req('/cases', 'POST', f.input, other))!.status, 429);
        for (let i = 0; i < 19; i++)
            await f.data(f.req(path + '/messages', 'POST', { requestKey: 'message-' + String(i).padStart(3, '0'), expectedVersion: i + 1, message: '補充' }));
        assert.equal((await f.req(path + '/messages', 'POST', { requestKey: 'message-019', expectedVersion: 20, message: '第20筆' }))!.status, 200);
        assert.equal((await f.req(path + '/messages', 'POST', { requestKey: 'message-020', expectedVersion: 21, message: '超額' }))!.status, 429);
        assert.equal(calls, 0);
    }
    finally {
        globalThis.fetch = fetch;
        f.db.close();
    }
});
test('operator authentication is checked again immediately before commit', async () => {
    const f = fixture();
    try {
        const c = await f.open();
        let checks = 0;
        const api = createTowerReception({ db: f.db, origin, now: () => new Date('2026-10-30T12:00:00.000Z'), operator: async () => ++checks === 1 });
        const r = await api.fetch(new Request(origin + '/api/v1/operator/reception/cases/' + c.case.id + '/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: 'operator-reply', expectedVersion: 1, message: '不可寫入' }) }));
        assert.equal(r!.status, 401);
        assert.equal(checks, 2);
        assert.equal(f.db.sqlite.prepare('SELECT version FROM tower_reception_cases').get()!.version, 1);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_reception_events').get()!.n, 1);
    }
    finally {
        f.db.close();
    }
});
test('simultaneous activation issues one grant and exhausted event cap still permits withdrawal', async () => {
    const f = fixture();
    try {
        const c = await f.open();
        f.account();
        await f.approve(c.case.id, 1);
        const path = '/cases/' + c.case.id;
        const results = await Promise.all([f.req(path + '/activate', 'POST', { requestKey: 'activate-one', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': towerKey }), f.req(path + '/activate', 'POST', { requestKey: 'activate-two', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': other })]);
        assert.deepEqual(results.map(r => r!.status).sort(), [201, 409]);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_tokens').get()!.n, 1);
        for (let i = 4; i <= 100; i++)
            f.db.sqlite.prepare("INSERT INTO tower_reception_events VALUES(?,?,'system','test','',?)").run(c.case.id, i, '2026-10-30');
        assert.equal((await f.req(path + '/messages', 'POST', { requestKey: 'over-cap', expectedVersion: 3, message: '不能再留言' }))!.status, 409);
        await f.data(f.req(path + '/withdraw', 'POST', { requestKey: 'withdraw-at-cap', expectedVersion: 3 }));
        assert.equal(f.db.sqlite.prepare('SELECT revoked FROM tower_tokens').get()!.revoked, 1);
    }
    finally {
        f.db.close();
    }
});
test('global open/write and lifetime case caps reject excess work atomically', async () => {
    const f = fixture();
    try {
        const c = await f.open();
        const globalKey = f.db.sqlite.prepare("SELECT key FROM rate_limits WHERE key LIKE 'reception:global-open:%'").get()!.key;
        f.db.sqlite.prepare('UPDATE rate_limits SET count=100 WHERE key=?').run(globalKey);
        assert.equal((await f.req('/cases', 'POST', f.input, other))!.status, 429);
        const hour = Math.floor(Date.parse('2026-10-30T12:00:00.000Z') / 3600000);
        f.db.sqlite.prepare('INSERT INTO rate_limits VALUES(?,1000,?)').run('reception:global-write:' + hour, '2026-10-30T13:00:00.000Z');
        assert.equal((await f.req('/cases/' + c.case.id + '/messages', 'POST', { requestKey: 'over-global', expectedVersion: 1, message: '超額' }))!.status, 429);
        assert.equal(f.db.sqlite.prepare('SELECT version FROM tower_reception_cases').get()!.version, 1);
        f.db.sqlite.prepare('UPDATE rate_limits SET count=0 WHERE key=?').run(globalKey);
        const original = f.db.sqlite.prepare('SELECT * FROM tower_reception_cases').get()!;
        const columns = Object.keys(original);
        const insert = f.db.sqlite.prepare('INSERT INTO tower_reception_cases(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')');
        for (let i = 0; i < 9999; i++) {
            const clone: typeof original = { ...original, id: 'capacity-' + i, token_hash: 'capacity-hash-' + i };
            insert.run(...columns.map(k => clone[k]));
        }
        assert.equal((await f.req('/cases', 'POST', f.input, other, false, { 'CF-Connecting-IP': '192.0.2.2' }))!.status, 409);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_reception_cases').get()!.n, 10000);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_reception_requests').get()!.n, 1);
    }
    finally {
        f.db.close();
    }
});
test('an oversized stream remains 413 when cancelling the client stream fails', async () => {
    const f = fixture();
    try {
        const c = await f.open();
        const api = createTowerReception({ db: f.db, origin, now: () => new Date('2026-10-30T12:00:00.000Z'), operator: async () => false });
        const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8193)); }, cancel() { throw Error('client disconnected'); } });
        const req = new Request(origin + '/api/v1/reception/cases/' + c.case.id + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit & {
            duplex: string;
        });
        const r = await api.fetch(req);
        assert.equal(r!.status, 413);
        assert.equal(f.db.sqlite.prepare('SELECT version FROM tower_reception_cases').get()!.version, 1);
    }
    finally {
        f.db.close();
    }
});
test('new reception grants cannot prepare or commit a different first resident/source tuple', async () => {
    const f = fixture();
    try {
        const c = await f.open();
        f.account();
        await f.approve(c.case.id, 1);
        await f.data(f.req('/cases/' + c.case.id + '/activate', 'POST', { requestKey: 'activation-one', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': towerKey }), 201);
        f.db.sqlite.exec("UPDATE tower_reception_cases SET expires_at='2099-01-01T00:00:00.000Z',approval_expires_at='2099-01-01T00:00:00.000Z'; UPDATE tower_tokens SET expires_at='2099-01-01T00:00:00.000Z'");
        const intake = createTowerIntake({ db: f.db, origin, localTest: true, sourceOrigins: ['https://source.example'], now: () => new Date('2026-10-30T12:00:00.000Z'), fetcher: async () => { throw Error('unexpected fetch'); } });
        const prepare = (residentId: string, requestKey: string) => intake.fetch(new Request(origin + '/api/v1/agent/tower-intake/prepare', { method: 'POST', headers: { Authorization: 'Bearer ' + towerKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceURL: 'https://source.example/condo.json', residentId, requestKey }) }));
        assert.equal((await prepare('different-resident', 'wrong-tuple'))!.status, 503);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_claims').get()!.n, 0);
        assert.equal((await prepare('new-resident', 'right-tuple'))!.status, 201);
        const time = '2026-10-30T12:00:00.000Z';
        f.db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES('0123456789abcdef','account','新住戶','介紹','resident',0,'external-ready',?,0)").run(time);
        const insert = f.db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES('0123456789abcdef','account',?,?,'challenge',?,?)");
        assert.throws(() => insert.run('different-resident', 'https://source.example/condo.json', time, time), /reception_binding_required/);
        assert.throws(() => insert.run('new-resident', 'https://different.example/condo.json', time, time), /reception_binding_required/);
        insert.run('new-resident', 'https://source.example/condo.json', time, time);
        f.db.sqlite.prepare("UPDATE tower_residencies SET source_url='https://moved.example/condo.json'").run();
        assert.equal((await prepare('new-resident', 'later-source'))!.status, 201);
    }
    finally {
        f.db.close();
    }
});
test('exhausted message quotas cannot prevent applicant withdrawal or operator revocation', async () => {
    for (const action of ['withdraw', 'revoke']) {
        const f = fixture();
        try {
            const c = await f.open();
            f.account();
            await f.approve(c.case.id, 1);
            await f.data(f.req('/cases/' + c.case.id + '/activate', 'POST', { requestKey: 'activate-one', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': towerKey }), 201);
            f.db.sqlite.exec("UPDATE rate_limits SET count=1000 WHERE key LIKE 'reception:case:%' OR key LIKE 'reception:global-write:%'");
            await f.data(f.req('/cases/' + c.case.id + '/' + action, 'POST', { requestKey: 'safe-termination', expectedVersion: 3 }, key, action === 'revoke'));
            assert.equal(f.db.sqlite.prepare('SELECT revoked FROM tower_tokens').get()!.revoked, 1);
        }
        finally {
            f.db.close();
        }
    }
});
test('one invited account reserves one valid new case even before activation', async () => {
    const f = fixture();
    try {
        const a = await f.open();
        const b = await f.data(f.req('/cases', 'POST', { ...f.input, requestKey: 'open-second' }, other), 201);
        f.account();
        await f.approve(a.case.id, 1);
        const approveB = { requestKey: 'approve-second', expectedVersion: 1, accountId: 'account', residentId: 'second-resident', sourceURL: 'https://second.example/condo.json', approvedDays: 30 };
        assert.equal((await f.req('/cases/' + b.case.id + '/approve', 'POST', approveB, other, true))!.status, 409);
        await f.data(f.req('/cases/' + a.case.id + '/activate', 'POST', { requestKey: 'activate-first', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': towerKey }), 201);
        assert.equal((await f.req('/cases/' + b.case.id + '/approve', 'POST', approveB, other, true))!.status, 409);
        assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM tower_reception_cases WHERE state IN ('approved','active')").get()!.n, 1);
        f.db.sqlite.exec("UPDATE tower_reception_cases SET expires_at='2099-01-01T00:00:00.000Z',approval_expires_at='2099-01-01T00:00:00.000Z' WHERE state='active'; UPDATE tower_tokens SET expires_at='2099-01-01T00:00:00.000Z'");
        const intake = createTowerIntake({ db: f.db, origin, localTest: true, sourceOrigins: ['https://source.example', 'https://second.example'], now: () => new Date('2026-10-30T12:00:00.000Z') });
        const wrong = await intake.fetch(new Request(origin + '/api/v1/agent/tower-intake/prepare', { method: 'POST', headers: { Authorization: 'Bearer ' + towerKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ requestKey: 'wrong-second-tuple', sourceURL: 'https://second.example/condo.json', residentId: 'second-resident' }) }));
        assert.equal(wrong!.status, 503);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_claims').get()!.n, 0);
    }
    finally {
        f.db.close();
    }
});
test('concurrent new-case approvals for one empty account have one winner', async () => {
    const f = fixture();
    try {
        const a = await f.open();
        const b = await f.data(f.req('/cases', 'POST', { ...f.input, requestKey: 'open-second' }, other), 201);
        f.account();
        const approve = (id: string, residentId: string, sourceURL: string) => f.req('/cases/' + id + '/approve', 'POST', { requestKey: 'approve-concurrent', expectedVersion: 1, accountId: 'account', residentId, sourceURL, approvedDays: 30 }, key, true);
        const results = await Promise.all([approve(a.case.id, 'new-resident', 'https://source.example/condo.json'), approve(b.case.id, 'second-resident', 'https://second.example/condo.json')]);
        assert.deepEqual(results.map(r => r!.status).sort(), [200, 409]);
        assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM tower_reception_cases WHERE state='approved'").get()!.n, 1);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_audit').get()!.n, 1);
    }
    finally {
        f.db.close();
    }
});
test('legacy competing approvals cannot activate into a tuple union, even concurrently', async () => {
    const f = fixture();
    try {
        const a = await f.open();
        const b = await f.data(f.req('/cases', 'POST', { ...f.input, requestKey: 'open-second' }, other), 201);
        f.account();
        await f.approve(a.case.id, 1);
        f.db.sqlite.prepare("UPDATE tower_reception_cases SET state='approved',version=2,account_id='account',resident_id='second-resident',source_url='https://second.example/condo.json',approval_expires_at='2026-11-29T12:00:00.000Z' WHERE id=?").run(b.case.id);
        const activate = (id: string, caseKey: string, newKey: string) => f.req('/cases/' + id + '/activate', 'POST', { requestKey: 'activate-concurrent', expectedVersion: 2 }, caseKey, false, { 'X-Tower-Agent-Key': newKey });
        const results = await Promise.all([activate(a.case.id, key, towerKey), activate(b.case.id, other, 'd'.repeat(64))]);
        assert.deepEqual(results.map(r => r!.status), [409, 409]);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_tokens').get()!.n, 0);
        await f.data(f.req('/cases/' + b.case.id + '/revoke', 'POST', { requestKey: 'resolve-competing', expectedVersion: 2 }, key, true));
        await f.data(activate(a.case.id, key, towerKey), 201);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_tokens').get()!.n, 1);
    }
    finally {
        f.db.close();
    }
});
test('activation rechecks a competing approval introduced immediately before its transaction', async () => {
    const f = fixture();
    try {
        const a = await f.open();
        const b = await f.data(f.req('/cases', 'POST', { ...f.input, requestKey: 'open-second' }, other), 201);
        f.account();
        await f.approve(a.case.id, 1);
        const batch = f.db.batch.bind(f.db);
        f.db.batch = async (statements) => { if (statements.some(s => (s as unknown as {
            sql: string;
        }).sql.startsWith('INSERT INTO tower_tokens')))
            f.db.sqlite.prepare("UPDATE tower_reception_cases SET state='approved',version=2,account_id='account',resident_id='second-resident',source_url='https://second.example/condo.json',approval_expires_at='2026-11-29T12:00:00.000Z' WHERE id=?").run(b.case.id); return batch(statements); };
        assert.equal((await f.req('/cases/' + a.case.id + '/activate', 'POST', { requestKey: 'activation-guard', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': towerKey }))!.status, 409);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_tokens').get()!.n, 0);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_reception_events WHERE case_id=?').get(a.case.id)!.n, 2);
    }
    finally {
        f.db.close();
    }
});
test('exact private receipts survive case expiry and withdrawal without reviving any grant', async () => {
    for (const withdrawn of [false, true]) {
        const f = fixture();
        try {
            const opened = await f.open();
            f.account();
            await f.approve(opened.case.id, 1);
            const path = '/cases/' + opened.case.id;
            const activateBody = { requestKey: 'activation-receipt', expectedVersion: 2 }, headers = { 'X-Tower-Agent-Key': towerKey };
            const receipt = await f.data(f.req(path + '/activate', 'POST', activateBody, key, false, headers), 201);
            if (withdrawn)
                await f.data(f.req(path + '/withdraw', 'POST', { requestKey: 'withdraw-receipt', expectedVersion: 3 }));
            f.setTime('2027-01-29T12:00:00.000Z');
            const counts = () => f.db.sqlite.prepare('SELECT (SELECT count(*) FROM tower_tokens) tokens,(SELECT count(*) FROM tower_reception_requests) requests,(SELECT count(*) FROM tower_reception_events) events,(SELECT count(*) FROM tower_audit) audits').get();
            const before = counts();
            assert.deepEqual(await f.data(f.req(path + '/activate', 'POST', activateBody, key, false, headers), 201), receipt);
            assert.deepEqual(await f.data(f.req('/cases', 'POST', f.input), 201), opened);
            assert.deepEqual(counts(), before);
            assert.equal((await f.req('/cases', 'POST', {...f.input, requestKey:'new-after-expiry'}))!.status, 403);
            assert.equal(f.db.sqlite.prepare('SELECT revoked FROM tower_tokens').get()!.revoked, withdrawn ? 1 : 0);
            assert.equal((await f.req(path + '/messages', 'POST', { requestKey: 'new-after-expiry', expectedVersion: withdrawn ? 4 : 3, message: '不可新增' }))!.status, 403);
            assert.equal((await f.req(path))!.status, 403);
            assert.equal((await f.req(path + '/activate', 'POST', activateBody, other, false, headers))!.status, 404);
            assert.equal((await f.req(path + '/activate', 'POST', activateBody, key, false, { 'X-Tower-Agent-Key': 'd'.repeat(64) }))!.status, 409);
            const intake = createTowerIntake({ db: f.db, origin, localTest: true, sourceOrigins: [], now: () => new Date('2027-01-29T12:00:00.000Z') });
            assert.equal((await intake.fetch(new Request(origin + '/api/v1/agent/tower-intake', { headers: { Authorization: 'Bearer ' + towerKey } })))!.status, 403);
        }
        finally {
            f.db.close();
        }
    }
});
test('concurrent approval and activation preserve the existing reservation', async () => {
    const f = fixture();
    try {
        const a = await f.open(), b = await f.data(f.req('/cases', 'POST', { ...f.input, requestKey: 'open-second' }, other), 201);
        f.account();
        await f.approve(a.case.id, 1);
        const results = await Promise.all([f.req('/cases/' + a.case.id + '/activate', 'POST', { requestKey: 'activate-reserved', expectedVersion: 2 }, key, false, { 'X-Tower-Agent-Key': towerKey }), f.req('/cases/' + b.case.id + '/approve', 'POST', { requestKey: 'approve-while-activating', expectedVersion: 1, accountId: 'account', residentId: 'second-resident', sourceURL: 'https://second.example/condo.json', approvedDays: 30 }, key, true)]);
        assert.deepEqual(results.map(r => r!.status), [201, 409]);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_tokens').get()!.n, 1);
    }
    finally {
        f.db.close();
    }
});
test('expired or withdrawn reservations allow an operator to approve a replacement case', async () => {
    for (const expired of [false, true]) {
        const f = fixture();
        try {
            const a = await f.open(), b = await f.data(f.req('/cases', 'POST', { ...f.input, requestKey: 'open-second' }, other), 201);
            f.account();
            await f.approve(a.case.id, 1);
            if (expired)
                f.setTime('2026-12-01T12:00:00.000Z');
            else
                await f.data(f.req('/cases/' + a.case.id + '/withdraw', 'POST', { requestKey: 'withdraw-first', expectedVersion: 2 }));
            const approval = await f.data(f.req('/cases/' + b.case.id + '/approve', 'POST', { requestKey: 'approve-replacement', expectedVersion: 1, accountId: 'account', residentId: 'second-resident', sourceURL: 'https://second.example/condo.json', approvedDays: 30 }, key, true));
            assert.equal(approval.case.state, 'approved');
        }
        finally {
            f.db.close();
        }
    }
});
test('clipboard success and fallback use the same invitation containing absolute service URLs', async () => {
    for (const clipboardFails of [false, true]) {
        let handler: (() => Promise<void>) | undefined, selected = false, copied = '';
        const invitation = { value: '請先讀取本頁同站的 /reception-onboarding.json。', focus() { }, select() { selected = true; } }, status = { textContent: '' };
        const button = { addEventListener(_event: string, callback: () => Promise<void>) { handler = callback; } };
        const context = { document: { querySelector(selector: string) { return selector === '#invitation' ? invitation : selector === '#copy-invitation' ? button : status; } }, location: { origin }, navigator: { clipboard: { async writeText(value: string) { copied = value; if (clipboardFails)
                        throw Error('clipboard unavailable'); } } } };
        runInNewContext(readFileSync(new URL('../public/reception.js', import.meta.url), 'utf8'), context);
        assert.match(invitation.value, new RegExp(origin + '/reception-onboarding\\.json'));
        assert(invitation.value.includes('接待網址：' + origin + '/reception'));
        await handler!();
        assert.equal(copied, invitation.value);
        assert.equal(selected, clipboardFails);
    }
});
test('approval rechecks a reservation introduced after preliminary reads and rolls back atomically', async () => {
    const f = fixture();
    try {
        const a = await f.open(), b = await f.data(f.req('/cases', 'POST', { ...f.input, requestKey: 'open-second' }, other), 201);
        f.account();
        const batch = f.db.batch.bind(f.db);
        f.db.batch = async (statements) => { if (statements.some(s => { const local = s as unknown as {
            sql: string;
            values: unknown[];
        }; return local.sql.startsWith('UPDATE tower_reception_cases SET state=') && local.values[0] === 'approved'; }))
            f.db.sqlite.prepare("UPDATE tower_reception_cases SET state='approved',version=2,account_id='account',resident_id='second-resident',source_url='https://second.example/condo.json',approval_expires_at='2026-11-29T12:00:00.000Z' WHERE id=?").run(b.case.id); return batch(statements); };
        const result = await f.req('/cases/' + a.case.id + '/approve', 'POST', { requestKey: 'approve-at-commit', expectedVersion: 1, accountId: 'account', residentId: 'new-resident', sourceURL: 'https://source.example/condo.json', approvedDays: 30 }, key, true);
        assert.equal(result!.status, 409);
        assert.equal(f.db.sqlite.prepare('SELECT state FROM tower_reception_cases WHERE id=?').get(a.case.id)!.state, 'pending');
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_audit').get()!.n, 0);
        assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_reception_requests').get()!.n, 2);
    }
    finally {
        f.db.close();
    }
});
