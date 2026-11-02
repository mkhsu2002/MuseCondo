import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {homeArtwork,giftCatalog} from '../src/artwork.ts';
import {residents} from '../src/residents.ts';
import {homeAccessMarkup} from '../src/live/framework-ui.ts';

function liveHarness(fetcher:typeof fetch){
 const document={title:'',documentElement:{lang:''}},exports:Record<string,unknown>={};
 const source=readFileSync(new URL('../src/live.ts',import.meta.url),'utf8').replaceAll('import.meta.env.BASE_URL',"''");
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const modules:Record<string,unknown>={
  './shared/lobby-markup.ts':{renderLiveShell:(_base:string,content:string)=>`<main>${content}</main>`},
  './shared/lobby-messages.ts':{lobbyMessages:()=>({})},
  './live/tower-appearance.ts':{disposeTowerAppearance:()=>{}},
  './live/framework-ui.ts':{homeAccessMarkup},
 };
 runInNewContext(compiled,{exports,require:(id:string)=>modules[id]??{},window:{addEventListener:()=>{}},document,fetch:fetcher,location:{pathname:'/neighbors',hash:''},AbortSignal,crypto,console});
 return {document,render:exports.renderLive as (root:unknown,route:string)=>Promise<void>};
}
test('live neighbor chrome defaults to English while resident-authored names, role and intro remain exact and escaped',async()=>{
 const name='方 & Fang',role='夢的收藏家',intro='自己的文字 <script>';const h=liveHarness(async(url)=>Response.json(String(url).endsWith('/session')?{signedIn:false}:{rooms:[{id:'0123456789abcdef',name,role,intro}]}));
 const root={innerHTML:'',querySelector:()=>null};await h.render(root,'neighbors');
 assert.equal(h.document.documentElement.lang,'en');assert.match(root.innerHTML,/<h1>Neighbors<\/h1>/);assert.match(root.innerHTML,/Move in with my Agent/);assert.match(root.innerHTML,/方 &amp; Fang/);assert.match(root.innerHTML,/夢的收藏家/);assert.match(root.innerHTML,/自己的文字 &lt;script&gt;/);assert.doesNotMatch(root.innerHTML,/<script>/);
 assert.doesNotMatch(root.innerHTML.replaceAll('方 &amp; Fang','').replaceAll(role,'').replaceAll('自己的文字 &lt;script&gt;',''),/\p{Script=Han}/u);
});
test('live service failures and signed-out move-in controls use English without changing route or auth contract',async()=>{
 for(const bad of [false,true]){const h=liveHarness(async()=>bad?new Response('offline',{status:503}):Response.json({signedIn:false})),root={innerHTML:'',querySelector:()=>null};await h.render(root,'move-in');assert.equal(h.document.documentElement.lang,'en');assert.doesNotMatch(root.innerHTML,/\p{Script=Han}/u);assert.match(root.innerHTML,bad?/Check status again/:/Account key/);assert.match(root.innerHTML,bad?/do not|before creating another account/:/Start at Reception/);}
});

test('signed-out home access reads actual registration state and keeps login usable if status fails',async()=>{
 for(const registration of [true,false,undefined]){
  const requests:string[]=[];
  const h=liveHarness(async url=>{
   requests.push(String(url));
   if(String(url).endsWith('/session'))return Response.json({signedIn:false});
   return registration===undefined?new Response('offline',{status:503}):Response.json({registrationEnabled:registration});
  });
  const root={innerHTML:'',querySelector:()=>null};await h.render(root,'move-in');
  assert.deepEqual(requests,['/api/v1/session','/api/v1/status']);
  assert.match(root.innerHTML,/id="live-login"/);
  assert.equal(root.innerHTML.includes('id="live-register"'),registration===true);
 }
});
test('public notice errors are English and artwork IDs keep their original residents and asset paths',async()=>{
 const exported:Record<string,unknown>={},source=readFileSync(new URL('../src/community/client.ts',import.meta.url),'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;runInNewContext(compiled,{exports:exported,require:()=>({}),fetch:async()=>new Response(null,{status:503})});await assert.rejects((exported.loadCommunity as (base:string,ids:string[])=>Promise<unknown>)('',[]),/Unable to read the public notice file/);
 for(const resident of residents){assert.ok(homeArtwork[resident.id].description.startsWith(resident.name+"'s "));assert.ok(homeArtwork[resident.id].desktop);}
 assert.deepEqual(giftCatalog.map(v=>v.id),['gift-sprout','gift-cloud','gift-coffee']);assert.doesNotMatch(giftCatalog.map(v=>v.name+' '+v.description).join(''),/\p{Script=Han}/u);
});
