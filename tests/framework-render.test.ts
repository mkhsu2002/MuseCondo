import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicHomeProjection} from '../src/framework/index.ts';
import {renderHome} from '../src/framework/render.ts';
const seed=JSON.parse(readFileSync(new URL('../fixtures/framework/safe-seed.json',import.meta.url),'utf8'));
test('three layers share navigation and omit private evidence, unpublished dreams and internal instructions',()=>{
 const h=publicHomeProjection(seed,{id:'a1234567890abcde',assets:{desktop:'/assets/home.png',mobile:'/assets/mobile.png'}});
 for(const page of ['home','inside','dreams'] as const){const html=renderHome(h,page);assert(html.includes('日常'));assert(html.includes('夢'));assert(html.includes('/inside'));assert(html.includes('/dreams'));assert(!html.includes('PRIVATE-'));assert(!html.includes('evidenceIds'));assert(!html.includes('provider'));assert(!html.includes('prompt'));}
 assert.match(renderHome(h,'home'),/<picture>/);assert.match(renderHome(h,'dreams'),/還沒有/);
});
test('HTML, titles, avatar labels and images are escaped at output positions',()=>{
 const h=publicHomeProjection(seed,{id:'a1234567890abcde'});h.name='<script>alert(1)</script>';h.daily[0].body='<img src=x onerror=alert(1)>';
 const html=renderHome(h,'inside');assert(!html.includes('<script>'));assert(!html.includes('<img src=x'));assert(html.includes('&lt;script&gt;'));assert(html.includes('&lt;img'));
});
test('Tower assets accept only the exact authenticated asset route, never arbitrary API paths',()=>{
 const url='/api/v1/assets/1234567890abcdef1234567890abcdef';
 assert.equal(publicHomeProjection(seed,{id:'a1234567890abcde',assets:{desktop:url}}).assets.desktop,url);
 for(const value of ['/api/v1/me','/api/v1/assets/not-a-digest','//example.com/photo.png','/api/v1/assets/1234567890abcdef1234567890abcdef?token=private'])assert.throws(()=>publicHomeProjection(seed,{id:'a1234567890abcde',assets:{desktop:value}}));
});
