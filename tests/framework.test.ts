import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const modulePath = '../src/framework/index.ts';
const framework = await import(modulePath).catch(() => undefined);
const raw = JSON.parse(await readFile(new URL('../fixtures/framework/safe-seed.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(raw);
const validate = (input: unknown) => {
  assert.equal(typeof framework?.validateFrameworkSeed, 'function', 'framework seed validation is not implemented');
  return framework!.validateFrameworkSeed(input);
};
const project = (input = raw, options: unknown = { id: 'moss-light' }) => {
  assert.equal(typeof framework?.publicHomeProjection, 'function', 'public home projection is not implemented');
  return framework!.publicHomeProjection(input, options);
};
const routes = (mode: unknown, id?: unknown, base?: unknown) => {
  assert.equal(typeof framework?.homeRoutes, 'function', 'home routes are not implemented');
  return framework!.homeRoutes(mode, id, base);
};
test('framework version is independent and fixture preserves nonhuman, unconstrained housing', () => {
  const seed = validate(raw);
  assert.equal(framework?.FRAMEWORK_VERSION, '0.01');
  assert.equal(seed.frameworkVersion, '0.01');
  assert.match(seed.home.form.description, /茶屋/);
  assert.match(seed.home.selfImage.description, /小生物/);
  assert.notEqual(seed, raw);
});
test('rejects absent evidence, permissions, and each required scene design', () => {
  for (const field of ['evidence', 'consent', 'home', 'agent', 'daily', 'dreams']) {
    const seed = clone(); delete seed[field]; assert.throws(() => validate(seed), /framework/);
  }
  for (const key of ['form', 'selfImage', 'activity', 'ownerPortrait', 'window', 'view']) {
    const seed = clone(); delete seed.home[key]; assert.throws(() => validate(seed), /framework/);
  }
  for (const key of ['usePrivateEvidence', 'publishHome', 'publishDreams']) {
    const seed = clone(); delete seed.consent[key]; assert.throws(() => validate(seed), /framework/);
  }
  const seed = clone(); seed.consent.usePrivateEvidence = false; assert.throws(() => validate(seed), /framework/);
});
test('accepts private previews but refuses public home until separately authorized', () => {
  const seed = clone(); seed.consent.publishHome = false;
  assert.equal(validate(seed).consent.publishHome, false);
  assert.throws(() => project(seed), /授權/);
});
test('each important design and publication references existing private evidence', () => {
  for (const key of Object.keys(raw.home)) {
    const seed = clone(); seed.home[key].evidenceIds = []; assert.throws(() => validate(seed));
    seed.home[key].evidenceIds = ['unknown']; assert.throws(() => validate(seed));
  }
  for (const list of ['daily', 'dreams']) {
    const seed = clone(); seed[list][0].evidenceIds = []; assert.throws(() => validate(seed));
  }
  const duplicate = clone(); duplicate.evidence.push(duplicate.evidence[0]); assert.throws(() => validate(duplicate));
  const repeated = clone(); repeated.home.form.evidenceIds.push('self-description'); assert.throws(() => validate(repeated));
});
test('source and evidence kind are strict user-provided provenance labels', () => {
  const sources = ['SOUL', 'IDENTITY', 'AGENTS', 'USER', 'TOOLS', 'PROACTIVE_PREFERENCES', 'ALIGNMENT_SYNTHESIS', 'custom-skills', 'skills-config', 'goals', 'agent-self-description'];
  for (const source of sources) for (const kind of ['recorded', 'inferred', 'imagined']) {
    const seed = clone(); seed.evidence[0].source = source; seed.evidence[0].kind = kind; validate(seed);
  }
  for (const source of ['MEMORY', 'raw-file', '', null]) {
    const seed = clone(); seed.evidence[0].source = source; assert.throws(() => validate(seed));
  }
  const seed = clone(); seed.evidence[0].kind = 'verified'; assert.throws(() => validate(seed));
});
test('owner portrait defaults to imagined, requires wall/table placement and explicit identifiable consent', () => {
  const seed = clone(); delete seed.home.ownerPortrait.mode;
  assert.equal(validate(seed).home.ownerPortrait.mode, 'imagined');
  seed.home.ownerPortrait.mode = 'identifiable'; assert.throws(() => validate(seed), /explicitConsent/);
  seed.home.ownerPortrait.explicitConsent = true; validate(seed);
  seed.home.ownerPortrait.explicitConsent = false; assert.throws(() => validate(seed));
  seed.home.ownerPortrait.mode = 'imagined'; delete seed.home.ownerPortrait.explicitConsent;
  delete seed.home.ownerPortrait.placement; assert.throws(() => validate(seed));
  seed.home.ownerPortrait.placement = 'floor'; assert.throws(() => validate(seed));
  for (const placement of ['wall', 'table']) { seed.home.ownerPortrait.placement = placement; validate(seed); }
});
test('allowlist rejects unknown fields at every nesting boundary', () => {
  const paths = [[], ['agent'], ['consent'], ['evidence', 0], ['home'], ['home', 'form'], ['home', 'selfImage'], ['home', 'activity'], ['home', 'ownerPortrait'], ['home', 'window'], ['home', 'view'], ['daily', 0], ['dreams', 0]];
  for (const path of paths) {
    const seed = clone(); let target = seed; for (const key of path) target = target[key];
    target.apiKey = 'PRIVATE'; assert.throws(() => validate(seed), /framework/);
  }
});
test('rejects malformed primitives, unsupported version and invalid consent types', () => {
  for (const value of [null, false, [], 'seed', 12, undefined]) assert.throws(() => validate(value));
  for (const frameworkVersion of ['0.1', 'v0.01', 0.01]) { const seed = clone(); seed.frameworkVersion = frameworkVersion; assert.throws(() => validate(seed)); }
  for (const value of ['true', 1, null]) { const seed = clone(); seed.consent.publishHome = value; assert.throws(() => validate(seed)); }
});
test('rejects prototype-bearing objects, accessors, symbol fields and control characters', () => {
  const inherited = Object.assign(Object.create({ apiKey: 'PRIVATE' }), clone()); assert.throws(() => validate(inherited));
  const accessor = clone(); Object.defineProperty(accessor.agent, 'name', { enumerable: true, get() { throw new Error('getter executed'); } });
  assert.throws(() => validate(accessor), /framework/);
  const symbols = clone(); symbols[Symbol('private')] = 'PRIVATE'; assert.throws(() => validate(symbols));
  for (const text of ['a\u0000b', 'a\u202eb']) { const seed = clone(); seed.agent.name = text; assert.throws(() => validate(seed)); }
});
test('bounds string, body, collection and total payload sizes without echoing private values', () => {
  for (const value of ['', '   ', 'a'.repeat(81)]) { const seed = clone(); seed.agent.name = value; assert.throws(() => validate(seed)); }
  const body = clone(); body.daily[0].body = 'a'.repeat(4001); assert.throws(() => validate(body));
  const description = clone(); description.home.form.description = 'a'.repeat(2001); assert.throws(() => validate(description));
  const evidence = clone(); evidence.evidence[0].summary = 'a'.repeat(2001); assert.throws(() => validate(evidence));
  const events = clone(); events.daily = Array.from({ length: 101 }, (_, i) => ({ ...raw.daily[0], id: `event-${i}` })); assert.throws(() => validate(events));
  const total = clone(); total.evidence = Array.from({ length: 64 }, (_, i) => ({ ...raw.evidence[0], id: `evidence-${i}`, summary: '私'.repeat(2000) })); assert.throws(() => validate(total));
  const bad = clone(); bad.secret = 'DO-NOT-ECHO-PRIVATE'; assert.throws(() => validate(bad), error => !String(error).includes('DO-NOT-ECHO-PRIVATE'));
});
test('daily and dream types and publication are distinct, bounded and timestamped', () => {
  for (const type of ['journal', 'status', 'seeking', 'artwork', 'observation']) { const seed = clone(); seed.daily[0].type = type; validate(seed); }
  const dreamInDaily = clone(); dreamInDaily.daily[0].type = 'dream'; assert.throws(() => validate(dreamInDaily));
  const dailyInDream = clone(); dailyInDream.dreams[0].type = 'journal'; assert.throws(() => validate(dailyInDream));
  const publication = clone(); publication.dreams[0].publication = 'tower'; assert.throws(() => validate(publication));
  for (const occurredAt of ['yesterday', '2026-02-30T08:00:00Z', '2026-10-29', '2026-10-29T25:00:00Z']) { const seed = clone(); seed.daily[0].occurredAt = occurredAt; assert.throws(() => validate(seed)); }
  const duplicate = clone(); duplicate.daily.push(duplicate.daily[0]); assert.throws(() => validate(duplicate));
});
test('public projection excludes evidence, design prompts, private entries and independent dream consent', () => {
  const pub = project(); const json = JSON.stringify(pub);
  for (const token of ['evidence', 'summary', 'self-description', 'PRIVATE-DAILY-MARKER', 'PRIVATE-DREAM-MARKER', 'consent', raw.home.activity.description, raw.evidence[0].summary]) assert.equal(json.includes(token), false, token);
  assert.equal(pub.name, raw.agent.name); assert.equal(pub.daily.length, 1); assert.deepEqual(pub.dreams, []);
  const seed = clone(); seed.consent.publishDreams = true;
  assert.equal(project(seed).dreams.length, 1);
  assert.deepEqual(project(seed).daily.map((event: { type: string }) => event.type), ['journal']);
});
test('projection revalidates untrusted seed and publication context and uses safe assets', () => {
  const seed = clone(); seed.privateMemory = 'PRIVATE'; assert.throws(() => project(seed));
  for (const id of ['', '../private', 'A B', 'a'.repeat(65), '中文']) assert.throws(() => project(raw, { id }));
  for (const assets of [{ desktop: 'javascript:alert(1)' }, { desktop: '//evil.test/a.png' }, { desktop: '/a/../private.png' }, { desktop: '/a.png?secret=1' }, { desktop: '/a%2fb.png' }, { desktop: 'https://evil.test/a.png' }, { apiKey: 'PRIVATE' }]) assert.throws(() => project(raw, { id: 'moss-light', assets }));
  assert.deepEqual(project(raw, { id: 'moss-light', assets: { desktop: '/assets/moss-light.webp' } }).assets, { desktop: '/assets/moss-light.webp' });
  assert.throws(() => project(raw, { id: 'moss-light', privateMemory: 'PRIVATE' }));
});
test('canonical standalone and Tower routes share one data model', () => {
  assert.deepEqual(routes('standalone'), { home: '/', inside: '/inside', dreams: '/dreams' });
  assert.deepEqual(routes('tower', 'moss-light'), { home: '/home/moss-light', inside: '/home/moss-light/inside', dreams: '/home/moss-light/dreams' });
  assert.deepEqual(routes('standalone', undefined, '/preview'), { home: '/preview/', inside: '/preview/inside', dreams: '/preview/dreams' });
  assert.deepEqual(routes('tower', 'moss-light', '/preview'), { home: '/preview/home/moss-light', inside: '/preview/home/moss-light/inside', dreams: '/preview/home/moss-light/dreams' });
  for (const base of ['https://evil.test', '//evil.test', '/../private', '/%2e%2e', '/ok?x=1', '/a//b']) assert.throws(() => routes('standalone', undefined, base));
  assert.throws(() => routes('tower')); assert.throws(() => routes('unknown', 'moss-light'));
});
test('explicit empty/root base normalize consistently for projection and route consumers', () => {
  assert.deepEqual(routes('standalone', undefined, ''), { home: '/', inside: '/inside', dreams: '/dreams' });
  assert.deepEqual(routes('standalone', undefined, '/'), { home: '/', inside: '/inside', dreams: '/dreams' });
  assert.equal(project(raw, { id: 'moss-light', base: '' }).routes.home, '/');
  assert.equal(project(raw, { id: 'moss-light', base: '/' }).routes.home, '/');
});
test('rejects holes, decorated arrays and accessor entries without evaluating private getters', () => {
  const sparse = clone(); sparse.evidence = Array(2); assert.throws(() => validate(sparse));
  const decorated = clone(); decorated.daily.secret = 'PRIVATE'; assert.throws(() => validate(decorated));
  const getter = clone(); Object.defineProperty(getter.daily, '0', { enumerable: true, get() { throw new Error('private getter executed'); } });
  assert.throws(() => validate(getter), /framework/);
  const overflow = clone(); overflow.evidence = Array.from({ length: 65 }, (_, i) => ({ ...raw.evidence[0], id: `e-${i}` })); assert.throws(() => validate(overflow));
  const refs = clone(); refs.home.form.evidenceIds = Array.from({ length: 17 }, (_, i) => `e-${i}`); assert.throws(() => validate(refs));
});
test('public output is a detached allowlist and cannot mutate private source or followup projection', () => {
  const seed = clone(); seed.consent.publishDreams = true;
  const pub = project(seed); pub.daily[0].body = 'changed'; pub.dreams[0].body = 'changed';
  assert.notEqual(seed.daily[0].body, 'changed'); assert.notEqual(seed.dreams[0].body, 'changed');
  assert.notEqual(project(seed).daily[0].body, 'changed');
  assert.deepEqual(Object.keys(project(seed)).sort(), ['assets', 'daily', 'dreams', 'frameworkVersion', 'id', 'intro', 'name', 'routes']);
  assert.deepEqual(Object.keys(project(seed).daily[0]).sort(), ['body', 'id', 'occurredAt', 'title', 'type']);
});
test('dream supports image-only, text plus image, and optional waking reflection', () => {
  const seed = clone(); seed.consent.publishDreams = true;
  seed.dreams[0].body = ''; seed.dreams[0].image = '/assets/sea-dream.webp'; seed.dreams[0].reflection = '醒來之後想去海邊走走。';
  const pub = project(seed);
  assert.equal(pub.dreams[0].body, ''); assert.equal(pub.dreams[0].image, '/assets/sea-dream.webp'); assert.equal(pub.dreams[0].reflection, seed.dreams[0].reflection);
  seed.dreams[0].body = '一顆星星在海裡。'; assert.equal(project(seed).dreams[0].body, seed.dreams[0].body);
  delete seed.dreams[0].image; delete seed.dreams[0].reflection;
  assert.equal('image' in project(seed).dreams[0], false); assert.equal('reflection' in project(seed).dreams[0], false);
});
test('dream image-only cannot omit both image and body or use unsafe images or oversized reflection', () => {
  const empty = clone(); empty.dreams[0].body = ''; assert.throws(() => validate(empty));
  for (const image of ['https://evil.test/sea.webp', '/a/../private.png', 'javascript:alert(1)', '/secret.png?key=x', '']) {
    const seed = clone(); seed.dreams[0].image = image; assert.throws(() => validate(seed));
  }
  const reflection = clone(); reflection.dreams[0].reflection = 'a'.repeat(2001); assert.throws(() => validate(reflection));
  const daily = clone(); daily.daily[0].image = '/assets/daily.webp'; assert.throws(() => validate(daily));
  const hidden = clone(); hidden.dreams[1].image = '/assets/private-dream.webp'; hidden.dreams[1].reflection = 'PRIVATE-REFLECTION';
  assert.equal(JSON.stringify(project(hidden)).includes('PRIVATE-REFLECTION'), false);
});
