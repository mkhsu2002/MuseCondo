import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LocalDatabase} from '../server/live/local-db.ts';
import {assetStatements} from '../server/live/tower-asset-storage.ts';
import {authorizedTowerAssetResponse} from '../server/live/tower-asset-delivery.ts';
import {acceptsTowerWebP,readTowerWebP,towerDerivativePrefix,TOWER_WEBP_PROFILE} from '../server/live/tower-asset-derivatives.ts';
const room='a'.repeat(16),original=new Uint8Array(4096).fill(7);
const webp=new Uint8Array(Buffer.from('UklGRjQAAABXRUJQVlA4ICgAAACwAQCdASoBAAEAAQAcJYgCdLoABiIAAP7Iv/+A3XxbTL9H5lyc5wAA','base64'));
const digest=async(bytes:Uint8Array)=>Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))).toString('hex');
async function sidecar(){
 const source={digest:await digest(original),size:original.length},prefix=towerDerivativePrefix(room,source.digest);
 const manifest={version:1,profile:TOWER_WEBP_PROFILE,roomId:room,sourceSha256:source.digest,sourceByteLength:source.size,width:1,height:1,contentType:'image/webp',objectKey:prefix+'.webp',sha256:await digest(webp),byteLength:webp.length};
 const data=new Map<string,Uint8Array>([[prefix+'.json',new TextEncoder().encode(JSON.stringify(manifest))],[prefix+'.webp',webp]]),reads:string[]=[];
 const bucket={async get(key:string){reads.push(key);const value=data.get(key);return value?{size:value.length,async arrayBuffer(){return new Uint8Array(value).buffer;}}:null;}};
 return {source,prefix,manifest,data,reads,bucket};
}
test('WebP requires an explicit positive Accept quality',()=>{
 for(const header of ['image/webp','image/avif, image/webp;q=0.8, */*;q=0.5','IMAGE/WEBP;q=1.000'])assert.equal(acceptsTowerWebP(header),true);
 for(const header of [null,'image/png','*/*','image/*','image/webp;q=0','image/webp;q=0.000','image/webp;q=2','image/webp;q=x','image/webp;q=1;q=0'])assert.equal(acceptsTowerWebP(header),false);
});
test('private fixed-profile derivative binds source, output digest, length, format and dimensions',async()=>{
 const f=await sidecar(),result=await readTowerWebP(f.bucket,room,f.source);assert.deepEqual(result?.bytes,webp);assert.equal(result?.digest,f.manifest.sha256);assert.deepEqual(f.reads,[f.prefix+'.json',f.prefix+'.webp']);
});
test('bad optional sidecars are rejected without following manifest-provided keys',async()=>{
 for(const damage of ['profile','source','room','sourceSize','key','sha','size','width','extra','missing','json','container','dimensions','bodySize']){
  const f=await sidecar();let manifest={...f.manifest};
  if(damage==='profile')manifest.profile='unsupported';if(damage==='source')manifest.sourceSha256='b'.repeat(64);if(damage==='room')manifest.roomId='b'.repeat(16);if(damage==='sourceSize')manifest.sourceByteLength++;
  if(damage==='key')manifest.objectKey='private/secrets';if(damage==='sha')manifest.sha256='b'.repeat(64);if(damage==='size')manifest.byteLength++;if(damage==='width')manifest.width++;
  if(damage==='extra')manifest=Object.assign(manifest,{other:'not allowed'});
  f.data.set(f.prefix+'.json',new TextEncoder().encode(JSON.stringify(manifest)));
  if(damage==='missing')f.data.delete(f.prefix+'.webp');if(damage==='json')f.data.set(f.prefix+'.json',new TextEncoder().encode('{'));
  if(['container','dimensions','bodySize'].includes(damage)){
   const broken=new Uint8Array(webp);broken[damage==='container'?8:26]^=1;
   f.data.set(f.prefix+'.webp',broken);manifest.sha256=await digest(broken);
   if(damage==='bodySize')f.data.set(f.prefix+'.webp',new Uint8Array(webp.length+1));
   f.data.set(f.prefix+'.json',new TextEncoder().encode(JSON.stringify(manifest)));
  }
  assert.equal(await readTowerWebP(f.bucket,room,f.source),null,damage);assert.ok(f.reads.every(key=>key.startsWith(f.prefix)));
 }
});
test('unknown or excessive R2 size is rejected before reading its body',async()=>{
 const source={digest:'a'.repeat(64),size:4096};
 for(const size of [undefined,0,4097,Number.NaN]){
  let bodies=0;const bucket={async get(){return {size,async arrayBuffer(){bodies++;throw Error('body must not be read');}};}};
  assert.equal(await readTowerWebP(bucket,room,source),null);assert.equal(bodies,0);
 }
});
test('negotiated WebP uses its own validator; absent or invalid copies safely deliver the verified PNG',async()=>{
 const f=await sidecar(),db=new LocalDatabase(':memory:');try{
  db.sqlite.exec('CREATE TABLE rooms(id TEXT PRIMARY KEY); CREATE TABLE tower_snapshots(room_id TEXT,revision INTEGER,PRIMARY KEY(room_id,revision)); CREATE TABLE tower_asset_chunks(room_id TEXT,revision INTEGER,purpose TEXT,sequence INTEGER,data BLOB,digest TEXT);');
  db.sqlite.prepare('INSERT INTO rooms VALUES(?)').run(room);db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,1)').run(room);db.sqlite.exec(await readFile(new URL('../migrations/0037_tower_asset_storage.sql',import.meta.url),'utf8'));
  await db.batch(await assetStatements(db,room,1,[{purpose:'home',bytes:original,digest:f.source.digest}]));
  const request=(accept:string,etag?:string)=>new Request('https://tower.example/asset',{headers:{Accept:accept,...(etag?{'If-None-Match':etag}:{})}});
  const png=(await authorizedTowerAssetResponse(request('image/webp;q=0'),db,room,1,'home',f.bucket))!;assert.equal(png.headers.get('Content-Type'),'image/png');assert.equal(f.reads.length,0);assert.deepEqual(new Uint8Array(await png.arrayBuffer()),original);
  const optimized=(await authorizedTowerAssetResponse(request('image/webp',png.headers.get('ETag')!),db,room,1,'home',f.bucket))!;assert.equal(optimized.status,200);assert.equal(optimized.headers.get('Content-Type'),'image/webp');assert.equal(optimized.headers.get('Vary'),'Accept');assert.notEqual(optimized.headers.get('ETag'),png.headers.get('ETag'));assert.deepEqual(new Uint8Array(await optimized.arrayBuffer()),webp);
  const cached=(await authorizedTowerAssetResponse(request('image/webp',optimized.headers.get('ETag')!),db,room,1,'home',f.bucket))!;assert.equal(cached.status,304);assert.equal(cached.headers.get('Vary'),'Accept');assert.equal(await cached.text(),'');
  f.data.delete(f.prefix+'.json');const fallback=(await authorizedTowerAssetResponse(request('image/webp'),db,room,1,'home',f.bucket))!;assert.equal(fallback.headers.get('Content-Type'),'image/png');assert.equal(fallback.headers.get('Vary'),'Accept');assert.deepEqual(new Uint8Array(await fallback.arrayBuffer()),original);
 }finally{db.close();}
});
