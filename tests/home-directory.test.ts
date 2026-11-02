import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {renderHomeDirectory} from '../src/shared/home-directory.ts';
import runtime from '../server/live/worker.ts';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createLiveApp} from '../server/live/app.ts';
import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
const origin='https://tower.example',id='a'.repeat(16),privateId='b'.repeat(16);
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const turn=async()=>{for(let n=0;n<3;n++)await new Promise<void>(resolve=>setImmediate(resolve));};
function frontend(initial=''){
 const listing=deferred<{rooms:{id:string;name:string}[]}>(),community=deferred<unknown>();
 const root={innerHTML:initial,dataset:{},querySelector(selector:string){if(selector==='[data-public-home-directory]'){const outerHTML=this.innerHTML.match(/<section[^>]*data-public-home-directory[^>]*>[\s\S]*?<\/section>/)?.[0];return outerHTML?{outerHTML,addEventListener(){}}:null;}return {addEventListener(){}};}};
 const context={root,renderVersion:0,liveServiceSeen:false,base:'',document:{documentElement:{},title:''},AbortSignal,fetch:async()=>Response.json({available:true,registrationEnabled:false,mode:'live'}),lobbyMessages:()=>({meta:{title:'Tower'}}),showTowerLobby:(target:typeof root,content:string)=>{target.innerHTML=content;},lobbyServiceMarkup:(kind:string)=>`<p>${kind}</p>`,api:(path:string)=>path.endsWith('/rooms')?listing.promise:community.promise,renderHomeDirectory,validateCommunity:()=>({events:[]}),renderLobbyFeed:()=>'<p>Community feed</p>',pending:undefined as Promise<void>|undefined};
 const source=readFileSync(new URL('../src/live.ts',import.meta.url),'utf8').split('export async function renderLiveTower')[1];assert.ok(source,'exercise the maintained frontend function');
 const code=ts.transpileModule('async function renderLiveTower'+source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 runInNewContext(code+';globalThis.pending=renderLiveTower(root);',context);
 return {root,listing,community,finished:()=>context.pending!};
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
 try{const response=await runtime.fetch(new Request(origin+'/'),{DB:db,PUBLIC_ORIGIN:origin,ASSETS:{fetch:async()=>new Response(assets,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=3600',ETag:'synthetic-static','Content-Length':String(assets.length),'Last-Modified':at}})}});assert.equal(response.status,200);const html=await response.text();assert.match(html,new RegExp('href="/home/'+id+'"'));assert.doesNotMatch(html,new RegExp('href="/home/'+privateId+'"'));assert.doesNotMatch(html,/Private home must stay private|<script>escape me<\/script>/);assert.match(html,/Public &lt;script&gt;escape me&lt;\/script&gt;/);assert.equal(response.headers.get('Cache-Control'),'no-store');for(const name of ['ETag','Content-Length','Last-Modified'])assert.equal(response.headers.get(name),null);assert.equal(network,0);assert.equal(db.sqlite.prepare('SELECT announcement_consent FROM tower_residencies WHERE room_id=?').get(id)!.announcement_consent,0);const app=createLiveApp({db,origin,localTest:true,registrationEnabled:false,towerEnabled:true});assert.equal((await app.editBuilding(false)).events.length,0);}finally{globalThis.fetch=original;db.close();}
});
test('the real homepage router preserves SSR doors before starting asynchronous live rendering',()=>{
 const source=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),file=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);let branch:ts.IfStatement|undefined;
 const visit=(node:ts.Node)=>{if(ts.isIfStatement(node)&&node.expression.getText(file)==='!pathname')branch=node;ts.forEachChild(node,visit);};visit(file);assert.ok(branch,'exercise the maintained homepage entry branch');
 const code=ts.transpileModule(branch!.getText(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 const root={innerHTML:renderHomeDirectory('',[{id,name:'SSR door before network'}]),querySelector(selector:string){return selector==='[data-public-home-directory]'&&this.innerHTML.includes('data-public-home-directory')?{}:null;}};let captured='';
 runInNewContext(code,{root,pathname:'',m:{service:{loading:'Loading'},meta:{title:'Tower'}},document:{title:''},renderLiveTower:(target:typeof root)=>{captured=target.innerHTML;}});
 assert.match(captured,/SSR door before network/);assert.match(captured,/data-public-home-directory/);
});
