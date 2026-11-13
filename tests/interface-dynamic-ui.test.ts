import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {localizeInterfaceHTML} from '../server/live/interface-html.ts';
import {renderWeeklyCard,renderWeeklyPage} from '../src/shared/tower-weekly-markup.ts';
import type {TowerWeeklyIssue} from '../src/shared/tower-weekly.ts';
class Element {
 text='';children:Element[]=[];attrs=new Map<string,string>();hidden=false;disabled=false;checked=false;value='';href='';handlers=new Map<string,(event:{preventDefault:()=>void})=>Promise<void>>();
 set textContent(value:string){this.text=String(value);this.children=[];}get textContent():string{return this.text+this.children.map(c=>c.textContent).join('');}
 append(...children:Element[]){this.children.push(...children);}replaceChildren(){this.text='';this.children=[];}setAttribute(name:string,value:string){this.attrs.set(name,value);}
 addEventListener(name:string,fn:(event:{preventDefault:()=>void})=>Promise<void>){this.handlers.set(name,fn);}
 html():string{return '<span'+[...this.attrs].map(([k,v])=>' '+k+'="'+v+'"').join('')+'>'+this.text+this.children.map(c=>c.html()).join('')+'</span>';}
}
const document=()=>{const nodes=new Map<string,Element>();return {nodes,getElementById(id:string){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id)!;},createElement(){return new Element();}};};
test('actual invitation script separates translated labels from original URL and expiry values',async()=>{
 const doc=document(),origin='https://tower.example';
 vm.runInNewContext(await readFile(new URL('../public/identity-offer.js',import.meta.url),'utf8'),{document:doc,location:{origin,pathname:'/identity/offer',hash:'#'+'a'.repeat(32)+'.'+'b'.repeat(64)},history:{replaceState(){}},URL,fetch:async()=>({ok:true,json:async()=>({publicURL:origin+'/home/'+'c'.repeat(16),offerDigest:'d'.repeat(64),expiresAt:'Home',state:'pending'})})});
 await new Promise(resolve=>setImmediate(resolve));
 const html=localizeInterfaceHTML('<html><body>'+doc.getElementById('offer-home').html()+doc.getElementById('offer-expiry').html()+'</body></html>','zh-TW',false,false);
 assert.ok(html.includes('查看 Agent 的公開小窩：'));assert.ok(html.includes('邀請到期時間：'));assert.ok(html.includes('data-no-translate="">Home</span>'));assert.ok(html.includes(origin+'/home/'+'c'.repeat(16)));assert.ok(!html.includes('>Invitation expires at '));
});
test('actual maintenance script translates failure label without changing provider error value',async()=>{
 const doc=document();doc.getElementById('request-id').value='a'.repeat(32);
 vm.runInNewContext(await readFile(new URL('../public/identity-maintenance.js',import.meta.url),'utf8'),{document:doc,navigator:{},fetch:async()=>{throw Error('Home');},AbortController,setTimeout,clearTimeout});
 await doc.getElementById('maintenance-form').handlers.get('submit')!({preventDefault(){}});
 const html=localizeInterfaceHTML('<html><body>'+doc.getElementById('status').html()+'</body></html>','zh-TW',false,false);
 assert.ok(html.includes('無法查看申請：'));assert.ok(html.includes('data-no-translate="">Home</span>'));assert.ok(!html.includes('>Unable to review request: '));
});
test('weekly resident counts translate their grammar while original authored text remains intact',()=>{
 const issue={id:'tower-weekly-test',publishedAt:'2026-11-12T00:00:00Z',title:'Home',message:'Dreams',residentCount:3,scene:null,newcomers:[],news:[]} as unknown as TowerWeeklyIssue;
 for(const render of [renderWeeklyCard,renderWeeklyPage]){const html=localizeInterfaceHTML('<html><body>'+render('',issue)+'</body></html>','zh-TW',false,false);assert.ok(html.includes('位住戶在 Muse Tower 安了家。'));assert.ok(!html.includes('>residents call Muse Tower home.<'));assert.ok(html.includes('data-no-translate="">Dreams</p>'));}
});
test('language observer settles after initial render and each manual switch',async()=>{
 const frames:(()=>void)[]=[],attrs=new Map([['aria-label','Language']]);let notify=()=>{};
 const control={getAttribute:(key:string)=>attrs.get(key),setAttribute:(key:string,value:string)=>{attrs.set(key,value);notify();}};
 const doc={body:{},documentElement:{lang:'en'},cookie:'',currentScript:{dataset:{},src:'https://tower.example/interface-language.js'},addEventListener(){},querySelector:()=>null,querySelectorAll:(selector:string)=>selector==='[data-interface-switch]'?[control]:[],createTreeWalker:()=>({nextNode:()=>null})};
 const window:{MuseInterfaceLanguage?:{choose:(locale:string)=>void};dispatchEvent:()=>void;addEventListener:()=>void}={dispatchEvent(){},addEventListener(){}};
 vm.runInNewContext(await readFile(new URL('../public/interface-language.js',import.meta.url),'utf8'),{document:doc,window,navigator:{language:'en',languages:['en']},location:{href:'https://tower.example/',origin:'https://tower.example',protocol:'https:'},history:{state:null,replaceState(){}},localStorage:{getItem:()=>null,setItem(){}},URL,fetch:async()=>({ok:true,json:async()=>({Home:'家'})}),MutationObserver:class{constructor(callback:()=>void){notify=callback;}observe(){}},requestAnimationFrame:(fn:()=>void)=>{frames.push(fn);},CustomEvent:class{}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(frames.length,0,'initial render should not schedule an observer loop');
 window.MuseInterfaceLanguage!.choose('zh-TW');for(let i=0;i<5&&frames.length;i++)frames.shift()!();assert.equal(frames.length,0,'manual switch should settle after the changed aria-label is observed');assert.equal(attrs.get('aria-label'),'語言');
});
test('browser back restores the explicit URL language ahead of the last saved choice',async()=>{
 const events=new Map<string,()=>void>(),location={href:'https://tower.example/neighbors?lang=en',origin:'https://tower.example',protocol:'https:'};
 const doc={body:{},documentElement:{lang:'en'},cookie:'',currentScript:{dataset:{},src:'https://tower.example/interface-language.js'},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],createTreeWalker:()=>({nextNode:()=>null})};
 const window:{MuseInterfaceLanguage?:{choose:(locale:string)=>void;locale:string};dispatchEvent:()=>void;addEventListener:(name:string,fn:()=>void)=>void}={dispatchEvent(){},addEventListener:(name,fn)=>{events.set(name,fn);}};
 let saved:string|null=null;
 vm.runInNewContext(await readFile(new URL('../public/interface-language.js',import.meta.url),'utf8'),{document:doc,window,navigator:{language:'en',languages:['en']},location,history:{state:null,replaceState(_state:unknown,_title:string,url:string){location.href=url;}},localStorage:{getItem:()=>saved,setItem(_key:string,value:string){saved=value;}},URL,fetch:async()=>({ok:true,json:async()=>({Home:'家'})}),MutationObserver:class{observe(){}},requestAnimationFrame:(fn:()=>void)=>fn(),CustomEvent:class{}});
 await new Promise(resolve=>setImmediate(resolve));window.MuseInterfaceLanguage!.choose('zh-TW');assert.equal(window.MuseInterfaceLanguage!.locale,'zh-TW');assert.equal(saved,'zh-TW');
 location.href='https://tower.example/?lang=en';assert.equal(typeof events.get('popstate'),'function');events.get('popstate')!();assert.equal(window.MuseInterfaceLanguage!.locale,'en');assert.equal(doc.documentElement.lang,'en');assert.equal(saved,'zh-TW','history navigation does not overwrite a deliberate saved preference');
});
