import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, serialize } from 'parse5';
import { renderTowerHome, type TowerHomeTarget } from '../server/live/tower-home-render.ts';
import { renderCondo } from '../src/framework/condo-render.ts';
import { digest } from '../server/live/live-contract.ts';
import type { PublicCondoSite } from '../src/framework/condo.ts';

// Parsed body hashes refreshed for the bilingual interface on 2026-11-12.
// Reviewed changes add protected resident spans/attributes and generic artwork labels.
// Exact prior source templates remain covered by condo-verify compatibility tests.
// Only the intentional hosted brand link/label change is normalized;
// the new separately tested sharing panel is removed for this comparison; the rest
// of the visible DOM/styles/widgets/footer remains protected.
const baseline = {
 public: {
  home: '7def5554c1be1028eb9a3c65be87212f1d7750a2248590e3a0ef279392668310',
  inside: '7e281fd916b620ff3eaa0d609738eba14f9779bd6923c81dfc37f0739b965e20',
  dreams: 'a10dac443a3c1efd157d6b1d8f3de8297ddab44e2e66351ffcb3fb5d0f8e49fd',
 },
 private: {
  home: '8096863a1038b7f738597841ec62785f6d976435288df15962b8cee558a50101',
  inside: '889d8ca31715c3709f86a0515fda57583c2f25ba009b0e249f27ad81ad732a23',
  dreams: 'e21f84fa6ce2ca51fa88122010d529da16bbd032666269070b91272c00984e6e',
 },
};
for (const kind of ['public', 'private'] as const) {
 for (const page of ['home', 'inside', 'dreams'] as const) {
  test(`${kind} ${page} keeps the reviewed bilingual-ready parsed body`, async () => {
   const site = JSON.parse(await readFile(new URL('../public/examples/muse-condo/condo.json', import.meta.url), 'utf8')) as PublicCondoSite;
   const target: TowerHomeTarget = kind === 'public'
    ? {kind, origin:'https://tower.example', roomId:'0123456789abcdef', revision:7}
    : {kind, prefix:'/api/v1/me/tower-intake', revision:7};
   const html = renderTowerHome(site, page, target, 'https://source.example/resident/condo.json');
   assert.equal(html.includes('data-home-sharing'),kind==='public');
   assert.equal(html.includes('src="/home-sharing.js"'),kind==='public');
   const towerRoot = kind === 'public' ? 'https://tower.example/' : '/';
   assert.ok(html.includes(`<a class="wordmark" href="${towerRoot}"><span aria-hidden="true">⌂</span> Muse Tower<small>`));
   assert.ok(html.includes(`href="${kind === 'public' ? '/home/0123456789abcdef' : '/api/v1/me/tower-intake/preview/home'}"`));
   const normalized = html.replace(/<section class="home-sharing"[\s\S]*?<\/section>/g,'').replace(`<a class="wordmark" href="${towerRoot}"><span aria-hidden="true">⌂</span> Muse Tower<small>`, `<a class="wordmark" href="${kind === 'public' ? '/home/0123456789abcdef' : '/api/v1/me/tower-intake/preview/home'}"><span aria-hidden="true">⌂</span> Muse Condo<small>`);
   const body = parse(normalized).childNodes.find(node => node.nodeName === 'html')!;
   assert.ok('childNodes' in body);
   const visible = body.childNodes.find(node => node.nodeName === 'body')!;
   assert.ok('childNodes' in visible);
   assert.equal(await digest(serialize(visible)), baseline[kind][page]);
  });
 }
}

test('standalone condo brand keeps its own home link on every page', async () => {
 const site = JSON.parse(await readFile(new URL('../public/examples/muse-condo/condo.json', import.meta.url), 'utf8')) as PublicCondoSite;
 for (const page of ['home', 'inside', 'dreams'] as const) {
  assert.ok(renderCondo(site, page).includes('<a class="wordmark" href="./index.html"><span aria-hidden="true">⌂</span> Muse Condo<small>'));
 }
 assert.equal(site.home.towerRootURL, undefined);
});
