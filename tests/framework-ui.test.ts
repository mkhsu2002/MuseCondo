import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const location = '../src/live/framework-ui.ts';
const ui = await import(location).catch(() => undefined);
const seed = JSON.parse(await readFile(new URL('../fixtures/framework/safe-seed.json', import.meta.url), 'utf8'));
const roomId = 'abcdef0123456789';
const assetId = 'a'.repeat(32);
const home = { room: { id: roomId, name: '測試住戶', intro: '公開介紹', role: '住戶', generationState: 'complete' }, assets: [{ purpose: 'home-desktop', url: `/api/v1/assets/${assetId}`, provider: 'PRIVATE-PROVIDER', model: 'PRIVATE-MODEL' }], posts: [{ id: 'post-1', kind: 'artwork', title: '小作品', body: '今天畫一朵花', createdAt: '2026-10-29T00:00:00Z' }], interactions: [] };
test('live router accepts all three tower routes and rejects arbitrary paths', () => {
  assert.equal(typeof ui?.isFrameworkLiveRoute, 'function');
  for (const route of ['move-in', 'neighbors', `home/${roomId}`, `home/${roomId}/inside`, `home/${roomId}/dreams`]) assert.equal(ui!.isFrameworkLiveRoute(route), true);
  for (const route of [`home/${roomId}/private`, 'home/../inside', 'home/not-an-id']) assert.equal(ui!.isFrameworkLiveRoute(route), false);
});
test('live public adapter uses shared projection shape and separate dream collection without provider metadata', () => {
  assert.equal(typeof ui?.towerHome, 'function');
  const dream = { id: 'dream-1', type: 'dream', title: '海', body: '', image: `/api/v1/assets/${assetId}`, reflection: '想去海邊', occurredAt: '2026-10-29T00:00:00Z' };
  const projected = ui!.towerHome(home, [dream], '/preview');
  assert.equal(projected.frameworkVersion, '0.01'); assert.equal(projected.daily[0].type, 'artwork'); assert.equal(projected.dreams[0].image, dream.image);
  assert.equal(projected.routes.dreams, `/preview/home/${roomId}/dreams`);
  assert.equal(JSON.stringify(projected).includes('PRIVATE'), false);
  assert.equal(projected.daily.some((post: { type: string }) => post.type === 'dream'), false);
});
test('seed onboarding requires private preview and explicit data use consent', () => {
  assert.equal(typeof ui?.seedOnboardingPayload, 'function');
  const privateSeed = structuredClone(seed); privateSeed.consent.publishHome = false;
  const payload = ui!.seedOnboardingPayload(JSON.stringify(privateSeed), '生活記錄者', 'Agent提供的精簡摘要', true);
  assert.equal(payload.publishProfile, false); assert.equal(payload.analyzeConsent, true); assert.equal(payload.frameworkSeed.agent.name, privateSeed.agent.name);
  assert.throws(() => ui!.seedOnboardingPayload(JSON.stringify(seed), '住戶', '摘要', true), /私密/);
  assert.throws(() => ui!.seedOnboardingPayload(JSON.stringify(privateSeed), '住戶', '摘要', false), /同意/);
  assert.throws(() => ui!.seedOnboardingPayload('{broken', '住戶', '摘要', true));
});
test('seed import and artwork review expose necessary controls without private evidence content', () => {
  assert.equal(typeof ui?.seedOnboardingForm, 'function');
  const form = ui!.seedOnboardingForm(); assert.match(form, /type="file"/); assert.match(form, /frameworkSeed/); assert.match(form, /不要.*原始/);
  const review = ui!.artworkReviewForm({ ...home, artworkReview: { required: true, valid: false, assetDigests: { desktop: 'PRIVATE-DIGEST', mobile: 'PRIVATE-DIGEST' } } });
  for (const key of ['self', 'activity', 'ownerPortrait', 'window', 'matchedPair']) assert.match(review, new RegExp(`name="${key}"`));
  assert.equal(review.includes('PRIVATE-DIGEST'), false); assert.match(review, /required/);
});
test('owner management offers edit and withdrawal, independent dream consent and minimal token scopes', () => {
  assert.equal(typeof ui?.ownerContentForms, 'function');
  const html = ui!.ownerContentForms(home.posts, [{ id: 'b'.repeat(32), type: 'dream', date: '2026-10-29', title: '夢', body: '海', evidenceIds: ['self-description'], publication: 'private' }], false, home.assets);
  for (const token of ['data-post-edit', 'data-post-withdraw', 'data-dream-edit', 'data-dream-withdraw', 'live-dream-consent', 'reflection', 'evidenceIds', 'type="date"']) assert.match(html, new RegExp(token));
  const scopes = ui!.tokenScopeFields();
  for (const scope of ['posts:write', 'dreams:read', 'dreams:write', 'dreams:publish', 'inbox:read', 'invitations:moderate']) assert.equal(scopes.includes(scope), true);
  assert.equal(scopes.includes('checked'), false);
});
test('generated route snapshots include live entrypoints and each historical dream route', async () => {
  const routes = await readFile(new URL('../scripts/routes.mjs', import.meta.url), 'utf8');
  assert.match(routes, /move-in/); assert.match(routes, /neighbors/); assert.match(routes, /dreams/);
});
test('public adapter defensively excludes an explicitly private post and never imports dreams into daily', () => {
 const projected=ui!.towerHome({...home,posts:[...home.posts,{...home.posts[0],id:'private',isPublic:false,body:'PRIVATE-POST'}]},[]);
 assert.equal(JSON.stringify(projected).includes('PRIVATE-POST'),false);
 assert.deepEqual(projected.dreams,[]);
});
test('private owner forms escape imported content and avoid embedding secrets or evidence summaries', () => {
 const markup=ui!.ownerContentForms([{...home.posts[0],title:'<script>alert(1)</script>',body:'<img src=x onerror=alert(1)>'}],[],false,[]);
 assert.equal(markup.includes('<script>'),false); assert.equal(markup.includes('<img src=x'),false);assert.match(markup,/&lt;script&gt;/);
});
test('public UI source uses shared renderer and keeps production strategy out of visible copy', async()=>{
 const [live,legacy]=await Promise.all([readFile(new URL('../src/live.ts',import.meta.url),'utf8'),readFile(new URL('../src/main.ts',import.meta.url),'utf8')]);
 assert.match(live,/renderHome\(towerHome/); assert.match(live,/public\/rooms\/\$\{id\}\/dreams/);
 for(const source of [live,legacy])assert.doesNotMatch(source,/Codex 暫用|Codex 原型|Meta API 選輯|規則型示範選輯|尚非 Meta AI|編輯版本：|選入理由：|來源 SHA-256|模型資訊/);
 assert.match(live,/X-Request-Key/);assert.match(live,/Content-Type':'image\/png/);assert.match(live,/data-post-edit/);assert.match(live,/data-dream-edit/);
 assert.match(legacy,/historicalDreams/);
});
