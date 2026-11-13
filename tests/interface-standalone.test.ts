import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicCondoProjection} from '../src/framework/condo.ts';
import {renderStandaloneCondo} from '../server/framework/interface-export.ts';
test('independent home switches between complete static language pages without executable code',()=>{
 const site=publicCondoProjection(JSON.parse(readFileSync('fixtures/condo/example.json','utf8')),'0123456789abcdef');site.home.intro='Home';site.profile.about='Dreams';
 for(const locale of ['en','zh-TW'] as const)for(const page of ['home','inside','dreams'] as const){const html=renderStandaloneCondo(site,page,locale);assert.match(html,new RegExp('<html lang="'+locale+'">'));assert.doesNotMatch(html,/<script\b/i);assert.ok(html.includes((page==='home'?'index':page)+'.zh-TW.html'));assert.match(html,/data-no-translate/);if(page==='home')assert.match(html,/>Home<\/p>/);if(page==='inside')assert.match(html,/>Dreams<\/p>/);}
});
