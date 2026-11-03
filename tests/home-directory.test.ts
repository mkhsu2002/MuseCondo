import {createNavigationEpoch} from '../src/route-policy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {renderTowerJournals} from '../src/shared/tower-journals-markup.ts';
import {renderWeeklyCard} from '../src/shared/tower-weekly-markup.ts';
import {renderHomeDirectory} from '../src/shared/home-directory.ts';
import runtime from '../server/live/worker.ts';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createLiveApp} from '../server/live/app.ts';
import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
const origin='https://tower.example',id='a'.repeat(16),privateId='b'.repeat(16);
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const turn=async()=>{for(let n=0;n<3;n++)await new Promise<void>(resolve=>setImmediate(resolve));};
function frontend(initial='',statusResponse?:Promise<Response>){
 const listing=deferred<{rooms:{id:string;name:string}[]}>(),community=deferred<unknown>(),frames:string[]=[];
 const root={innerHTML:initial,dataset:{},querySelector(selector:string){if(selector==='[data-public-home-directory]'){const outerHTML=this.innerHTML.match(/<section[^>]*data-public-home-directory[^>]*>[\s\S]*?<\/section>/)?.[0];return outerHTML?{outerHTML,addEventListener(){}}:null;}return {addEventListener(){}};}};
 const context={root,renderTowerJournals,AbortController,journalCleanup:null,journalsMarkup:'',window:{addEventListener(){},removeEventListener(){}},renderWeeklyCard,weeklyMarkup:'',renderVersion:0,liveServiceSeen:false,base:'',document:{documentElement:{},title:'',addEventListener(){},removeEventListener(){}},AbortSignal,fetch:async()=>statusResponse??Response.json({available:true,registrationEnabled:false,mode:'live'}),lobbyMessages:()=>({meta:{title:'Tower'}}),showTowerLobby:(target:typeof root,content:string)=>{frames.push(content);target.innerHTML=content;},lobbyServiceMarkup:(kind:string)=>`<p>${kind}</p>`,api:(path:string)=>path.endsWith('/tower-journals')?Promise.resolve({edition:null}):path.endsWith('/rooms')?listing.promise:path.split('?')[0].endsWith('/tower-weekly')?Promise.resolve({issues:[]}):community.promise,renderHomeDirectory,validateCommunity:()=>({events:[]}),renderLobbyFeed:()=>'<p>Community feed</p>',pending:undefined as Promise<void>|undefined};
 const source=readFileSync(new URL('../src/live.ts',import.meta.url),'utf8').split('export async function renderLiveTower')[1];assert.ok(source,'exercise the maintained frontend function');
 const code=ts.transpileModule('async function renderLiveTower'+source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 runInNewContext(code+';globalThis.pending=renderLiveTower(root);',context);
 return {root,listing,community,frames,finished:()=>context.pending!};
}
test('validated doors appear immediately while community hangs and remain after community failure',async()=>{
 const f=frontend();await turn();f.listing.resolve({rooms:[{id,name:'Listed independently'}]});await turn();assert.match(f.root.innerHTML,/Listed independently/);assert.match(f.root.innerHTML,new RegExp('href="/home/'+id+'"'));assert.match(f.root.innerHTML,/loading/);f.community.reject(Error('community unavailable'));await f.finished();assert.match(f.root.innerHTML,/Listed independently/);assert.match(f.root.innerHTML,/unavailable/);
});
test('SSR doors survive pending listing but an unverified or failed listing removes stale SSR doors',async()=>{
 for(const invalid of [false,true]){const f=frontend(renderHomeDirectory('',[{id,name:'Old consent'}]));await turn();assert.match(f.root.innerHTML,/Old consent/);if(invalid)f.listing.resolve({rooms:[{id:'not-a-household',name:'Unverified'}]});else f.listing.reject(Error('listing unavailable'));f.community.reject(Error('community unavailable'));await f.finished();assert.doesNotMatch(f.root.innerHTML,/Old consent|Unverified|data-public-home-directory/);}
});
test('directory markup escapes names and excludes invalid identifiers without announcement metadata',()=>{
 const html=renderHomeDirectory('',[{id,name:'<script>alert("x")</script> & a\'s door'},{id:'javascript:alert(1)',name:'Bad ID'},{id:'" onclick="evil',name:'Attribute attack'}]);assert.match(html,/&lt;script&gt;/);assert.match(html,/&quot;x&quot;/);assert.match(html,/&amp; a&#39;s door/);assert.doesNotMatch(html,/<script|Bad ID|Attribute attack|onclick=/);assert.equal((html.match(/href=/g)??[]).length,1);assert.match(html,new RegExp('href="/home/'+id+'"'));
});
test('root SSR lists only public doors without announcement permission, provider calls or reusable HTML cache',async()=>{
 const db=new LocalDatabase(':memory:');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(v=>v.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));openSyntheticTower(db);
 const at=new Date().toISOString();for(const [room,published,name] of [[id,1,'Public <script>escape me</script>'],[privateId,0,'Private home must stay private']] as const){db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(room,'synthetic-'+room,at);db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at) VALUES(?,?,?,'Public intro','resident',?,'external-ready',?)").run(room,room,name,published,at);db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,public_revision,directory_consent,snapshot_consent,announcement_consent,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?,?,0,?,?)").run(room,room,room,'https://synthetic.example/'+room,published?1:null,published,published,at,at);}
 const assets='<html><body><div id="app"></div></body></html>',original=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No provider is needed for a directory');};
 try{const response=await runtime.fetch(new Request(origin+'/'),{DB:db,PUBLIC_ORIGIN:origin,ASSETS:{fetch:async()=>new Response(assets,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=3600',ETag:'synthetic-static','Content-Length':String(assets.length),'Last-Modified':at}})}});assert.equal(response.status,200);const html=await response.text();for(const marker of ['data-tower-lobby','data-lobby-feed','id="tower-landscape"','id="tower-video"','class="live-header"'])assert.ok(html.includes(marker),'server response must include '+marker);assert.match(html,new RegExp('href="/home/'+id+'"'));assert.doesNotMatch(html,new RegExp('href="/home/'+privateId+'"'));assert.doesNotMatch(html,/Private home must stay private|<script>escape me<\/script>/);assert.match(html,/Public &lt;script&gt;escape me&lt;\/script&gt;/);assert.equal(response.headers.get('Cache-Control'),'no-store');for(const name of ['ETag','Content-Length','Last-Modified'])assert.equal(response.headers.get(name),null);assert.equal(network,0);assert.equal(db.sqlite.prepare('SELECT announcement_consent FROM tower_residencies WHERE room_id=?').get(id)!.announcement_consent,0);const app=createLiveApp({db,origin,localTest:true,registrationEnabled:false,towerEnabled:true});assert.equal((await app.editBuilding(false)).events.length,0);}finally{globalThis.fetch=original;db.close();}
});
test('the lazy homepage router preserves SSR doors while its live import is pending',async()=>{
 const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),file=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const fn=file.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='navigate');assert.ok(fn);
 const loader=deferred<unknown>(),root={innerHTML:renderHomeDirectory('',[{id,name:'SSR door before network'}])};let captured='';
 const code=ts.transpileModule(fn!.getText(file).replace('export ','').replace("import('./live')",'loadLive()').replace("import('./demo')",'loadDemo()').replaceAll('import.meta.env.VITE_MUSE_DEMO','false'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const context={navigation:createNavigationEpoch(),live:undefined,demo:undefined,root,base:'',location:{pathname:'/'},usesPublishedHomeDocument:()=>false,isLiveRoute:()=>false,loadLive:()=>loader.promise,finish:()=>{},pending:undefined as Promise<void>|undefined};
 runInNewContext(code+';globalThis.pending=navigate();',context);
 assert.match(root.innerHTML,/SSR door before network/);
 loader.resolve({renderLiveTower:async(target:typeof root)=>{captured=target.innerHTML;}});await context.pending;
 assert.match(captured,/SSR door before network/);assert.match(captured,/data-public-home-directory/);
});

test('the homepage mounts immediately while the status response is pending',async()=>{
 const status=deferred<Response>(),f=frontend(renderHomeDirectory('',[{id,name:'SSR door'}]),status.promise);
 assert.equal(f.frames.length,1,'mount the full shell before awaiting status');assert.match(f.frames[0],/loading/);assert.match(f.frames[0],/SSR door/);
 status.resolve(Response.json({available:true,mode:'live'}));await turn();f.listing.resolve({rooms:[{id,name:'Current door'}]});f.community.reject(Error('community unavailable'));await f.finished();
});
test('updating homepage content preserves the hero and player nodes and binds controls once',()=>{
 const source=readFileSync(new URL('../src/live.ts',import.meta.url),'utf8'),file=ts.createSourceFile('live.ts',source,ts.ScriptTarget.Latest,true);
 const fn=file.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='showTowerLobby');assert.ok(fn);
 let shellWrites=0,binds=0;const feed={innerHTML:''};
 const root={querySelector:(selector:string)=>selector==='[data-lobby-feed]'?feed:null,get innerHTML(){return 'existing shell';},set innerHTML(_value:string){shellWrites++;}};
 const context={root,weeklyMarkup:'',journalsMarkup:'',lobbyRoot:null,base:'',disposeLobby(){},towerScenePreference:()=> 'day',renderTowerLobby:()=> 'replacement shell',bindTowerWelcome:()=>{binds++;}};
 const code=ts.transpileModule(fn!.getText(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 runInNewContext(code+';showTowerLobby(root,"loading");showTowerLobby(root,"validated feed");',context);
 assert.equal(shellWrites,0,'data refresh must not replace the homepage shell');assert.equal(feed.innerHTML,'<div data-weekly-slot></div><div data-journals-slot></div>validated feed');assert.equal(binds,1);
});

test('SPA return to a fresh lobby keeps journal revalidation alive and clears revoked content on visibility',async()=>{
 const file=ts.createSourceFile('live.ts',readFileSync('src/live.ts','utf8'),ts.ScriptTarget.Latest,true),names=['showTowerLobby','renderLiveTower'];
 const functions=names.map(name=>file.statements.find((n):n is ts.FunctionDeclaration=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!.getText(file).replace('export ',''));
 let mounted=false;const slot={innerHTML:''},feed={innerHTML:''},handlers=new Map<string,()=>void>();let journalCalls=0;
 const root={dataset:{},get innerHTML(){return '';},set innerHTML(_v:string){mounted=true;},querySelector(selector:string){if(selector==='[data-lobby-feed]')return mounted?feed:null;if(selector==='[data-journals-slot]')return mounted?slot:null;return null;}};
 const context={root,base:'',renderVersion:0,lobbyRoot:null,journalCleanup:null as null|(()=>void),weeklyMarkup:'',journalsMarkup:'',AbortController,AbortSignal,renderTowerJournals,renderWeeklyCard,renderHomeDirectory,lobbyServiceMarkup:(kind:string)=>kind,lobbyMessages:()=>({meta:{title:'Tower'}}),towerScenePreference:()=> 'day',renderTowerLobby:()=>'<main>mounted</main>',bindTowerWelcome(){},document:{documentElement:{},title:'',visibilityState:'visible',addEventListener:(k:string,f:()=>void)=>handlers.set(k,f),removeEventListener:(k:string)=>handlers.delete(k)},window:{addEventListener:(k:string,f:()=>void)=>handlers.set(k,f),removeEventListener:(k:string)=>handlers.delete(k)},fetch:()=>new Promise(()=>{}),api:(path:string)=>path.includes('tower-journals')?Promise.resolve({edition:journalCalls++===0?{day:'2026-11-03',cutoffAt:'2026-11-03T16:00:00Z',publishedAt:'2026-11-03T16:00:00Z',items:[{author:'Fang',title:'A public journal',excerpt:'A visible story',originalAt:'2026-11-02T12:00:00Z',href:'https://tower.example/home/'+id+'/inside'}]}:null}):Promise.resolve({issues:[]})};
 const code=ts.transpileModule('function disposeLobby(){journalCleanup?.();journalCleanup=null;}\n'+functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 runInNewContext(code+';void renderLiveTower(root);',context);await turn();assert.match(slot.innerHTML,/A public journal/);assert.ok(handlers.has('visibilitychange'));assert.ok(handlers.has('pageshow'));handlers.get('visibilitychange')!();await turn();assert.doesNotMatch(slot.innerHTML,/A public journal|A visible story/);context.journalCleanup?.();
});

test('homepage SSR keeps weekly and journals available when the resident directory fails',async()=>{
 const db=new LocalDatabase(':memory:');try{for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+f,'utf8'));const prepare=db.prepare.bind(db);db.prepare=sql=>{if(sql==='SELECT * FROM rooms WHERE published=1 ORDER BY created_at DESC')throw Error('synthetic directory outage');return prepare(sql);};const response=await runtime.fetch(new Request(origin+'/'),{DB:db,PUBLIC_ORIGIN:origin,TOWER_DAILY_JOURNALS_ENABLED:'true',ASSETS:{fetch:async()=>new Response('<html><body><div id="app"></div></body></html>',{headers:{'Content-Type':'text/html'}})}});assert.equal(response.status,200);const html=await response.text();assert.match(html,/data-tower-journals/);assert.match(html,/data-tower-weekly/);assert.match(html,/id="tower-landscape"/);assert.equal(response.headers.get('Cache-Control'),'no-store');}finally{db.close();}
});
