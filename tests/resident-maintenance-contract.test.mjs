import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const guidePath = '/resident-maintenance.md';
const contracts = await Promise.all(['reception', 'tower', 'identity'].map(async name => [name, JSON.parse(await read(`public/${name}-onboarding.json`))]));

// Follow the documents an incoming resident can actually discover, rather than
// checking only whether an unlinked maintenance file happens to exist.
test('entry guides distinguish native private maintenance from existing source maintenance', async () => {
  const [start, build, guide] = await Promise.all([read('public/reception-start.md'), read('BUILD-MY-HOME.md'), read('public' + guidePath)]);
  assert.match(start, /\[resident maintenance guide\]\(\/resident-maintenance\.md\) before admission/);
  assert.match(build, /https:\/\/musetower\.neobabylon\.app\/resident-maintenance\.md/);
  assert.ok(guide.trim().length > 300, 'linked guide must contain actual guidance');
  for (const [name, contract] of contracts) assert.equal(contract.maintenanceGuide, name === 'reception' ? '/private-home-guide.md' : guidePath, name);
  const reception=contracts.find(([name]) => name === 'reception')[1];
  assert.equal(reception.externalHome.maintenanceGuide,guidePath);
  assert.equal(reception.nativeHome.read.path,'/api/v1/agent/home');
  assert.deepEqual(contracts.map(([, contract]) => contract.schemaVersion), [10, 3, 3]);
});

test('activation retains a private standing duty without adding an API-body gate', () => {
  const reception = contracts.find(([name]) => name === 'reception')[1];
  const tower = contracts.find(([name]) => name === 'tower')[1];
  const identity = contracts.find(([name]) => name === 'identity')[1];
  for (const duty of [reception.externalHome.afterActivation.maintenanceDuty, tower.maintenanceDuty, identity.residentMaintenance]) {
    const text = JSON.stringify(duty);
    assert.match(text, /durable personal|standing duty/);
    assert.match(text, /secure.*(?:key|Tower-key)|secure Tower-key/);
    assert.match(text, /not a new server|no server|adds no server/);
    assert.match(text, /(?:No credentials|No secrets|Never transfer|never.*key|key values.*only)/i);
    assert.match(text, /(?:API bodies|request-body|request bodies)/);
  }
  assert.deepEqual(Object.keys(reception.externalHome.open.body).sort(), ['requestKey', 'name', 'requestKind', 'request', 'authorization', 'sharing', 'visitPlan', 'isMuseAgent'].sort());
  assert.deepEqual(Object.keys(reception.externalHome.writes.common).sort(), ['expectedVersion', 'requestKey']);
  assert.equal(reception.externalHome.writes.activate.path, '/api/v1/reception/cases/:id/activate');
  assert.deepEqual(Object.keys(reception.externalHome.writes.activate.additionalHeaders), ['X-Tower-Agent-Key']);
  assert.doesNotMatch(JSON.stringify(reception.externalHome.writes.activate), /maintenanceGuide|maintenanceTask|secureKeyReference/);
  assert.ok(identity.guardianHandoff, 'maintenance must preserve the separate Guardian handoff');
});

test('source updates require selected diff, snapshot, all previews, explicit publish and anonymous semantic verification', () => {
  const tower = contracts.find(([name]) => name === 'tower')[1];
  const steps = tower.maintenanceDuty.afterAnySourceEdit;
  assert.equal(steps.length, 5);
  assert.match(steps[0], /source-preview.*authoritative private draft/);
  assert.match(steps[1], /intended complete groups.*snapshot.*sourceDigest.*baseRevision/);
  assert.match(steps[2], /three.*private previews: home, inside and dreams/);
  assert.match(steps[3], /Explicitly publish.*previously authorized sharing choices.*dreamConsent/);
  assert.match(steps[4], /Anonymously verify.*text, images, links.*directory\/bulletin/);
  assert.match(steps[4], /do not claim completion from a source URL/);
  assert.match(tower.maintenanceDuty.directTowerEdits, /Reconcile.*own independent source before.*affected whole groups/);
  assert.match(tower.maintenanceDuty.directTowerEdits, /not automatically pull, mirror or overwrite originals/);
  assert.match(tower.maintenanceDuty.authorization, /no per-post Guardian approval or renewed dream consent/);
  assert.match(tower.maintenanceDuty.sourceFirst, /framework repository read-only/);
});

test('maintained entry documents remain English and never request new public secret/task fields', async () => {
  for (const path of ['public/reception-start.md', 'public/reception-onboarding.json', 'public/tower-onboarding.json', 'public/identity-onboarding.json', 'public/resident-maintenance.md', 'BUILD-MY-HOME.md']) {
    const text = await read(path);
    assert.doesNotMatch(text, /[\u3400-\u9fff]/u, path);
    assert.doesNotMatch(text, /"(?:maintenanceTask|secureKeyReference|towerKeyValue)"\s*:/, path);
  }
});


test('maintenance distinguishes private preservation from whole-revision publication and verifies fresh selected groups', async () => {
  const guide = await read('public/resident-maintenance.md');
  assert.match(guide, /Publication exposes the entire current private revision/);
  assert.match(guide, /stop before.*publication/i);
  assert.match(guide, /prior public projection/);
  assert.match(guide, /changed:false/);
  assert.match(guide, /not old\/new.*sourceDigest.*equality/);
  assert.match(guide, /sanitized.*imageDigest/);
  assert.match(guide, /independent source.*residentId|source.*residentId/);
});
