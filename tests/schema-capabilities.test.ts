import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import runtime from '../server/live/worker.ts';
import {LocalDatabase} from '../server/live/local-db.ts';
import {routeSchemaCapability,routeSchemaReady,FULL_SCHEMA_CAPABILITY,CAPABILITY_SCHEMA_QUERY} from '../server/live/schema-capabilities.ts';
import {RELEASE_MANIFEST} from '../server/live/generated-release.ts';
import {CONDO_PROFILE_FIELDS} from '../src/framework/condo.ts';
import {assetStatements} from '../server/live/tower-asset-storage.ts';
const origin='https://tower.example',room='a'.repeat(16),account='b'.repeat(16),time='2026-11-02T00:00:00.000Z';
const home='/home/'+room,jsonHome='/api/v1/tower/rooms/'+room,image='/api/v1/tower/assets/'+room+'/1/home.png';
async function fixture(){
 const db=new LocalDatabase(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 openSyntheticTower(db);
 db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,'c'.repeat(64),time);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at) VALUES(?,?, 'Synthetic public home','Welcome','neighbor',1,'complete',?)").run(room,account,time);
 db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,revision,public_revision,snapshot_consent,created_at,updated_at) VALUES(?,?,?,'https://source.example/condo.json','owner-attested',1,1,1,?,?)").run(room,account,room,time,time);
 const site={templateVersion:'muse-condo-1',example:false,home:{frameworkVersion:'0.01',id:room,name:'Synthetic public home',intro:'Welcome',assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[],dreams:[]},homeAlt:'Synthetic home',profile:Object.fromEntries(CONDO_PROFILE_FIELDS.map(key=>[key,'Synthetic profile']))};
 db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,1,?,?,?)').run(room,JSON.stringify(site),'d'.repeat(64),time);
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 await db.batch(await assetStatements(db,room,1,[{purpose:'home',bytes,digest:hash}]));
 const env={DB:db,PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:'synthetic-operator',ASSETS:{async fetch(){return new Response('STATIC FALLBACK');}}};
 const get=(path:string,method='GET')=>runtime.fetch(new Request(origin+path,{method}),env);
 return {db,get,bytes,env};
}

test('only supported public methods and exact handler paths receive reduced capabilities',()=>{
 assert.deepEqual(routeSchemaCapability('GET',home),['tower_residencies','tower_snapshots']);
 assert.deepEqual(routeSchemaCapability('HEAD',home+'/inside/'),['tower_residencies','tower_snapshots']);
 assert.deepEqual(routeSchemaCapability('GET','/api/v1/public/rooms/'+room+'/dreams'),['rooms','dream_consent','dreams','tower_residencies']);
 for(const [method,path] of [['POST',home],['GET',home+'//'],['GET','/home/bad-id'],['GET','/api/v1/tower/assets/'+room+'/0/home.png'],['HEAD','/api/v1/public/rooms'],['GET','/api/v1/tower/appearance'],['GET','/api/v1/assets/'+'a'.repeat(32)],['GET','/api/v1/status'],['GET','/api/v1/unrecognized']])assert.equal(routeSchemaCapability(method,path),FULL_SCHEMA_CAPABILITY,path);
 assert.ok(FULL_SCHEMA_CAPABILITY.length>100);
 assert.ok(CAPABILITY_SCHEMA_QUERY.length<100000);
});

test('unrelated visit and identity guards do not take published homes, JSON or immutable images offline',async()=>{
 const f=await fixture();try{
 f.db.sqlite.exec('DROP TABLE tower_visits; DROP TRIGGER identity_recovery_request_prune_guard');
 for(const path of [home,home+'/inside',home+'/dreams',jsonHome,image]){const response=await f.get(path);assert.equal(response.status,200,path);assert.doesNotMatch(await response.text(),/STATIC FALLBACK/);}
 assert.match(await(await f.get(home)).text(),/Synthetic public home/);
 assert.equal((await(await f.get(jsonHome)).json()).site.home.name,'Synthetic public home');
 assert.deepEqual(new Uint8Array(await(await f.get(image)).arrayBuffer()),f.bytes);
 for(const path of [jsonHome+'/visits','/api/v1/status'])assert.equal((await f.get(path)).status,503,path);
 const release=await runtime.fetch(new Request(origin+'/api/v1/operator/release',{headers:{'X-Tower-Operator-Key':'synthetic-operator'}}),f.env);assert.equal((await release.json()).ready,false);
 }finally{f.db.close();}
});

