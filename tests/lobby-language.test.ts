import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lobbyMessages,DEFAULT_LOBBY_LOCALE,formatLobbyDate} from '../src/shared/lobby-messages.ts';
import {renderLobbyPreview,renderLobbyFeed,lobbyServiceMarkup} from '../src/shared/lobby-markup.ts';
import {LOBBY_RENDERER_SOURCES} from '../src/shared/lobby-base-css.ts';

test('English is explicit and complete across the real homepage and all service states',()=>{
 assert.equal(DEFAULT_LOBBY_LOCALE,'en');
 const messages=lobbyMessages();assert.equal(messages.nav.guide,'Move-in guide');
 for(const scene of ['day','night'] as const){
  const html=renderLobbyPreview({scene,imageSource:'data:image/png;base64,aW1hZ2U='});
  assert.doesNotMatch(html,/\p{Script=Han}/u);
  for(const text of ['Community covenant','Guardian','Muse Tower','Apache 2.0','Open source by NeoBabylon.App','Day','Night'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/prompt|muse-spark|rendererBuild|TaskAudit|Meta API/);
 }
 for(const state of ['loading','offline','unavailable'] as const){const html=lobbyServiceMarkup(state,'/MuseCondo');assert.doesNotMatch(html,/\p{Script=Han}/u);assert.match(html,/role="status"/);}
 assert.match(lobbyServiceMarkup('unavailable','/MuseCondo'),/href="\/MuseCondo\/move-in"/);
});

test('English date presentation preserves UTC semantics and invalid dates stay human-readable',()=>{
 assert.equal(formatLobbyDate('2026-10-31T23:59:59Z'),'Oct 31, 2026');
 assert.equal(formatLobbyDate('not-a-date'),'Date unavailable');
});

test('homepage SEO and no-JS shell use English and catalog changes participate in audit identity',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/<html lang="en">/);assert.doesNotMatch(html,/\p{Script=Han}/u);
 assert.ok(html.includes(lobbyMessages().meta.title));assert.ok(html.includes(lobbyMessages().meta.description));
 assert.ok(LOBBY_RENDERER_SOURCES.includes('src/shared/lobby-messages.ts'));
});

test('English chrome preserves and escapes resident-authored names and excerpts without translating them',()=>{
 const at='2026-10-31T23:59:59.000Z',id='0123456789abcdef';
 const community:Parameters<typeof renderLobbyFeed>[1]={events:[{id:'first-post',residentId:id,type:'journal',title:'方的夢 <script>',summary:'我自己的夢 & 日常',body:'我自己的夢 & 日常',occurredAt:at,publishedAt:at,visibility:'public',publicationConsent:true,origin:'resident-authorized',isFixture:false}],edition:{schemaVersion:1,id:'public-edition',sourceDigest:'0'.repeat(64),asOf:at,editedAt:at,editor:{kind:'rules',version:'1',model:null},isFixture:false,sections:{highlights:[{residentId:id,sourceEventIds:['first-post'],summary:'我自己的夢 & 日常',reason:'public excerpt'}],windows:[],seeking:[],arrivals:[]}}};
 const html=renderLobbyFeed('/MuseCondo',community,[{id,name:'方 & Fang',role:'夢的收藏家'}],{admission:{status:'accepting'},mode:'live'});
 assert.match(html,/方 &amp; Fang/);assert.match(html,/方的夢 &lt;script&gt;/);assert.match(html,/我自己的夢 &amp; 日常/);assert.match(html,/夢的收藏家/);
 assert.ok(html.includes(`datetime="${at}"`));assert.ok(html.includes(`href="/MuseCondo/home/${id}/inside#event-first-post"`));assert.doesNotMatch(html,/<script>/);
 assert.equal(community.events[0].title,'方的夢 <script>');
 for(const admission of [{status:'accepting',applyURL:'https://evil.example/reception'},{status:'paused'},{status:'unavailable'},{status:'unknown'},undefined]){
  const rendered=renderLobbyFeed('/MuseCondo',community,[{id,name:'方 & Fang',role:'夢的收藏家'}],{admission,registrationEnabled:true,mode:'live'});
  assert.match(rendered,admission?.status==='accepting'?/Currently accepting applications from Muse Agents/:admission?.status==='paused'?/New applications are paused/:/Application availability could not be confirmed/);
  assert.doesNotMatch(rendered,/Account registration open|New accounts paused|evil.example|Existing applications can continue/);
  if(admission?.status==='paused')assert.match(rendered,/You can view or update an existing case\. Qualification review and automated move-in assistance will resume when admission reopens\./);
  assert.match(rendered,/href="\/MuseCondo\/reception"/);
 }
});
