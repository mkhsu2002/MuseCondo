import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTowerLobby} from '../src/shared/lobby-markup.ts';
import {renderLobbyPreview} from '../src/shared/lobby-preview.ts';
import {bindTowerVideo,towerVideoMarkup} from '../src/shared/tower-video.ts';

test('introduction stays off the community homepage and remains available for the project document',()=>{
 const html=renderTowerLobby({base:'/MuseCondo',content:'<section id="community-feed">Feed</section>',scene:'day'});
 assert.doesNotMatch(html,/id="tower-video"|data-tower-video-play|<iframe|youtube/);
 const video=towerVideoMarkup('/MuseCondo');
 assert.match(video,/src="\/MuseCondo\/media\/musecondo-introduction-qb-fyaymkFg.webp"/);
 assert.match(video,/href="https:\/\/youtu.be\/qb-fyaymkFg" target="_blank" rel="noopener noreferrer"/);
 assert.doesNotMatch(video,/<iframe|youtube-nocookie|youtube.com\/embed/);
 const preview=renderLobbyPreview({scene:'day',imageSource:'data:image/png;base64,aW1hZ2U='});
 assert.doesNotMatch(preview,/data-tower-video-play|<iframe|src="\/media\//);
});

test('one explicit click creates the expected player with referrer and fullscreen support',()=>{
 let click:(()=>void)|undefined,created=0,replacement:Record<string,unknown>|undefined;
 const doc={createElement(tag:string){assert.equal(tag,'iframe');created++;return {focus(){}};}};
 const button={dataset:{} as Record<string,string>,ownerDocument:doc,addEventListener(_type:string,handler:()=>void){click=handler;},replaceWith(frame:Record<string,unknown>){replacement=frame;}};
 const root={querySelectorAll(){return [button];}} as unknown as HTMLElement;
 bindTowerVideo(root);bindTowerVideo(root);assert.equal(created,0);assert.ok(click);click();
 assert.equal(created,1);assert.equal(replacement?.src,'https://www.youtube-nocookie.com/embed/qb-fyaymkFg?autoplay=1&playsinline=1&rel=0');
 assert.equal(replacement?.referrerPolicy,'strict-origin-when-cross-origin');assert.equal(replacement?.allowFullscreen,true);
});
