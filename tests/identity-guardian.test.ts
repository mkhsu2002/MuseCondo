import {syntheticMailReady} from './helpers/identity-mail-ready-fixture.ts';
import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { LocalDatabase } from '../server/live/local-db.ts';
import type { Statement } from '../server/live/db.ts';
import { hashIdentityInput } from '../server/live/identity-private.ts';
import {createIdentityMailCoordinator} from '../server/live/identity-mail-coordinator.ts';
import runtime from '../server/live/worker.ts';
const origin = 'https://identity.example', time = '2026-10-31T00:00:00.000Z', contactKey = '9'.repeat(64), base = '/api/v1/agent/identity/guardian-invitations', operatorBase = '/api/v1/operator/identity/guardian-invitations';
const nativeDates = new LocalDatabase(':memory:');
test.after(() => nativeDates.close());
async function fixture() {
    const db = new LocalDatabase(':memory:');
    for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort())
        db.sqlite.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
 openSyntheticTower(db);
 await syntheticMailReady(db,origin,contactKey);
    for (const x of ['a', 'b']) {
        const account = x.repeat(16), agent = 'mcid:' + x.repeat(64);
        db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account, 'guardian-' + x, time);
        db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Test','Test','resident','external-ready',?)").run(account, account, time);
        db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)").run(account, account, account, 'https://source.example/' + x, time, time);
        db.sqlite.prepare('INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').run(agent, account, account, account, time, time);
        db.sqlite.prepare('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)').run(x, account, await hashIdentityInput(x.repeat(64)), JSON.stringify(['tower:read', 'tower:write']), '2027-01-01T00:00:00.000Z', time);
    }
    db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run('e'.repeat(16), 'guardian-extra', time);
    let now = new Date(time), operatorEnabled = true;
    db.sqlite.function('strftime', { varargs: true }, (...args) => args[1] === 'now' ? now.toISOString() : nativeDates.sqlite.prepare('SELECT strftime(' + args.map(() => '?').join(',') + ') value').get(...args)!.value);
    const dispatched: string[] = [], providerCalls: RequestInit[] = [];
    const coordinator={idFromName:(n:string)=>n,get:()=>({fetch:(request:Request)=>createIdentityMailCoordinator({db,origin,contactKey,from:'MuseCondo <identity@example.com>',trustedKeys:new Map(),now:()=>now}).fetch(request)})};
    const env = { db, origin, contactKey, coordinator,deliveryEnabled:'true', apiKey: 'runtime-key', from: 'MuseCondo <identity@example.com>', now: () => now, operator: async (r: Request) => operatorEnabled && r.headers.get('X-Tower-Operator-Key') === 'operator-key', onMailEvent: (id: string) => { dispatched.push(id); }, fetcher: async (_url: unknown, init?: RequestInit) => { if(String(_url).includes('/suppressions/'))return new Response(null,{status:404});providerCalls.push({...init,body:await new Response(init!.body).text()}); return new Response(JSON.stringify({ id: 'provider-one' })); } };
    assert(existsSync(new URL('../server/live/identity-guardian.ts', import.meta.url)), 'guardian invitation handler is implemented');
    const { createIdentityGuardian } = await import('../server/live/identity-guardian.ts');
    let handler = createIdentityGuardian(env);
    const input = { requestKey: 'proposal-0001', agentId: 'mcid:' + 'a'.repeat(64), expectedVersion: 1, email: 'Guardian.Local@EXAMPLE.COM', attestGuardianDesignated: true };
    const send = (path: string, method = 'GET', body?: unknown, token = 'a', headers: Record<string, string> = {}) => handler.fetch(new Request(origin + path, { method, headers: { ...(path.startsWith('/api/v1/operator/') ? { 'X-Tower-Operator-Key': 'operator-key' } : { Authorization: 'Bearer ' + token.repeat(64) }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const propose = (body: unknown = input) => send(operatorBase, 'POST', body), accept = (id: string, body: unknown = { requestKey: 'accept-0001', expectedVersion: 1, guardianConsent: true }, token = 'a') => send(base + '/' + id + '/accept', 'POST', body, token);
    const count = (t: string) => Number(db.sqlite.prepare('SELECT COUNT(*) n FROM ' + t).get()!.n);
    return { db, env, input, send, propose, accept, count, dispatched, providerCalls, setTime: (s: string) => { now = new Date(s); }, operatorOff: () => { operatorEnabled = false; }, reconfigure: (extra: Partial<typeof env>) => { handler = createIdentityGuardian({ ...env, ...extra }); } };
}
async function proposed(f: Awaited<ReturnType<typeof fixture>>) { const r = (await f.propose())!; assert.equal(r.status, 201, await r.clone().text()); return (await r.json()).invitation; }
test('both parties consent before one encrypted mail event; identity remains provisional and Tower state is untouched', async () => {
    const f = await fixture();
    try {
        const tables = ['rooms', 'tower_residencies', 'tower_snapshots', 'tower_tokens', 'consent_events', 'dream_consent', 'manager_jobs', 'manager_events', 'private_profiles', 'assets'];
        const before = tables.map(t => f.db.sqlite.prepare('SELECT * FROM ' + t).all());
        const p = await proposed(f);
        assert.equal(p.state, 'proposed');
        assert.equal(p.version, 1);
        assert.equal(p.expectedIdentityVersion, 2);
        assert.equal(p.maskedEmail, '***@example.com');
        assert.equal(f.count('identity_mail_events'), 0);
        assert.equal(f.dispatched.length, 0);
        const get = (await f.send(base))!;
        assert.deepEqual(await get.json(), { invitations: [p] });
        assert.deepEqual(await (await f.send(base, 'GET', undefined, 'b'))!.json(), { invitations: [] });
        const r = (await f.accept(p.id))!;
        assert.equal(r.status, 200, await r.clone().text());
        const result = await r.json();
        assert.equal(result.invitation.state, 'accepted');
        assert.equal(result.invitation.version, 2);
        assert.equal(result.invitation.expectedIdentityVersion, 3);
        assert.equal(result.identityVersion, 3);
        assert.equal(result.mailEvent.state, 'pending');
        assert.deepEqual(f.dispatched, [result.mailEvent.id]);
        assert.equal(f.count('identity_mail_events'), 1);
        assert.equal(f.count('guardian_invite_requests'), 2);
        assert.equal(f.providerCalls.length, 0);
        const i = f.db.sqlite.prepare('SELECT * FROM agent_identities WHERE agent_id=?').get(f.input.agentId)!;
        assert.equal(i.version, 3);
        assert.equal(i.state, 'provisional');
        assert.equal(i.authority_epoch, 1);
        assert.equal(i.recovery_consent, 1);
        for (const [n, t] of tables.entries())
            assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM ' + t).all(), before[n], t);
        const secretRows = JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_guardian_invites').all()) + JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_events').all()) + JSON.stringify(f.db.sqlite.prepare('SELECT * FROM guardian_invite_requests').all()) + JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_audit').all());
        assert(!secretRows.includes('Guardian.Local'));
        assert(!JSON.stringify(result).includes('ciphertext'));
        assert(!JSON.stringify(result).includes('token'));
        assert.equal(r.headers.get('cache-control'), 'no-store');
        assert.match(r.headers.get('x-robots-tag')!, /noindex/);
    }
    finally {
        f.db.close();
    }
});
test('permanent exact receipts redispatch the original event without another version, charge, audit or provider attempt', async () => {
    const f = await fixture();
    try {
        const first = (await f.propose())!, p = await first.json();
        assert.deepEqual(await (await f.propose())!.json(), p);
        assert.equal((await f.propose({ ...f.input, email: 'other@example.com' }))!.status, 409);
        const accept = (await f.accept(p.invitation.id))!, a = await accept.json();
        assert.deepEqual(await (await f.accept(p.invitation.id))!.json(), a);
        assert.equal((await f.accept(p.invitation.id, { requestKey: 'accept-0001', expectedVersion: 2, guardianConsent: true }))!.status, 409);
        assert.equal(f.dispatched.length, 2);
        assert.equal(f.count('guardian_invite_requests'), 2);
        assert.equal(f.count('guardian_invite_rate_attempts'), 2);
        assert.equal(f.count('identity_audit'), 2);
        assert.equal(f.count('identity_mail_audit'), 1);
        assert.equal((await f.propose({ ...f.input, requestKey: 'replacement-key', expectedVersion: 3 }))!.status, 409);
        f.db.sqlite.prepare("UPDATE tower_tokens SET revoked=1 WHERE id='a'").run();
        assert.equal((await f.accept(p.invitation.id))!.status, 403);
        f.operatorOff();
        assert.equal((await f.propose())!.status, 401);
    }
    finally {
        f.db.close();
    }
});
test('cross-account acceptance, stale versions and expired or registered invitations cannot change authority', async () => {
    const f = await fixture();
    try {
        const p = await proposed(f);
        assert.equal((await f.accept(p.id, undefined, 'b'))!.status, 404);
        assert.equal((await f.accept(p.id, { requestKey: 'stale-0001', expectedVersion: 2, guardianConsent: true }))!.status, 409);
        f.setTime(p.expiresAt);
        assert.equal((await f.accept(p.id))!.status, 409);
        assert.equal(f.count('identity_mail_events'), 0);
        f.setTime(time);
        assert.equal((await f.accept(p.id))!.status, 200);
        f.db.sqlite.prepare("UPDATE identity_guardian_invites SET state='registered'").run();
        assert.equal((await f.propose({ ...f.input, requestKey: 'replace-registered', expectedVersion: 3 }))!.status, 409);
        assert.equal(f.count('identity_guardian_invites'), 1);
    }
    finally {
        f.db.close();
    }
});
test('the same address on separate households is never an identity merge', async () => {
    const f = await fixture();
    try {
        const a = await proposed(f);
        const b = (await f.propose({ ...f.input, agentId: 'mcid:' + 'b'.repeat(64), requestKey: 'proposal-other' }))!;
        assert.equal(b.status, 201);
        assert.notEqual((await b.json()).invitation.id, a.id);
        assert.equal(f.count('agent_identities'), 2);
        assert.equal(f.count('identity_guardian_invites'), 2);
    }
    finally {
        f.db.close();
    }
});
test('strict JSON schemas and separate same-origin scopes reject unauthorized consent and private input leakage', async () => {
    const f = await fixture();
    try {
        for (const headers of [{ Cookie: 'session=x' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[]) {
            assert.equal((await f.send(operatorBase, 'POST', f.input, 'a', headers))!.status, 403);
            assert.equal((await f.send(base, 'GET', undefined, 'a', headers))!.status, 403);
        }
        assert.equal((await f.send(operatorBase, 'POST', f.input, 'a', { 'X-Tower-Operator-Key': '' }))!.status, 401);
        assert.equal((await f.send(base, 'GET', undefined, 'a', { Authorization: '' }))!.status, 401);
        for (const body of [{ ...f.input, attestGuardianDesignated: false }, { ...f.input, extra: true }, { ...f.input, email: 'x\r\ny@example.com' }, { ...f.input, email: 'x@example.com,y@example.com' }, { ...f.input, expectedVersion: 0 }, { ...f.input, requestKey: 'short' }])
            assert.equal((await f.propose(body))!.status, 400);
        const p = await proposed(f);
        for (const body of [{ requestKey: 'accept-0001', expectedVersion: 1, guardianConsent: false }, { requestKey: 'accept-0001', expectedVersion: 1, guardianConsent: true, email: 'x@example.com' }, { requestKey: 'accept-0001', expectedVersion: '1', guardianConsent: true }])
            assert.equal((await f.accept(p.id, body))!.status, 400);
        f.db.sqlite.prepare("UPDATE tower_tokens SET scopes='[\"tower:read\"]' WHERE id='a'").run();
        assert.equal((await f.accept(p.id))!.status, 403);
        assert.equal((await f.send(base))!.status, 200);
        f.db.sqlite.prepare("UPDATE tower_tokens SET scopes='[\"tower:write\"]' WHERE id='a'").run();
        assert.equal((await f.send(base))!.status, 403);
        assert.equal((await f.send(base, 'POST', {}))!.status, 405);
        assert.equal((await f.send(operatorBase))!.status, 405);
        assert.equal(await f.send(base + '/confirm'), null);
        assert.equal(f.count('identity_mail_events'), 0);
    }
    finally {
        f.db.close();
    }
});
test('streaming JSON has a 16KiB bound, including cancellation errors', async () => {
    const f = await fixture();
    try {
        const { createIdentityGuardian } = await import('../server/live/identity-guardian.ts');
        const h = createIdentityGuardian(f.env);
        const raw = (body: BodyInit, headers: Record<string, string> = {}) => h.fetch(new Request(origin + operatorBase, { method: 'POST', headers: { 'X-Tower-Operator-Key': 'operator-key', 'Content-Type': 'application/json', ...headers }, body, ...(body instanceof ReadableStream ? { duplex: 'half' as const } : {}) }));
        const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16385)); }, cancel() { throw new Error('synthetic cancellation'); } });
        assert.equal((await raw(stream))!.status, 413);
        assert.equal((await raw('{}', { 'Content-Length': '16385' }))!.status, 413);
        assert.equal((await raw('{}', { 'Content-Type': 'text/plain' }))!.status, 415);
        assert.equal((await raw('{'))!.status, 400);
        assert.equal((await raw(new Uint8Array([0xff])))!.status, 400);
    }
    finally {
        f.db.close();
    }
});
test('missing sender, provider or contact configuration cannot consume acceptance versions', async () => {
    for (const config of [{ apiKey: '' }, { from: '' }, { contactKey: '' }]) {
        const f = await fixture();
        try {
            const p = await proposed(f);
            f.reconfigure(config);
            assert.equal((await f.accept(p.id))!.status, 503);
            assert.equal(f.db.sqlite.prepare('SELECT version FROM agent_identities WHERE agent_id=?').get(f.input.agentId)!.version, 2);
            assert.equal(f.db.sqlite.prepare('SELECT version FROM identity_guardian_invites').get()!.version, 1);
            assert.equal(f.count('identity_mail_events'), 0);
            assert.equal(f.count('guardian_invite_requests'), 1);
        }
        finally {
            f.db.close();
        }
    }
});
test('competing requests cannot partially designate or enqueue twice', async () => {
    for (const same of [true, false]) {
        const f = await fixture();
        try {
            const results = await Promise.all([f.propose(), f.propose(same ? f.input : { ...f.input, requestKey: 'proposal-competing' })]);
            assert.deepEqual(results.map(r => r!.status).sort(), same ? [201, 201] : [201, 409]);
            const p = await results.find(r => r!.status === 201)!.json();
            const accepted = await Promise.all([f.accept(p.invitation.id), f.accept(p.invitation.id, same ? undefined : { requestKey: 'accept-competing', expectedVersion: 1, guardianConsent: true })]);
            assert.deepEqual(accepted.map(r => r!.status).sort(), same ? [200, 200] : [200, 409]);
            assert.equal(f.count('identity_guardian_invites'), 1);
            assert.equal(f.count('identity_mail_events'), 1);
            assert.equal(f.count('guardian_invite_requests'), 2);
            assert.equal(f.dispatched.length, same ? 2 : 1);
        }
        finally {
            f.db.close();
        }
    }
});
test('operator cancellation invalidates the code and permits a fresh bilateral invitation, including expiry', async () => {
    for (const accepted of [false, true]) {
        const f = await fixture();
        try {
            const p = await proposed(f);
            if (accepted)
                assert.equal((await f.accept(p.id))!.status, 200);
            f.setTime('2026-11-02T00:00:00.000Z');
            const version = accepted ? 2 : 1;
            const path = operatorBase + '/' + p.id + '/cancel', body = { requestKey: 'cancel-0001', expectedVersion: version };
            const response = (await f.send(path, 'POST', body))!;
            assert.equal(response.status, 200);
            const result = await response.json();
            assert.equal(result.invitation.state, 'cancelled');
            assert.equal(result.invitation.version, version + 1);
            assert.equal(f.db.sqlite.prepare('SELECT invite_token_hash FROM identity_guardian_invites WHERE id=?').get(p.id)!.invite_token_hash, null);
            assert.deepEqual(await (await f.send(path, 'POST', body))!.json(), result);
            if (accepted) {
                assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events').get()!.state, 'cancelled');
                assert.equal(f.count('identity_mail_audit'), 2);
            }
            f.setTime('2026-11-02T00:00:01.000Z');
            const replacement = (await f.propose({ ...f.input, requestKey: 'fresh-proposal', expectedVersion: result.identityVersion }))!;
            assert.equal(replacement.status, 201);
            const fresh = await replacement.json();
            assert.notEqual(fresh.invitation.id, p.id);
            assert.equal(fresh.invitation.state, 'proposed');
            assert.equal(f.dispatched.length, accepted ? 1 : 0);
            assert.equal((await f.accept(p.id, { requestKey: 'old-accept-key', expectedVersion: version + 1, guardianConsent: true }))!.status, 409);
        }
        finally {
            f.db.close();
        }
    }
});
test('cancellation preserves sending, unknown and accepted outcomes; registered guardians cannot be cancelled', async () => {
    for (const state of ['sending', 'unknown', 'accepted']) {
        const f = await fixture();
        try {
            const p = await proposed(f);
            await f.accept(p.id);
            f.db.sqlite.prepare('UPDATE identity_mail_events SET state=?').run(state);
            const r = (await f.send(operatorBase + '/' + p.id + '/cancel', 'POST', { requestKey: 'cancel-0001', expectedVersion: 2 }))!;
            assert.equal(r.status, 200);
            assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events').get()!.state, state);
            assert.equal(f.count('identity_mail_audit'), 1);
        }
        finally {
            f.db.close();
        }
    }
    const f = await fixture();
    try {
        const p = await proposed(f);
        await f.accept(p.id);
        f.db.sqlite.prepare("UPDATE identity_guardian_invites SET state='registered'").run();
        assert.equal((await f.send(operatorBase + '/' + p.id + '/cancel', 'POST', { requestKey: 'cancel-registered', expectedVersion: 2 }))!.status, 409);
        assert.equal(f.db.sqlite.prepare('SELECT version FROM agent_identities WHERE agent_id=?').get(f.input.agentId)!.version, 3);
    }
    finally {
        f.db.close();
    }
});
test('acceptance and cancellation compete on the same invitation version atomically', async () => {
    const f = await fixture();
    try {
        const p = await proposed(f);
        const results = await Promise.all([f.accept(p.id), f.send(operatorBase + '/' + p.id + '/cancel', 'POST', { requestKey: 'cancel-race', expectedVersion: 1 })]);
        assert.deepEqual(results.map(r => r!.status).sort(), [200, 409]);
        assert.equal(f.count('guardian_invite_requests'), 2);
        assert.equal(f.count('identity_audit'), 2);
        const invite = f.db.sqlite.prepare('SELECT * FROM identity_guardian_invites').get()!;
        assert.equal(invite.version, 2);
        assert.equal(f.db.sqlite.prepare('SELECT version FROM agent_identities WHERE agent_id=?').get(f.input.agentId)!.version, 3);
    }
    finally {
        f.db.close();
    }
});
test('accept commit revalidates scoped authorization, identity tuple and invitation version with no partial writes', async () => {
    const mutations = [
        "UPDATE tower_tokens SET revoked=1 WHERE id='a'",
        "UPDATE tower_tokens SET scopes='[\"tower:read\"]' WHERE id='a'",
        "UPDATE tower_tokens SET account_id='" + 'b'.repeat(16) + "' WHERE id='a'",
        "UPDATE tower_tokens SET expires_at='2026-10-31T00:00:00.000Z' WHERE id='a'",
        "UPDATE agent_identities SET version=3 WHERE agent_id='mcid:" + 'a'.repeat(64) + "'",
        "UPDATE agent_identities SET authority_epoch=2 WHERE agent_id='mcid:" + 'a'.repeat(64) + "'",
        "UPDATE tower_residencies SET resident_id='" + 'e'.repeat(16) + "' WHERE account_id='" + 'a'.repeat(16) + "'",
        "UPDATE rooms SET account_id='" + 'e'.repeat(16) + "' WHERE id='" + 'a'.repeat(16) + "'",
        "UPDATE identity_guardian_invites SET version=2",
        "UPDATE identity_guardian_invites SET state='cancelled'",
    ];
    for (const [n, mutation] of mutations.entries()) {
        const f = await fixture();
        try {
            const p = await proposed(f);
            const batch = f.db.batch.bind(f.db);
            f.db.batch = async (statements: Statement[]) => { if (statements.some(s => (s as unknown as {
                sql: string;
            }).sql.startsWith('INSERT INTO identity_mail_events')))
                f.db.sqlite.exec(mutation); return batch(statements); };
            const r = (await f.accept(p.id))!;
            assert.equal(r.status, n < 4 ? 403 : 409, String(n));
            assert.equal(f.count('identity_mail_events'), 0);
            assert.equal(f.count('identity_mail_audit'), 0);
            assert.equal(f.count('guardian_invite_requests'), 1);
            assert.equal(f.count('identity_audit'), 1);
            assert.equal(f.dispatched.length, 0);
        }
        finally {
            f.db.close();
        }
    }
});
test('operator is rechecked before proposal and cancellation commit; failed audit rolls the whole agreement back', async () => {
    for (const kind of ['proposal', 'cancel', 'audit']) {
        const f = await fixture();
        try {
            if (kind === 'proposal') {
                let calls = 0;
                f.reconfigure({ operator: async () => ++calls < 3 });
                assert.equal((await f.propose())!.status, 401);
                assert.equal(f.count('identity_guardian_invites'), 0);
                assert.equal(f.count('identity_audit'), 0);
            }
            else {
                const p = await proposed(f);
                if (kind === 'cancel') {
                    let calls = 0;
                    f.reconfigure({ operator: async () => ++calls < 3 });
                    assert.equal((await f.send(operatorBase + '/' + p.id + '/cancel', 'POST', { requestKey: 'cancel-0001', expectedVersion: 1 }))!.status, 401);
                }
                else {
                    f.db.sqlite.exec("CREATE TRIGGER fail_guardian_audit BEFORE INSERT ON identity_mail_audit BEGIN SELECT RAISE(ABORT,'synthetic'); END");
                    assert.equal((await f.accept(p.id))!.status, 503);
                    assert.equal(f.count('identity_mail_events'), 0);
                    assert.equal(f.dispatched.length, 0);
                }
                assert.equal(f.count('guardian_invite_requests'), 1);
                assert.equal(f.db.sqlite.prepare('SELECT version FROM agent_identities WHERE agent_id=?').get(f.input.agentId)!.version, 2);
                assert.equal(f.db.sqlite.prepare('SELECT version FROM identity_guardian_invites').get()!.version, 1);
            }
        }
        finally {
            f.db.close();
        }
    }
});
test('proposal and acceptance use permanent per-input reservations and exact replays survive quota exhaustion', async () => {
    const f = await fixture();
    try {
        const p = await proposed(f);
        await f.accept(p.id);
        for (const key of ['guardian:operator:guardian', 'guardian:agent:' + 'a'.repeat(16), 'guardian:global'])
            f.db.sqlite.prepare('UPDATE rate_limits SET count=1000 WHERE key=?').run(key);
        assert.equal((await f.propose())!.status, 201);
        assert.equal((await f.accept(p.id))!.status, 200);
        assert.equal((await f.propose({ ...f.input, requestKey: 'new-rate-key', expectedVersion: 3 }))!.status, 429);
        assert.equal(f.count('guardian_invite_rate_attempts'), 2);
        assert.equal(f.dispatched.length, 2);
    }
    finally {
        f.db.close();
    }
});
test('protected mail processing only consumes its persisted event and returns no private payload', async () => {
    const f = await fixture();
    try {
        const p = await proposed(f);
        const a = await (await f.accept(p.id))!.json(), path = '/api/v1/operator/identity/mail/' + a.mailEvent.id;
        const pending = (await f.send(path))!;
        assert.equal((await pending.json()).state, 'pending');
        assert.equal((await f.send(path + '/process', 'POST', { to: 'intruder@example.com' }))!.status, 400);
        const result = (await f.send(path + '/process', 'POST', {}))!;
        assert.equal(result.status, 200);
        assert.equal((await result.json()).state, 'accepted');
        assert.equal(f.providerCalls.length, 1);
        const body = JSON.parse(String(f.providerCalls[0].body));
        assert.deepEqual(body.to, ['Guardian.Local@example.com']);
        assert(body.text.includes(f.input.agentId));
        await f.send(path + '/process', 'POST', {});
        assert.equal(f.providerCalls.length, 1);
        const status = await (await f.send(path))!.text();
        assert(!status.includes('Guardian.Local'));
        assert(!status.includes('ciphertext'));
        assert(!status.includes('token'));
        assert.equal((await f.send(path, 'GET', undefined, 'a', { 'X-Tower-Operator-Key': '' }))!.status, 401);
    }
    finally {
        f.db.close();
    }
});
test('Pages dispatch persists before waitUntil sends the exact event, and unreleased confirmation routes remain closed', async () => {
    const f = await fixture(), original = globalThis.fetch, pending: Promise<unknown>[] = [];
    let calls = 0;
    globalThis.fetch = async (_url, init) => { if(String(_url).includes('/suppressions/'))return new Response(null,{status:404});calls++; assert.equal(f.count('identity_mail_events'), 1); assert.equal(f.count('guardian_invite_requests'), 2); assert.deepEqual(JSON.parse(await new Response(init!.body).text()).to, ['Guardian.Local@example.com']); return new Response(JSON.stringify({ id: 'runtime-provider' })); };
    try {
        f.db.sqlite.function('strftime', { varargs: true }, (...args) => nativeDates.sqlite.prepare('SELECT strftime(' + args.map(() => '?').join(',') + ') value').get(...args)!.value);
        f.db.sqlite.prepare("UPDATE tower_tokens SET expires_at='2099-01-01T00:00:00.000Z'").run();
        const env = { DB: f.db, PUBLIC_ORIGIN: origin, TOWER_OPERATOR_KEY: 'operator-key', IDENTITY_CONTACT_KEY: contactKey, IDENTITY_MAIL_API_KEY: 'runtime-key', IDENTITY_MAIL_FROM: 'MuseCondo <identity@example.com>',IDENTITY_CARDS:{idFromName:(n:string)=>n,get:()=>({fetch:(request:Request)=>createIdentityMailCoordinator({db:f.db,origin,contactKey,from:f.env.from,trustedKeys:new Map()}).fetch(request)})},IDENTITY_MAIL_DELIVERY_ENABLED:'true' };
        const req = (path: string, method = 'GET', body?: unknown, operator = false) => new Request(origin + path, { method, headers: { ...(operator ? { 'X-Tower-Operator-Key': 'operator-key' } : { Authorization: 'Bearer ' + 'a'.repeat(64) }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const proposal = await runtime.fetch(req(operatorBase, 'POST', f.input, true), env);
        assert.equal(proposal.status, 201);
        const p = await proposal.json();
        assert.equal(calls, 0);
        const response = await runtime.fetch(req(base + '/' + p.invitation.id + '/accept', 'POST', { requestKey: 'accept-runtime', expectedVersion: 1, guardianConsent: true }), env, { waitUntil(p) { pending.push(p); } });
        assert.equal(response.status, 200);
        const accepted = await response.json();
        assert.equal(pending.length, 1);
        await Promise.all(pending);
        assert.equal(calls, 1);
        const replay = await runtime.fetch(req(base + '/' + p.invitation.id + '/accept', 'POST', {requestKey:'accept-runtime',expectedVersion:1,guardianConsent:true}), env);assert.deepEqual(await replay.json(),accepted);assert.equal(calls,1);
        const status = await runtime.fetch(req('/api/v1/operator/identity/mail/' + accepted.mailEvent.id, 'GET', undefined, true), env);
        assert.equal((await status.json()).state, 'accepted');
        assert.equal((await runtime.fetch(req(base + '/confirm', 'POST', {}), env)).status, 404);
        assert.equal((await runtime.fetch(req('/api/v1/agent/identity'), env)).status, 200);
        const metadata = await (await runtime.fetch(req('/api/v1/agent/identity'), env)).json();
        assert.equal(metadata.identity.recoveryConfigured, false);
        assert.equal(metadata.identity.issuanceReady, false);
    }
    finally {
        globalThis.fetch = original;
        f.db.close();
    }
});
test('Pages fails closed until every guardian table and binding trigger exists', async () => {
    const f = await fixture();
    try {
        for (const name of ['identity_guardian_invites', 'guardian_invite_requests', 'guardian_invite_rate_attempts', 'identity_mail_events', 'identity_mail_audit']) {
            f.db.sqlite.exec('ALTER TABLE ' + name + ' RENAME TO hidden_' + name);
            const res = await runtime.fetch(new Request(origin + base), { DB: f.db, PUBLIC_ORIGIN: origin });
            assert.equal(res.status, 503, name);
            assert.equal((await res.json()).error, 'database_schema_not_ready');
            f.db.sqlite.exec('ALTER TABLE hidden_' + name + ' RENAME TO ' + name);
        }
        for (const name of ['identity_guardian_account_binding', 'identity_guardian_immutable_binding']) {
            const sql = f.db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)!.sql;
            f.db.sqlite.exec('DROP TRIGGER ' + name);
            const res = await runtime.fetch(new Request(origin + base), { DB: f.db, PUBLIC_ORIGIN: origin });
            assert.equal(res.status, 503, name);
            f.db.sqlite.exec(String(sql));
        }
    }
    finally {
        f.db.close();
    }
});
test('SQL-native clock expires acceptance while its batch waits without consuming identity or mail state', async () => {
    for (const expireToken of [false, true]) {
        const f = await fixture();
        try {
            const p = await proposed(f);
            const batch = f.db.batch.bind(f.db);
            f.db.batch = async (statements) => { if (statements.some(s => (s as unknown as {
                sql: string;
            }).sql.startsWith('INSERT INTO identity_mail_events')))
                f.setTime(expireToken ? '2027-01-01T00:00:00.000Z' : p.expiresAt); return batch(statements); };
            const result = (await f.accept(p.id))!;
            assert.equal(result.status, expireToken ? 403 : 409);
            assert.equal(f.count('identity_mail_events'), 0);
            assert.equal(f.count('identity_mail_audit'), 0);
            assert.equal(f.count('guardian_invite_requests'), 1);
            assert.equal(f.count('identity_audit'), 1);
            assert.equal(f.db.sqlite.prepare('SELECT version FROM agent_identities WHERE agent_id=?').get(f.input.agentId)!.version, 2);
            assert.equal(f.db.sqlite.prepare('SELECT version FROM identity_guardian_invites').get()!.version, 1);
        }
        finally {
            f.db.close();
        }
    }
});
test('queued proposal CAS and failed cancellation audit never create partial authority transitions', async () => {
    const f = await fixture();
    try {
        const batch = f.db.batch.bind(f.db);
        f.db.batch = async (statements) => { if (statements.some(s => (s as unknown as {
            sql: string;
        }).sql.startsWith('INSERT INTO identity_guardian_invites')))
            f.db.sqlite.prepare("UPDATE agent_identities SET authority_epoch=2 WHERE agent_id=?").run(f.input.agentId); return batch(statements); };
        assert.equal((await f.propose())!.status, 409);
        assert.equal(f.count('identity_guardian_invites'), 0);
        assert.equal(f.count('identity_audit'), 0);
        assert.equal(f.count('guardian_invite_requests'), 0);
        f.db.batch = batch;
        f.db.sqlite.prepare('UPDATE agent_identities SET authority_epoch=1').run();
        const p = await proposed(f);
        await f.accept(p.id);
        f.db.sqlite.exec("CREATE TRIGGER fail_cancel_audit BEFORE INSERT ON identity_mail_audit WHEN NEW.action='cancelled' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
        assert.equal((await f.send(operatorBase + '/' + p.id + '/cancel', 'POST', { requestKey: 'cancel-audit-fail', expectedVersion: 2 }))!.status, 503);
        assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_guardian_invites').get()!.state, 'accepted');
        assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events').get()!.state, 'pending');
        assert.equal(f.count('guardian_invite_requests'), 2);
        assert.equal(f.db.sqlite.prepare('SELECT version FROM agent_identities WHERE agent_id=?').get(f.input.agentId)!.version, 3);
    }
    finally {
        f.db.close();
    }
});
test('JSON property order cannot change an otherwise identical permanent request', async () => {
 const f=await fixture();try{const p=await proposed(f);const reordered={email:f.input.email,attestGuardianDesignated:true,expectedVersion:1,agentId:f.input.agentId,requestKey:f.input.requestKey};assert.equal((await f.propose(reordered))!.status,201);await f.accept(p.id);assert.equal((await f.accept(p.id,{guardianConsent:true,expectedVersion:1,requestKey:'accept-0001'}))!.status,200);assert.equal(f.count('identity_guardian_invites'),1);assert.equal(f.count('guardian_invite_requests'),2);assert.equal(f.dispatched.length,2);}finally{f.db.close();}
});

for(const lostAck of [false,true]) test((lostAck?'lost-ack ':'new-commit ')+'guardian dispatch awaits callback after commit; historical receipt uses the same event despite callback failure', async () => {
 const f=await fixture();try {
 const p=await proposed(f),seen:string[]=[];
 f.reconfigure({onMailEvent:async id=>{await Promise.resolve();assert.equal(f.count('guardian_invite_requests'),2);assert.equal(f.db.sqlite.prepare('SELECT entity_id FROM identity_mail_events WHERE id=?').get(id)!.entity_id,p.id);seen.push(id);throw Error('private callback failure');}});
 const batch=f.db.batch.bind(f.db);let lost=false;
 f.db.batch=async statements=>{const r=await batch(statements);if(lostAck&&!lost&&statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_mail_events'))){lost=true;throw Error('lost commit ack');}return r;};
 const r=(await f.accept(p.id))!;assert.equal(r.status,200);const value=await r.json();assert.deepEqual(seen,[value.mailEvent.id]);
 assert.deepEqual(await (await f.accept(p.id))!.json(),value);assert.deepEqual(seen,[value.mailEvent.id,value.mailEvent.id]);
 assert.equal((await f.accept(p.id,undefined,'b'))!.status,404);assert.equal(seen.length,2);assert.equal(f.count('identity_mail_events'),1);assert.equal(f.count('guardian_invite_requests'),2);
 }finally{f.db.close();}
});
