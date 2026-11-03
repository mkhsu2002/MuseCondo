import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
const runtime=process.argv[2];
if(!runtime)throw Error('Usage: npm run test:native:assets -- /path/to/runtime/node_modules');
const {build}=await import(pathToFileURL(runtime+'/esbuild/lib/main.js').href);
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(runtime+'/miniflare/dist/src/index.js').href);
const source=`import {assetStatements,cloneAssetStatements,readTowerAsset} from './server/live/tower-asset-storage.ts';
const room='f'.repeat(16), second='e'.repeat(16), at='2026-11-03T00:00:00.000Z';
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
export default {async fetch(request,env){
 const db=env.DB, {size,mode}=await request.json();
 if(mode==='seed'){
  await db.batch([
   db.prepare('INSERT INTO tower_admission_policies VALUES(2,?,0,?)').bind('["*"]',at),db.prepare('UPDATE tower_admission_current SET policy_version=2 WHERE id=1'),
   ...[room,second].flatMap(id=>[
    db.prepare('INSERT INTO accounts(id,login_hash,created_at,test_only) VALUES(?,?,?,1)').bind(id,'synthetic-'+id,at),
    db.prepare('INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at,test_only) VALUES(?,?,?,?,?,?,?,1)').bind(id,id,'Synthetic asset smoke','Synthetic','resident','external-ready',at),
    db.prepare('INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,id,id,'https://synthetic.example/'+id,'owner-attested',at,at),
    ...Array.from({length:12},(_,i)=>db.prepare('INSERT INTO tower_snapshots(room_id,revision,public_json,content_digest,created_at) VALUES(?,?,?,?,?)').bind(id,i+1,'{}','synthetic',at))
   ])]);return Response.json({seeded:true});
 }
 const revision=size===4?1:size===3*1024*1024?2:size===8*1024*1024?3:4;
 const bytes=new Uint8Array(size).fill(255),digest=await sha(bytes);
 if(mode==='store'){
  const statements=await assetStatements(db,room,revision,[{purpose:'home',bytes,digest}]);await db.batch(statements);
  const raw=await db.prepare('SELECT data FROM tower_asset_object_chunks WHERE room_id=? AND digest=? LIMIT 1').bind(room,digest).first();
  const read=await readTowerAsset(db,room,revision,'home');
  if(!read||read.size!==size||read.digest!==digest||read.bytes.some(b=>b!==255))throw Error('native_binary_mismatch');
  return Response.json({mode,size,shape:Array.isArray(raw.data)?'number-array':Object.prototype.toString.call(raw.data),digest});
 }
 if(mode==='dedup'){
  const before=await db.prepare('SELECT count(*) n,sum(length(data)) bytes FROM tower_asset_object_chunks').first();
  await db.batch(await assetStatements(db,room,5,[{purpose:'home',bytes,digest},{purpose:'dream',bytes,digest}]));
  await db.batch(await cloneAssetStatements(db,room,5,6,['home','dream']));
  const after=await db.prepare('SELECT count(*) n,sum(length(data)) bytes FROM tower_asset_object_chunks').first();
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('native_dedup_copied_bytes');
  return Response.json({mode,before,after});
 }
 if(mode==='aggregate'){
  const a=new Uint8Array(6*1024*1024).fill(253),b=new Uint8Array(6*1024*1024).fill(254);
  const statements=await assetStatements(db,room,7,[{purpose:'home',bytes:a,digest:await sha(a)},{purpose:'dream',bytes:b,digest:await sha(b)}]);await db.batch(statements);
  const home=await readTowerAsset(db,room,7,'home'),dream=await readTowerAsset(db,room,7,'dream');
  if(home.size!==a.length||dream.size!==b.length)throw Error('native_large_pair_mismatch');
  return Response.json({mode,bytes:home.size+dream.size,statements:statements.length});
 }
 if(mode==='legacy'){
  await db.prepare('INSERT INTO tower_asset_chunks(room_id,revision,purpose,sequence,data,digest) VALUES(?,1,?,0,?,?)').bind(second,'home',bytes.buffer,digest).run();
  await db.batch(await cloneAssetStatements(db,second,1,2,['home']));await db.batch(await cloneAssetStatements(db,second,2,3,['home']));
  const ref=await db.prepare('SELECT legacy_revision FROM tower_asset_refs WHERE room_id=? AND revision=3').bind(second).first();
  const count=await db.prepare('SELECT count(*) n FROM tower_asset_object_chunks WHERE room_id=?').bind(second).first();
  if(ref.legacy_revision!==1||count.n!==0||(await readTowerAsset(db,second,3,'home')).size!==size)throw Error('native_legacy_anchor_invalid');
  let immutable=false;try{await db.prepare('UPDATE tower_asset_chunks SET data=? WHERE room_id=?').bind(new Uint8Array([9]).buffer,second).run();}catch{immutable=true;}
  if(!immutable)throw Error('native_legacy_mutable');return Response.json({mode,immutable,legacyAnchor:ref.legacy_revision});
 }
 if(mode==='isolation'){
  if(await readTowerAsset(db,second,1,'dream'))throw Error('native_cross_household_leak');
  const foreign=await db.prepare('SELECT digest,size FROM tower_asset_objects WHERE room_id=? LIMIT 1').bind(room).first();
  let rejected=false;try{await db.prepare('INSERT INTO tower_asset_refs VALUES(?,4,?,?,NULL,?,?)').bind(second,'dream',foreign.digest,foreign.digest,foreign.size).run();}catch{rejected=true;}
  if(!rejected)throw Error('native_cross_household_ref');return Response.json({mode,rejected});
 }
 if(mode==='tamper'){
  await db.batch([db.prepare('DROP TRIGGER tower_asset_chunk_immutable'),db.prepare('UPDATE tower_asset_object_chunks SET data=? WHERE room_id=? AND digest=?').bind(new Uint8Array([4,3,2,1]).buffer,room,digest)]);
  let rejected=false;try{await readTowerAsset(db,room,1,'home');}catch{rejected=true;}
  if(!rejected)throw Error('native_corrupt_bytes_served');return Response.json({mode,rejected});
 }
 if(mode==='rollback'){
  const unique=new Uint8Array([45,67,89]);const hash=await sha(unique);let rejected=false;
  try{await db.batch([...(await assetStatements(db,room,8,[{purpose:'home',bytes:unique,digest:hash}])),db.prepare("SELECT json('forced-native-rollback')")]);}catch{rejected=true;}
  const leftover=await db.prepare('SELECT count(*) n FROM tower_asset_objects WHERE room_id=? AND digest=?').bind(room,hash).first();
  if(!rejected||leftover.n)throw Error('native_rollback_failed');return Response.json({mode,rejected,leftover:leftover.n});
 }
 return new Response('unknown',{status:400});
}};`;
const compiled=await build({stdin:{contents:source,resolveDir:root},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
const config={modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-30',d1Databases:['DB'],outboundService:()=>{throw Error('external_network_forbidden');}};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config);
try{
 const db=await mf.getD1Database('DB');
 for(const name of (await readdir(root+'/migrations')).filter(n=>n.endsWith('.sql')).sort()){
  const statements=JSON.parse(execFileSync('python3',['-c',"import sys,sqlite3,json\ns=sys.stdin.read();p='';out=[]\nfor c in s:\n p+=c\n if c==';' and sqlite3.complete_statement(p):out.append(p);p=''\nprint(json.dumps(out))"],{input:await readFile(root+'/migrations/'+name,'utf8'),encoding:'utf8'}));
  await db.batch(statements.map(sql=>db.prepare(sql)));
 }
 for(const data of [{mode:'seed'},{mode:'store',size:4},{mode:'store',size:3*1024*1024},{mode:'store',size:8*1024*1024},{mode:'dedup',size:4},{mode:'aggregate',size:4},{mode:'legacy',size:4},{mode:'rollback',size:4},{mode:'isolation',size:4},{mode:'tamper',size:4}]){
  const response=await mf.dispatchFetch('https://synthetic-assets.example/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const body=await response.text();assert.equal(response.status,200,body.slice(0,500));console.log(body);
 }
 console.log('PASS native D1 immutable asset storage, 8MiB read and 12MiB batch, legacy anchors and rollback; outbound denied');
}finally{await mf.dispose();}
