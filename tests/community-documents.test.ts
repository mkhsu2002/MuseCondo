import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import runtime from '../server/live/worker.ts';
import {usesStandaloneDocument} from '../src/route-policy.ts';
const origin='https://tower.example';
test('project and history are independent static documents without a database or session, including clean URL assets and HEAD',async()=>{
 const requests:string[]=[];
 const env={ASSETS:{async fetch(req:Request){const u=new URL(req.url);requests.push(u.pathname);if(u.pathname.endsWith('/index.html'))return Response.redirect(origin+u.pathname.replace('index.html',''),308);return new Response(req.method==='HEAD'?null:'<h1>Independent public document</h1>',{headers:{'Content-Type':'text/html'}});}}};
 for(const path of ['/project','/project/','/project/index.html','/tower-history','/tower-history/','/project/perspectives','/project/perspectives/claude','/project/perspectives/gemini/index.html']){const response=await runtime.fetch(new Request(origin+path),env);assert.equal(response.status,200);assert.equal(response.headers.get('Location'),null);assert.match(await response.text(),/Independent/);assert.equal((await runtime.fetch(new Request(origin+path,{method:'HEAD'}),env)).status,200);assert.equal((await runtime.fetch(new Request(origin+path,{method:'POST'}),env)).status,405);}
 assert.ok(requests.every(x=>['/project/','/tower-history/','/project/perspectives/','/project/perspectives/claude/','/project/perspectives/gemini/'].includes(x)));
 for(const x of ['/project','/project/','/tower-history','/tower-history/index.html'])assert(usesStandaloneDocument(x));
 for(const x of ['/project/perspectives/private','/project/perspectives/claude/extra','/projectile','/project/private','/tower-history/other','/home/0123456789abcdef'])assert(!usesStandaloneDocument(x));
});
test('history is a no-JS, oldest-to-newest record with real dates and distinct page metadata',()=>{
 const html=readFileSync(new URL('../tower-history/index.html',import.meta.url),'utf8');
 const dates=[...html.matchAll(/<li><time datetime="([^"]+)"/g)].map(x=>x[1]);assert.equal(dates.length,9);assert.deepEqual(dates,[...dates].sort());
 assert.match(html,/2026-10-28/);assert.match(html,/2026-11-02T00:12:59-07:00/);assert.match(html,/2026-11-03T15:23:58-07:00/);
 assert.match(html,/<title>Tower History/);assert.match(html,/rel="canonical" href="https:\/\/musetower.neobabylon.app\/tower-history"/);assert.doesNotMatch(html,/<script|<iframe|form|API key|prompt|acceptance criteria|submitted at/i);
});

test('the homepage samples four newest doors while no-JS Neighbors retains every public resident, excludes private doors and never caches consent',async()=>{
 const {LocalDatabase}=await import('../server/live/local-db.ts');const {readdirSync}=await import('node:fs');const {openSyntheticTower}=await import('./helpers/tower-admission-fixture.ts');
 const db=new LocalDatabase(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));openSyntheticTower(db);
 try{
  for(let i=0;i<7;i++){const room=i.toString(16).padStart(16,'0'),at=`2026-11-03T10:0${i}:00.000Z`,visible=i<6?1:0;db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(room,'fixture-'+room,at);db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at) VALUES(?,?,?,'Intro','resident',?,'external-ready',?)").run(room,room,'Neighbor '+i,visible,at);db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,public_revision,directory_consent,snapshot_consent,announcement_consent,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?,?,0,?,?)").run(room,room,room,'https://fixture.example/'+room,visible?1:null,visible,visible,at,at);}
  const env={DB:db,PUBLIC_ORIGIN:origin,ASSETS:{fetch:async()=>new Response('<html><head><title>Tower</title></head><body><div id="app"></div></body></html>',{headers:{'Content-Type':'text/html',ETag:'static', 'Cache-Control':'public, max-age=3600'}})}};
  const home=await(await runtime.fetch(new Request(origin+'/'),env)).text();assert.match(home,/Neighbor 5/);assert.doesNotMatch(home,/Neighbor 0|Neighbor 1|Neighbor 6/);
  const directory=await runtime.fetch(new Request(origin+'/neighbors'),env),html=await directory.text();assert.equal(directory.status,200);assert.equal(directory.headers.get('Cache-Control'),'no-store');assert.equal(directory.headers.get('ETag'),null);for(let i=0;i<6;i++)assert.match(html,new RegExp('Neighbor '+i));assert.doesNotMatch(html,/Neighbor 6/);assert.equal((html.match(/data-resident-slot/g)??[]).length,6);assert.match(html,/<title>Our neighbors/);
  const head=await runtime.fetch(new Request(origin+'/neighbors',{method:'HEAD'}),env);assert.equal(head.status,200);assert.equal(await head.text(),'');
 }finally{db.close();}
});
