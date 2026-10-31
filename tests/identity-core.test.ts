import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as identity from '../src/identity/index.ts';

const agentId = `mcid:${'a'.repeat(64)}`;
const createdAt = '2026-10-31T00:00:00.000Z';
const issuer = 'https://identity.example.com';
const credentialId = 'b'.repeat(32);
const payload = {
  type: 'NeoBabylonAgentIdentity', version: '0.01', issuer, agentId, credentialId,
  publicName: '範例 Agent', issuedAt: createdAt, keyId: 'issuer-2026.10',
  verificationURL: `${issuer}/identity/verify/${credentialId}`,
} as const satisfies identity.CredentialPayload;

async function keyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
}

async function signedFixture() {
  const pair = await keyPair();
  const signed = await identity.signCredential(payload, pair.privateKey);
  assert.ok(signed, 'signing must return an envelope');
  const options = { issuer, keys: new Map([[payload.keyId, pair.publicKey]]) };
  return { pair, signed, options };
}

test('agent IDs are independent random 256-bit identifiers', () => {
  const first = identity.createAgentId();
  const second = identity.createAgentId();
  assert.match(first, /^mcid:[0-9a-f]{64}$/);
  assert.match(second, /^mcid:[0-9a-f]{64}$/);
  assert.notEqual(first, second);
});

test('portable records contain exactly the version, random ID and canonical creation time', () => {
  const record = { version: '0.01', agentId, createdAt };
  assert.equal(identity.validateIdentityRecord(record), true);
  assert.equal(identity.validateIdentityRecord(Object.assign(Object.create(null), record)), true);
});

test('portable record validation rejects invalid IDs, dates, versions and all extra fields', () => {
  const record = { version: '0.01', agentId, createdAt };
  const invalid = [null, [], 'record', {}, { ...record, version: '0.02' },
    { ...record, agentId: `mcid:${'A'.repeat(64)}` }, { ...record, agentId: `mcid:${'a'.repeat(63)}` },
    { ...record, agentId: 'owner@example.com' }, { ...record, createdAt: '2026-02-30T00:00:00.000Z' },
    { ...record, createdAt: '2026-10-31T00:00:00Z' }, { ...record, createdAt: '2026-10-31T00:00:00.000+00:00' },
    ...['email', 'runtime', 'name', 'publicName', 'keyId', 'home', 'secret', 'privateKey', 'recoverySecret', 'unknown'].map(key => ({ ...record, [key]: 'forbidden' })),
    Object.assign(Object.create({}), record), { ...record, [Symbol('secret')]: true },
    Object.defineProperty({ ...record }, 'secret', { value: 'hidden' }),
    Object.defineProperty({ ...record }, 'createdAt', { get() { throw new Error('getter must not run'); } }),
  ];
  for (const value of invalid) assert.equal(identity.validateIdentityRecord(value), false);
});

test('credential payload validates the exact versioned public contract', () => {
  assert.equal(identity.validateCredentialPayload(payload), true);
  assert.equal(identity.validateCredentialPayload({ ...payload, publicName: '界'.repeat(80) }), true);
});

test('credential payload rejects all malformed fields, unsafe origins and extra secrets', () => {
  const invalid = [null, [], {}, ...Object.keys(payload).map(key => {
    const value = { ...payload } as Record<string, unknown>; delete value[key]; return value;
  }), { ...payload, type: 'OtherIdentity' }, { ...payload, version: '0.02' },
  { ...payload, agentId: `mcid:${'A'.repeat(64)}` }, { ...payload, credentialId: 'B'.repeat(32) },
  { ...payload, credentialId: 'b'.repeat(31) }, { ...payload, credentialId: 'b'.repeat(33) },
  ...['', ' ', '界'.repeat(81), 'hello\nworld', 'hello\u0000world', 'hello\u0085world', 'hello\u202Eworld'].map(publicName => ({ ...payload, publicName })),
  ...['', 'a'.repeat(65), 'key with spaces', 'key/part', 'key\n', '金鑰'].map(keyId => ({ ...payload, keyId })),
  ...['http://identity.example.com', `${issuer}/`, `${issuer}/path`, `${issuer}?q=1`, `${issuer}#part`, 'https://user:pass@identity.example.com', 'https://IDENTITY.example.com', 'https://identity.example.com:443'].map(unsafeIssuer => ({ ...payload, issuer: unsafeIssuer, verificationURL: `${unsafeIssuer}/identity/verify/${credentialId}` })),
  { ...payload, issuedAt: '2026-02-30T00:00:00.000Z' }, { ...payload, issuedAt: '2026-10-31' },
  { ...payload, verificationURL: `${issuer}/identity/verify/${'c'.repeat(32)}` },
  { ...payload, verificationURL: `https://evil.example/identity/verify/${credentialId}` },
  { ...payload, verificationURL: `${payload.verificationURL}?extra=true` },
  ...['email', 'recoverySecret', 'privateKey', 'publicKey', 'unknown'].map(key => ({ ...payload, [key]: 'forbidden' })),
  { ...payload, [Symbol('hidden')]: true }, Object.assign(Object.create({}), payload),
  Object.defineProperty({ ...payload }, 'issuer', { get() { throw new Error('must not run'); } }),
  ];
  for (const value of invalid) assert.equal(identity.validateCredentialPayload(value), false);
});

