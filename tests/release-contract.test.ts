import test from 'node:test';
import assert from 'node:assert/strict';
import {RELEASE_MANIFEST} from '../server/live/generated-release.ts';
import {hashContract,releaseReadiness,protectedAssetReadiness,type ReleaseManifest} from '../server/live/release-contract.ts';
import runtime from '../server/live/worker.ts';
import {LocalDatabase} from '../server/live/local-db.ts';
import {readFileSync,readdirSync} from 'node:fs';
const origin='https://release.example',key='synthetic-release-operator';
const request=(headers:Record<string,string>={})=>new Request(origin+'/api/v1/operator/release',{headers});
test('release authentication rejects wrong keys before any D1 access',async()=>{
 let calls=0;const db={prepare(){calls++;throw Error('must not access D1');},async batch(){calls++;return [];}};
 const response=await runtime.fetch(request({'X-Tower-Operator-Key':'wrong'}),{PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:key,DB:db,ASSETS:{async fetch(){calls++;throw Error('must not access assets');}}});
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
  const complete=await inspect();assert.equal(complete.ready,RELEASE_MANIFEST.buildComplete&&!(RELEASE_MANIFEST as ReleaseManifest).frontendAssets.some(a=>a.path.startsWith('tower-lord/')));assert.equal((await releaseReadiness(db,{...RELEASE_MANIFEST,frontendAssets:[],buildComplete:true})).ready,true);assert.equal(complete.schemaReady,true);assert.equal(complete.migrationsReady,true);assert.match(complete.schemaHash,/^[a-f0-9]{64}$/);assert.ok(JSON.stringify(complete).length<4000);assert.doesNotMatch(JSON.stringify(complete),/CREATE TABLE|login_hash|synthetic-release-operator/);
  db.sqlite.exec('ALTER TABLE accounts ADD COLUMN synthetic_extra TEXT');assert.equal((await inspect()).ready,false);assert.equal((await inspect()).schemaReady,false);
 }finally{db.close();}
});
test('release rejects a replaced trigger and absent applied migration',async()=>{
 for(const mutation of ["DROP TRIGGER tower_reception_first_claim; CREATE TRIGGER tower_reception_first_claim AFTER INSERT ON accounts BEGIN SELECT 1; END;",'DELETE FROM d1_migrations WHERE id=(SELECT MAX(id) FROM d1_migrations)']){
  const db=fixture();try{db.sqlite.exec(mutation);const response=await runtime.fetch(request({'X-Tower-Operator-Key':key}),{PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:key,DB:db});assert.equal(response.status,200);const result=await response.json();assert.equal(result.ready,false);if(mutation.startsWith('DROP'))assert.equal(result.schemaReady,false);else assert.equal(result.migrationsReady,false);}finally{db.close();}
 }
});

test('release verifies protected static bytes through its own binding and fails closed',async()=>{
 const db=fixture();try{
  const bytes='private static script', sha256=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bytes)).then(b=>Buffer.from(b).toString('hex'));
  const frontendAssets=[{path:'tower-lord/console.js',sha256,access:'protected' as const}];
  const manifest={...RELEASE_MANIFEST,buildComplete:true,frontendAssets,frontendHash:await hashContract(frontendAssets)};
  let calls=0;const assets={async fetch(request:Request){calls++;assert.equal(request.url,origin+'/tower-lord/console.js');assert.equal(request.headers.has('X-Tower-Operator-Key'),false);return new Response(bytes);}};
  const good=await releaseReadiness(db,manifest,assets,origin);
  assert.equal(good.ready,true);assert.equal(good.protectedAssetsReady,true);assert.equal(good.protectedAssetsHash,await hashContract(frontendAssets));assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(good),/private static script|tower-lord/);
  for(const binding of [undefined,{async fetch(){return new Response('tampered');}},{async fetch(){return new Response(null,{status:302,headers:{Location:'/login'}});}},{async fetch(){return new Response('missing',{status:404});}}]){
   const bad=await releaseReadiness(db,manifest,binding,origin);assert.equal(bad.ready,false);assert.equal(bad.protectedAssetsReady,false);assert.equal(bad.protectedAssetsHash,null);
  }
 }finally{db.close();}
});

test('protected release bytes enforce a real 2MiB stream cap and cancel unknown or false content lengths',async()=>{
 const manifest={...RELEASE_MANIFEST,frontendAssets:[{path:'tower-lord/console.js',sha256:'0'.repeat(64),access:'protected' as const}]};
 for(const headers of [{} as Record<string,string>,{'Content-Length':'1'}]){
  let cancelled=false,reads=0;
  const assets={async fetch(){return new Response(new ReadableStream<Uint8Array>({pull(controller){reads++;if(reads>5)controller.close();else controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}}),{headers});}};
  const result=await protectedAssetReadiness(manifest,assets,origin);
  assert.equal(result.protectedAssetsReady,false);assert.equal(cancelled,true);assert.ok(reads<=4,'oversized stream must not be consumed to EOF');
 }
});
test('protected release deadline aborts a stalled fetch and cancels a stalled body',async()=>{
 const manifest={...RELEASE_MANIFEST,frontendAssets:[{path:'tower-lord/console.js',sha256:'0'.repeat(64),access:'protected' as const}]};
 for(const phase of ['fetch','body']){
  let supplied:Request|undefined,cancelled=false;
  const assets={async fetch(request:Request){supplied=request;if(phase==='fetch')return new Promise<Response>(()=>{});return new Response(new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel(){cancelled=true;}}));}};
  const started=Date.now();
  let guard:ReturnType<typeof setTimeout>|undefined;
  const pending=protectedAssetReadiness(manifest,assets,origin);
  const result=await Promise.race([pending,new Promise<never>((_,reject)=>{guard=setTimeout(()=>reject(Error('protected_asset_deadline_missing')),6500);})]).finally(()=>clearTimeout(guard));
  assert.equal(result.protectedAssetsReady,false);assert.equal(supplied?.signal.aborted,true,phase+' request must be aborted');assert.ok(Date.now()-started<6000);if(phase==='body')assert.equal(cancelled,true);
 }
});
