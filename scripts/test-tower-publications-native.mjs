/* global Response, setTimeout */
// Real workerd Pages + D1 + R2 + SQLite DO + ASSETS. Every network hop terminates locally.
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';
const runtime=process.argv[2];if(!runtime)throw Error('Pass an existing node_modules directory containing miniflare and esbuild');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(join(resolve(runtime),'miniflare/dist/src/index.js')).href);
const {build}=await import(pathToFileURL(join(resolve(runtime),'esbuild/lib/main.js')).href);
const compile=async entry=>(await build({entryPoints:[entry],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'})).outputFiles[0].text;
const [pages,clock]=await Promise.all([compile('server/live/worker.ts'),compile('workers/tower-manager/worker.ts')]);
const origin='https://synthetic-publications.example',operator='synthetic-native-operator',trigger='synthetic-native-trigger';
const reference=await readFile('public/tower/muse-tower-reference-v1.png'),referenceURL='data:image/png;base64,'+reference.toString('base64');
assert.equal(createHash('sha256').update(reference).digest('hex'),'6f68c848ff2883ef903521f709edc3f4c78356652cbfbd8975b4c285b76f5d96');
const png=new PNG({width:1536,height:1024});for(let p=0;p<png.data.length;p+=4){png.data[p]=225;png.data[p+1]=210;png.data[p+2]=185;png.data[p+3]=255;}const image=PNG.sync.write(png).toString('base64');
const migrations=[];
for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()){
 const statements=JSON.parse(execFileSync('python3',['-c',"import sys,sqlite3,json\ns='';r=[]\nfor c in sys.stdin.read():\n s+=c\n if c==';' and sqlite3.complete_statement(s):r.append(s);s=''\nif s.strip() and not s.strip().startswith('--'):raise ValueError('Incomplete SQL')\nprint(json.dumps(r))"],{input:await readFile('migrations/'+name,'utf8'),encoding:'utf8'}));migrations.push(...statements);
}
async function scenario(unknownImage){
 let mf,db,images=0,paidText=0,counts=0,steps=0;
 const outbound=async request=>{
  const url=new URL(request.url);
  if(url.origin===origin){assert.equal(url.pathname,'/api/v1/manager/publications/step');assert.equal(request.headers.get('X-Manager-Schedule-Key'),trigger);assert.equal(request.headers.get('Authorization'),null);assert.equal(request.headers.get('X-Tower-Operator-Key'),null);steps++;return mf.dispatchFetch(request);}
  assert.equal(url.origin,'https://api.meta.ai','External networking is forbidden; only the synthetic Meta handler exists');
  assert.equal(request.headers.get('Authorization'),'Bearer synthetic-pages-only-provider');
  const body=await request.json();
  if(url.pathname==='/v1/responses/input_tokens'){counts++;return Response.json({input_tokens:100});}
  const purpose=url.pathname==='/v1/images/edits'?'image':body.instructions.includes('independent visual reviewer')?'review':'plan';
  const claim=await db.prepare("SELECT j.*,c.owner_lease,s.lease_until FROM manager_jobs j JOIN tower_scene_calls c ON c.job_id=j.id JOIN tower_scenes s ON s.id=c.scene_id WHERE j.state='running' AND c.purpose=? ORDER BY j.created_at DESC LIMIT 1").bind(purpose).first();
  assert.ok(claim,'Every synthetic paid POST must have a durable native claim');assert.equal(claim.owner_lease,claim.lease_until);assert.ok(claim.lease_until>new Date().toISOString());assert.equal(claim.actual_micro,null);
  if(purpose==='image'){
   images++;assert.equal(body.model,'muse-image-1.0');assert.deepEqual(body.images,[{image_url:referenceURL}]);assert.equal(body.size,'1600x1000');assert.deepEqual(body.tool_enablement,{enable_image_search:false,enable_web_search:false,enable_shell:false});
   if(unknownImage&&images===1)throw Error('Synthetic acknowledgement lost after image dispatch');
   return Response.json({created:Math.floor(Date.now()/1000),usage:{input_tokens:321,output_tokens:45},data:[{b64_json:image}]});
  }
  assert.equal(url.pathname,'/v1/responses');assert.equal(body.model,'muse-spark-1.3');assert.ok(Array.isArray(body.input));assert.ok(body.input[0].content.some(c=>c.type==='input_image'));paidText++;
  const value=purpose==='review'?{pass:true,description:'Synthetic empty stepped ivory Tower test fixture.'}:{sceneKey:JSON.parse(body.input[0].content.find(c=>c.type==='input_text').text).sceneKey,prompt:'Synthetic same-Tower empty corner for native runtime proof.'};
  return Response.json({id:'synthetic-spark-'+paidText,model:'muse-spark-1.3',status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
 };
 const config={workers:[
  {name:'pages',modules:true,script:pages,compatibilityDate:'2026-10-30',d1Databases:{DB:'native-publications'},r2Buckets:{MANAGER_ASSETS:'native-scene-artifacts'},assets:{directory:resolve('public'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},serviceBindings:{MANAGER_RUNTIME:'clock'},bindings:{PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:operator,MANAGER_SCHEDULE_TRIGGER_KEY:trigger,meta_muse_api:'synthetic-pages-only-provider',META_MANAGER_APPROVED:'true',META_MANAGER_BUDGET_MICRO:'10000000',META_MANAGER_DAILY_MICRO:'10000000',META_MANAGER_MONTHLY_MICRO:'10000000',TOWER_SCENES_ENABLED:'true'},outboundService:outbound},
  {name:'clock',modules:true,script:clock,compatibilityDate:'2026-10-30',durableObjects:{MANAGER_CLOCK:{className:'ManagerClock',useSQLite:true}},bindings:{PUBLIC_ORIGIN:origin,MANAGER_SCHEDULE_TRIGGER_KEY:trigger},outboundService:async request=>{assert.equal(new URL(request.url).origin,origin);return outbound(request);}},
 ]};
 mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config);
 try{
  db=await mf.getD1Database('DB','pages');for(const sql of migrations)await db.prepare(sql).run();
  const post=(path,value,key=operator,scheduled=false)=>mf.dispatchFetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',[scheduled?'X-Manager-Schedule-Key':'X-Tower-Operator-Key']:key},body:JSON.stringify(value)});
  const sceneAdmin='/api/v1/operator/tower-scenes',step='/api/v1/manager/publications/step';
  const list=async()=>await(await mf.dispatchFetch(origin+'/api/v1/public/tower-scenes')).json();
  const jobs=async()=>(await db.prepare('SELECT id,state FROM tower_scenes ORDER BY id').all()).results;
  const waitJobs=async count=>{const end=Date.now()+60000;while(Date.now()<end){const rows=await jobs();if(rows.length===count&&rows.every(r=>['reviewed','unknown','invalid','blocked','published'].includes(r.state)))return rows;await new Promise(done=>setTimeout(done,100));}throw Error('Native publication alarm did not settle: '+JSON.stringify(await jobs()));};
  assert.equal((await post(sceneAdmin,{preview:true},'wrong')).status,401);assert.equal(images+paidText+counts,0);
  assert.equal((await post(sceneAdmin,{batch:1})).status,503);assert.equal((await post(sceneAdmin,{style:'approved'})).status,503);assert.deepEqual(await jobs(),[]);
  const unauthorizedStep=await post(step,{id:'seed-v1-01',kind:'scene',sceneKey:'arrival-court',batchId:'initial-v1-1'},'wrong',true);assert.equal(unauthorizedStep.status,401);
  const queued=await post(sceneAdmin,{preview:true});assert.equal(queued.status,202,await queued.clone().text());
  const rows=await waitJobs(3);assert.ok(steps>=3,'Real SQLite DO alarms dispatch all three preview tasks');
  assert.deepEqual(rows.map(r=>r.id),['seed-v1-01','seed-v1-02','seed-v1-05']);assert.equal(images,3);
  if(unknownImage){
   assert.equal(rows.find(r=>r.id==='seed-v1-01').state,'unknown');assert.equal(rows.filter(r=>r.state==='reviewed').length,2);
   const receipt=await db.prepare("SELECT * FROM manager_jobs WHERE id='scene:seed-v1-01:image'").first();assert.equal(receipt.state,'unknown');assert.equal(receipt.actual_micro,null);assert.equal(receipt.reserved_micro,10000);
   const snapshot={images,paidText,counts};assert.equal((await post(step,{id:'seed-v1-01',kind:'scene',sceneKey:'arrival-court',batchId:'initial-v1-1'},trigger,true)).status,200);
   assert.equal((await post(sceneAdmin,{preview:true})).status,202);await new Promise(done=>setTimeout(done,1500));assert.deepEqual({images,paidText,counts},snapshot,'Unknown dispatch and durable DO completion never retry paid generation');
   assert.equal((await post(sceneAdmin,{style:'approved'})).status,503);assert.deepEqual((await list()).scenes,[]);
   console.log('PASS native unknown image keeps its reservation, never re-POSTs through direct step or DO requeue, and cannot pass style approval');return;
  }
  assert.ok(rows.every(r=>r.state==='reviewed'));assert.deepEqual((await list()).scenes,[]);
  for(const id of ['seed-v1-01','seed-v1-02','seed-v1-05']){
   const path=sceneAdmin+'/'+id+'.png';assert.equal((await mf.dispatchFetch(origin+path)).status,401);
   const preview=await mf.dispatchFetch(origin+path,{headers:{'X-Tower-Operator-Key':operator}});assert.equal(preview.status,200,await preview.clone().text());assert.equal(preview.headers.get('Cache-Control'),'no-store');assert.equal(preview.headers.get('X-Robots-Tag'),'noindex, nofollow');
   const bytes=new Uint8Array(await preview.arrayBuffer()),decoded=PNG.sync.read(Buffer.from(bytes));assert.equal(decoded.width,1536);assert.equal(decoded.height,1024);
   const artifact=await db.prepare('SELECT sha256,byte_length FROM tower_scenes WHERE id=?').bind(id).first();assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);assert.equal(bytes.length,artifact.byte_length);
   assert.equal((await mf.dispatchFetch(origin+'/api/v1/tower/scenes/'+id+'.png')).status,404);
  }
  const paidBefore=images+paidText;
  assert.equal((await post(step,{id:'seed-v1-03',kind:'scene',sceneKey:'reading-lounge',batchId:'initial-v1-1'},trigger,true)).status,503);assert.equal(images+paidText,paidBefore);assert.equal((await jobs()).length,3);
  await assert.rejects(db.prepare("UPDATE tower_scenes SET state='published',published_at=? WHERE id='seed-v1-01'").bind(new Date().toISOString()).run(),/scene_style_approval_required/);
  assert.equal((await post(sceneAdmin,{batch:1})).status,503);assert.equal((await post(sceneAdmin,{approve:1})).status,503);assert.equal((await post(sceneAdmin,{batch:2})).status,503);
  console.log('PASS native D1/R2/ASSETS + actual DO: three reviewed previews are operator-only; style gate prevents additional generation and all publication');
  assert.equal((await post(sceneAdmin,{style:'approved'})).status,200);assert.equal((await post(sceneAdmin,{batch:1})).status,202);assert.ok((await waitJobs(5)).every(r=>r.state==='reviewed'));assert.equal(images,5);
  assert.equal((await post(sceneAdmin,{batch:2})).status,503);assert.equal((await post(sceneAdmin,{approve:1})).status,200);assert.equal((await list()).scenes.length,5);
  const publicImage=await mf.dispatchFetch(origin+'/api/v1/tower/scenes/seed-v1-01.png');assert.equal(publicImage.status,200);assert.equal(publicImage.headers.get('Content-Type'),'image/png');assert.equal(PNG.sync.read(Buffer.from(await publicImage.arrayBuffer())).width,1536);
  assert.doesNotMatch(JSON.stringify(await list()),/synthetic-pages-only-provider|prompt|request_sha|owner_lease/);
  console.log('PASS native explicit style approval unlocks only remaining first-batch scenes; manual batch approval publishes five immutable images');
 }finally{await mf.dispose();}
}
await scenario(false);await scenario(true);
console.log('PASS Tower publications native runtime; no provider credentials, no external networking, trigger-only DO and synthetic paid responses');