test('real Ed25519 signs a public payload with a canonical 64-byte base64url signature', async () => {
  const pair = await keyPair();
  const signed = await identity.signCredential(payload, pair.privateKey);
  assert.match(signed.signature, /^[A-Za-z0-9_-]{86}$/);
  assert.deepEqual(Object.keys(signed).sort(), ['payload', 'signature']);
  assert.deepEqual(signed.payload, payload);
  assert.notEqual(signed.payload, payload, 'the signed payload must be a snapshot');
  const sorted = Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)));
  assert.equal(await crypto.subtle.verify('Ed25519', pair.publicKey,
    Buffer.from(signed.signature, 'base64url'), new TextEncoder().encode(JSON.stringify(sorted))), true);
  assert.equal(await identity.verifyCredential(signed, { issuer, keys: new Map([[payload.keyId, pair.publicKey]]) }), true);
});

test('canonical signing and verification do not depend on payload insertion order', async () => {
  const { signed, options, pair } = await signedFixture();
  const reordered = Object.fromEntries(Object.entries(payload).reverse());
  assert.ok(identity.validateCredentialPayload(reordered));
  assert.equal((await identity.signCredential(reordered, pair.privateKey)).signature, signed.signature);
  assert.equal(await identity.verifyCredential({ ...signed, payload: reordered }, options), true);
});

test('tampering any public payload field or adding private fields invalidates verification', async () => {
  const { signed, options } = await signedFixture();
  const tampered = [
    { ...payload, publicName: 'Changed' }, { ...payload, agentId: `mcid:${'c'.repeat(64)}` },
    { ...payload, issuedAt: '2026-10-30T00:00:00.000Z' },
    { ...payload, credentialId: 'c'.repeat(32), verificationURL: `${issuer}/identity/verify/${'c'.repeat(32)}` },
    { ...payload, issuer: 'https://evil.example', verificationURL: `https://evil.example/identity/verify/${credentialId}` },
    { ...payload, keyId: 'another-key' }, { ...payload, version: '0.02' },
    { ...payload, verificationURL: `${issuer}/identity/verify/mismatch` },
    ...['recoverySecret', 'email', 'privateKey', 'publicKey'].map(key => ({ ...payload, [key]: 'forbidden' })),
  ];
  for (const value of tampered) assert.equal(await identity.verifyCredential({ ...signed, payload: value }, options), false);
});

test('verification requires external issuer and key trust; embedded keys never grant trust', async () => {
  const { signed, options } = await signedFixture();
  const stranger = await keyPair();
  for (const trust of [
    { ...options, issuer: 'https://wrong.example' }, { issuer, keys: new Map() },
    { issuer, keys: new Map([['unknown-key', options.keys.get(payload.keyId)!]]) },
    { issuer, keys: new Map([[payload.keyId, stranger.publicKey]]) },
    { issuer, keys: new Map([[payload.keyId, stranger.privateKey]]) },
  ]) assert.equal(await identity.verifyCredential(signed, trust), false);
  assert.equal(await identity.verifyCredential({ ...signed, publicKey: stranger.publicKey }, options), false);
  assert.equal(await identity.verifyCredential({ ...signed, payload: { ...payload, publicKey: stranger.publicKey } }, { issuer, keys: new Map() }), false);
});

