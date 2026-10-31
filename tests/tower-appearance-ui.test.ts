import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {bindTowerAppearance,appearanceControls} from '../src/live/tower-appearance.ts';
class Node {
 dataset:Record<string,string>={};hidden=true;isConnected=true;textContent='';src='';alt='';attributes:Record<string,string>={};events:Record<string,()=>unknown>={};
 setAttribute(k:string,v:string){this.attributes[k]=v;}addEventListener(k:string,fn:()=>unknown){this.events[k]=fn;}removeEventListener(k:string){delete this.events[k];}
}
function fixture(){const panorama=new Node(),button=new Node(),image=new Node(),caption=new Node(),status=new Node(),day=new Node(),night=new Node();panorama.dataset.scene='day';day.dataset.towerScene='day';night.dataset.towerScene='night';image.src='/tower/muse-tower-day-v2.webp';const elements:Record<string,Node>={'[data-appearance-toggle]':button,'img':image,'[data-scene-caption]':caption,'[role=status]':status};const root={querySelector:()=>Object.assign(panorama,{querySelector:(key:string)=>elements[key],querySelectorAll:()=>[day,night]})} as unknown as HTMLElement;return {root,panorama,button,image,caption,status,day,night};}
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
