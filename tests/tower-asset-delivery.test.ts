import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LocalDatabase} from '../server/live/local-db.ts';
import {assetStatements} from '../server/live/tower-asset-storage.ts';
import {authorizedTowerAssetResponse} from '../server/live/tower-asset-delivery.ts';
const room='a'.repeat(16), bytes=new Uint8Array([1,2,3,4]);
async function fixture(){
 const db=new LocalDatabase(':memory:');
 db.sqlite.exec('CREATE TABLE rooms(id TEXT PRIMARY KEY); CREATE TABLE tower_snapshots(room_id TEXT,revision INTEGER,PRIMARY KEY(room_id,revision)); CREATE TABLE tower_asset_chunks(room_id TEXT,revision INTEGER,purpose TEXT,sequence INTEGER,data BLOB,digest TEXT);');
 db.sqlite.prepare('INSERT INTO rooms VALUES(?)').run(room);
 db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,1)').run(room);
 db.sqlite.exec(await readFile(new URL('../migrations/0037_tower_asset_storage.sql',import.meta.url),'utf8'));
 const digest=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 await db.batch(await assetStatements(db,room,1,[{purpose:'home',bytes,digest}]));return db;
}
test('authorized PNG revalidation returns no body or BLOB read; stale validators still verify full bytes',async()=>{
 const db=await fixture();try{
  const initial=(await authorizedTowerAssetResponse(new Request('https://tower.example/asset'),db,room,1,'home'))!;
  assert.equal(initial.status,200);assert.equal(initial.headers.get('Cache-Control'),'private, no-cache, must-revalidate');assert.equal(initial.headers.get('Content-Length'),'4');
  assert.deepEqual(new Uint8Array(await initial.arrayBuffer()),bytes);const etag=initial.headers.get('ETag')!;
  const queries:string[]=[],prepare=db.prepare.bind(db);db.prepare=(sql:string)=>{queries.push(sql);return prepare(sql);};
  for(const value of [etag,'W/'+etag,'"stale", '+etag,'*']){
   const response=(await authorizedTowerAssetResponse(new Request('https://tower.example/asset',{headers:{'If-None-Match':value}}),db,room,1,'home'))!;
   assert.equal(response.status,304);assert.equal(await response.text(),'');assert.equal(response.headers.get('ETag'),etag);
  }
  assert.ok(queries.every(sql=>!/(?:SELECT sequence,)?(?:hex\(data\)|data)(?:,| FROM)/.test(sql)),queries.join('\n'));
  const stale=(await authorizedTowerAssetResponse(new Request('https://tower.example/asset',{headers:{'If-None-Match':etag.slice(0,-2)+'"'}}),db,room,1,'home'))!;
  assert.equal(stale.status,200);assert.deepEqual(new Uint8Array(await stale.arrayBuffer()),bytes);
  const head=(await authorizedTowerAssetResponse(new Request('https://tower.example/asset',{method:'HEAD'}),db,room,1,'home'))!;assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('Content-Length'),'4');
 }finally{db.close();}
});
test('missing or corrupt object metadata never produces a successful conditional response',async()=>{
 const db=await fixture();try{
  const request=new Request('https://tower.example/asset',{headers:{'If-None-Match':'*'}});
  assert.equal(await authorizedTowerAssetResponse(request,db,room,1,'dream'),null);
  db.sqlite.exec('DROP TRIGGER tower_asset_chunk_permanent; DELETE FROM tower_asset_object_chunks;');
  await assert.rejects(authorizedTowerAssetResponse(request,db,room,1,'home'),/tower_asset_corrupt/);
 }finally{db.close();}
});
