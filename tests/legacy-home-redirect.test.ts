import test from 'node:test';
import assert from 'node:assert/strict';
import runtime, { type PagesBindings } from '../server/live/worker.ts';

const tower = 'https://tower.example', destination = 'https://independent.example';
const config = (map: unknown = { '/old-home': destination }) => JSON.stringify(map);
async function fetch(path: string, mapping: string | undefined = config(), method = 'GET') {
  const env: PagesBindings = {
    LEGACY_HOME_REDIRECTS: mapping,
    ASSETS: { async fetch() { return new Response('static'); } },
  };
  return runtime.fetch(new Request(tower + path, { method }), env);
}
test('legacy prefix redirects GET and HEAD to the independent origin with the prefix removed', async () => {
  for (const method of ['GET', 'HEAD']) for (const [path, suffix] of [
    ['/old-home', '/'], ['/old-home/', '/'], ['/old-home/inside.html', '/inside.html'],
    ['/old-home/assets/home.png?private=value#fragment', '/assets/home.png'],
    ['/old-home/%E5%AE%B6.html', '/%E5%AE%B6.html'],
  ]) {
    const response = await fetch(path, config(), method);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), destination + suffix);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
});
test('legacy matching uses path boundaries and the longest configured prefix', async () => {
  assert.equal((await fetch('/old-home-other/inside')).status, 200);
  const response = await fetch('/old-home/nested/inside.html', config({ '/old-home': destination, '/old-home/nested': 'https://nested.example' }));
  assert.equal(response.headers.get('location'), 'https://nested.example/inside.html');
  assert.equal((await fetch('/old-home', config(), 'POST')).status, 200);
  assert.equal((await fetch('/legacy/inside.html', config({ '/legacy': destination }))).status, 308);
  assert.equal((await fetch('/old-home', JSON.stringify({}))).status, 200);
  assert.equal((await fetch('/old-home', '')).status, 200);
});
test('invalid legacy config disables the complete map without exposing it', async () => {
  for (const mapping of ['bad json', 'null', '[]', 'true', ' '.repeat(16385) + '{}', config(Object.fromEntries(Array.from({length:21},(_,i)=>['/old-'+i,destination]))), ...[
    { '/old-home': 'http://independent.example' }, { '/old-home': destination + '/' },
    { '/old-home': 'https://user:pass@independent.example' }, { '/old-home': destination + '?x' },
    { '/old-home': destination + '#' }, { '/old-home': destination + '/path' },
    { '/old-home': destination + '\n' }, { '/old-home': 3 },
    { '/': destination }, { '//evil.example': destination }, { '/old-home/': destination },
    { '/old-home/../unsafe': destination }, { '/old%2dhome': destination },
    { '/old-home?x': destination }, { '/old-home\n': destination },
    { '/old-home': destination, '/other': 'https://user@unsafe.example' },
  ].map(config)]) {
    const response = await fetch('/old-home/inside.html', mapping);
    assert.equal(response.status, 200, mapping);
    assert.equal(response.headers.get('location'), null, mapping);
    assert.equal(await response.text(), 'static');
  }
});
test('legacy redirects cannot override reserved Tower paths or escape to another origin', async () => {
  for (const path of ['/api', '/api/v1/status', '/home/1234567890abcdef', '/move-in', '/neighbors', '/assets/app.js', '/about', '/agent-onboarding.json', '/tower-onboarding.json', '/examples/muse-condo', '/m7k2px/inside', '/reception', '/admin', '/manage', '/login']) {
    const prefix = '/' + path.split('/')[1];
    const response = await fetch(path, config({ [prefix]: destination }));
    assert.equal(response.headers.get('location'), null, path);
  }
  for (const path of ['/old-home//evil.example/path', '/old-home/%2f%2fevil.example', '/old-home/%5cevil.example', '/old-home/%0d%0aLocation:evil', '/old-home/%00file', '/old-home/%7ffile', '/old-home/%C2%85file', '/old-home/%252f%252fevil.example', '/old-home/../outside']) {
    const response = await fetch(path);
    assert.equal(response.headers.get('location'), null, path);
  }
});
