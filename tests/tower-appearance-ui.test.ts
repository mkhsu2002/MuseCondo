import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {bindTowerAppearance,appearanceControls,disposeTowerAppearance} from '../src/live/tower-appearance.ts';
class Node {
 children:Node[]=[];parent:Node|null=null;ownerDocument={createElement:()=>new Node()};
 prepend(node:Node){node.parent=this;this.children.unshift(node);}remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
 dataset:Record<string,string>={};hidden=true;isConnected=true;textContent='';src='';alt='';attributes:Record<string,string>={};events:Record<string,()=>unknown>={};
 setAttribute(k:string,v:string){this.attributes[k]=v;}addEventListener(k:string,fn:()=>unknown){this.events[k]=fn;}removeEventListener(k:string){delete this.events[k];}
}
function fixture(){const wrapper=new Node(),panorama=new Node(),button=new Node(),image=new Node(),caption=new Node(),status=new Node(),day=new Node(),night=new Node();panorama.dataset.scene='day';day.dataset.towerScene='day';night.dataset.towerScene='night';image.src='/tower/muse-tower-day-v2.webp';const elements:Record<string,Node>={'[data-appearance-toggle]':button,'img':image,'[data-scene-caption]':caption,'[role=status]':status};const root={querySelector:(key:string)=>key==='[data-tower-lobby]'?wrapper:Object.assign(panorama,{querySelector:(key:string)=>elements[key],querySelectorAll:()=>[day,night]})} as unknown as HTMLElement;return {root,wrapper,panorama,button,image,caption,status,day,night};}
const instant=async()=>{};
const projection=(endsAt='2026-11-01T07:00:00.000Z')=>({theme:'halloween',revision:1,generation:'manager-2026-10-31-r0',endsAt,images:{day:'/api/v1/tower/appearance/assets/manager-2026-10-31-r0/day.png',night:'/api/v1/tower/appearance/assets/manager-2026-10-31-r0/night.png'}});
test('activated day/night artifacts are actual img sources; native mobile buttons and local standard toggle preserve scene',async()=>{
 const f=fixture(),clock=()=>Date.parse('2026-10-31T20:00:00Z');let url='';const loaded:string[]=[];
 const cleanup=await bindTowerAppearance(f.root,'',async input=>{url=String(input);return Response.json(projection());},clock,async src=>{loaded.push(src);});
 assert.equal(url,'/api/v1/tower/appearance');assert.equal(f.image.src,projection().images.day);assert.equal(f.panorama.dataset.theme,'halloween');assert.equal(f.button.hidden,false);
 await f.night.events.click();assert.equal(f.image.src,projection().images.night);assert.equal(f.panorama.dataset.scene,'night');assert.equal(f.night.attributes['aria-pressed'],'true');assert.equal(f.day.attributes['aria-pressed'],'false');
 await f.button.events.click();assert.equal(f.image.src,'/tower/muse-tower-night-v2.webp');assert.equal(f.panorama.dataset.theme,'standard');await f.day.events.click();assert.equal(f.image.src,'/tower/muse-tower-day-v2.webp');await f.button.events.click();assert.equal(f.image.src,projection().images.day);assert.ok(loaded.includes(projection().images.day)&&loaded.includes(projection().images.night));cleanup();
});
test('untrusted projection paths, service failure and either artifact failure keep both scenes on originals',async()=>{
 const clock=()=>Date.parse('2026-10-31T20:00:00Z');
 for(const value of [{theme:'halloween',endsAt:'2026-11-01T07:00:00Z'},{...projection(),images:{day:'https://evil.example/day.png',night:projection().images.night}},{...projection(),images:{day:'https://tower.example'+projection().images.day,night:projection().images.night}},{...projection(),images:{day:projection().images.day+'?key=secret',night:projection().images.night}},{...projection(),generation:'other'}, {...projection(),endsAt:'2026-10-30T07:00:00Z'},{}]){
  const f=fixture();const stop=await bindTowerAppearance(f.root,'',async()=>Response.json(value),clock,instant);assert.equal(f.image.src,'/tower/muse-tower-day-v2.webp');assert.equal(f.button.hidden,true);await f.night.events.click();assert.equal(f.image.src,'/tower/muse-tower-night-v2.webp');stop();
 }
 const network=fixture();await bindTowerAppearance(network.root,'',async()=>{throw Error('network');},clock,instant);assert.equal(network.image.src,'/tower/muse-tower-day-v2.webp');
 const broken=fixture();await bindTowerAppearance(broken.root,'',async()=>Response.json(projection()),clock,async src=>{if(src.endsWith('night.png'))throw Error('image');});assert.equal(broken.image.src,'/tower/muse-tower-day-v2.webp');assert.equal(broken.button.hidden,true);
});
test('open tab expiry or runtime image error immediately restores current original without new API calls',async()=>{
 const f=fixture();let time=Date.parse('2026-10-31T20:00:00.000Z');const end=time+25;
 const stop=await bindTowerAppearance(f.root,'',async()=>Response.json(projection(new Date(end).toISOString())),()=>time,instant);await f.night.events.click();time=end;await new Promise(resolve=>setTimeout(resolve,35));assert.equal(f.image.src,'/tower/muse-tower-night-v2.webp');assert.equal(f.panorama.dataset.theme,'standard');assert.equal(f.button.hidden,true);stop();
 const failed=fixture();const cleanup=await bindTowerAppearance(failed.root,'',async()=>Response.json(projection()),()=>Date.parse('2026-10-31T20:00:00Z'),instant);failed.image.events.error();assert.equal(failed.image.src,'/tower/muse-tower-day-v2.webp');assert.equal(failed.button.hidden,true);cleanup();
});
test('production markup and CSS contain no pre-made Halloween scene or SVG decoration',()=>{
 assert.match(appearanceControls(),/<button type="button" data-appearance-toggle/);
 const welcome=readFileSync(new URL('../src/live/tower-welcome.ts',import.meta.url),'utf8');assert.doesNotMatch(welcome,/appearanceDecorations|tower-festive|tower-halloween/);
 const css=readFileSync(new URL('../src/live/tower-welcome.css',import.meta.url),'utf8');assert.doesNotMatch(css,/tower-festive|tower-lantern|tower-halloween|data-theme=halloween/);
});

