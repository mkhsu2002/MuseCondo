import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, serialize } from 'parse5';
import { renderTowerHome, type TowerHomeTarget } from '../server/live/tower-home-render.ts';
import { digest } from '../server/live/live-contract.ts';
import type { PublicCondoSite } from '../src/framework/condo.ts';

// Parsed body hashes captured from main 07576b2's original Tower wrapper, before
// extraction. Head metadata may evolve; visible DOM/styles/widgets/footer may not.
const baseline = {
 public: {
  home: 'b662d0d44f1ed16e02929edc0e7fcdcdbe40e848a1c5dfa32caa8cddb27cf7d5',
  inside: 'd47aa992904ffa151aeb27b199a5d69fe561cad9f224f0c8e88d9397049bd5c0',
  dreams: 'ecc0fdbc1b08c1697f4eae43441bda47a91a3121c3934b9a9e651f9ef775bdbf',
 },
 private: {
  home: 'a96d16dac3a99ad8ea228d18967bde33fdf875bb77372fb0fbeb48db8878f71a',
  inside: '174b84f9cf5eff60515d63ca321ce99686507f03bdbe1b67989cdcf3a8651e36',
  dreams: '1a6eb3d2ac5bd549e86bbc2706fc49057f9b72e14c10f1b2589eac10f46fdfa3',
 },
};
for (const kind of ['public', 'private'] as const) {
 for (const page of ['home', 'inside', 'dreams'] as const) {
  test(`${kind} ${page} keeps the pre-extraction parsed visible body`, async () => {
   const site = JSON.parse(await readFile(new URL('../public/examples/muse-condo/condo.json', import.meta.url), 'utf8')) as PublicCondoSite;
   const target: TowerHomeTarget = kind === 'public'
    ? {kind, origin:'https://tower.example', roomId:'0123456789abcdef', revision:7}
    : {kind, prefix:'/api/v1/me/tower-intake', revision:7};
   const html = renderTowerHome(site, page, target, 'https://source.example/resident/condo.json');
   const body = parse(html).childNodes.find(node => node.nodeName === 'html')!;
   assert.ok('childNodes' in body);
   const visible = body.childNodes.find(node => node.nodeName === 'body')!;
   assert.ok('childNodes' in visible);
   assert.equal(await digest(serialize(visible)), baseline[kind][page]);
  });
 }
}
