import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { addInteraction, readInteractions, STORAGE_KEY, type StorageLike } from '../src/interactions.ts';
import { publicProjection, publicManagerInput, type PrivateResident } from '../server/privacy.ts';
import { FileJobStore, OnboardingService, type OnboardingInput } from '../server/onboarding.ts';
import { disconnectedMeta, type MetaGateway, type MetaGenerationResult } from '../server/meta.ts';
import { residents } from '../src/residents.ts';
import { homeArtwork, characterArtwork } from '../src/artwork.ts';
function memoryStore(): StorageLike {
  const store = new Map<string, string>();
  return { getItem: key => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); }, removeItem: key => { store.delete(key); } };
}
const input: OnboardingInput = { identityKey: 'TEST-IDENTITY', personality: 'TEST-PRIVATE-MEMORY', consent: { analyzePersonality: true, publishProfile: true, publishOwner: false } };
const fakeResult: MetaGenerationResult = {
  provider: 'meta-api', verifiedModel: { name: 'TEST-ONLY-MODEL', metadataSource: 'test fixture; not verified production metadata' },
  desktop: { id: 'test-desktop', purpose: 'home-desktop', provider: 'meta-api', status: 'generated', model: 'TEST-ONLY-MODEL', promptVersion: 'test-v1', generatedAt: '2026-10-28T00:00:00Z', file: 'test/desktop', generationId: 'test-generation' },
  mobile: { id: 'test-mobile', purpose: 'home-mobile', provider: 'meta-api', status: 'generated', model: 'TEST-ONLY-MODEL', promptVersion: 'test-v1', generatedAt: '2026-10-28T00:00:00Z', file: 'test/mobile', generationId: 'test-generation' },
  publicIntro: 'Public test introduction', publicRole: 'Test role',
};
async function withService(fn: (store: FileJobStore, file: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'muse-test-'));
  const file = join(dir, 'jobs.json');
  try { await fn(new FileJobStore(file), file); } finally { await rm(dir, { recursive: true }); }
}
test('ten fixtures have unique random-form IDs and no private fields', () => {
  assert.equal(residents.length, 10); assert.equal(new Set(residents.map(x => x.id)).size, 10);
  for (const r of residents) { assert.match(r.id, /^[a-z0-9]{6}$/); assert.equal('owner' in r, false); assert.equal('privateMemory' in r, false); assert.equal('model' in r, false); }
});
test('interactions persist once, reject duplicates/rate abuse, retain literal text', () => {
  const storage = memoryStore(); const entry = { residentId: residents[0].id, kind: 'message' as const, name: 'Neighbor', text: '<script>not an instruction</script>' };
  addInteraction(storage, entry, 50_000);
  assert.equal(readInteractions(storage)[0].text, entry.text);
  assert.throws(() => addInteraction(storage, entry, 100_000), /重複/);
  assert.throws(() => addInteraction(storage, { ...entry, text: 'different' }, 60_000), /30 秒/);
  addInteraction(storage, { ...entry, text: 'different' }, 100_000);
  assert.equal(readInteractions(storage).length, 2);
});
test('validation blocks empty, oversized and linked/private contact content', () => {
  const storage = memoryStore(); const base = { residentId: residents[0].id, kind: 'message' as const, name: 'A', text: 'hello' };
  for (const text of ['', ' ', 'a'.repeat(281), 'https://example.com', 'email a@example.com']) assert.throws(() => addInteraction(storage, { ...base, text }));
  assert.throws(() => addInteraction(storage, { ...base, name: 'a'.repeat(25) }));
});
test('storage corruption and storage failures are handled without false success', () => {
  const storage = memoryStore(); storage.setItem(STORAGE_KEY, '{broken'); assert.deepEqual(readInteractions(storage), []);
  storage.setItem(STORAGE_KEY, '[null,{"text":"bad"}]'); assert.deepEqual(readInteractions(storage), []);
  assert.throws(() => addInteraction({ ...storage, setItem() { throw new Error('quota'); } }, { residentId: residents[0].id, kind: 'gift', name: 'A', text: 'Hello' }), /尚未送出/);
});
test('private fields and owner identity require independent publication consent', () => {
  const record: PrivateResident = { id: 'test', name: 'A', publicIntro: 'Hi', publicRole: 'Helper', privateMemory: 'SECRET', owner: { name: 'OWNER-SECRET', website: 'PRIVATE' }, consent: input.consent };
  assert.deepEqual(publicProjection(record), { id: 'test', name: 'A', intro: 'Hi', role: 'Helper' });
  assert.equal(JSON.stringify(publicProjection(record)).includes('SECRET'), false);
  assert.deepEqual(publicProjection({ ...record, consent: { ...input.consent, publishProfile: false } }), { id: 'test' });
  assert.equal('owner' in publicProjection({ ...record, consent: { ...input.consent, publishOwner: true } }), true);
  assert.equal('model' in publicProjection({ ...record, verifiedModel: { name: 'guessed', evidence: '' } }), false);
});
test('manager only receives deduplicated, consenting public events', () => {
  const event = { id: 'e1', residentId: 'a', occurredAt: '2026-10-28', type: 'journal' as const, summary: 'PUBLIC', visibility: 'public' as const };
  assert.deepEqual(publicManagerInput([event, event, { ...event, id: 'private', visibility: 'private' }, { ...event, id: 'b', residentId: 'b' }], new Set(['a'])), [{ id: 'e1', residentId: 'a', occurredAt: '2026-10-28', type: 'journal', summary: 'PUBLIC' }]);
});
test('consent denied creates no job', () => withService(async store => {
  await assert.rejects(new OnboardingService(store, disconnectedMeta).prepare({ ...input, consent: { ...input.consent, analyzePersonality: false } }), /授權/);
}));
test('repeat and concurrent requests, including after restart, keep one job; no raw memory saved', () => withService(async (store, file) => {
  const service = new OnboardingService(store, disconnectedMeta);
  const jobs = await Promise.all([service.prepare(input), service.prepare(input), service.prepare(input)]);
  assert.equal(new Set(jobs.map(x => x.residentId)).size, 1);
  const restarted = new OnboardingService(new FileJobStore(file), disconnectedMeta);
  assert.equal((await restarted.prepare(input)).idempotencyKey, jobs[0].idempotencyKey);
  assert.equal((await readFile(file, 'utf8')).includes(input.personality), false);
  await assert.rejects(service.prepare({ ...input, personality: 'changed to reroll' }), /固定/);
}));
test('disconnected API does not mark generation complete or create another address', () => withService(async store => {
  const service = new OnboardingService(store, disconnectedMeta); const first = await service.run(input); const retry = await service.run(input);
  assert.equal(first.state, 'failed'); assert.equal(first.residentId, retry.residentId); assert.equal(retry.result, undefined);
}));
test('successful fake gateway gets called once even with concurrent and repeated requests', () => withService(async store => {
  let count = 0;
  const gateway: MetaGateway = { async analyzeAndGenerate() { count++; return fakeResult; } };
  const service = new OnboardingService(store, gateway);
  await Promise.all([service.run(input), service.run(input)]);
  assert.equal((await service.run(input)).state, 'complete'); assert.equal(count, 1);
}));
test('uncertain provider outcome requires recovery and cannot silently reroll', () => withService(async (store, file) => {
  let count = 0;
  const gateway: MetaGateway = { async analyzeAndGenerate() { count++; throw new Error('timeout: unknown remote result'); } };
  const service = new OnboardingService(store, gateway);
  assert.equal((await service.run(input)).state, 'needs-recovery');
  assert.equal((await new OnboardingService(new FileJobStore(file), gateway).run(input)).state, 'needs-recovery');
  assert.equal(count, 1);
}));
test('missing asset provenance is held for recovery, never published as complete', () => withService(async store => {
  const gateway: MetaGateway = { async analyzeAndGenerate() { return { ...fakeResult, desktop: { ...fakeResult.desktop, generatedAt: null } }; } };
  assert.equal((await new OnboardingService(store, gateway).run(input)).state, 'needs-recovery');
}));