test('rotation accepts both explicitly trusted keys and revocation removes old trust', async () => {
  const old = await keyPair(); const next = await keyPair();
  const nextPayload = { ...payload, keyId: 'issuer-2027' };
  const oldSigned = await identity.signCredential(payload, old.privateKey);
  const nextSigned = await identity.signCredential(nextPayload, next.privateKey);
  const keys = new Map([[payload.keyId, old.publicKey], [nextPayload.keyId, next.publicKey]]);
  assert.equal(await identity.verifyCredential(oldSigned, { issuer, keys }), true);
  assert.equal(await identity.verifyCredential(nextSigned, { issuer, keys }), true);
  keys.delete(payload.keyId);
  assert.equal(await identity.verifyCredential(oldSigned, { issuer, keys }), false);
  assert.equal(await identity.verifyCredential(nextSigned, { issuer, keys }), true);
});

test('malformed envelopes and noncanonical or incorrect signatures safely return false', async () => {
  const { signed, options } = await signedFixture();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const lastIndex = alphabet.indexOf(signed.signature.at(-1)!);
  const alternateEncoding = `${signed.signature.slice(0, -1)}${alphabet[lastIndex + 1]}`;
  assert.deepEqual(Buffer.from(alternateEncoding, 'base64url'), Buffer.from(signed.signature, 'base64url'));
  const malformed = [null, [], {}, { payload }, { signature: signed.signature },
    { ...signed, unknown: true }, { ...signed, [Symbol('secret')]: true },
    Object.defineProperty({ ...signed }, 'signature', { get() { throw new Error('must not run'); } }),
    ...['', '!', 'a'.repeat(85), 'a'.repeat(87), `${signed.signature}=`, `${signed.signature}\n`,
      `${signed.signature.slice(0, 10)}+${signed.signature.slice(11)}`, alternateEncoding,
      'A'.repeat(86)].map(signature => ({ ...signed, signature })),
  ];
  for (const value of malformed) assert.equal(await identity.verifyCredential(value, options), false);
});

test('signing rejects malformed contracts, public keys and non-Ed25519 keys', async () => {
  const pair = await keyPair();
  const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const withSecret = { ...payload, recoverySecret: 'secret' };
  await assert.rejects(() => identity.signCredential(withSecret, pair.privateKey));
  await assert.rejects(() => identity.signCredential({ ...payload, issuedAt: 'invalid' }, pair.privateKey));
  await assert.rejects(() => identity.signCredential(payload, pair.publicKey));
  await assert.rejects(() => identity.signCredential(payload, hmac));
});

test('signing validates the same snapshot it signs when a Proxy changes field reads', async () => {
  const pair = await keyPair();
  let reads = 0;
  const changingPayload = new Proxy({ ...payload, publicName: 'Safe' }, {
    get(target, property, receiver) {
      if (property === 'publicName') return ++reads <= 4 ? 'Safe' : '';
      return Reflect.get(target, property, receiver);
    },
  });
  const signed = await identity.signCredential(changingPayload, pair.privateKey);
  assert.equal(identity.validateCredentialPayload(signed.payload), true);
  assert.equal(await identity.verifyCredential(signed, { issuer, keys: new Map([[payload.keyId, pair.publicKey]]) }), true);
});

test('verification cannot substitute an invalid signed payload after validating another payload', async () => {
  const pair = await keyPair();
  const invalidPayload = { ...payload, publicName: '' };
  const sorted = Object.fromEntries(Object.entries(invalidPayload).sort(([a], [b]) => a.localeCompare(b)));
  const signature = Buffer.from(await crypto.subtle.sign('Ed25519', pair.privateKey,
    new TextEncoder().encode(JSON.stringify(sorted)))).toString('base64url');
  const signed = { payload: invalidPayload, signature };
  const options = { issuer, keys: new Map([[payload.keyId, pair.publicKey]]) };
  assert.equal(await identity.verifyCredential(signed, options), false);
  let reads = 0;
  const changingEnvelope = new Proxy(signed, {
    get(target, property, receiver) {
      if (property === 'payload') return ++reads === 1 ? payload : invalidPayload;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.equal(await identity.verifyCredential(changingEnvelope, options), false);
});