const manifest=()=>({version:1,day:{canvas:'#ffffff',surface:'#ffffff',surfaceAlt:'#eeeeee',ink:'#111111',muted:'#222222',accent:'#0000aa',onAccent:'#ffffff',border:'#777777',decor:'#dddddd'},night:{canvas:'#000000',surface:'#111111',surfaceAlt:'#111111',ink:'#ffffff',muted:'#eeeeee',accent:'#55aaff',onAccent:'#000000',border:'#777777',decor:'#333333'},layout:{hero:'split',cards:'grid',density:'relaxed'},decoration:{pattern:'dots',corners:'arcs',shape:'round',weight:2,scale:24,opacity:.05}});
async function presentation(){const value=manifest();const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');return {version:1,id,revision:1,manifest:value};}
test('approved whole-page presentation commits with image and changes both scenes atomically',async()=>{
 const f=fixture(),p=await presentation();const stop=await bindTowerAppearance(f.root,'',async()=>Response.json({...projection(),presentation:p}),()=>Date.parse('2026-10-31T20:00:00Z'),instant);
 assert.equal(f.image.src,projection().images.day);assert.equal(f.wrapper.children.length,1);assert.match(f.wrapper.children[0].textContent,/--lobby-canvas:#ffffff/);assert.equal(f.wrapper.dataset.presentation,p.id);
 await f.night.events.click();assert.equal(f.image.src,projection().images.night);assert.match(f.wrapper.children[0].textContent,/--lobby-canvas:#000000/);assert.equal(f.wrapper.dataset.presentationScene,'night');
 await f.button.events.click();assert.equal(f.image.src,'/tower/muse-tower-night-v2.webp');assert.equal(f.wrapper.children.length,0);assert.equal(f.wrapper.dataset.presentation,undefined);
 await f.button.events.click();assert.equal(f.wrapper.children.length,1);assert.match(f.wrapper.children[0].textContent,/--lobby-canvas:#000000/);stop();assert.equal(f.wrapper.children.length,0);assert.equal(f.image.src,'/tower/muse-tower-night-v2.webp');
});
test('malformed, injected or hash-mismatched presentations reject the entire image/theme bundle',async()=>{
 const p=await presentation();
 for(const bad of [{...p,id:'0'.repeat(64)},{...p,revision:0},{...p,version:2},{...p,css:'body{display:none}'},{...p,manifest:{...p.manifest,day:{...p.manifest.day,canvas:'url(https://evil.example)'}}}]){
  const f=fixture();const stop=await bindTowerAppearance(f.root,'',async()=>Response.json({...projection(),presentation:bad}),()=>Date.parse('2026-10-31T20:00:00Z'),instant);
  assert.equal(f.image.src,'/tower/muse-tower-day-v2.webp');assert.equal(f.wrapper.children.length,0);assert.equal(f.button.hidden,true);stop();
 }
});
test('expiry, image failure, binding replacement and SPA departure clear the whole presentation',async()=>{
 const p=await presentation(),f=fixture();let time=Date.parse('2026-10-31T20:00:00Z');const end=time+30;
 const stop=await bindTowerAppearance(f.root,'',async()=>Response.json({...projection(new Date(end).toISOString()),presentation:p}),()=>time,instant);time=end;await new Promise(resolve=>setTimeout(resolve,40));assert.equal(f.wrapper.children.length,0);assert.equal(f.image.src,'/tower/muse-tower-day-v2.webp');stop();
 const broken=fixture();await bindTowerAppearance(broken.root,'',async()=>Response.json({...projection(),presentation:p}),()=>Date.parse('2026-10-31T20:00:00Z'),instant);broken.image.events.error();assert.equal(broken.wrapper.children.length,0);assert.equal(broken.image.src,'/tower/muse-tower-day-v2.webp');disposeTowerAppearance(broken.root);
 const replaced=fixture();await bindTowerAppearance(replaced.root,'',async()=>Response.json({...projection(),presentation:p}),()=>Date.parse('2026-10-31T20:00:00Z'),instant);const replacement=await bindTowerAppearance(replaced.root,'',async()=>Response.json({theme:'standard'}),()=>Date.parse('2026-10-31T20:00:00Z'),instant);assert.equal(replaced.wrapper.children.length,0);assert.equal(replaced.image.src,'/tower/muse-tower-day-v2.webp');replacement();
 const pending=fixture();let finish!:(value:Response)=>void;const binding=bindTowerAppearance(pending.root,'',async()=>new Promise(resolve=>{finish=resolve;}),()=>Date.parse('2026-10-31T20:00:00Z'),instant);disposeTowerAppearance(pending.root);finish(Response.json({...projection(),presentation:p}));await binding;assert.equal(pending.wrapper.children.length,0);assert.equal(pending.image.src,'/tower/muse-tower-day-v2.webp');
});

test('approved presentation requires the homepage boundary and never styles an unrelated host',async()=>{
 const f=fixture(),p=await presentation();const query=f.root.querySelector.bind(f.root);f.root.querySelector=((key:string)=>key==='[data-tower-lobby]'?null:query(key)) as typeof f.root.querySelector;
 const stop=await bindTowerAppearance(f.root,'',async()=>Response.json({...projection(),presentation:p}),()=>Date.parse('2026-10-31T20:00:00Z'),instant);
 assert.equal(f.image.src,'/tower/muse-tower-day-v2.webp');assert.equal(f.wrapper.children.length,0);assert.equal(f.button.hidden,true);stop();
});
