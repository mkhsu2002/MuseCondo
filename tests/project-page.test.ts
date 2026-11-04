import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parse} from 'parse5';
import config from '../vite.config.ts';
import {bindTowerVideo} from '../src/shared/tower-video.ts';
const file=(path:string)=>{const url=new URL('../'+path,import.meta.url);return existsSync(url)?readFileSync(url,'utf8'):'';};
type Node={nodeName:string;attrs?:{name:string;value:string}[];childNodes?:Node[]};
function elements(html:string,tag:string){const found:Record<string,string>[]=[];function walk(node:Node){if(node.nodeName===tag)found.push(Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value])));for(const child of node.childNodes??[])walk(child);}walk(parse(html));return found;}

test('project is a complete indexable document with co-creation and city links, independent of the community SPA',()=>{
 const html=file('project/index.html');assert.equal(elements(html,'h1').length,1,'The project document must have its own main heading');
 assert.ok(elements(html,'link').some(a=>a.rel==='canonical'&&a.href==='https://musetower.neobabylon.app/project'));
 assert.ok(elements(html,'meta').some(a=>a.name==='description'&&a.content.length>50));
 assert.ok(elements(html,'meta').some(a=>a.property==='og:url'&&a.content==='https://musetower.neobabylon.app/project'));
 assert.ok(elements(html,'script').some(a=>a.src==='/src/project.ts'&&a.type==='module'));
 assert.doesNotMatch(html,/src="\/src\/main\.ts"|data-route|buymeacoffee|donat|BMC/i);
 const links=elements(html,'a');assert.ok(links.some(a=>a.href==='https://github.com/mkhsu2002/MuseCondo'));
 assert.ok(links.some(a=>a.href==='https://neobabylon.app'&&a.target==='_blank'&&a.rel==='noopener noreferrer'));
 assert.ok(links.some(a=>a.href==='/'&&a['aria-label']==='Muse Tower community'));
 assert.match(html,/early contributor/i);
});

test('the project hero has a local eager WebP poster and creates no player before explicit activation',()=>{
 const html=file('project/index.html');assert.equal(elements(html,'iframe').length,0);
 const poster=elements(html,'img').find(a=>a.src==='/media/musecondo-introduction-qb-fyaymkFg.webp');assert.ok(poster);assert.equal(poster.loading,'eager');assert.equal(poster.fetchpriority,'high');
 assert.ok(elements(html,'button').some(a=>Object.hasOwn(a,'data-tower-video-play')));
 const thirdPartyReferences=[...elements(html,'script'),...elements(html,'iframe'),...elements(html,'img'),...elements(html,'link')].filter(a=>/youtube|youtu\.be/.test(a.src??a.href??''));assert.deepEqual(thirdPartyReferences,[]);
 assert.ok(elements(html,'a').some(a=>a.href==='https://youtu.be/qb-fyaymkFg'));
 let handler:(()=>void)|undefined,frame:Record<string,unknown>|undefined;let created=0;
 const button={dataset:{},ownerDocument:{createElement(tag:string){assert.equal(tag,'iframe');created++;return {focus(){}};}},addEventListener(_name:string,listener:()=>void){handler=listener;},replaceWith(value:Record<string,unknown>){frame=value;}};
 bindTowerVideo({querySelectorAll:()=>[button]} as unknown as HTMLElement);assert.equal(created,0);assert.ok(handler);handler();
 assert.equal(frame?.src,'https://www.youtube-nocookie.com/embed/qb-fyaymkFg?autoplay=1&playsinline=1&rel=0');
});

test('Tower builds have separate project/history HTML inputs and preserve the main entry',()=>{
 const build=config.build!;const input=build.rollupOptions?.input as Record<string,string>|undefined;
 assert.equal(input?.main,resolve('index.html'));assert.equal(input?.project,resolve('project/index.html'));assert.equal(input?.['tower-history'],resolve('tower-history/index.html'));
});

test('project CSP permits only the click-loaded nocookie frame and history permits no frames',()=>{
 const headers=file('public/_headers');
 for(const path of ['/project','/project/','/project/index.html','/tower-history','/tower-history/','/tower-history/index.html']){
  const section=headers.split('\n'+path+'\n')[1]?.split(/\n(?=\S)/)[0]??'';
  assert.match(section,/Content-Security-Policy:/,path);assert.match(section,/script-src 'self'/);assert.match(section,/connect-src 'none'/);assert.doesNotMatch(section,/'unsafe-inline'|'unsafe-eval'/);
  assert.ok(section.includes(path.startsWith('/project')?'frame-src https://www.youtube-nocookie.com':'frame-src \'none\''));
 }
 const entry=file('src/project.ts');assert.match(entry,/bindTowerVideo/);assert.doesNotMatch(entry,/from.*(?:live|demo)|fetch\(|\/api\//);
});
