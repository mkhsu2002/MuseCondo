import test from 'node:test';
import assert from 'node:assert/strict';
import {createTowerWeeklyRoutes, type createTowerWeeklyServices} from '../server/live/tower-weekly-routes.ts';
import {sceneFigure} from '../src/shared/tower-weekly-markup.ts';
import {towerSceneDisplayURL} from '../src/shared/tower-scene-types.ts';
const origin='https://tower.example',png=new Uint8Array([137,80,78,71]),webp=new Uint8Array([82,73,70,70]);
const scene={id:'scene-fixture',title:'A quiet corner',caption:'A quiet corner',url:origin+towerSceneDisplayURL('','scene-fixture'),width:1600,height:1000,createdAt:'2026-11-03T00:00:00Z'};
function fixture(){
 let published=true,ready=true,originalReads=0,derivativeReads=0;
 const services={
  scenes:{list:async()=>published?[scene]:[],assetMetadata:async()=>published?{sha256:'a'.repeat(64)}:null,asset:async()=>{originalReads++;return published?{sha256:'a'.repeat(64),arrayBuffer:async()=>png.buffer}:null;}},
  weekly:{get:async()=>({id:'tower-weekly-inaugural',scene})},
  imageOptimization:{image:async()=>{derivativeReads++;return ready?{bytes:webp,digest:'b'.repeat(64),size:webp.length}:null;},enqueue:async()=>null},
 } as unknown as ReturnType<typeof createTowerWeeklyServices>;
 const handler=createTowerWeeklyRoutes({origin,services,operator:async()=>false,scheduled:async()=>false});
 const request=(accept='image/webp',etag?:string,head=false,path=towerSceneDisplayURL('',scene.id))=>handler(new Request(origin+path,{method:head?'HEAD':'GET',headers:{Accept:accept,...(etag?{'If-None-Match':etag}:{})}}));
 return {request,set published(value:boolean){published=value;},set ready(value:boolean){ready=value;},get originalReads(){return originalReads;},get derivativeReads(){return derivativeReads;}};
}
test('scene wall and issue projections use one stable versioned display URL, preserving the original path',async()=>{
 assert.equal(towerSceneDisplayURL('',scene.id),'/api/v1/tower/scenes/scene-fixture.png?display=webp-v1');
 const html=sceneFigure('',scene);assert.ok(html.includes('src="'+towerSceneDisplayURL('',scene.id)+'"'));assert.ok(html.includes('href="'+towerSceneDisplayURL('',scene.id)+'"'));assert.doesNotMatch(html,/timestamp|Date\.now/);
 const f=fixture(),listing=(await f.request('image/png',undefined,false,'/api/v1/public/tower-scenes'))!;
 assert.equal(((await listing.json()) as {scenes:typeof scene[]}).scenes[0].url,scene.url);
 const weekly=(await f.request('image/png',undefined,false,'/api/v1/public/tower-weekly/tower-weekly-inaugural'))!;assert.equal(((await weekly.json()) as {issue:{scene:typeof scene}}).issue.scene.url,scene.url);
});
test('scene display revalidates both representations, supports HEAD and cannot confuse old PNG validators with WebP',async()=>{
 const f=fixture(),optimized=(await f.request())!;assert.equal(optimized.status,200);assert.equal(optimized.headers.get('Content-Type'),'image/webp');assert.equal(optimized.headers.get('Cache-Control'),'private, no-cache, must-revalidate');assert.equal(optimized.headers.get('Vary'),'Accept');assert.equal(f.originalReads,0);assert.deepEqual(new Uint8Array(await optimized.arrayBuffer()),webp);
 const webpTag=optimized.headers.get('ETag')!,notModified=(await f.request('image/webp',webpTag))!;assert.equal(notModified.status,304);assert.equal(await notModified.text(),'');assert.equal(notModified.headers.get('Vary'),'Accept');
 const head=(await f.request('image/webp',undefined,true))!;assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('Content-Length'),String(webp.length));
 const original=(await f.request('image/png',webpTag,false,'/api/v1/tower/scenes/scene-fixture.png'))!;assert.equal(original.status,200);assert.equal(original.headers.get('Content-Type'),'image/png');assert.equal(original.headers.get('Vary'),'Accept');assert.deepEqual(new Uint8Array(await original.arrayBuffer()),png);
 const pngTag=original.headers.get('ETag')!;assert.notEqual(pngTag,webpTag);assert.equal((await f.request('image/webp',pngTag))!.status,200);assert.equal((await f.request('image/png',pngTag))!.status,304);
});
test('unpublished scenes stop before reading a derivative; an absent copy keeps the original PNG visible',async()=>{
 const f=fixture();f.published=false;assert.equal((await f.request())!.status,404);assert.equal(f.derivativeReads,0);assert.equal(f.originalReads,0);
 f.published=true;f.ready=false;const fallback=(await f.request())!;assert.equal(fallback.status,200);assert.equal(fallback.headers.get('Content-Type'),'image/png');assert.deepEqual(new Uint8Array(await fallback.arrayBuffer()),png);
});
