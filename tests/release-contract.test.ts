import test from 'node:test';
import assert from 'node:assert/strict';
import {RELEASE_MANIFEST} from '../server/live/generated-release.ts';
import {releaseReadiness} from '../server/live/release-contract.ts';
import runtime from '../server/live/worker.ts';
import {LocalDatabase} from '../server/live/local-db.ts';
import {readFileSync,readdirSync} from 'node:fs';
const origin='https://release.example',key='synthetic-release-operator';
const request=(headers:Record<string,string>={})=>new Request(origin+'/api/v1/operator/release',{headers});
test('release authentication rejects wrong keys before any D1 access',async()=>{
 let calls=0;const db={prepare(){calls++;throw Error('must not access D1');},async batch(){calls++;return [];}};
 const response=await runtime.fetch(request({'X-Tower-Operator-Key':'wrong'}),{PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:key,DB:db});
 assert.equal(response.status,401);assert.equal(calls,0);
});
test('release rejects cookies and foreign origins before D1 access',async()=>{
 for(const headers of ([{Cookie:'session=synthetic'},{Origin:'https://foreign.example'},{'Sec-Fetch-Site':'cross-site'}] as Record<string,string>[])){
  let calls=0;const db={prepare(){calls++;throw Error('must not access D1');},async batch(){calls++;return [];}};
  assert.equal((await runtime.fetch(request({...headers,'X-Tower-Operator-Key':key}),{PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:key,DB:db})).status,403);assert.equal(calls,0);
 }
});
function fixture(){const db=new LocalDatabase(':memory:');const files=readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort();for(const file of files)db.sqlite.exec(readFileSync('migrations/'+file,'utf8'));db.sqlite.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT)');for(const file of files)db.sqlite.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(file);return db;}
test('release reports exact full schema and migration readiness without resident data',async()=>{
 const db=fixture();try{
  const inspect=async()=>{const response=await runtime.fetch(request({'X-Tower-Operator-Key':key}),{PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:key,DB:db});assert.equal(response.status,200);return await response.json();};
  const complete=await inspect();assert.equal(complete.ready,RELEASE_MANIFEST.buildComplete);assert.equal((await releaseReadiness(db,{...RELEASE_MANIFEST,buildComplete:true})).ready,true);assert.equal(complete.schemaReady,true);assert.equal(complete.migrationsReady,true);assert.match(complete.schemaHash,/^[a-f0-9]{64}$/);assert.ok(JSON.stringify(complete).length<4000);assert.doesNotMatch(JSON.stringify(complete),/CREATE TABLE|login_hash|synthetic-release-operator/);
  db.sqlite.exec('ALTER TABLE accounts ADD COLUMN synthetic_extra TEXT');assert.equal((await inspect()).ready,false);assert.equal((await inspect()).schemaReady,false);
 }finally{db.close();}
});
test('release rejects a replaced trigger and absent applied migration',async()=>{
 for(const mutation of ["DROP TRIGGER tower_reception_first_claim; CREATE TRIGGER tower_reception_first_claim AFTER INSERT ON accounts BEGIN SELECT 1; END;",'DELETE FROM d1_migrations WHERE id=(SELECT MAX(id) FROM d1_migrations)']){
  const db=fixture();try{db.sqlite.exec(mutation);const response=await runtime.fetch(request({'X-Tower-Operator-Key':key}),{PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:key,DB:db});assert.equal(response.status,200);const result=await response.json();assert.equal(result.ready,false);if(mutation.startsWith('DROP'))assert.equal(result.schemaReady,false);else assert.equal(result.migrationsReady,false);}finally{db.close();}
 }
});
