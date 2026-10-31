import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {renderLobbyPreview,renderTowerLobby,renderLiveShell,renderLobbyFeed} from '../src/shared/lobby-markup.ts';
import {LOBBY_BASE_CSS,LOBBY_BASE_CSS_HASH,LOBBY_RENDERER_BUILD_HASH,LOBBY_RENDERER_SOURCES,LOBBY_CSS_SOURCES,LOBBY_LOGO_DATA_URL} from '../src/shared/lobby-base-css.ts';

test('private render and live homepage share the full shell, welcome, feed, covenant and footer',()=>{
 const preview=renderLobbyPreview({scene:'night',imageSource:'data:image/png;base64,aW1hZ2U='});
 assert.match(preview,/data-tower-lobby/);assert.match(preview,/data-preview-fixture="masked-feed"/);
 for(const marker of ['class="live-header"','class="live-main live-lobby"','class="live-footer"','id="resident-guide"','id="community-covenant"','class="live-card live-feed-card"','class="live-feed-empty"','data-scene="night"'])assert.ok(preview.includes(marker),marker);
 assert.ok(preview.includes(LOBBY_LOGO_DATA_URL));assert.doesNotMatch(preview,/fang|guardian|provider|apiKey|<script/i);
 const live=renderTowerLobby({base:'',content:'<p>live feed</p>',scene:'day'});
 assert.match(live,/data-tower-lobby/);assert.doesNotMatch(live,/data-preview-fixture/);assert.match(live,/live feed/);
 assert.doesNotMatch(renderLiveShell('','<p>account</p>'),/data-tower-lobby/);
 assert.equal(typeof renderLobbyFeed,'function');
});
test('private preview never accepts arbitrary URLs, markup or other MIME types',()=>{
 for(const imageSource of ['https://evil.example/image.png','data:image/svg+xml,<svg onload=alert(1)>','data:image/png;base64,aW1hZ2U=" onerror="evil','/api/v1/tower/appearance/assets/other/day.png'])assert.throws(()=>renderLobbyPreview({scene:'day',imageSource}));
});
test('private preview stylesheet bytes and embedded brand match the maintained production sources',()=>{
 const actual=LOBBY_CSS_SOURCES.map(path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')).join('\n');
 assert.equal(LOBBY_BASE_CSS,actual);assert.equal(createHash('sha256').update(actual).digest('hex'),LOBBY_BASE_CSS_HASH);
 assert.equal(LOBBY_LOGO_DATA_URL,'data:image/png;base64,'+readFileSync(new URL('../public/neobabylon-logo-v0.1.png',import.meta.url)).toString('base64'));
 assert.doesNotMatch(LOBBY_BASE_CSS,/@import|url\(/i);
});

test('renderer build digest covers actual markup, scene text, generic theme code, notices, CSS and brand bytes',()=>{
 const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
 const sources=Object.fromEntries(LOBBY_RENDERER_SOURCES.map(path=>[path,sha(readFileSync(new URL('../'+path,import.meta.url)))]));
 const expected=sha(JSON.stringify({protocol:'lobby-renderer-build-v1',css:LOBBY_BASE_CSS_HASH,sources,brand:sha(readFileSync(new URL('../public/neobabylon-logo-v0.1.png',import.meta.url)))}));
 assert.equal(LOBBY_RENDERER_BUILD_HASH,expected);assert.notEqual(LOBBY_RENDERER_BUILD_HASH,LOBBY_BASE_CSS_HASH);
});
