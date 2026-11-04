import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTowerLobby,renderLiveShell} from '../src/shared/lobby-markup.ts';
import {renderHomeDirectory} from '../src/shared/home-directory.ts';
import {renderTowerJournals} from '../src/shared/tower-journals-markup.ts';
import * as scenesMarkup from '../src/shared/tower-weekly-markup.ts';
import {parse} from 'parse5';

function elements(html:string){const out:{nodeName:string;attrs?:{name:string;value:string}[]}[]=[];function walk(n:unknown){const v=n as {nodeName:string;attrs?:{name:string;value:string}[];childNodes?:unknown[]};out.push(v);v.childNodes?.forEach(walk);}walk(parse(html));return out;}
const attr=(n:ReturnType<typeof elements>[number],name:string)=>n.attrs?.find(a=>a.name===name)?.value;
test('community homepage omits project video and puts charter/history/future before final Agent CTA',()=>{
 const html=renderTowerLobby({base:'',content:'<div data-weekly-slot>weekly</div><div data-journals-slot>garden</div><div data-public-home-directory>homes</div><div data-scenes-slot>scenes</div>',scene:'day'});
 assert.doesNotMatch(html,/data-tower-video-play|<iframe|Discover MuseCondo/);
 assert.ok(html.indexOf('data-tower-panorama')<html.indexOf('data-weekly-slot'));
 assert.ok(html.indexOf('data-scenes-slot')<html.indexOf('data-community-resources'));
 assert.ok(html.indexOf('data-community-resources')<html.indexOf('data-agent-move-in'));
 assert.match(html,/href="\/tower-history"/);assert.match(html,/M\.K\./);assert.match(html,/2026-11-03/);
 assert.doesNotMatch(html,/From the lobby desk|By the neighbors’ windows|Someone to talk to|Forks and commercial/);
});
test('garden has exactly four slots, preserves valid entry, blanks missing and discards fifth',()=>{
 const make=(i:number)=>({author:'Neighbor',title:`Story ${i}`,excerpt:'Shared story',originalAt:`2026-11-0${i}T12:00:00.000Z`,href:'https://tower.example/home/'+'a'.repeat(16)+'/inside'});
 for(const count of [0,1,5]){const html=renderTowerJournals({day:'2026-11-03',cutoffAt:'2026-11-03T16:00:00.000Z',publishedAt:'2026-11-03T17:00:00.000Z',items:Array.from({length:count},(_,i)=>make(i+1))});
  assert.equal(elements(html).filter(n=>attr(n,'data-garden-slot')!==undefined).length,4);
  assert.equal(elements(html).filter(n=>attr(n,'data-empty-slot')!==undefined).length,4-Math.min(4,count));
  assert.match(html,/居民園地/);assert.doesNotMatch(html,/Story 5/);
 }
});
test('resident row keeps latest API order, only four authorized doors, blank places never fake identities',()=>{
 const rooms=Array.from({length:6},(_,i)=>({id:i.toString(16).padStart(16,'0'),name:`Resident ${i}`}));
 for(const count of [0,2,6]){const html=renderHomeDirectory('',rooms.slice(0,count));assert.equal(elements(html).filter(n=>attr(n,'data-resident-slot')!==undefined).length,4);assert.equal(new Set(elements(html).filter(n=>attr(n,'href')?.startsWith('/home/')).map(n=>attr(n,'href'))).size,Math.min(count,4));assert.doesNotMatch(html,/Resident 4|Resident 5/);}
});
test('city logo opens externally while Tower name and scene collection remain reachable',()=>{
 const nodes=elements(renderLiveShell('','<p>content</p>'));const city=nodes.find(n=>n.nodeName==='a'&&attr(n,'href')==='https://neobabylon.app/');assert.ok(city);assert.equal(attr(city,'target'),'_blank');assert.match(attr(city,'rel')??'',/noopener/);
 assert.ok(nodes.some(n=>n.nodeName==='a'&&attr(n,'href')==='/tower-scenes'));assert.ok(nodes.some(n=>n.nodeName==='a'&&attr(n,'href')==='/'));
});
test('four scenery slots and full wall link use only supplied public scenes',()=>{
 const scenes=Array.from({length:5},(_,i)=>({id:`seed-v1-0${i+1}`,title:`Corner ${i}`,caption:'A quiet corner',url:'/unused',width:1920,height:1200,createdAt:'2026-11-03T12:00:00Z'}));
 for(const count of [0,2,5]){const html=scenesMarkup.renderScenePreview('',scenes.slice(0,count));assert.equal(elements(html).filter(n=>attr(n,'data-scene-slot')!==undefined).length,4);assert.equal(elements(html).filter(n=>n.nodeName==='img').length,Math.min(4,count));assert.match(html,/href="\/tower-scenes"/);assert.doesNotMatch(html,/Corner 4/);}
});
