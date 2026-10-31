import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createIdentityCard, type IdentityCardEnvironment } from '../server/live/identity-card.ts';
import { LocalDatabase } from '../server/live/local-db.ts';
import { encryptPrivate, decryptPrivate, hashIdentityInput, hashPrivate } from '../server/live/identity-private.ts';
import { verifyCredential, type SignedCredential } from '../src/identity/index.ts';
const origin = 'https://identity.example', time = '2026-10-31T00:00:00.000Z', contactKey = '9'.repeat(64), base = '/api/v1/agent/identity/card';
// Deterministic small fixture only; this is NOT production PDF/QR/font acceptance.
const pdfFixture = new TextEncoder().encode('%PDF-1.4\nsynthetic lifecycle test fixture\n%%EOF');
type Adapter = (signed: Readonly<SignedCredential>) => Promise<Uint8Array>;
async function fixture(adapter?: Adapter) {
    const db = new LocalDatabase(':memory:');
    for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort())
        db.sqlite.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
    let native = time, app = time, renders = 0;
    const real = new LocalDatabase(':memory:');
    db.sqlite.function('strftime', { varargs: true }, (...args) => args[1] === 'now' ? native : real.sqlite.prepare('SELECT strftime(' + args.map(() => '?').join(',') + ') v').get(...args)!.v);
    for (const x of ['a', 'b']) {
        const account = x.repeat(16), agent = 'mcid:' + x.repeat(64), id = x.repeat(32);
        db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account, await hashIdentityInput(x + 'login'), time);
        db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Private Home','Private','resident','external-ready',?)").run(account, account, time);
        db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)").run(account, account, account, 'https://private.example/' + x, time, time);
        db.sqlite.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,'[\"tower:read\",\"tower:write\"]','2027-01-01T00:00:00.000Z',?)").run(x, account, await hashIdentityInput(x.repeat(64)), time);
        db.sqlite.prepare("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,version,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,3,'active',1,?,?)").run(agent, account, account, account, time, time);
        db.sqlite.prepare("INSERT INTO identity_guardian_invites(id,agent_id,account_id,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,invite_token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,3,1,'registered',?,?,?,'2026-11-01T00:00:00.000Z',?,?)").run(id, agent, account, await encryptPrivate(contactKey, 'guardian-recipient', agent, 'shared@example.com'), await hashPrivate(contactKey, 'guardian-email', 'shared@example.com'), 'f'.repeat(64), time, time);
        db.sqlite.prepare('INSERT INTO identity_guardians(guardian_id,agent_id,invitation_id,email_verified_at,created_at) VALUES(?,?,?,?,?)').run(id, agent, id, time, time);
        db.sqlite.prepare("INSERT INTO identity_guardian_passkeys(credential_id,guardian_id,agent_id,webauthn_user_id,public_key,counter,device_type,backed_up,transports_json,aaguid,created_at) VALUES(?,?,?,?,?,0,'singleDevice',0,'[]','synthetic',?)").run(x, id, agent, x.repeat(43), 'AA', time);
        db.sqlite.prepare('INSERT INTO identity_offline_recovery_codes(agent_id,code_hash,authority_epoch,identity_version,created_at,confirmed_at) VALUES(?,?,1,3,?,?)').run(agent, x.repeat(64), time, time);
    }
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey), publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const env = { db, origin, contactKey, signingKeyId: 'test-key', signingPrivateJwk: JSON.stringify(privateJwk), trustedPublicJwks: JSON.stringify({ 'test-key': publicJwk }), now: () => new Date(app), renderCard: async (s: Readonly<SignedCredential>) => { renders++; return adapter ? adapter(s) : pdfFixture.slice(); } };
    const create = (settings: IdentityCardEnvironment) => {
        const service = createIdentityCard(settings);
        return { fetch: async (request: Request): Promise<Response> => {
                const response = await service.fetch(request);
                assert(response, 'the test request must match an identity-card route');
                return response;
            } };
    };
    const handler = create(env);
    const send = async (path: string, body?: unknown, token = 'a', headers: Record<string, string> = {}) => (await handler.fetch(new Request(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token.repeat(64) } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))) as Response;
    const issue = { requestKey: 'issue-key-0001', expectedIdentityVersion: 3, expectedCardRevision: 0, publicName: '完整名字 ' + '界'.repeat(70), publicVerificationConsent: true };
    const count = (table: string) => Number(db.sqlite.prepare('SELECT COUNT(*) n FROM ' + table).get()!.n);
    return { db, env, send, issue, pair, create, count, renders: () => renders, setNative: (v: string) => { native = v; }, setApp: (v: string) => { app = v; }, close: () => { db.close(); real.close(); } };
}
async function issue(f: Awaited<ReturnType<typeof fixture>>, body: unknown = f.issue) { const r = await f.send(base + '/issue', body); assert.equal(r.status, 201, await r.clone().text()); return r.json(); }
for (const alg of ['Ed25519', 'EdDSA', undefined]) {
    test(`workerd-compatible JWK import preserves issuance, verification and public keys with alg=${alg ?? 'absent'}`, async (t) => {
        const f = await fixture();
        try {
            const privateJwk = JSON.parse(f.env.signingPrivateJwk), ring = JSON.parse(f.env.trustedPublicJwks);
            for (const jwk of [privateJwk, ring['test-key']]) {
                delete jwk.alg;
                if (alg !== undefined)
                    jwk.alg = alg;
            }
            f.env.signingPrivateJwk = JSON.stringify(privateJwk);
            f.env.trustedPublicJwks = JSON.stringify(ring);
            const originalPrivate = f.env.signingPrivateJwk, originalRing = f.env.trustedPublicJwks;
            const importKey = crypto.subtle.importKey;
            // Match workerd's Ed25519 JWK alg check; all accepted imports still use real WebCrypto.
            t.mock.method(crypto.subtle, 'importKey', async (format: KeyFormat, keyData: JsonWebKey | BufferSource, algorithm: Parameters<SubtleCrypto['importKey']>[2], extractable: boolean, keyUsages: KeyUsage[]) => {
                if (format === 'jwk' && algorithm === 'Ed25519' && (keyData as JsonWebKey).alg === 'Ed25519')
                    throw new DOMException('JSON Web Key Algorithm parameter "alg" ("Ed25519") does not match requested Ed25519 curve.', 'DataError');
                return Reflect.apply(importKey, crypto.subtle, [format, keyData, algorithm, extractable, keyUsages]);
            });
            const identityBefore = f.db.sqlite.prepare('SELECT version,authority_epoch FROM agent_identities WHERE account_id=?').get('a'.repeat(16));
            const result = await issue(f), id = result.card.credentialId;
            const signed = await (await f.send(base + '/' + id + '/json')).json();
            assert(await verifyCredential(signed, { issuer: origin, keys: new Map([['test-key', f.pair.publicKey]]) }));
            const verified = await f.send('/api/v1/identity/verify/' + id, undefined, '');
            assert.equal(verified.status, 200);
            assert.deepEqual((await verified.json()).signedCredential, signed);
            const keys = await f.send('/api/v1/identity/keys', undefined, '');
            assert.equal(keys.status, 200);
            assert.deepEqual(await keys.json(), { issuer: origin, keys: { 'test-key': { kty: 'OKP', crv: 'Ed25519', x: ring['test-key'].x } } });
            assert.equal(f.env.signingPrivateJwk, originalPrivate);
            assert.equal(f.env.trustedPublicJwks, originalRing);
            assert.deepEqual(f.db.sqlite.prepare('SELECT version,authority_epoch FROM agent_identities WHERE account_id=?').get('a'.repeat(16)), identityBefore);
        }
        finally {
            f.close();
        }
    });
}
test('unsupported public or private JWK alg fails closed before issuance and outbox', async () => {
    for (const target of ['public', 'private']) {
        const f = await fixture();
        try {
            if (target === 'public') {
                const ring = JSON.parse(f.env.trustedPublicJwks);
                ring['test-key'].alg = 'ES256';
                f.env.trustedPublicJwks = JSON.stringify(ring);
                assert.equal((await f.send('/api/v1/identity/keys', undefined, '')).status, 503);
            }
            else {
                const jwk = JSON.parse(f.env.signingPrivateJwk);
                jwk.alg = 'ES256';
                f.env.signingPrivateJwk = JSON.stringify(jwk);
            }
            assert.equal((await f.send(base + '/issue', f.issue)).status, 503, target);
            assert.equal(f.count('identity_card_attempts'), 0);
            assert.equal(f.count('identity_credentials'), 0);
            assert.equal(f.count('identity_mail_events'), 0);
        }
        finally {
            f.close();
        }
    }
});
test('issue signs exact public name, immutable PDF/JSON manifests, independent revision, pending private refs and permanent replay', async () => {
    const f = await fixture();
    try {
        const before = f.db.sqlite.prepare('SELECT version,authority_epoch FROM agent_identities WHERE account_id=?').get('a'.repeat(16));
        const r = await issue(f), id = r.card.credentialId;
        assert.match(id, /^[a-f0-9]{32}$/);
        assert.equal(r.card.revision, 1);
        assert.deepEqual(f.db.sqlite.prepare('SELECT version,authority_epoch FROM agent_identities WHERE account_id=?').get('a'.repeat(16)), before);
        const signed = await (await f.send(base + '/' + id + '/json')).json();
        assert.equal(signed.payload.publicName, f.issue.publicName);
        assert.equal(await verifyCredential(signed, { issuer: origin, keys: new Map([['test-key', f.pair.publicKey]]) }), true);
        assert.deepEqual(new Uint8Array(await (await f.send(base + '/' + id + '/pdf')).arrayBuffer()), pdfFixture);
        const publicResult = await (await f.send('/api/v1/identity/verify/' + id, undefined, '')).json();
        assert.equal(publicResult.status, 'valid');
        assert.equal(publicResult.publicName, f.issue.publicName);
        assert.equal(publicResult.agentId, signed.payload.agentId);
        assert.deepEqual(publicResult.signedCredential, signed);
        assert.deepEqual(await (await f.send(base + '/issue', f.issue)).json(), r);
        assert.equal(f.renders(), 1);
        assert.equal((await f.send(base + '/issue', { ...f.issue, publicName: 'changed' })).status, 409);
        assert.equal(f.count('identity_credentials'), 1);
        assert.equal(f.count('identity_card_requests'), 1);
        assert.equal(f.count('identity_mail_events'), 1);
        const mail = f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!;
        assert.equal(mail.state, 'pending');
        assert.equal(mail.attempt_count, 0);
        const refs = JSON.parse(await decryptPrivate(contactKey, 'mail-payload', String(mail.id), String(mail.payload_ciphertext)));
        assert.equal(refs.credentialId, id);
        assert.deepEqual(Object.keys(refs).sort(), ['credentialId', 'jsonDigest', 'pdfDigest', 'template']);
        const raw = JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_credentials').all()) + JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_audit').all());
        for (const secret of ['shared@example.com', contactKey, 'private.example', '"d":'])
            assert(!raw.includes(secret), secret);
        const keys = await (await f.send('/api/v1/identity/keys', undefined, '')).json();
        assert(!JSON.stringify(keys).includes('"d"'));
        assert.deepEqual(Object.keys(keys.keys['test-key']).sort(), ['crv', 'kty', 'x']);
        assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('identity-card:account:' + 'a'.repeat(16))!.count, 1);
    }
    finally {
        f.close();
    }
});
test('reissue supersedes only previous card and cancels pending mail; revoke leaves identity and Tower authority intact', async () => {
    const f = await fixture();
    try {
        const first = await issue(f);
        const second = await issue(f, { ...f.issue, requestKey: 'issue-key-0002', expectedCardRevision: 1, publicName: '新名字' });
        const old = await (await f.send('/api/v1/identity/verify/' + first.card.credentialId, undefined, '')).json();
        assert.deepEqual(old, { credentialId: first.card.credentialId, status: 'superseded' });
        assert.equal(f.db.sqlite.prepare("SELECT state FROM identity_mail_events WHERE entity_id=?").get(first.card.credentialId)!.state, 'cancelled');
        assert.equal(f.count('identity_mail_audit'), 3);
        const revoke = { requestKey: 'revoke-key-0001', expectedIdentityVersion: 3, expectedCardRevision: 2, credentialId: second.card.credentialId };
        const result = await f.send(base + '/revoke', revoke);
        assert.equal(result.status, 200, await result.clone().text());
        assert.deepEqual(await (await f.send(base + '/revoke', revoke)).json(), await result.json());
        assert.deepEqual(await (await f.send('/api/v1/identity/verify/' + second.card.credentialId, undefined, '')).json(), { credentialId: second.card.credentialId, status: 'revoked' });
        const head = await (await f.send(base)).json();
        assert.equal(head.revision, 3);
        assert.equal(head.card, null);
        assert.equal(f.db.sqlite.prepare('SELECT version FROM agent_identities WHERE account_id=?').get('a'.repeat(16))!.version, 3);
        assert.equal(f.db.sqlite.prepare("SELECT revoked FROM tower_tokens WHERE id='a'").get()!.revoked, 0);
        assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_mail_events WHERE kind='security-notice' AND state='pending'").get()!.n, 1);
        await issue(f, { ...f.issue, requestKey: 'issue-after-revoke', expectedCardRevision: 3 });
        for (const sql of ["UPDATE identity_credentials SET signed_json='{}'", "UPDATE identity_credentials SET state='issued' WHERE state='revoked'", 'DELETE FROM identity_credentials', 'DELETE FROM identity_card_artifacts', "UPDATE identity_card_heads SET revision=revision-1", 'DELETE FROM identity_card_requests'])
            assert.throws(() => f.db.sqlite.exec(sql), sql);
    }
    finally {
        f.close();
    }
});
test('strict consent, payload and transport guard reject provisional, missing recovery and cross-household access', async () => {
    const f = await fixture();
    try {
        for (const v of [{ ...f.issue, email: 'other@example.com' }, { ...f.issue, publicVerificationConsent: false }, { ...f.issue, publicName: '界'.repeat(81) }, { ...f.issue, publicName: 'bad\nname' }, { ...f.issue, expectedCardRevision: -1 }])
            assert.equal((await f.send(base + '/issue', v)).status, 400);
        for (const h of [{ Cookie: 'session=1' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[])
            assert.equal((await f.send(base + '/issue', f.issue, 'a', h)).status, 403);
        const changes = ["UPDATE agent_identities SET state='provisional' WHERE account_id='aaaaaaaaaaaaaaaa'", "UPDATE identity_guardian_invites SET state='cancelled' WHERE id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'", "UPDATE identity_guardian_passkeys SET revoked_at='2026-10-31T00:00:00.000Z' WHERE credential_id='a'", "UPDATE identity_offline_recovery_codes SET consumed_at='2026-10-31T00:00:00.000Z' WHERE agent_id='mcid:" + 'a'.repeat(64) + "'"];
        for (const [i, sql] of changes.entries()) {
            const t = await fixture();
            try {
                t.db.sqlite.exec(sql);
                assert.equal((await t.send(base + '/issue', t.issue)).status, 409, String(i));
                assert.equal(t.renders(), 0);
            }
            finally {
                t.close();
            }
        }
        const r = await issue(f);
        assert.equal((await f.send(base + '/' + r.card.credentialId + '/pdf', undefined, 'b')).status, 404);
        assert.equal((await f.send('/api/v1/identity/verify/' + 'f'.repeat(32), undefined, '')).status, 404);
        const b = await f.send(base + '/issue', f.issue, 'b');
        assert.equal(b.status, 201);
        assert.notEqual((await b.json()).card.credentialId, r.card.credentialId);
        assert.equal(f.count('agent_identities'), 2);
    }
    finally {
        f.close();
    }
});
test('missing renderer, invalid keyring, signer mismatch, render failure and oversized artifact fail closed before card/outbox', async () => {
    for (const kind of ['missing', 'ring', 'private-ring', 'mismatch', 'throw', 'oversize']) {
        const f = await fixture(kind === 'throw' ? async () => { throw new Error('raw-secret'); } : kind === 'oversize' ? async () => new Uint8Array(8388609) : undefined);
        try {
            if (kind === 'missing')
                delete (f.env as {
                    renderCard?: Adapter;
                }).renderCard;
            if (kind === 'ring')
                f.env.trustedPublicJwks = '{}';
            if (kind === 'private-ring')
                f.env.trustedPublicJwks = JSON.stringify({ 'test-key': JSON.parse(f.env.signingPrivateJwk) });
            if (kind === 'mismatch') {
                const p = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
                f.env.trustedPublicJwks = JSON.stringify({ 'test-key': await crypto.subtle.exportKey('jwk', p.publicKey) });
            }
            const h = f.create(f.env), request = () => h.fetch(new Request(origin + base + '/issue', { method: 'POST', headers: { Authorization: 'Bearer ' + 'a'.repeat(64), 'Content-Type': 'application/json' }, body: JSON.stringify(f.issue) }));
            const r = await request();
            assert.equal(r.status, 503, kind);
            assert(!(await r.text()).includes('raw-secret'));
            assert.equal(f.count('identity_credentials'), 0);
            assert.equal(f.count('identity_mail_events'), 0);
            await request();
            assert(f.renders() <= 2, kind);
        }
        finally {
            f.close();
        }
    }
});
test('renderer receives deeply frozen public signed snapshot and cannot mutate signed JSON', async () => {
    let saw = false;
    const f = await fixture(async (s) => {
        saw = true;
        assert(Object.isFrozen(s));
        assert(Object.isFrozen(s.payload));
        assert.deepEqual(Object.keys(s).sort(), ['payload', 'signature']);
        assert.throws(() => {
            (s.payload as {
                publicName: string;
            }).publicName = 'mutated';
        });
        return pdfFixture;
    });
    try {
        const r = await issue(f);
        assert(saw);
        assert.equal((await (await f.send(base + '/' + r.card.credentialId + '/json')).json()).payload.publicName, f.issue.publicName);
    }
    finally {
        f.close();
    }
});
test('public lookup validates signature and newest state after async verification, suppressing suspended/withdrawn identity', async () => {
    const f = await fixture();
    try {
        const r = await issue(f), id = r.card.credentialId;
        f.db.sqlite.exec("UPDATE agent_identities SET state='suspended' WHERE account_id='aaaaaaaaaaaaaaaa'");
        assert.deepEqual(await (await f.send('/api/v1/identity/verify/' + id, undefined, '')).json(), { credentialId: id, status: 'suspended' });
        f.db.sqlite.exec("UPDATE agent_identities SET state='active' WHERE account_id='aaaaaaaaaaaaaaaa'; UPDATE identity_card_heads SET public_verification_consent=0 WHERE account_id='aaaaaaaaaaaaaaaa'");
        assert.deepEqual(await (await f.send('/api/v1/identity/verify/' + id, undefined, '')).json(), { credentialId: id, status: 'withdrawn' });
        const response = await f.send('/api/v1/identity/verify/' + id, undefined, '');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.match(response.headers.get('x-robots-tag')!, /noindex/);
    }
    finally {
        f.close();
    }
});
test('same request competition renders once; distinct issue/revoke CAS has only one winner', async () => {
    const f = await fixture();
    try {
        const [a, b] = await Promise.all([f.send(base + '/issue', f.issue), f.send(base + '/issue', f.issue)]);
        assert.equal(a.status, 201);
        assert.equal(b.status, 201);
        assert.deepEqual(await a.json(), await b.json());
        assert.equal(f.renders(), 1);
        assert.equal(f.count('identity_credentials'), 1);
        const current = await (await f.send(base)).json();
        const results = await Promise.all([f.send(base + '/issue', { ...f.issue, requestKey: 'competing-issue', expectedCardRevision: 1 }), f.send(base + '/revoke', { requestKey: 'competing-revoke', expectedIdentityVersion: 3, expectedCardRevision: 1, credentialId: current.card.credentialId })]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    }
    finally {
        f.close();
    }
});
test('late token/identity/guardian/residence changes roll back card/artifacts/outbox/audit and receipt', async () => {
    const mutations = ["UPDATE tower_tokens SET revoked=1 WHERE id='a'", "UPDATE tower_tokens SET scopes='[\"tower:read\"]' WHERE id='a'", "UPDATE agent_identities SET version=version+1 WHERE account_id='aaaaaaaaaaaaaaaa'", "UPDATE identity_guardians SET version=version+1 WHERE guardian_id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'", "UPDATE tower_residencies SET revision=revision+1 WHERE account_id='aaaaaaaaaaaaaaaa'", "UPDATE identity_guardian_passkeys SET revoked_at='2026-10-31T00:00:00.000Z' WHERE credential_id='a'"];
    for (const [i, sql] of mutations.entries()) {
        const f = await fixture();
        try {
            const batch = f.db.batch.bind(f.db);
            f.db.batch = async (statements) => {
                if (statements.some(s => (s as unknown as {
                    sql: string;
                }).sql.startsWith('INSERT INTO identity_credentials')))
                    f.db.sqlite.exec(sql);
                return batch(statements);
            };
            const r = await f.send(base + '/issue', f.issue);
            assert.equal(r.status, i < 2 ? 403 : 409, String(i));
            for (const table of ['identity_credentials', 'identity_card_artifacts', 'identity_card_requests', 'identity_mail_events', 'identity_audit'])
                assert.equal(f.count(table), 0, table);
        }
        finally {
            f.close();
        }
    }
});
test('native queued expiry and final private read/replay authorization do not regrant old tokens', async () => {
    const f = await fixture();
    try {
        const r = await issue(f), id = r.card.credentialId;
        f.db.sqlite.exec("UPDATE tower_tokens SET revoked=1 WHERE id='a'");
        assert.equal((await f.send(base + '/issue', f.issue)).status, 403);
        assert.equal((await f.send(base + '/' + id + '/pdf')).status, 403);
    }
    finally {
        f.close();
    }
    const g = await fixture();
    try {
        const batch = g.db.batch.bind(g.db);
        g.db.batch = async (s) => {
            if (s.some(s => (s as unknown as {
                sql: string;
            }).sql.startsWith('INSERT INTO identity_credentials')))
                g.setNative('2027-01-01T00:00:00.000Z');
            return batch(s);
        };
        assert.equal((await g.send(base + '/issue', g.issue)).status, 403);
        assert.equal(g.count('identity_credentials'), 0);
    }
    finally {
        g.close();
    }
});
test('subsequent recovery epoch/version and current backup still allow new cards without invalidating old valid card', async () => {
    const f = await fixture();
    try {
        const old = await issue(f);
        f.db.sqlite.exec("UPDATE agent_identities SET version=4,authority_epoch=2 WHERE account_id='aaaaaaaaaaaaaaaa'; UPDATE identity_offline_recovery_codes SET consumed_at='2026-10-31T00:00:00.000Z' WHERE agent_id='mcid:" + 'a'.repeat(64) + "';");
        f.db.sqlite.prepare('INSERT INTO identity_offline_recovery_codes(agent_id,code_hash,authority_epoch,identity_version,created_at,confirmed_at) VALUES(?,?,2,4,?,?)').run('mcid:' + 'a'.repeat(64), 'e'.repeat(64), time, time);
        assert.equal((await (await f.send('/api/v1/identity/verify/' + old.card.credentialId, undefined, '')).json()).status, 'valid');
        await issue(f, { ...f.issue, requestKey: 'recovered-issue', expectedIdentityVersion: 4, expectedCardRevision: 1 });
        assert.equal(f.db.sqlite.prepare('SELECT version FROM agent_identities WHERE account_id=?').get('a'.repeat(16))!.version, 4);
    }
    finally {
        f.close();
    }
});
test('different runtime resumes the original signed candidate after renderer timeout or final batch failure without new quota/CID', async () => {
    for (const failure of ['render', 'commit']) {
        const seen: SignedCredential[] = [];
        let throwRender = failure === 'render';
        const f = await fixture(async (signed) => {
            seen.push(structuredClone(signed));
            if (throwRender) {
                throwRender = false;
                throw new Error('synthetic transport timeout');
            }
            return pdfFixture;
        });
        try {
            const batch = f.db.batch.bind(f.db);
            let throwCommit = failure === 'commit';
            f.db.batch = async (statements) => {
                if (throwCommit && statements.some(s => (s as unknown as {
                    sql: string;
                }).sql.startsWith('INSERT INTO identity_credentials'))) {
                    throwCommit = false;
                    throw new Error('synthetic precommit unavailable');
                }
                return batch(statements);
            };
            assert.equal((await f.send(base + '/issue', f.issue)).status, 503);
            assert.equal(f.count('identity_credentials'), 0);
            const other = f.create(f.env), request = new Request(origin + base + '/issue', { method: 'POST', headers: { Authorization: 'Bearer ' + 'a'.repeat(64), 'Content-Type': 'application/json' }, body: JSON.stringify(f.issue) });
            const resumed = await other.fetch(request);
            assert.equal(resumed.status, 201, await resumed.clone().text());
            assert.equal(seen.length, 2);
            assert.deepEqual(seen[1], seen[0]);
            assert.equal(f.count('identity_card_attempts'), 1);
            assert.equal(f.count('identity_credentials'), 1);
            assert.equal(f.count('identity_mail_events'), 1);
            assert.equal(f.count('identity_card_requests'), 1);
            assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('identity-card:account:' + 'a'.repeat(16))!.count, 1);
        }
        finally {
            f.close();
        }
    }
});
test('public verification rejects altered signed data and rechecks suspension/revocation/withdrawal after its first read', async () => {
    for (const change of ['tamper', 'suspend', 'withdraw', 'revoke']) {
        const f = await fixture();
        try {
            const result = await issue(f), id = result.card.credentialId, prepare = f.db.prepare.bind(f.db);
            let reads = 0;
            f.db.prepare = sql => {
                const s = prepare(sql), bind = s.bind.bind(s);
                s.bind = (...v) => {
                    const b = bind(...v), first = b.first.bind(b);
                    if (sql.startsWith('SELECT c.*'))
                        b.first = async <T>() => {
                            const row = await first<Record<string, unknown>>();
                            if (++reads === 1 && row) {
                                if (change === 'tamper') {
                                    const signed = JSON.parse(String(row.signed_json));
                                    signed.payload.publicName = 'forged';
                                    row.signed_json = JSON.stringify(signed);
                                    row.json_digest = await hashIdentityInput(String(row.signed_json));
                                }
                                else if (change === 'suspend')
                                    f.db.sqlite.exec("UPDATE agent_identities SET state='suspended' WHERE account_id='aaaaaaaaaaaaaaaa'");
                                else if (change === 'withdraw')
                                    f.db.sqlite.exec("UPDATE identity_card_heads SET public_verification_consent=0 WHERE account_id='aaaaaaaaaaaaaaaa'");
                                else
                                    f.db.sqlite.prepare("UPDATE identity_credentials SET state='revoked' WHERE credential_id=?").run(id);
                            }
                            return row as T | null;
                        };
                    return b;
                };
                return s;
            };
            const r = await f.send('/api/v1/identity/verify/' + id, undefined, '');
            if (change === 'tamper') {
                assert.equal(r.status, 503);
                assert(!(await r.text()).includes('forged'));
            }
            else {
                assert.deepEqual(await r.json(), { credentialId: id, status: change === 'suspend' ? 'suspended' : change === 'withdraw' ? 'withdrawn' : 'revoked' });
                assert.equal(reads, 2);
            }
        }
        finally {
            f.close();
        }
    }
});
test('private artifact, metadata and permanent receipt recheck bearer after retrieving their data', async () => {
    for (const path of ['artifact', 'metadata', 'receipt']) {
        const f = await fixture();
        try {
            const result = await issue(f), prepare = f.db.prepare.bind(f.db);
            let fired = false;
            const target = path === 'artifact' ? 'SELECT chunk_index,data_base64' : path === 'metadata' ? 'SELECT c.*' : 'SELECT operation,input_hash,response_json,status';
            f.db.prepare = sql => {
                const s = prepare(sql), bind = s.bind.bind(s);
                s.bind = (...v) => {
                    const b = bind(...v);
                    if (sql.startsWith(target) && !fired) {
                        if (path === 'artifact') {
                            const all = b.all.bind(b);
                            b.all = async <T>() => { const r = await all<T>(); fired = true; f.db.sqlite.exec("UPDATE tower_tokens SET revoked=1 WHERE id='a'"); return r; };
                        }
                        else {
                            const first = b.first.bind(b);
                            b.first = async <T>() => { const r = await first<T>(); fired = true; f.db.sqlite.exec("UPDATE tower_tokens SET revoked=1 WHERE id='a'"); return r; };
                        }
                    }
                    return b;
                };
                return s;
            };
            const r = await f.send(path === 'artifact' ? base + '/' + result.card.credentialId + '/pdf' : path === 'metadata' ? base : base + '/issue', path === 'receipt' ? f.issue : undefined);
            assert.equal(r.status, 403, path);
            assert(fired);
        }
        finally {
            f.close();
        }
    }
});
test('cross-runtime simultaneous retry and lost successful commit response preserve exactly one card and side effect', async () => {
    const f = await fixture();
    try {
        const other = f.create(f.env), request = () => new Request(origin + base + '/issue', { method: 'POST', headers: { Authorization: 'Bearer ' + 'a'.repeat(64), 'Content-Type': 'application/json' }, body: JSON.stringify(f.issue) });
        const [a, b] = await Promise.all([f.send(base + '/issue', f.issue), other.fetch(request())]);
        assert.equal(a.status, 201);
        assert.equal(b.status, 201);
        assert.deepEqual(await a.json(), await b.json());
        for (const t of ['identity_card_attempts', 'identity_credentials', 'identity_card_requests', 'identity_mail_events'])
            assert.equal(f.count(t), 1);
    }
    finally {
        f.close();
    }
    const g = await fixture();
    try {
        const batch = g.db.batch.bind(g.db);
        let lost = true;
        g.db.batch = async (s) => {
            const r = await batch(s);
            if (lost && s.some(s => (s as unknown as {
                sql: string;
            }).sql.startsWith('INSERT INTO identity_credentials'))) {
                lost = false;
                throw new Error('synthetic lost commit acknowledgement');
            }
            return r;
        };
        await issue(g);
        assert.equal(g.renders(), 1);
        assert.equal(g.count('identity_mail_events'), 1);
    }
    finally {
        g.close();
    }
});
test('JSON artifact integrity, audit rollback and pending-only cancellation preserve uncertain send history', async () => {
    const f = await fixture();
    try {
        const first = await issue(f), id = first.card.credentialId;
        f.db.sqlite.prepare("UPDATE identity_mail_events SET state='unknown',attempt_count=1 WHERE entity_id=?").run(id);
        await issue(f, { ...f.issue, requestKey: 'second-unknown-card', expectedCardRevision: 1 });
        assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE entity_id=?').get(id)!.state, 'unknown');
        assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_mail_audit WHERE action='cancelled'").get()!.n, 0);
        f.db.sqlite.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT,'synthetic');END");
        const before = f.count('identity_card_artifacts');
        assert.equal((await f.send(base + '/issue', { ...f.issue, requestKey: 'audit-failure-card', expectedCardRevision: 2 })).status, 503);
        assert.equal(f.count('identity_credentials'), 2);
        assert.equal(f.count('identity_card_artifacts'), before);
        assert.equal(f.count('identity_mail_events'), 2);
        assert.equal(f.count('identity_card_requests'), 2);
    }
    finally {
        f.close();
    }
});
test('logical account/global quota is charged once and repeated original-key transport recovery is separately bounded', async () => {
    const f = await fixture(async () => { throw new Error('synthetic adapter outage'); });
    try {
        for (let i = 0; i < 31; i++) {
            const r = await f.send(base + '/issue', f.issue);
            assert.equal(r.status, i < 30 ? 503 : 429, String(i));
        }
        assert.equal(f.count('identity_card_attempts'), 1);
        assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('identity-card:account:' + 'a'.repeat(16))!.count, 1);
        assert.equal(f.count('identity_credentials'), 0);
    }
    finally {
        f.close();
    }
});
test('reissue records the superseded-to-new credential relation and every issued audit has its CID', async () => {
    const f = await fixture();
    try {
        const a = await issue(f), b = await issue(f, { ...f.issue, requestKey: 'audit-reissue-test', expectedCardRevision: 1 });
        const rows = f.db.sqlite.prepare('SELECT action,detail_json FROM identity_audit ORDER BY rowid').all();
        assert.deepEqual(rows.map(r => r.action), ['card-issued', 'card-superseded', 'card-issued']);
        assert.equal(JSON.parse(String(rows[0].detail_json)).credentialId, a.card.credentialId);
        assert.deepEqual(JSON.parse(String(rows[1].detail_json)), { credentialId: a.card.credentialId, supersededBy: b.card.credentialId, revision: 2 });
        assert.equal(JSON.parse(String(rows[2].detail_json)).credentialId, b.card.credentialId);
    }
    finally {
        f.close();
    }
});
test('artifact digest mismatch fails closed instead of returning modified file bytes', async () => {
    const f = await fixture();
    try {
        const result = await issue(f), prepare = f.db.prepare.bind(f.db);
        f.db.prepare = sql => {
            const s = prepare(sql), bind = s.bind.bind(s);
            s.bind = (...v) => {
                const b = bind(...v);
                if (sql.startsWith('SELECT chunk_index,data_base64')) {
                    const all = b.all.bind(b);
                    b.all = async <T>() => {
                        const r = await all<{
                            chunk_index: number;
                            data_base64: string;
                        }>();
                        r.results[0].data_base64 = Buffer.alloc(pdfFixture.length, 65).toString('base64');
                        return r as unknown as Awaited<ReturnType<typeof b.all<T>>>;
                    };
                }
                return b;
            };
            return s;
        };
        const r = await f.send(base + '/' + result.card.credentialId + '/pdf');
        assert.equal(r.status, 503);
        assert(!(await r.text()).includes('AAAA'));
    }
    finally {
        f.close();
    }
});
test('privacy revocation succeeds with suspended identity and all Passkeys revoked without modifying identity or authority', async () => {
    const f = await fixture();
    try {
        const r = await issue(f), id = r.card.credentialId;
        f.db.sqlite.exec("UPDATE agent_identities SET state='suspended' WHERE account_id='aaaaaaaaaaaaaaaa'; UPDATE identity_guardian_passkeys SET revoked_at='2026-10-31T00:00:00.000Z' WHERE credential_id='a'");
        const before = JSON.stringify(f.db.sqlite.prepare('SELECT * FROM agent_identities').all()) + JSON.stringify(f.db.sqlite.prepare('SELECT * FROM tower_tokens').all());
        const body = { requestKey: 'suspended-revoke-test', expectedIdentityVersion: 3, expectedCardRevision: 1, credentialId: id };
        const a = await f.send(base + '/revoke', body);
        assert.equal(a.status, 200, await a.clone().text());
        assert.deepEqual(await (await f.send(base + '/revoke', body)).json(), await a.json());
        assert.equal(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM agent_identities').all()) + JSON.stringify(f.db.sqlite.prepare('SELECT * FROM tower_tokens').all()), before);
        assert.deepEqual(await (await f.send('/api/v1/identity/verify/' + id, undefined, '')).json(), { credentialId: id, status: 'revoked' });
        assert.equal((await f.send(base + '/issue', { ...f.issue, requestKey: 'suspended-issue-new', expectedCardRevision: 2 })).status, 409);
    }
    finally {
        f.close();
    }
});
test('privacy revocation without current verified guardian contact remains atomic and records notification omission', async () => {
    const f = await fixture();
    try {
        const r = await issue(f), id = r.card.credentialId;
        f.db.sqlite.exec("UPDATE identity_guardian_invites SET state='cancelled' WHERE id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'");
        const response = await f.send(base + '/revoke', { requestKey: 'contact-missing-revoke', expectedIdentityVersion: 3, expectedCardRevision: 1, credentialId: id });
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_mail_events WHERE kind='security-notice'").get()!.n, 0);
        assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE entity_id=?').get(id)!.state, 'cancelled');
        assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_audit WHERE action='notification-not-enqueued-no-verified-contact'").get()!.n, 1);
    }
    finally {
        f.close();
    }
});
test('scopes, stale revisions, consumed backup, logical quota ceilings and unsupported transport fail without card allocation', async () => {
    for (const key of ['identity-card:account:' + 'a'.repeat(16), 'identity-card:global']) {
        const f = await fixture();
        try {
            f.db.sqlite.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?)').run(key, key.endsWith('global') ? 1000 : 10, '2026-10-31T01:00:00.000Z');
            assert.equal((await f.send(base + '/issue', f.issue)).status, 429);
            assert.equal(f.count('identity_card_attempts'), 0);
            assert.equal(f.renders(), 0);
        }
        finally {
            f.close();
        }
    }
    const f = await fixture();
    try {
        assert.equal((await f.send(base + '/issue', { ...f.issue, expectedIdentityVersion: 2 })).status, 409);
        assert.equal((await f.send(base + '/issue', { ...f.issue, expectedCardRevision: 1 })).status, 409);
        assert.equal((await f.send(base + '/issue', f.issue, 'a', { 'Content-Type': 'text/plain' })).status, 415);
        assert.equal((await f.send(base + '?email=someone', undefined, 'a')).status, 400);
        f.db.sqlite.exec("UPDATE tower_tokens SET scopes='[\"tower:read\"]' WHERE id='a'");
        assert.equal((await f.send(base + '/issue', f.issue)).status, 403);
        f.db.sqlite.exec("UPDATE tower_tokens SET scopes='[\"tower:write\"]' WHERE id='a'");
        assert.equal((await f.send(base)).status, 403);
        f.db.sqlite.exec("UPDATE tower_tokens SET scopes='[\"tower:read\",\"tower:write\"]' WHERE id='a'; UPDATE identity_offline_recovery_codes SET consumed_at='2026-10-31T00:00:00.000Z' WHERE code_hash='" + 'a'.repeat(64) + "'");
        assert.equal((await f.send(base + '/issue', f.issue)).status, 409);
        assert.equal(f.renders(), 0);
        assert.equal(f.count('identity_credentials'), 0);
    }
    finally {
        f.close();
    }
});
test('revoke still rolls back native queued expiry and final authority/identity/residence races without losing the issued card', async () => {
    for (const mutation of ['token', 'identity', 'residence', 'clock']) {
        const f = await fixture();
        try {
            const result = await issue(f), batch = f.db.batch.bind(f.db);
            f.db.batch = async (s) => {
                if (s.some(s => (s as unknown as {
                    sql: string;
                }).sql.startsWith("UPDATE identity_credentials SET state='revoked'"))) {
                    if (mutation === 'token')
                        f.db.sqlite.exec("UPDATE tower_tokens SET revoked=1 WHERE id='a'");
                    if (mutation === 'identity')
                        f.db.sqlite.exec("UPDATE agent_identities SET version=version+1 WHERE account_id='aaaaaaaaaaaaaaaa'");
                    if (mutation === 'residence')
                        f.db.sqlite.exec("UPDATE tower_residencies SET revision=revision+1 WHERE account_id='aaaaaaaaaaaaaaaa'");
                    if (mutation === 'clock')
                        f.setNative('2027-01-01T00:00:00.000Z');
                }
                return batch(s);
            };
            const r = await f.send(base + '/revoke', { requestKey: 'revoke-race-test', expectedIdentityVersion: 3, expectedCardRevision: 1, credentialId: result.card.credentialId });
            assert.equal(r.status, ['token', 'clock'].includes(mutation) ? 403 : 409, mutation);
            assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_credentials').get()!.state, 'issued');
            assert.equal(f.count('identity_card_requests'), 1);
            assert.equal(f.count('identity_mail_events'), 1);
        }
        finally {
            f.close();
        }
    }
});
test('keyring rejects noncanonical JWK coordinates and forbidden extra fields without reflecting secret data', async () => {
    for (const kind of ['noncanonical', 'extra']) {
        const f = await fixture();
        try {
            const ring = JSON.parse(f.env.trustedPublicJwks);
            if (kind === 'noncanonical') {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', x = ring['test-key'].x;
                ring['test-key'].x = x.slice(0, -1) + chars[chars.indexOf(x.at(-1)) ^ 1];
            }
            else
                ring['test-key'].secret = 'never-return-this';
            f.env.trustedPublicJwks = JSON.stringify(ring);
            const r = await f.send('/api/v1/identity/keys', undefined, '');
            assert.equal(r.status, 503, kind);
            assert(!(await r.text()).includes('never-return-this'));
        }
        finally {
            f.close();
        }
    }
});
test('large public-only PDF persists in bounded groups below D1 row and free invocation query budgets', async () => {
    const bytes = new Uint8Array(4376506).fill(65), f = await fixture(async () => bytes);
    try {
        let finalBatch = 0;
        const batch = f.db.batch.bind(f.db);
        f.db.batch = async (s) => {
            if (s.some(s => (s as unknown as {
                sql: string;
            }).sql.startsWith('INSERT INTO identity_credentials')))
                finalBatch = s.length;
            return batch(s);
        };
        const r = await issue(f);
        const response = await f.send(base + '/' + r.card.credentialId + '/pdf');
        assert.equal(response.status, 200);
        assert.equal(await hashIdentityInput(Buffer.from(await response.arrayBuffer()).toString('base64')), await hashIdentityInput(Buffer.from(bytes).toString('base64')));
        assert(finalBatch < 40);
        assert.equal(f.db.sqlite.prepare("SELECT MAX(length(data_base64)) n FROM identity_card_artifacts WHERE kind='pdf'").get()!.n, 65536);
        assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_card_artifacts WHERE kind='pdf'").get()!.n, Math.ceil(bytes.length / 49152));
    }
    finally {
        f.close();
    }
});
test('key rotation preserves historical trust and a pre-rotation candidate resumes without changing its signature', async () => {
    let unavailable = true;
    const f = await fixture(async () => {
        if (unavailable) {
            unavailable = false;
            throw new Error('synthetic timeout');
        }
        return pdfFixture;
    });
    try {
        assert.equal((await f.send(base + '/issue', f.issue)).status, 503);
        const candidate = JSON.parse(String(f.db.sqlite.prepare('SELECT signed_json FROM identity_card_attempts').get()!.signed_json));
        const next = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']), ring = JSON.parse(f.env.trustedPublicJwks);
        ring['rotated-key'] = await crypto.subtle.exportKey('jwk', next.publicKey);
        f.env.signingKeyId = 'rotated-key';
        f.env.signingPrivateJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', next.privateKey));
        f.env.trustedPublicJwks = JSON.stringify(ring);
        const r = await issue(f);
        assert.deepEqual(await (await f.send(base + '/' + r.card.credentialId + '/json')).json(), candidate);
        assert.equal((await (await f.send('/api/v1/identity/verify/' + r.card.credentialId, undefined, '')).json()).status, 'valid');
        const second = await issue(f, { ...f.issue, requestKey: 'post-rotation-issue', expectedCardRevision: 1 });
        assert.equal((await (await f.send(base + '/' + second.card.credentialId + '/json')).json()).payload.keyId, 'rotated-key');
    }
    finally {
        f.close();
    }
});
test('privacy revoke ignores exhausted issuance quotas after one issued card and nine failed reissue candidates', async () => {
    for (const quota of ['account', 'global']) {
        let outage = false;
        const f = await fixture(async () => { if (outage)
            throw new Error('synthetic renderer outage'); return pdfFixture; });
        try {
            const card = await issue(f);
            outage = true;
            if (quota === 'account')
                for (let i = 0; i < 9; i++)
                    assert.equal((await f.send(base + '/issue', { ...f.issue, requestKey: 'failed-reissue-' + i, expectedCardRevision: 1 })).status, 503);
            else
                f.db.sqlite.prepare('UPDATE rate_limits SET count=1000,expires_at=? WHERE key=?').run('2026-10-31T01:00:00.000Z', 'identity-card:global');
            const before = f.db.sqlite.prepare("SELECT key,count,expires_at FROM rate_limits WHERE key IN (?,?) ORDER BY key").all('identity-card:account:' + 'a'.repeat(16), 'identity-card:global');
            const revoked = await f.send(base + '/revoke', { requestKey: 'quota-free-revoke', expectedIdentityVersion: 3, expectedCardRevision: 1, credentialId: card.card.credentialId });
            assert.equal(revoked.status, 200, await revoked.clone().text());
            assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_credentials').get()!.state, 'revoked');
            assert.deepEqual(f.db.sqlite.prepare("SELECT key,count,expires_at FROM rate_limits WHERE key IN (?,?) ORDER BY key").all('identity-card:account:' + 'a'.repeat(16), 'identity-card:global'), before);
        }
        finally {
            f.close();
        }
    }
});
test('revoke retries after precommit failure despite removed or changed guardian contact without notifying stale recipient', async () => {
    for (const change of ['removed', 'replaced', 'guardian-version']) {
        const f = await fixture();
        try {
            const r = await issue(f), id = r.card.credentialId, body = { requestKey: 'contact-resume-revoke', expectedIdentityVersion: 3, expectedCardRevision: 1, credentialId: id }, batch = f.db.batch.bind(f.db);
            let failOnce = true;
            f.db.batch = async (s) => { if (failOnce && s.some(s => (s as unknown as {
                sql: string;
            }).sql.startsWith("UPDATE identity_credentials SET state='revoked'"))) {
                failOnce = false;
                throw new Error('synthetic precommit unavailable');
            } return batch(s); };
            assert.equal((await f.send(base + '/revoke', body)).status, 503);
            if (change === 'removed')
                f.db.sqlite.exec("UPDATE identity_guardian_invites SET state='cancelled' WHERE id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'");
            if (change === 'guardian-version')
                f.db.sqlite.exec("UPDATE identity_guardians SET version=version+1 WHERE guardian_id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'");
            if (change === 'replaced') {
                // Test-only external contact replacement; production currently forbids modifying initial invite contacts.
                f.db.sqlite.exec('DROP TRIGGER identity_guardian_immutable_binding');
                f.db.sqlite.prepare('UPDATE identity_guardian_invites SET recipient_ciphertext=?,email_hash=? WHERE id=?').run(await encryptPrivate(contactKey, 'guardian-recipient', 'mcid:' + 'a'.repeat(64), 'replacement@example.com'), await hashPrivate(contactKey, 'guardian-email', 'replacement@example.com'), 'a'.repeat(32));
            }
            const resumed = await f.send(base + '/revoke', body);
            assert.equal(resumed.status, 200, await resumed.clone().text());
            assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_credentials').get()!.state, 'revoked');
            assert.equal(f.count('identity_card_requests'), 2);
            const events = f.db.sqlite.prepare("SELECT * FROM identity_mail_events WHERE kind='security-notice'").all();
            assert.equal(events.length, change === 'removed' ? 0 : 1);
            if (events.length)
                assert.equal(await decryptPrivate(contactKey, 'guardian-recipient', 'mcid:' + 'a'.repeat(64), String(events[0].recipient_ciphertext)), change === 'replaced' ? 'replacement@example.com' : 'shared@example.com');
            else
                assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_audit WHERE action='notification-not-enqueued-no-verified-contact'").get()!.n, 1);
        }
        finally {
            f.close();
        }
    }
});
test('contact removal or replacement immediately before revoke commit skips only notification and commits privacy withdrawal', async () => {
    for (const change of ['removed', 'replaced']) {
        const f = await fixture();
        try {
            const r = await issue(f), id = r.card.credentialId, batch = f.db.batch.bind(f.db);
            let changed = false;
            const replacementCipher = await encryptPrivate(contactKey, 'guardian-recipient', 'mcid:' + 'a'.repeat(64), 'replacement@example.com'), replacementHash = await hashPrivate(contactKey, 'guardian-email', 'replacement@example.com');
            f.db.batch = async (s) => { if (!changed && s.some(s => (s as unknown as {
                sql: string;
            }).sql.startsWith("UPDATE identity_credentials SET state='revoked'"))) {
                changed = true;
                if (change === 'removed')
                    f.db.sqlite.exec("UPDATE identity_guardian_invites SET state='cancelled' WHERE id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'");
                else {
                    f.db.sqlite.exec('DROP TRIGGER identity_guardian_immutable_binding');
                    f.db.sqlite.prepare('UPDATE identity_guardian_invites SET recipient_ciphertext=?,email_hash=? WHERE id=?').run(replacementCipher, replacementHash, 'a'.repeat(32));
                }
            } return batch(s); };
            const response = await f.send(base + '/revoke', { requestKey: 'contact-final-race', expectedIdentityVersion: 3, expectedCardRevision: 1, credentialId: id });
            assert.equal(response.status, 200, await response.clone().text());
            assert(changed);
            assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_credentials').get()!.state, 'revoked');
            assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_mail_events WHERE kind='security-notice'").get()!.n, 0);
            assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_audit WHERE action='notification-not-enqueued-contact-changed'").get()!.n, 1);
            assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_mail_audit WHERE action='queued'").get()!.n, 1);
            assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE entity_id=?').get(id)!.state, 'cancelled');
            assert.equal(f.count('identity_card_requests'), 2);
        }
        finally {
            f.close();
        }
    }
});
test('lost revoke acknowledgement replays the original receipt after contact removal with no second event or quota charge', async () => {
    const f = await fixture();
    try {
        const card = await issue(f), body = { requestKey: 'lost-revoke-ack', expectedIdentityVersion: 3, expectedCardRevision: 1, credentialId: card.card.credentialId }, batch = f.db.batch.bind(f.db);
        let lost = false;
        f.db.batch = async (s) => { const r = await batch(s); if (!lost && s.some(s => (s as unknown as {
            sql: string;
        }).sql.startsWith("UPDATE identity_credentials SET state='revoked'"))) {
            lost = true;
            throw new Error('synthetic committed acknowledgement lost');
        } return r; };
        const first = await f.send(base + '/revoke', body);
        assert.equal(first.status, 200);
        const receipt = await first.json();
        assert(lost);
        f.db.sqlite.exec("UPDATE identity_guardian_invites SET state='cancelled' WHERE id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'");
        assert.deepEqual(await (await f.send(base + '/revoke', body)).json(), receipt);
        assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_mail_events WHERE kind='security-notice'").get()!.n, 1);
        assert.equal(f.count('identity_card_requests'), 2);
        assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('identity-card:account:' + 'a'.repeat(16))!.count, 1);
        assert.equal(f.db.sqlite.prepare('SELECT version FROM agent_identities WHERE account_id=?').get('a'.repeat(16))!.version, 3);
    }
    finally {
        f.close();
    }
});
