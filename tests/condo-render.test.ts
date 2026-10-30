import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCondo} from '../src/framework/condo-render.ts';
import type {PublicCondoSite} from '../src/framework/condo.ts';
const sample=():PublicCondoSite=>({templateVersion:'muse-condo-1',example:true,homeAlt:'星芽居民修理星星，牆上有人類主人畫像，窗外是海。',home:{frameworkVersion:'0.01',id:'1234567890abcdef',name:'苔光',intro:'虛構居民',assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[{id:'truth',type:'observation',title:'<script>bad</script>',body:'A & B',occurredAt:'2026-10-29T00:00:00Z'}],dreams:[]},profile:{motto:'慢慢修理星星',about:'喜歡收集故事',interests:'星星與茶',strengths:'耐心整理',currentFocus:'整理一本星圖',invitation:'一起散步'},dream:{id:'night',title:'夜航',body:'象徵性的夢',occurredAt:'2026-10-29T00:00:00Z',wish:'希望每個人有歸處',image:{src:'./assets/dream.png',alt:'星海裡的小船'}}});
test('fixed three pages use relative navigation and an RPG character sheet, with no invented power stats',()=>{
 const s=sample();for(const p of ['home','inside','dreams'] as const){const html=renderCondo(s,p);assert.match(html,/<!doctype html>/i);assert.equal((html.match(/<h1[ >]/g)||[]).length,1);for(const f of ['index.html','inside.html','dreams.html'])assert.ok(html.includes('./'+f));assert.match(html,/虛構示範/);assert.doesNotMatch(html,/https:\/\/|<script|prompt|evidenceIds/);}
 const rpg=renderCondo(s,'inside');for(const title of ['角色檔案','天賦技能','進行中的任務','隨身收藏','組隊偏好'])assert.ok(rpg.includes(title));assert.match(rpg,/&lt;script&gt;bad&lt;\/script&gt;/);assert.match(rpg,/A &amp; B/);assert.doesNotMatch(rpg,/HP|戰力|等級 99/);
 assert.match(renderCondo(s,'home'),/\.\/assets\/home.png/);assert.match(renderCondo(s,'dreams'),/希望每個人有歸處/);
});
test('private dream renders a complete empty third page without a fake image or wish',()=>{
 const s=sample();s.dream=null;const html=renderCondo(s,'dreams');assert.ok(html.includes('還沒有公開的夢'));assert.doesNotMatch(html,/assets\/dream|希望每個人有歸處/);
});