test('prototype gift selection is allowlisted and persisted without modifying runtime provider', () => {
  const storage = memoryStore();
  const gift = { residentId: residents[0].id, kind: 'gift' as const, name: 'Neighbor', text: 'A little light', giftId: 'gift-cloud' };
  addInteraction(storage, gift);
  assert.equal(readInteractions(storage)[0].giftId, 'gift-cloud');
  assert.throws(() => addInteraction(memoryStore(), { ...gift, giftId: 'https://external.example/picture' }), /無效/);
  assert.throws(() => addInteraction(memoryStore(), { ...gift, kind: 'message' }), /無效/);
});


test('every prototype asset has truthful Codex provenance and matches the delivered file', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/prototype-provenance.json', import.meta.url), 'utf8'));
  assert.equal(manifest.assets.length, 25);
  assert.equal(Object.keys(homeArtwork).length, 10);
  assert.equal(new Set(Object.values(homeArtwork).flatMap(art => [art.desktop, art.mobile])).size, 20);
  for (const resident of residents) {
    const art = homeArtwork[resident.id]; assert.ok(art);
    assert.ok(manifest.assets.find((asset: { id: string; residentId: string; purpose: string }) => asset.id === art.desktop && asset.residentId === resident.id && asset.purpose === 'home-desktop'));
    assert.ok(manifest.assets.find((asset: { id: string; residentId: string; referenceAssetId: string }) => asset.id === art.mobile && asset.residentId === resident.id && asset.referenceAssetId === art.desktop));
  }
  for (const asset of manifest.assets) {
    assert.equal(asset.provider, 'codex-built-in-imagegen'); assert.equal(asset.status, 'prototype-generated');
    assert.equal(asset.productionReplacement, 'meta-api'); assert.equal(asset.model, null); assert.equal(asset.generatedAt, null);
    assert.ok(asset.prompt); assert.ok(asset.promptVersion); assert.ok(asset.observedAt);
    const file = await readFile(new URL(`../public/${asset.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(file).digest('hex'), asset.sha256);
    assert.equal(file.readUInt32BE(16), asset.width); assert.equal(file.readUInt32BE(20), asset.height);
    if (asset.purpose === 'gift') assert.equal(file[25], 6); // PNG retains alpha channel.
  }
});


test('ten Star Sprout portraits map to residents and derive from the selected A master', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/character-provenance.json', import.meta.url), 'utf8'));
  assert.equal(manifest.assets.length, 12);
  assert.equal(Object.keys(characterArtwork).length, 10);
  assert.equal(new Set(Object.values(characterArtwork).map(art => art.file)).size, 10);
  const master = manifest.assets.find((asset: { id: string }) => asset.id === 'character-species-master');
  assert.equal(master.referenceAssetId, 'character-reference-a'); assert.ok(master.prompt);
  for (const resident of residents) {
    const art = characterArtwork[resident.id]; assert.ok(art);
    const record = manifest.assets.find((asset: { id: string; residentId: string }) => asset.id === art.file && asset.residentId === resident.id);
    assert.ok(record); assert.equal(record.referenceAssetId, master.id); assert.equal(record.purpose, 'character'); assert.ok(record.prompt);
  }
  for (const asset of manifest.assets) {
    const file = await readFile(new URL(`../public/${asset.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(file).digest('hex'), asset.sha256);
    assert.equal(file.readUInt32BE(16), 1254); assert.equal(file.readUInt32BE(20), 1254);
    assert.equal(asset.provider, 'codex-built-in-imagegen'); assert.equal(asset.model, null); assert.equal(asset.generatedAt, null);
  }
});


test('world-neighbor fixtures use ten different fictional owners, cities and roles without contact URLs', () => {
  assert.equal(new Set(residents.map(resident => resident.demo.ownerAlias)).size, 10);
  assert.equal(new Set(residents.map(resident => resident.demo.city)).size, 10);
  assert.equal(new Set(residents.map(resident => resident.role)).size, 10);
  for (const resident of residents) {
    assert.equal(resident.demo.kind, 'fictional-fixture');
    assert.equal(resident.demo.ownerIsFictional, true);
    assert.equal(resident.demo.ownerDisclosure, 'fictional-demo-only');
    assert.ok(resident.demo.country); assert.ok(resident.demo.personality); assert.ok(resident.demo.ownerProject);
    assert.ok(resident.diary.body); assert.ok(resident.busy); assert.ok(resident.seeking); assert.ok(resident.interests.length);
    assert.doesNotMatch(JSON.stringify(resident.demo), /https?:|www\.|@/);
  }
});


test('approved NeoBabylon logo matches its recorded provenance without granting repository licensing', async () => {
  const asset = JSON.parse(await readFile(new URL('../public/brand-provenance.json', import.meta.url), 'utf8'));
  const data = await readFile(new URL(`../public/${asset.file}`, import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256);
  assert.equal(asset.width, 2172); assert.equal(asset.height, 724);
  assert.equal(asset.status, 'user-approved-existing-brand-asset');
  assert.equal(asset.model, null); assert.equal(asset.prompt, null);
  assert.match(asset.usageScope, /does not grant downstream rights/);
});
