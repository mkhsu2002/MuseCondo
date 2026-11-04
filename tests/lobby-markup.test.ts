import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {renderLobbyPreview} from '../src/shared/lobby-preview.ts';
import {renderTowerLobby,renderLiveShell,renderLobbyFeed} from '../src/shared/lobby-markup.ts';
import {LOBBY_BASE_CSS,LOBBY_BASE_CSS_HASH,LOBBY_RENDERER_BUILD_HASH,LOBBY_RENDERER_SOURCES,LOBBY_CSS_SOURCES,LOBBY_LOGO_DATA_URL,LOBBY_VIDEO_POSTER_DATA_URL} from '../src/shared/lobby-base-css.ts';

function scanablePreview(markup:string){
 const poster=readFileSync(new URL('../public/media/musecondo-introduction-qb-fyaymkFg.webp',import.meta.url));
 assert.equal(createHash('sha256').update(poster).digest('hex'),'7083b77baf18b79bf6b1fce366441a7c37f3ac0d54c550f15cfd6023c0b70a07');
 assert.equal(LOBBY_VIDEO_POSTER_DATA_URL,'data:image/webp;base64,'+poster.toString('base64'));
 // Exclude only this exact reviewed, hash-pinned binary. Other inputs stay visible.
 return markup.replaceAll(LOBBY_VIDEO_POSTER_DATA_URL,'data:image/approved-video-poster');
}

test('private render and live homepage share the full shell, welcome, feed, covenant and footer',()=>{
 const preview=renderLobbyPreview({scene:'night',imageSource:'data:image/png;base64,aW1hZ2U='});
 assert.match(preview,/data-tower-lobby/);assert.match(preview,/data-preview-fixture="masked-feed"/);
 for(const marker of ['class="live-header"','class="live-main live-lobby"','class="live-footer"','id="resident-guide"','id="community-covenant"','data-garden-slot','data-empty-slot','data-scene="night"'])assert.ok(preview.includes(marker),marker);
 assert.ok(preview.includes(LOBBY_LOGO_DATA_URL));
 // Approved binary image encodings can coincidentally contain a short name.
 // Keep checking all visible copy, alt text, links and markup for private data.
 const publicMarkup=scanablePreview(preview);
 assert.doesNotMatch(publicMarkup,/fang|fangdorami|mksaid2025|provider|apiKey|<script/i);
 const live=renderTowerLobby({base:'',content:'<p>live feed</p>',scene:'day'});
 assert.match(live,/data-tower-lobby/);assert.doesNotMatch(live,/data-preview-fixture/);assert.match(live,/live feed/);
 assert.doesNotMatch(renderLiveShell('','<p>account</p>'),/data-tower-lobby/);
 assert.equal(typeof renderLobbyFeed,'function');
});
test('privacy scan excludes only the exact approved poster, retaining new binary inputs and public attributes',()=>{
 assert.match(LOBBY_VIDEO_POSTER_DATA_URL,/fang/i); // Accidental four-letter token in the reviewed binary.
 assert.doesNotMatch(scanablePreview(LOBBY_VIDEO_POSTER_DATA_URL),/fang/i);
 for(const value of ['data:image/png;base64,FANG','data:image/webp;base64,FANG','data:image/svg+xml,FANG','aria-label="Fang"','alt="Fang"','<meta name="description" content="Fang">'])assert.match(scanablePreview(value),/fang/i);
 assert.match(scanablePreview('<script>private</script>'),/<script/i);
});
test('private preview never accepts arbitrary URLs, markup or other MIME types',()=>{
 for(const imageSource of ['https://evil.example/image.png','data:image/svg+xml,<svg onload=alert(1)>','data:image/png;base64,aW1hZ2U=" onerror="evil','/api/v1/tower/appearance/assets/other/day.png'])assert.throws(()=>renderLobbyPreview({scene:'day',imageSource}));
});
test('private preview stylesheet bytes and embedded brand match the maintained production sources',()=>{
 const actual=LOBBY_CSS_SOURCES.map(path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')).join('\n');
 assert.equal(LOBBY_BASE_CSS,actual);assert.equal(createHash('sha256').update(actual).digest('hex'),LOBBY_BASE_CSS_HASH);
 assert.equal(LOBBY_LOGO_DATA_URL,'data:image/webp;base64,'+readFileSync(new URL('../public/neobabylon-logo-v0.1-display.webp',import.meta.url)).toString('base64'));
 assert.doesNotMatch(LOBBY_BASE_CSS,/@import|url\(/i);
});

test('renderer build digest covers actual markup, scene text, generic theme code, notices, CSS and brand bytes',()=>{
 const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
 const sources=Object.fromEntries(LOBBY_RENDERER_SOURCES.map(path=>[path,sha(readFileSync(new URL('../'+path,import.meta.url)))]));
 const expected=sha(JSON.stringify({protocol:'lobby-renderer-build-v1',css:LOBBY_BASE_CSS_HASH,sources,brand:sha(readFileSync(new URL('../public/neobabylon-logo-v0.1-display.webp',import.meta.url)))}));
 assert.equal(LOBBY_RENDERER_BUILD_HASH,expected);assert.notEqual(LOBBY_RENDERER_BUILD_HASH,LOBBY_BASE_CSS_HASH);
});

test('display brand is a bounded transparent 3x asset while the original master remains intact',()=>{
 const logo=readFileSync(new URL('../public/neobabylon-logo-v0.1-display.webp',import.meta.url));
 assert.equal(logo.subarray(0,4).toString(),'RIFF');assert.equal(logo.subarray(8,16).toString(),'WEBPVP8L');
 const dimensions=logo.readUInt32LE(21);
 assert.equal((dimensions&0x3fff)+1,630);assert.equal(((dimensions>>>14)&0x3fff)+1,210);
 assert.equal((dimensions>>>28)&1,1,'Alpha must be preserved');assert.ok(logo.length<60000);
 const original=readFileSync(new URL('../public/neobabylon-logo-v0.1.png',import.meta.url));
 assert.equal(createHash('sha256').update(original).digest('hex'),'13995bcd5574d51cbc1a60e81e119ca19ac7ef2fa82afff7185f547e31b8fb05');
 const live=renderLiveShell('/prefix','<p>content</p>');
 assert.match(live,/src="\/prefix\/neobabylon-logo-v0.1-display\.webp"/);
 assert.doesNotMatch(live,/neobabylon-logo-v0.1\.png/);
 assert.match(live,/alt="NeoBabylon" width="630" height="210"/);
 const preview=renderLobbyPreview({scene:'day',imageSource:'data:image/png;base64,aW1hZ2U='});
 assert.ok(preview.includes(LOBBY_LOGO_DATA_URL));
 assert.ok(!preview.includes(original.toString('base64')));
});
