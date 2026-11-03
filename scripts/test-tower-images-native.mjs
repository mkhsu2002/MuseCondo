/* global setTimeout, Buffer, crypto, Response */
// Actual Pages, native D1/R2 and SQLite Durable Object alarms. Only the platform
// IMAGES encoder is a synthetic stub: this test proves no real codec or billing.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';
const runtime=process.argv[2];if(!runtime)throw Error('Pass existing node_modules containing miniflare and esbuild');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(join(resolve(runtime),'miniflare/dist/src/index.js')).href);
const {build}=await import(pathToFileURL(join(resolve(runtime),'esbuild/lib/main.js')).href);
const compile=async contents=>(await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'})).outputFiles[0].text;
const room='a'.repeat(16),origin='https://synthetic-native-images.example',trigger='synthetic-image-trigger',operator='synthetic-image-operator';
const image=new PNG({width:300,height:300});image.data.fill(160);for(let at=3;at<image.data.length;at+=4)image.data[at]=255;
const png=new Uint8Array(PNG.sync.write(image,{deflateLevel:0,filterType:0}));assert.ok(png.length>256*1024);
// Offline cwebp encoding of the same synthetic gray square; no resident artwork.
const output='UklGRtoAAABXRUJQVlA4IM4AAACQFgCdASosASwBPlEokkcjoqGhICgAcAoJaW7hd2EbQAnsA99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtWAA/v+oEAAAAAAAAAAAAAAAAA==';
const webp=new Uint8Array(Buffer.from(output,'base64'));
const hash=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))).toString('hex');
const pages=await compile(`import real from './server/live/worker.ts';
export default {async fetch(request,env,context){const bucket=env.MANAGER_ASSETS;const observed={put:(...args)=>bucket.put(...args),get:async key=>{await fetch(env.PUBLIC_ORIGIN+'/__synthetic/r2-read',{method:'POST',headers:{'X-Manager-Schedule-Key':env.MANAGER_SCHEDULE_TRIGGER_KEY}});return bucket.get(key);}};return real.fetch(request,{...env,MANAGER_ASSETS:observed},context);}};`);
const clock=await compile(`import real,{ManagerClock as ActualClock} from './workers/tower-manager/worker.ts';
function platform(env){return {input(stream){return {transform(options){if(JSON.stringify(options)!==JSON.stringify({width:1920,height:1920,fit:'scale-down'}))throw Error('native-transform-options');return {async output(options){if(JSON.stringify(options)!==JSON.stringify({format:'image/webp',quality:85,anim:false}))throw Error('native-output-options');const source=new Uint8Array(await new Response(stream).arrayBuffer());if(source.length!==${png.length})throw Error('native-source-bytes');await fetch(env.PUBLIC_ORIGIN+'/__synthetic/encoder-dispatch',{method:'POST',headers:{'X-Manager-Schedule-Key':env.MANAGER_SCHEDULE_TRIGGER_KEY}});if(env.SYNTHETIC_IMAGE_MODE==='unknown')throw Error('synthetic-encoder-unknown');return {response(){return new Response(Uint8Array.from(atob('${output}'),v=>v.charCodeAt(0)),{headers:{'Content-Type':'image/webp'}});}};}};}};}};}
export class ManagerClock extends ActualClock {constructor(state,env){super(state,{...env,IMAGES:platform(env)});}}
export default {...real,fetch(request,env,context){return real.fetch(request,{...env,IMAGES:platform(env)},context);}};`);
const seed=await compile(`import {assetStatements} from './server/live/tower-asset-storage.ts';
export default {async fetch(request,env){const input=await request.json(),room='${room}',at=new Date().toISOString(),bytes=Uint8Array.from(atob(input.png),v=>v.charCodeAt(0));const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
await env.DB.batch([
env.DB.prepare('INSERT INTO accounts(id,login_hash,created_at,test_only) VALUES(?,?,?,1)').bind(room,'synthetic-native-image-hash',at),
env.DB.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES(?,?,'Synthetic image smoke','Synthetic only','resident',1,'external-ready',?,1)").bind(room,room,at),
env.DB.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,public_revision,snapshot_consent,dream_consent,created_at,updated_at) VALUES(?,?,?,'https://synthetic-source.example/condo.json','owner-attested',1,1,0,?,?)").bind(room,room,'native-synthetic-image',at,at),
env.DB.prepare('INSERT INTO tower_snapshots(room_id,revision,public_json,content_digest,created_at) VALUES(?,1,?,?,?)').bind(room,'{}','a'.repeat(64),at)
]);await env.DB.batch(await assetStatements(env.DB,room,1,[{purpose:'home',bytes,digest}]));return Response.json({sourceSha:digest});}};`);
const migrations=[];for(const name of(await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()){
 const statements=JSON.parse(execFileSync('python3',['-c',"import sys,sqlite3,json\ns='';r=[]\nfor c in sys.stdin.read():\n s+=c\n if c==';' and sqlite3.complete_statement(s):r.append(s);s=''\nprint(json.dumps(r))"],{input:await readFile('migrations/'+name,'utf8'),encoding:'utf8'}));migrations.push(...statements);
}
async function scenario(mode){
 let mf,transforms=0,r2Reads=0,claims=0,completions=0,forbidden=0;
 const outbound=async request=>{
  const url=new URL(request.url);if(url.origin!==origin){forbidden++;throw Error('External calls forbidden in native image harness');}
  assert.equal(request.headers.get('X-Manager-Schedule-Key'),trigger);assert.equal(request.headers.get('Authorization'),null);
  if(url.pathname==='/__synthetic/encoder-dispatch'){transforms++;return Response.json({syntheticEncoder:true});}
  if(url.pathname==='/__synthetic/r2-read'){r2Reads++;return Response.json({observed:true});}
  assert.match(url.pathname,/^\/api\/v1\/manager\/images\/(?:claim|[a-f0-9]{64}\/(?:complete|failed))$/);
  if(url.pathname.endsWith('/claim'))claims++;if(url.pathname.endsWith('/complete'))completions++;
  return mf.dispatchFetch(request);
 };
 const config={workers:[
  {name:'pages',modules:true,script:pages,compatibilityDate:'2026-10-30',d1Databases:{DB:'native-images'},r2Buckets:{MANAGER_ASSETS:'native-image-derivatives'},assets:{directory:resolve('public'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},serviceBindings:{MANAGER_RUNTIME:'clock'},bindings:{PUBLIC_ORIGIN:origin,MANAGER_SCHEDULE_TRIGGER_KEY:trigger,TOWER_OPERATOR_KEY:operator,TOWER_IMAGE_OPTIMIZATION_ENABLED:'true',TOWER_IMAGE_DAILY_LIMIT:'8',TOWER_IMAGE_MONTHLY_LIMIT:'100'},outboundService:outbound},
  {name:'clock',modules:true,script:clock,compatibilityDate:'2026-10-30',durableObjects:{MANAGER_CLOCK:{className:'ManagerClock',useSQLite:true}},bindings:{PUBLIC_ORIGIN:origin,MANAGER_SCHEDULE_TRIGGER_KEY:trigger,SYNTHETIC_IMAGE_MODE:mode},outboundService:outbound},
  {name:'seed',modules:true,script:seed,compatibilityDate:'2026-10-30',d1Databases:{DB:'native-images'},outboundService:()=>{throw Error('Seed cannot access network');}},
 ]};
 mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config);
 try{
  const db=await mf.getD1Database('DB','pages');for(const sql of migrations)await db.prepare(sql).run();
  // Ephemeral synthetic admission policy, confined to this isolated database.
  await db.prepare('INSERT INTO tower_admission_policies VALUES(2,?,0,?)').bind('["*"]',new Date().toISOString()).run();
  await db.prepare('UPDATE tower_admission_current SET policy_version=2 WHERE id=1').run();
  const seeded=await(await mf.getWorker('seed')).fetch(origin+'/seed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({png:Buffer.from(png).toString('base64')})});assert.equal(seeded.status,200,await seeded.clone().text());const {sourceSha}=await seeded.json();assert.equal(sourceSha,await hash(png));
  const post=(key=operator)=>mf.dispatchFetch(origin+'/api/v1/operator/images/backfill',{method:'POST',headers:{'Content-Type':'application/json',...(key?{'X-Tower-Operator-Key':key}:{})},body:JSON.stringify({sources:[{kind:'home',id:room+':home'}]})});
  assert.equal((await post('')).status,401);assert.equal((await mf.dispatchFetch(origin+'/api/v1/manager/images/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);assert.equal(transforms,0);
  const response=await post();assert.equal(response.status,200,await response.clone().text());
  const state=async()=>db.prepare('SELECT * FROM tower_image_jobs LIMIT 1').first();
  const deadline=Date.now()+20000;while(Date.now()<deadline&&!['ready','unknown'].includes((await state())?.state))await new Promise(done=>setTimeout(done,50));
  const job=await state();assert.equal(job.state,mode==='unknown'?'unknown':'ready');assert.equal(transforms,1);assert.ok(claims>=1);assert.equal((await db.prepare('SELECT count(*) n FROM tower_image_jobs WHERE reserved_day IS NOT NULL AND reserved_month IS NOT NULL').first()).n,1);
  const events=(await db.prepare('SELECT kind FROM tower_image_events ORDER BY id').all()).results.map(row=>row.kind);assert.deepEqual(events,['pending','running',mode==='unknown'?'unknown':'ready']);
  const bucket=await mf.getR2Bucket('MANAGER_ASSETS','pages'),objects=await bucket.list({prefix:'tower-auto-derivatives/'});assert.equal(objects.objects.length,mode==='unknown'?0:1);
  const imageURL=origin+'/api/v1/tower/assets/'+room+'/1/home.png';
  if(mode!=='unknown'){
   assert.equal(completions,1);assert.equal(job.output_sha,await hash(webp));assert.ok(job.object_key.endsWith('/'+job.output_sha+'.webp'));
   const optimized=await mf.dispatchFetch(imageURL,{headers:{Accept:'image/webp'}});assert.equal(optimized.status,200);assert.equal(optimized.headers.get('Content-Type'),'image/webp');assert.equal(optimized.headers.get('Vary'),'Accept');assert.deepEqual(new Uint8Array(await optimized.arrayBuffer()),webp);
   const pngResponse=await mf.dispatchFetch(imageURL,{headers:{Accept:'image/png'}});assert.equal(pngResponse.status,200);assert.equal(pngResponse.headers.get('Content-Type'),'image/png');assert.equal(await hash(new Uint8Array(await pngResponse.arrayBuffer())),sourceSha);
  }else{
   const fallback=await mf.dispatchFetch(imageURL,{headers:{Accept:'image/webp'}});assert.equal(fallback.status,200);assert.equal(fallback.headers.get('Content-Type'),'image/png');assert.equal(await hash(new Uint8Array(await fallback.arrayBuffer())),sourceSha);
  }
  await post();const worker=await mf.getWorker('clock');const replay=await worker.fetch('https://manager.internal/images/wake',{method:'POST',headers:{'X-Manager-Schedule-Key':trigger}});assert.equal(replay.status,200);await new Promise(done=>setTimeout(done,1400));assert.equal(transforms,1,'Persistent terminal result prevents retransformation');assert.equal((await db.prepare('SELECT count(*) n FROM tower_image_jobs').first()).n,1);assert.deepEqual((await db.prepare('SELECT kind FROM tower_image_events ORDER BY id').all()).results.map(row=>row.kind),events);
  await db.prepare('UPDATE tower_residencies SET snapshot_consent=0,public_revision=NULL WHERE room_id=?').bind(room).run();const before=r2Reads;const withdrawn=await mf.dispatchFetch(imageURL,{headers:{Accept:'image/webp'}});assert.equal(withdrawn.status,404);assert.equal(r2Reads,before,'Withdrawal is enforced before optional private R2 reads');assert.equal(forbidden,0);
  console.log('PASS native image '+mode+': actual protected Pages -> SQLite DO alarm -> synthetic IMAGES encoder -> native R2/D1; one reservation/transform, terminal replay, withdrawal before R2; no external provider calls');
 }finally{await mf.dispose();}
}
await scenario('complete');await scenario('unknown');

async function codecSmokeScenario(){
 const dev='https://framework-v001.musecondo.pages.dev',sourceSHA='5d3983dd12622dd7fb83eb1785f5d3f242a6394d52f688af5423a1773a8e68e1';
 const transparent='UklGRpYAAABXRUJQVlA4WAoAAAAQAAAAAgAAAgAAQUxQSAoAAAAA/4AA/0D///+AVlA4IGYAAACwAgCdASoDAAMAAQAcJbACdEyAf0CpAPIvBr/hx+QA4lF96Tf5Ff/5Ffy+TT77DlD/9XP3f1JtCed51vySc1H6//fvKFf7Y6f1c/ubIqfwM/+9i9CYp39fmKDX9d1/u7BU/oAAAAA=';
 // No D1, household, R2, provider secret or real Images binding is configured here.
 const script=await compile(`import real,{ManagerClock as ActualClock} from './workers/tower-manager/worker.ts';
function platform(){return {input(stream){return {transform(options){if(JSON.stringify(options)!==JSON.stringify({width:1920,height:1920,fit:'scale-down'}))throw Error('synthetic-smoke-options');return {async output(options){if(JSON.stringify(options)!==JSON.stringify({format:'image/webp',quality:85,anim:false}))throw Error('synthetic-smoke-output');const bytes=new Uint8Array(await new Response(stream).arrayBuffer()),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(digest!=='${sourceSHA}')throw Error('synthetic-smoke-source');await fetch('https://synthetic-codec-counter.internal/dispatch',{method:'POST'});return {response(){return new Response(Uint8Array.from(atob('${transparent}'),v=>v.charCodeAt(0)),{headers:{'Content-Type':'image/webp'}});}};}};}};}};}
export class ManagerClock extends ActualClock {constructor(state,env){super(state,{...env,IMAGES:platform()});}}
export default {...real,fetch(request,env,context){return real.fetch(request,{...env,IMAGES:platform()},context);}};`);
 let transforms=0,external=0;const outbound=request=>{if(request.url==='https://synthetic-codec-counter.internal/dispatch'&&request.method==='POST'){transforms++;return Response.json({synthetic:true});}external++;throw Error('Real network forbidden in codec smoke harness');};
 const config={workers:[
  {name:'smoke-clock',modules:true,script,compatibilityDate:'2026-10-30',durableObjects:{MANAGER_CLOCK:{className:'ManagerClock',useSQLite:true}},bindings:{PUBLIC_ORIGIN:dev,MANAGER_SCHEDULE_TRIGGER_KEY:trigger},outboundService:outbound},
  {name:'production-smoke-clock',modules:true,script,compatibilityDate:'2026-10-30',durableObjects:{MANAGER_CLOCK:{className:'ManagerClock',useSQLite:true}},bindings:{PUBLIC_ORIGIN:'https://musetower.neobabylon.app',MANAGER_SCHEDULE_TRIGGER_KEY:trigger},outboundService:outbound},
  // Build the hostile Origin inside a native service call: Miniflare's external
  // HTTP proxy would otherwise reject that header before product code executes.
  {name:'production-probe',modules:true,script:`export default {fetch(request,env){return env.TARGET.fetch(new Request('https://manager.internal/images/smoke',{method:'POST',headers:{'X-Manager-Schedule-Key':'${trigger}',Origin:'${dev}'}}));}};`,compatibilityDate:'2026-10-30',serviceBindings:{TARGET:'production-smoke-clock'},outboundService:outbound},
 ]};
 const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config);
 try{
  const worker=await mf.getWorker('smoke-clock'),request=(allowed=true)=>worker.fetch('https://manager.internal/images/smoke',{method:'POST',headers:allowed?{'X-Manager-Schedule-Key':trigger}:{}});
  assert.equal((await request(false)).status,401);assert.equal(transforms,0);
  const responses=await Promise.all([request(),request(),request()]);for(const response of responses){assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');}
  const receipts=await Promise.all(responses.map(response=>response.json()));assert.ok(receipts.every(receipt=>['complete','unknown'].includes(receipt.state)));const completed=receipts.find(receipt=>receipt.state==='complete');assert.ok(completed);assert.equal(transforms,1);
  assert.equal(completed.profile,'cf-webp-1920-q85-v1');assert.equal(completed.sourceSHA,sourceSHA);assert.equal(completed.grossMicroUsd,500);assert.equal(completed.width,3);assert.equal(completed.height,3);assert.equal(completed.alpha,true);assert.equal(completed.metadataStripped,true);
  const bytes=new Uint8Array(Buffer.from(completed.outputBase64,'base64'));assert.deepEqual(bytes,new Uint8Array(Buffer.from(transparent,'base64')));assert.equal(completed.bytes,bytes.length);assert.ok(bytes.length<=16384);assert.equal(completed.outputSHA,await hash(bytes));
  for(let n=0;n<3;n++){assert.deepEqual(await(await request()).json(),completed);assert.equal(transforms,1,'A permanent native SQLite DO receipt suppresses replay conversion');}
  const production=await mf.getWorker('production-probe'),rejected=await production.fetch('https://native-probe.internal/',{method:'POST'});assert.equal(rejected.status,404);assert.equal(transforms,1);assert.equal(external,0);
  console.log('PASS native dev codec smoke: actual Worker auth + SQLite DO atomic permanent receipt; concurrent/replayed calls dispatch one synthetic transparent codec only; production forged Origin denied; no household/D1/R2 or real network');
 }finally{await mf.dispose();}
}
await codecSmokeScenario();
