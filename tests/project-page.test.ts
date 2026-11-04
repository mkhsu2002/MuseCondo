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


test('five full essays have distinct metadata, safe links and direct build entries',()=>{
 const names=['chatgpt','muse','gemini','grok','claude'];
 const input=config.build!.rollupOptions?.input as Record<string,string>;
 for(const name of ['index',...names]){
  const path='project/perspectives/'+(name==='index'?'':name+'/')+'index.html';const html=file(path);const canonical='https://musetower.neobabylon.app/project/perspectives'+(name==='index'?'':'/'+name);
  assert.equal(elements(html,'h1').length,1,path);assert.ok(elements(html,'link').some(a=>a.rel==='canonical'&&a.href===canonical));assert.ok(elements(html,'meta').some(a=>a.property==='og:url'&&a.content===canonical));assert.equal(input['perspective-'+name],resolve(path));
  assert.equal(elements(html,'iframe').length,0);assert.equal(elements(html,'script').length,0);assert.doesNotMatch(html,/Here is a copy-ready version|[\uE000-\uF8FF]/);if(name!=='index')assert.doesNotMatch(html,/From your perspective as an AI agent, what are your thoughts/);
  for(const a of elements(html,'a').filter(a=>a.target==='_blank'))assert.match(a.rel,/noopener/);
 }
 const project=file('project/index.html');assert.match(project,/Meta Global AI Developer Hackathon 2026/);assert.ok(elements(project,'a').some(a=>a.href.endsWith('/MuseCondo_Meta_Hackathon_2026.pptx')));assert.ok(elements(project,'a').some(a=>a.href==='/project/perspectives'));
});


test('hub prints the original question and supplied artworks are the matching cover and OG images',()=>{
 const hub=file('project/perspectives/index.html');assert.match(hub,/The question we asked/);assert.match(hub,/From your perspective as an AI agent/);assert.match(hub,/finally, illustrate what your own ideal home would look like/);
 for(const name of ['muse','grok','gemini','chatgpt','claude']){const html=file('project/perspectives/'+name+'/index.html');const cover='/media/perspective-'+name+'-home-20261103.webp',og='/og/perspective-'+name+'-home-20261103.jpg';assert.ok(elements(html,'img').some(a=>a.src===cover&&Number(a.width)>=1280&&a.fetchpriority==='high'));for(const key of ['og:image','twitter:image'])assert.ok(elements(html,'meta').some(a=>(a.property??a.name)===key&&a.content==='https://musetower.neobabylon.app'+og));assert.ok(file('public'+cover).length);assert.ok(file('public'+og).length);}
});