test('required tables and additive storage absence fail closed before handlers or HTML fallback',async()=>{
 for(const table of ['tower_snapshots','tower_residencies','tower_asset_refs','tower_asset_objects','tower_asset_object_chunks','tower_asset_chunks']){
 const f=await fixture();try{f.db.sqlite.exec('PRAGMA foreign_keys=OFF; DROP TABLE '+table);const path=table==='tower_snapshots'||table==='tower_residencies'?home:image;const response=await f.get(path);assert.equal(response.status,503,table);assert.equal((await response.json()).error,'database_schema_not_ready');}finally{f.db.close();}
 }
});

test('same-name views and changed canonical table DDL cannot impersonate required capabilities',async()=>{
 for(const mutation of ["ALTER TABLE tower_snapshots ADD COLUMN extra TEXT",'PRAGMA foreign_keys=OFF; DROP TABLE tower_snapshots; CREATE VIEW tower_snapshots AS SELECT 1 AS room_id']){
 const f=await fixture();try{f.db.sqlite.exec(mutation);assert.equal((await f.get(home)).status,503);}finally{f.db.close();}
 }
});

test('activity list survives missing participation but detail remains unavailable',async()=>{
 const f=await fixture();try{
 f.db.sqlite.exec("INSERT INTO tower_activities VALUES('synthetic','Synthetic','Welcome',NULL,NULL,'open',1,'2026-11-02','2026-11-02'); DROP TABLE tower_activity_participation");
 const list=await f.get('/api/v1/tower/activities');assert.equal(list.status,200);assert.match(await list.text(),/Synthetic/);
 assert.equal((await f.get('/api/v1/tower/activities/synthetic')).status,503);
 }finally{f.db.close();}
});

test('conservative writes reject missing recovery guards without ledger, audit or mail effects',async()=>{
 const f=await fixture();try{
 const snapshot=()=>JSON.stringify(['identity_audit','identity_mail_events','identity_recovery_requests','tower_audit','tower_requests'].map(table=>f.db.sqlite.prepare('SELECT * FROM '+table).all()));
 const before=snapshot();f.db.sqlite.exec('DROP TRIGGER identity_recovery_request_prune_guard');
 for(const path of ['/api/v1/identity/recovery','/api/v1/me/tower-intake/content','/api/v1/unrecognized'])assert.equal((await f.get(path,'POST')).status,503,path);
 assert.equal(snapshot(),before);
 }finally{f.db.close();}
});

test('request checks observe dropped and restored required schema without stale readiness',async()=>{
 const f=await fixture();try{
 assert.equal((await f.get(home)).status,200);
 const ddl=f.db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='tower_snapshots'").get()!.sql as string;
 const row=f.db.sqlite.prepare('SELECT * FROM tower_snapshots').get()!;
 f.db.sqlite.exec('PRAGMA foreign_keys=OFF; DROP TABLE tower_snapshots');
 assert.equal((await f.get(home)).status,503);
 f.db.sqlite.exec(ddl);f.db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,?,?,?,?)').run(row.room_id,row.revision,row.public_json,row.content_digest,row.created_at);
 assert.equal((await f.get(home)).status,200);
 }finally{f.db.close();}
});

test('public home performs one bounded selected schema query using one names bind',async()=>{
 const f=await fixture();try{
 const queries:{sql:string;values:unknown[]}[]=[],prepare=f.db.prepare.bind(f.db);
 f.db.prepare=(sql:string)=>{const statement=prepare(sql);if(sql.includes('sqlite_master')){const query={sql,values:[] as unknown[]};queries.push(query);const bind=statement.bind.bind(statement);statement.bind=(...values:unknown[])=>{query.values=values;return bind(...values);};}return statement;};
 assert.equal((await f.get(home)).status,200);
 assert.equal(queries.length,1);assert.equal(queries[0].sql,CAPABILITY_SCHEMA_QUERY);assert.deepEqual(queries[0].values,[JSON.stringify(['tower_residencies','tower_snapshots'])]);
 assert.equal(await routeSchemaReady(f.db,'GET','/api/v1/status'),true);
 assert.equal(queries.at(-1)!.values.length,1);
 assert.equal(RELEASE_MANIFEST.schemaDefinitions.length,RELEASE_MANIFEST.schemaObjects);
 }finally{f.db.close();}
});

test('legacy room public reads fail closed when Tower membership authority is absent',async()=>{const f=await fixture();try{f.db.sqlite.exec('PRAGMA foreign_keys=OFF; DROP TABLE tower_residencies');for(const path of ['/api/v1/public/rooms/'+room,'/api/v1/public/rooms/'+room+'/dreams']){const response=await f.get(path);assert.equal(response.status,503,path);assert.equal((await response.json()).error,'database_schema_not_ready');}}finally{f.db.close();}});
