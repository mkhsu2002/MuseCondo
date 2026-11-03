import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {assetStatements,cloneAssetStatements} from '../server/live/tower-asset-storage.ts';
import {createTowerImageOptimization} from '../server/live/tower-image-optimization.ts';
const room='a'.repeat(16);
const sha=async(bytes:Uint8Array)=>Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))).toString('hex');
function png(seed=7,width=300,height=300){const image=new PNG({width,height});image.data.fill(seed);return new Uint8Array(PNG.sync.write(image,{deflateLevel:0,filterType:0}));}
function webp(width=300,height=300,seed=0){
 const bytes=new Uint8Array(32),view=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode('RIFF'));view.setUint32(4,24,true);bytes.set(new TextEncoder().encode('WEBPVP8 '),8);view.setUint32(16,12,true);bytes[20]=16;bytes.set([157,1,42],23);view.setUint16(26,width,true);view.setUint16(28,height,true);bytes[30]=seed;return bytes;
}
async function fixture(limits={dailyLimit:64,monthlyLimit:1000}){
 const db=new LocalDatabase(':memory:');let time=new Date('2026-11-03T20:00:00.000Z');
 // Unit tests control SQLite's clock; this does not claim deployed/native timer acceptance.
 db.sqlite.function('strftime',{varargs:true},(...args)=>{assert.equal(args[0],'%Y-%m-%dT%H:%M:%fZ');assert.equal(args[1],'now');assert.ok(args.length===2||args[2]==='+2 minutes');return new Date(time.getTime()+(args[2]?120000:0)).toISOString();});
 db.sqlite.exec('CREATE TABLE rooms(id TEXT PRIMARY KEY); CREATE TABLE tower_snapshots(room_id TEXT,revision INTEGER,PRIMARY KEY(room_id,revision)); CREATE TABLE tower_asset_chunks(room_id TEXT,revision INTEGER,purpose TEXT,sequence INTEGER,data BLOB,digest TEXT); CREATE TABLE tower_residencies(room_id TEXT PRIMARY KEY,public_revision INTEGER,dream_consent INTEGER,snapshot_consent INTEGER); CREATE TABLE tower_scenes(id TEXT PRIMARY KEY,state TEXT,object_key TEXT,sha256 TEXT,byte_length INTEGER,width INTEGER,height INTEGER);');
 for(const file of ['0037_tower_asset_storage.sql','0043_tower_image_optimization.sql'])db.sqlite.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const objects=new Map<string,Uint8Array>();let puts=0,gets=0,wakes=0;
 const bucket={async put(key:string,bytes:Uint8Array){puts++;objects.set(key,new Uint8Array(bytes));},async get(key:string){gets++;const bytes=objects.get(key);return bytes?{size:bytes.length,async arrayBuffer(){return new Uint8Array(bytes).buffer;}}:null;}};
 const service=createTowerImageOptimization({db,bucket,enabled:true,...limits,wake:async()=>{wakes++;}});
 async function home(id=room,seed=7,publicHome=true){
  db.sqlite.prepare('INSERT INTO rooms VALUES(?)').run(id);db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,1)').run(id);db.sqlite.prepare('INSERT INTO tower_residencies VALUES(?,1,1,?)').run(id,publicHome?1:0);
  const bytes=png(seed),digest=await sha(bytes);assert.ok(bytes.length>256*1024);await db.batch(await assetStatements(db,id,1,[{purpose:'home',bytes,digest},{purpose:'dream',bytes,digest}]));return {id,digest,bytes};
 }
 async function republish(id=room){
  db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,2)').run(id);
  await db.batch(await cloneAssetStatements(db,id,1,2,['home','dream']));
  db.sqlite.prepare('UPDATE tower_residencies SET public_revision=2,snapshot_consent=1,dream_consent=1 WHERE room_id=?').run(id);
 }
 const job=(id:string)=>db.sqlite.prepare('SELECT * FROM tower_image_jobs WHERE id=?').get(id)!;
 return {db,service,bucket,objects,home,republish,job,get puts(){return puts;},get gets(){return gets;},get wakes(){return wakes;},advance(ms:number){time=new Date(time.getTime()+ms);},close(){db.close();}};
}
test('public source enqueue is permanently deduplicated with one creation audit and wake',async()=>{
 const f=await fixture();try{await f.home();const first=await f.service.enqueue('home',room+':home');assert.ok(first);for(let n=0;n<4;n++)assert.equal((await f.service.enqueue('home',room+':home'))!.id,first.id);assert.equal(f.wakes,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_events').get()!.n,1);assert.equal(f.job(first.id).state,'pending');}finally{f.close();}
});
test('private homes and unshared dreams never enqueue or wake; backfill has a six-item bound',async()=>{
 const f=await fixture();try{await f.home(room,7,false);assert.equal(await f.service.enqueue('home',room+':home'),null);assert.equal(await f.service.enqueue('home',room+':dream'),null);f.db.sqlite.prepare('UPDATE tower_residencies SET snapshot_consent=1,dream_consent=0').run();assert.equal(await f.service.enqueue('home',room+':dream'),null);assert.equal(f.wakes,0);await assert.rejects(f.service.backfill(Array.from({length:7},()=>({kind:'home' as const,id:room+':home'}))),/image_batch_limit/);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs').get()!.n,0);}finally{f.close();}
});
test('claim races reserve one job once; complete persists an immutable readable result and replay writes nothing',async()=>{
 const f=await fixture();try{const home=await f.home();const pending=(await f.service.enqueue('home',room+':home'))!;const claims=await Promise.all(Array.from({length:4},()=>f.service.claim()));const actual=claims.filter(value=>value!==null);assert.equal(actual.length,1);const claimed=actual[0]!;assert.equal(claimed.id,pending.id);assert.equal(f.job(claimed.id).state,'running');assert.equal(await f.service.complete(claimed.id,claimed.lease,webp()),true);const puts=f.puts,events=f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_events').get()!.n;assert.equal(await f.service.complete(claimed.id,claimed.lease,webp()),true);assert.equal(f.puts,puts);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_events').get()!.n,events);assert.equal(f.job(claimed.id).state,'ready');assert.deepEqual((await f.service.image('home',room+':home',home.digest))!.bytes,webp());assert.deepEqual(f.db.sqlite.prepare('SELECT kind FROM tower_image_events ORDER BY id').all().map(row=>row.kind),['pending','running','ready']);}finally{f.close();}
});
test('competing completions cannot overwrite the winning immutable output object',async()=>{
 const f=await fixture();try{const home=await f.home();await f.service.enqueue('home',room+':home');const claimed=(await f.service.claim())!;const outcomes=await Promise.all([f.service.complete(claimed.id,claimed.lease,webp()),f.service.complete(claimed.id,claimed.lease,webp(300,300,1))]);assert.equal(outcomes.filter(Boolean).length,1);const saved=f.job(claimed.id);assert.equal(saved.state,'ready');const image=(await f.service.image('home',room+':home',home.digest))!;assert.ok(image);assert.equal(await sha(image.bytes),saved.output_sha);assert.equal(f.objects.size,2);assert.ok(String(saved.object_key).endsWith('/'+saved.output_sha+'.webp'));}finally{f.close();}
});
test('daily and monthly reservation caps apply atomically even with concurrent claims',async()=>{
 for(const limits of [{dailyLimit:1,monthlyLimit:1000},{dailyLimit:64,monthlyLimit:1}]){
  const f=await fixture(limits);try{for(const [id,seed] of [[room,7],['b'.repeat(16),8],['c'.repeat(16),9]] as const){await f.home(id,seed);await f.service.enqueue('home',id+':home');}const claims=await Promise.all(Array.from({length:5},()=>f.service.claim()));assert.equal(claims.filter(value=>value!==null).length,1);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_image_jobs WHERE state='running'").get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs WHERE claimed_at IS NOT NULL').get()!.n,1);assert.equal(await f.service.claim(),null);}finally{f.close();}
 }
});
test('lower current limits constrain old pending jobs without rewriting their original quota snapshots',async()=>{
 for(const limits of [{dailyLimit:1,monthlyLimit:1000},{dailyLimit:64,monthlyLimit:1}]){
  const f=await fixture();try{
   await f.home(room,7);await f.home('b'.repeat(16),8);await f.service.enqueue('home',room+':home');await f.service.enqueue('home','b'.repeat(16)+':home');
   const first=(await f.service.claim())!;assert.equal(await f.service.failed(first.id,first.lease,'transform_rejected'),true);
   const pending=f.db.sqlite.prepare("SELECT id,daily_limit,monthly_limit FROM tower_image_jobs WHERE state='pending'").get()!;assert.equal(pending.daily_limit,64);assert.equal(pending.monthly_limit,1000);
   const lowered=createTowerImageOptimization({db:f.db,bucket:f.bucket,enabled:true,...limits,wake:async()=>{}});assert.equal(await lowered.claim(),null);
   assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs WHERE claimed_at IS NOT NULL').get()!.n,1);assert.equal(f.job(String(pending.id)).state,'pending');assert.equal(f.job(String(pending.id)).daily_limit,64);assert.equal(f.job(String(pending.id)).monthly_limit,1000);
  }finally{f.close();}
 }
});
test('withdrawal between claim and complete cancels output; withdrawn ready images never touch R2',async()=>{
 const f=await fixture();try{const home=await f.home();await f.service.enqueue('home',room+':home');const claimed=(await f.service.claim())!;f.db.sqlite.prepare('UPDATE tower_residencies SET snapshot_consent=0').run();assert.equal(await f.service.complete(claimed.id,claimed.lease,webp()),false);assert.equal(f.job(claimed.id).state,'cancelled');assert.equal(f.puts,0);assert.equal(await f.service.image('home',room+':home',home.digest),null);assert.equal(f.gets,0);}finally{f.close();}
 const ready=await fixture();try{const home=await ready.home();await ready.service.enqueue('home',room+':home');const claimed=(await ready.service.claim())!;assert.equal(await ready.service.complete(claimed.id,claimed.lease,webp()),true);const reads=ready.gets;ready.db.sqlite.prepare('UPDATE tower_residencies SET dream_consent=0,snapshot_consent=0').run();assert.equal(await ready.service.image('home',room+':home',home.digest),null);assert.equal(ready.gets,reads);}finally{ready.close();}
});
test('withdrawal while uploading an output prevents publication in the final atomic guard',async()=>{
 const f=await fixture();try{const home=await f.home();await f.service.enqueue('home',room+':home');const claimed=(await f.service.claim())!,put=f.bucket.put.bind(f.bucket);f.bucket.put=async(key,bytes)=>{await put(key,bytes);f.db.sqlite.prepare('UPDATE tower_residencies SET snapshot_consent=0').run();};assert.equal(await f.service.complete(claimed.id,claimed.lease,webp()),false);assert.equal(f.job(claimed.id).state,'cancelled');const reads=f.gets;assert.equal(await f.service.image('home',room+':home',home.digest),null);assert.equal(f.gets,reads);}finally{f.close();}
});
test('ready output is reused after fresh regrant and same-image republication without another job or transform',async()=>{
 const f=await fixture();try{
  const home=await f.home(),original=(await f.service.enqueue('home',room+':home'))!,claimed=(await f.service.claim())!;
  assert.equal(await f.service.complete(claimed.id,claimed.lease,webp()),true);const puts=f.puts,wakes=f.wakes;
  f.db.sqlite.prepare('UPDATE tower_residencies SET snapshot_consent=0,public_revision=NULL').run();const reads=f.gets;assert.equal(await f.service.image('home',room+':home',home.digest),null);assert.equal(f.gets,reads);
  f.db.sqlite.prepare('UPDATE tower_residencies SET snapshot_consent=1,public_revision=1').run();assert.equal((await f.service.enqueue('home',room+':home'))!.id,original.id);assert.deepEqual((await f.service.image('home',room+':home',home.digest))!.bytes,webp());
  await f.republish();assert.equal((await f.service.enqueue('home',room+':home'))!.id,original.id);assert.deepEqual((await f.service.image('home',room+':home',home.digest))!.bytes,webp());assert.equal(f.job(original.id).source_epoch,'[1,null]');
  assert.equal(await f.service.claim(),null);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs WHERE claimed_at IS NOT NULL').get()!.n,1);assert.equal(f.puts,puts);assert.equal(f.wakes,wakes);
 }finally{f.close();}
});
test('cancelled old publication epochs do not strand a new legal publication of the same PNG',async()=>{
 for(const phase of ['pending','running']){
  const f=await fixture();try{
   await f.home();const original=(await f.service.enqueue('home',room+':home'))!,oldClaim=phase==='running'?(await f.service.claim())!:null;
   f.db.sqlite.prepare('UPDATE tower_residencies SET snapshot_consent=0,public_revision=NULL').run();
   if(oldClaim)assert.equal(await f.service.complete(oldClaim.id,oldClaim.lease,webp()),false);else assert.equal(await f.service.claim(),null);
   assert.equal(f.job(original.id).state,'cancelled');assert.equal(f.puts,0);await f.republish();
   const replacement=(await f.service.enqueue('home',room+':home'))!;assert.notEqual(replacement.id,original.id);assert.equal(replacement.source_sha,original.source_sha);assert.equal(f.job(replacement.id).source_epoch,'[2,null]');assert.equal(f.wakes,2);
   const newClaim=(await f.service.claim())!;assert.equal(newClaim.id,replacement.id);
   if(oldClaim){assert.equal(await f.service.complete(oldClaim.id,oldClaim.lease,webp()),false);assert.equal(await f.service.complete(newClaim.id,oldClaim.lease,webp()),false);assert.equal(f.puts,0);}
   assert.equal(await f.service.complete(newClaim.id,newClaim.lease,webp()),true);assert.equal(f.job(original.id).state,'cancelled');assert.equal(f.job(replacement.id).state,'ready');assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs').get()!.n,2);
  }finally{f.close();}
 }
});
test('an unknown paid outcome suppresses retransformation across new publication epochs with the same SHA',async()=>{
 const f=await fixture();try{
  const home=await f.home(),original=(await f.service.enqueue('home',room+':home'))!,claimed=(await f.service.claim())!;
  assert.equal(await f.service.failed(claimed.id,claimed.lease,'transform_unknown'),true);const wakes=f.wakes;
  f.db.sqlite.prepare('UPDATE tower_residencies SET snapshot_consent=0,public_revision=NULL').run();assert.equal(await f.service.enqueue('home',room+':home'),null);await f.republish();
  const result=(await f.service.enqueue('home',room+':home'))!;assert.equal(result.id,original.id);assert.equal(result.state,'unknown');assert.equal(f.job(original.id).source_epoch,'[1,null]');assert.equal(await f.service.claim(),null);assert.equal(await f.service.complete(claimed.id,claimed.lease,webp()),false);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs WHERE claimed_at IS NOT NULL').get()!.n,1);assert.equal(f.wakes,wakes);assert.equal(f.puts,0);const reads=f.gets;assert.equal(await f.service.image('home',room+':home',home.digest),null);assert.equal(f.gets,reads);
 }finally{f.close();}
});
test('a queued new epoch cannot claim while an older identical source runs or becomes unknown',async()=>{
 const f=await fixture();try{
  await f.home();const old=(await f.service.enqueue('home',room+':home'))!,claimed=(await f.service.claim())!;
  await f.republish();const next=(await f.service.enqueue('home',room+':home'))!;assert.notEqual(next.id,old.id);assert.equal(next.state,'pending');
  const bypass=f.db.sqlite.prepare("UPDATE tower_image_jobs SET state='running',claimed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),reserved_day=substr(strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,10),reserved_month=substr(strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,7),lease_token=?,lease_until=strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 minutes'),source_width=300,source_height=300 WHERE id=?");
  assert.throws(()=>bypass.run('e'.repeat(32),next.id),/tower-image-quota-or-clock/);
  assert.equal(await f.service.claim(),null);assert.equal(f.job(next.id).state,'pending');assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs WHERE claimed_at IS NOT NULL').get()!.n,1);
  assert.equal(await f.service.failed(claimed.id,claimed.lease,'transform_unknown'),true);assert.throws(()=>bypass.run('e'.repeat(32),next.id),/tower-image-quota-or-clock/);assert.equal(await f.service.claim(),null);assert.equal(f.job(old.id).state,'unknown');assert.equal(f.job(next.id).state,'cancelled');assert.equal(f.job(next.id).error_code,'prior_outcome_unknown');
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_image_jobs WHERE claimed_at IS NOT NULL').get()!.n,1);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_image_events WHERE kind='running'").get()!.n,1);assert.equal(f.puts,0);
 }finally{f.close();}
});
test('published Tower scenes use the same durable pipeline while private scenes cannot enter',async()=>{
 const f=await fixture();try{
  const bytes=png(5,1200,750),digest=await sha(bytes),id='scene-synthetic',key='tower-scenes/'+id+'.png';f.objects.set(key,bytes);
  f.db.sqlite.prepare('INSERT INTO tower_scenes VALUES(?,?,?,?,?,?,?)').run(id,'reviewed',key,digest,bytes.length,1200,750);assert.equal(await f.service.enqueue('scene',id),null);assert.equal(f.gets,0);
  f.db.sqlite.prepare("UPDATE tower_scenes SET state='published' WHERE id=?").run(id);assert.ok(await f.service.enqueue('scene',id));const claimed=(await f.service.claim())!;assert.equal(claimed.sourceSha,digest);assert.equal(await f.service.complete(claimed.id,claimed.lease,webp(1200,750)),true);assert.deepEqual((await f.service.image('scene',id,digest))!.bytes,webp(1200,750));const reads=f.gets;
  f.db.sqlite.prepare("UPDATE tower_scenes SET state='reviewed' WHERE id=?").run(id);assert.equal(await f.service.image('scene',id,digest),null);assert.equal(f.gets,reads);
 }finally{f.close();}
});
test('only a currently active appearance can enqueue or serve a private display derivative',async()=>{
 const f=await fixture();try{
  const generation='manager-2026-11-03-r0',sourceId=generation+':day',bytes=png(),digest=await sha(bytes);
  f.db.sqlite.exec('CREATE TABLE tower_autonomy_current(id INTEGER PRIMARY KEY,generation_id TEXT,revision INTEGER,starts_at TEXT,ends_at TEXT); CREATE TABLE tower_autonomy_assets(generation_id TEXT,scene TEXT,sha256 TEXT,bytes INTEGER,object_key TEXT);');
  f.db.sqlite.prepare('INSERT INTO tower_autonomy_current VALUES(1,?,1,?,?)').run(generation,'2026-11-03T19:00:00.000Z','2026-11-03T21:00:00.000Z');
  f.db.sqlite.prepare('INSERT INTO tower_autonomy_assets VALUES(?,?,?,?,?)').run(generation,'day',digest,bytes.length,'synthetic-original-appearance.png');
  type Appearance=NonNullable<Parameters<typeof createTowerImageOptimization>[0]['appearance']>;
  type State=Awaited<ReturnType<Appearance['publicState']>>;
  let active:State=null,wakes=0;
  const appearance:Appearance={async publicState(){return active&&active.endsAt>'2026-11-03T20:00:00.000Z'?active:null;},async asset(){return bytes;}};
  const service=createTowerImageOptimization({db:f.db,bucket:f.bucket,enabled:true,dailyLimit:64,monthlyLimit:1000,wake:async()=>{wakes++;},appearance});
  assert.equal(await service.enqueue('appearance',sourceId),null);assert.equal(await service.image('appearance',sourceId,digest),null);assert.equal(wakes,0);assert.equal(f.gets,0);
  active={theme:'halloween',generation,revision:1,endsAt:'2026-11-03T21:00:00.000Z',images:{day:'/synthetic/day.png',night:'/synthetic/night.png'}};
  assert.ok(await service.enqueue('appearance',sourceId));const claimed=(await service.claim())!;assert.equal(await service.complete(claimed.id,claimed.lease,webp()),true);assert.deepEqual((await service.image('appearance',sourceId,digest))!.bytes,webp());
  const reads=f.gets;active=null;assert.equal(await service.image('appearance',sourceId,digest),null);assert.equal(f.gets,reads);
  active={theme:'halloween',generation,revision:1,endsAt:'2026-11-03T19:30:00.000Z',images:{day:'/synthetic/day.png',night:'/synthetic/night.png'}};
  f.db.sqlite.prepare('UPDATE tower_autonomy_current SET ends_at=? WHERE id=1').run(active.endsAt);assert.equal(await service.image('appearance',sourceId,digest),null);assert.equal(f.gets,reads);
 }finally{f.close();}
});
test('appearance revision change invalidates a previously claimed lease before output is stored',async()=>{
 const f=await fixture();try{
  const generation='manager-2026-11-03-r0',sourceId=generation+':day',bytes=png(),digest=await sha(bytes);
  f.db.sqlite.exec('CREATE TABLE tower_autonomy_current(id INTEGER PRIMARY KEY,generation_id TEXT,revision INTEGER,starts_at TEXT,ends_at TEXT); CREATE TABLE tower_autonomy_assets(generation_id TEXT,scene TEXT,sha256 TEXT,bytes INTEGER,object_key TEXT);');
  f.db.sqlite.prepare('INSERT INTO tower_autonomy_current VALUES(1,?,1,?,?)').run(generation,'2026-11-03T19:00:00.000Z','2026-11-03T21:00:00.000Z');
  f.db.sqlite.prepare('INSERT INTO tower_autonomy_assets VALUES(?,?,?,?,?)').run(generation,'day',digest,bytes.length,'synthetic-original-appearance.png');
  let revision=1;const service=createTowerImageOptimization({db:f.db,bucket:f.bucket,enabled:true,dailyLimit:64,monthlyLimit:1000,wake:async()=>{},appearance:{async publicState(){return {theme:'halloween',generation,revision,endsAt:'2026-11-03T21:00:00.000Z',images:{day:'/synthetic/day.png',night:'/synthetic/night.png'}};},async asset(){return bytes;}}});
  const queued=(await service.enqueue('appearance',sourceId))!;assert.equal(f.job(queued.id).source_epoch,'[1,null]');const claimed=(await service.claim())!;revision=2;f.db.sqlite.prepare('UPDATE tower_autonomy_current SET revision=2 WHERE id=1').run();assert.equal(await service.complete(claimed.id,claimed.lease,webp()),false);assert.equal(f.job(claimed.id).state,'cancelled');assert.equal(f.puts,0);assert.equal(f.gets,0);
 }finally{f.close();}
});
test('invalid output cannot become ready and corrupt stored output is never served',async()=>{
 const f=await fixture();try{const home=await f.home();await f.service.enqueue('home',room+':home');const claimed=(await f.service.claim())!;await assert.rejects(f.service.complete(claimed.id,claimed.lease,new Uint8Array([1,2,3])),/image_output_invalid/);assert.equal(f.job(claimed.id).state,'running');assert.equal(f.puts,0);assert.equal(await f.service.complete(claimed.id,claimed.lease,webp(299,290)),false);assert.equal(f.job(claimed.id).state,'rejected');assert.equal(await f.service.image('home',room+':home',home.digest),null);}finally{f.close();}
 const corrupt=await fixture();try{const home=await corrupt.home();await corrupt.service.enqueue('home',room+':home');const claimed=(await corrupt.service.claim())!;assert.equal(await corrupt.service.complete(claimed.id,claimed.lease,webp()),true);const key=String(corrupt.job(claimed.id).object_key);corrupt.objects.set(key,webp(300,300,1));assert.equal(await corrupt.service.image('home',room+':home',home.digest),null);}finally{corrupt.close();}
});
test('unknown and expired reservations remain permanent and are never blindly reclaimed',async()=>{
 const f=await fixture();try{await f.home();await f.service.enqueue('home',room+':home');const claimed=(await f.service.claim())!;assert.equal(await f.service.failed(claimed.id,claimed.lease,'transform_unknown'),true);assert.equal(f.job(claimed.id).state,'unknown');assert.equal(await f.service.claim(),null);assert.equal(await f.service.complete(claimed.id,claimed.lease,webp()),false);assert.throws(()=>f.db.sqlite.prepare("UPDATE tower_image_jobs SET state='pending' WHERE id=?").run(claimed.id),/tower-image-terminal/);assert.equal((await f.service.enqueue('home',room+':home'))!.state,'unknown');assert.equal(f.wakes,1);}finally{f.close();}
 const expired=await fixture();try{await expired.home();await expired.service.enqueue('home',room+':home');const claimed=(await expired.service.claim())!;expired.advance(120001);assert.equal(await expired.service.claim(),null);assert.equal(expired.job(claimed.id).state,'unknown');assert.equal(expired.job(claimed.id).error_code,'lease_expired_unknown');assert.equal(await expired.service.complete(claimed.id,claimed.lease,webp()),false);assert.equal(expired.puts,0);}finally{expired.close();}
});
test('SQLite guards preserve binding, reservation, job and append-only audit history',async()=>{
 const f=await fixture();try{await f.home();const job=(await f.service.enqueue('home',room+':home'))!;
  assert.throws(()=>f.db.sqlite.prepare("UPDATE tower_image_jobs SET source_sha=? WHERE id=?").run('b'.repeat(64),job.id),/tower-image-binding/);
  assert.throws(()=>f.db.sqlite.prepare('INSERT OR REPLACE INTO tower_image_jobs SELECT * FROM tower_image_jobs WHERE id=?').run(job.id),/tower-image-initial-state/);
  assert.throws(()=>f.db.sqlite.prepare('DELETE FROM tower_image_jobs WHERE id=?').run(job.id),/tower-image-permanent/);
  assert.throws(()=>f.db.sqlite.prepare("UPDATE tower_image_events SET kind='changed'").run(),/tower-image-audit-immutable/);
  assert.throws(()=>f.db.sqlite.prepare('DELETE FROM tower_image_events').run(),/tower-image-audit-permanent/);
  assert.throws(()=>f.db.sqlite.prepare('INSERT OR REPLACE INTO tower_image_events SELECT * FROM tower_image_events').run(),/tower-image-audit-replace/);
  const claimed=(await f.service.claim())!;assert.throws(()=>f.db.sqlite.prepare("UPDATE tower_image_jobs SET state='unknown',lease_token=? WHERE id=?").run('c'.repeat(32),claimed.id),/tower-image-reservation-immutable/);
 }finally{f.close();}
});
test('event recovery wakes at most once per SQLite day, with durable audit',async()=>{
 const f=await fixture();try{await f.home();await f.service.enqueue('home',room+':home');assert.equal(f.wakes,1);await Promise.all([f.service.recover(),f.service.recover(),f.service.recover()]);assert.equal(f.wakes,2);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_image_events WHERE kind='recovery-wake'").get()!.n,1);f.advance(86400000);await f.service.recover();await f.service.recover();assert.equal(f.wakes,3);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_image_events WHERE kind='recovery-wake'").get()!.n,2);}finally{f.close();}
});
