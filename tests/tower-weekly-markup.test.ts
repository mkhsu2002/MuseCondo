import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWeeklyCard,renderWeeklyPage,renderWeeklyArchive} from '../src/shared/tower-weekly-markup.ts';
import type {TowerWeeklyIssue} from '../src/shared/tower-weekly.ts';
const issue:TowerWeeklyIssue={id:'tower-weekly-inaugural',number:1,periodKey:'inaugural',periodStart:'2026-10-27T17:00:00.000Z',cutoffAt:'2026-11-03T17:00:00.000Z',publishedAt:'2026-11-03T17:01:00.000Z',title:'Tower Weekly · Issue 1',message:'Welcome to our first weekly!',residentCount:2,newcomers:[{residentId:'a'.repeat(16),name:'Fang <safe>',homeURL:'https://tower.example/home/'+'a'.repeat(16)}],news:[{eventId:'entry-1',residentId:'a'.repeat(16),title:'A window',summary:'Public <script>text</script>',homeURL:'https://tower.example/home/'+'a'.repeat(16)}]};
test('weekly SSR card links canonical issue and archive, with real dates/count and escaped resident copy',()=>{
 const html=renderWeeklyCard('',issue);assert.match(html,/Tower Weekly/);assert.match(html,/\/tower-weekly\/tower-weekly-inaugural/);assert.match(html,/2 residents/);assert.match(html,/datetime="2026-11-03T17:01:00.000Z"/);
 const page=renderWeeklyPage('',issue);assert.match(page,/Fang &lt;safe&gt;/);assert.match(page,/Public &lt;script&gt;text&lt;\/script&gt;/);assert(!page.includes('<script>'));assert.match(page,/href="\/home\/aaaaaaaaaaaaaaaa"/);assert(!page.includes('https://tower.example'));
});
test('no issue or news remains an honest empty state; optional total never invents zero',()=>{
 assert.match(renderWeeklyCard('',null),/first Tower Weekly/);const html=renderWeeklyPage('',{...issue,residentCount:null,newcomers:[],news:[]});assert(!html.includes('0 residents'));assert.match(html,/No new neighbors/);assert.match(renderWeeklyArchive('',[issue]),/Issue 1/);
});

test('archive offers stable older-issue navigation instead of dropping history',()=>{
 const html=renderWeeklyArchive('',[issue],2);assert.match(html,/href="\/tower-weekly\?before=2"/);assert.match(html,/Older issues/);assert.doesNotMatch(renderWeeklyArchive('',[issue],null),/Older issues/);
});
