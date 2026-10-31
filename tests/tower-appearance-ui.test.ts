import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {bindTowerAppearance,appearanceDecorations,appearanceControls} from '../src/live/tower-appearance.ts';
class Node {
 dataset:Record<string,string>={};hidden=true;isConnected=true;textContent='';attributes:Record<string,string>={};events:Record<string,()=>void>={};
 setAttribute(k:string,v:string){this.attributes[k]=v;}addEventListener(k:string,fn:()=>void){this.events[k]=fn;}
}
function fixture(){const panorama=new Node(),button=new Node(),banner=new Node();const elements:Record<string,Node>={'[data-appearance-toggle]':button,'[data-appearance-banner]':banner};const root={querySelector:()=>Object.assign(panorama,{querySelector:(key:string)=>elements[key]})} as unknown as HTMLElement;return {root,panorama,button,banner};}
test('only live allowlisted projection enables decorations; toggle is keyboard native and failure leaves site usable',async()=>{
 const f=fixture(),clock=()=>Date.parse('2026-10-31T20:00:00Z');let url='';
 const cleanup=await bindTowerAppearance(f.root,'',async input=>{url=String(input);return Response.json({theme:'halloween',revision:1,endsAt:'2026-11-01T07:00:00.000Z'});},clock);
 assert.equal(url,'/api/v1/tower/appearance');assert.equal(f.panorama.dataset.theme,'halloween');assert.equal(f.button.hidden,false);assert.equal(f.banner.hidden,false);f.button.events.click();assert.equal(f.panorama.dataset.theme,'standard');f.button.events.click();assert.equal(f.panorama.dataset.theme,'halloween');cleanup();
 for(const value of [{theme:'<script>',endsAt:'2026-11-01T07:00:00.000Z'},{theme:'halloween',endsAt:'2026-10-30T07:00:00.000Z'},{theme:'halloween',endsAt:'bad'},{}]){
 const broken=fixture();const stop=await bindTowerAppearance(broken.root,'',async()=>Response.json(value),clock);assert.equal(broken.panorama.dataset.theme,'standard');assert.equal(broken.button.hidden,true);stop();
 }
 const broken=fixture();await bindTowerAppearance(broken.root,'',async()=>{throw Error('network');},clock);assert.equal(broken.panorama.dataset.theme,'standard');
});
test('decorations are inline noninteractive SVG, preserve original tower, and CSS honors reduced motion',()=>{
 const markup=appearanceDecorations();assert.match(markup,/aria-hidden="true"/);assert.match(markup,/<svg/);assert.doesNotMatch(markup,/<img|<script|https?:|onload|foreignObject|<a /);assert.match(appearanceControls(),/<button type="button" data-appearance-toggle/);assert.doesNotMatch(markup,/data-appearance-toggle/);
 const welcome=readFileSync(new URL('../src/live/tower-welcome.ts',import.meta.url),'utf8');assert.match(welcome,/appearanceControls\(\)\}<\/figcaption>/);
 const css=readFileSync(new URL('../src/live/tower-welcome.css',import.meta.url),'utf8');assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/pointer-events:none/);
});

test('an open tab restores standard appearance at expiry without a second service call',async()=>{
 const f=fixture();let time=Date.parse('2026-10-31T20:00:00.000Z');const endsAt=time+25;
 const stop=await bindTowerAppearance(f.root,'',async()=>Response.json({theme:'halloween',endsAt:new Date(endsAt).toISOString()}),()=>time);
 assert.equal(f.panorama.dataset.theme,'halloween');time=endsAt;await new Promise(resolve=>setTimeout(resolve,35));assert.equal(f.panorama.dataset.theme,'standard');assert.equal(f.button.hidden,true);assert.equal(f.banner.hidden,true);stop();
});
