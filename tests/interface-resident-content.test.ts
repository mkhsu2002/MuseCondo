import test from 'node:test';
import assert from 'node:assert/strict';
import {publicCondoProjection} from '../src/framework/condo.ts';
import {renderCondo} from '../src/framework/condo-render.ts';
import {condoFixture} from './helpers/condo-fixture.ts';
import {localizeInterfaceResponse} from '../server/live/interface-html.ts';
import {parse,type DefaultTreeAdapterMap} from 'parse5';
test('UI catalog collisions never change resident name, prose, dream or artwork description',async()=>{
 const site=publicCondoProjection(condoFixture(),'0123456789abcdef');site.home.name='Home';site.home.intro='Dreams';site.profile.about='Character sheet';site.profile.interests='Home';site.homeAlt='Home';
 const originalDream={id:'d',title:'Home',body:'Dreams',occurredAt:'2026-11-12T00:00:00Z',wish:'Home',image:{src:'./assets/dream.png',alt:'Dreams'}};site.dream=originalDream;
 for(const page of ['home','inside','dreams'] as const){
  const response=await localizeInterfaceResponse(new Request('https://tower.example/home/0123456789abcdef?lang=zh-TW'),new Response(renderCondo(site,page),{headers:{'Content-Type':'text/html'}}));
  const html=await response.text();assert.match(html,/<html lang="zh-TW">/);assert.match(html,/>家<\/a>/);assert.match(html,/>夢境<\/a>/);
  const protectedText:string[]=[];function walk(node:DefaultTreeAdapterMap['node'],protectedParent=false){const element=node as {attrs?:{name:string;value:string}[];value?:string;childNodes?:typeof node[]};const protectedNow=protectedParent||!!element.attrs?.some(a=>a.name==='data-no-translate');if(protectedNow&&typeof element.value==='string')protectedText.push(element.value);for(const child of element.childNodes||[])walk(child,protectedNow);}for(const child of parse(html).childNodes)walk(child);
  assert.ok(protectedText.includes('Home'));if(page==='home')assert.ok(protectedText.includes('Dreams'));if(page==='inside')assert.ok(protectedText.includes('Character sheet'));if(page==='dreams')assert.ok(protectedText.includes('Dreams'));
 }
});
