/* global Response, setTimeout */
// Native D1 transaction-boundary proof. Only time and external Meta/render adapters are synthetic.
// Every product trigger and product state-machine method remains active. No external traffic is permitted.
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';
const runtimeRoot=process.argv[2];if(!runtimeRoot)throw Error('Pass an existing Wrangler node_modules directory; no dependency installation is performed');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(join(resolve(runtimeRoot),'miniflare/dist/src/index.js')).href);
const {build}=await import(pathToFileURL(join(resolve(runtimeRoot),'esbuild/lib/main.js')).href);
const at='2026-10-31T20:00:00.000Z',origin='https://native-theme-guards.example';
const picture=(width,height,red)=>{const p=new PNG({width,height});for(let i=0;i<p.data.length;i+=4){p.data[i]=red;p.data[i+1]=50;p.data[i+2]=70;p.data[i+3]=255;}return PNG.sync.write(p).toString('base64');};
const images=[picture(1600,900,30),picture(1600,900,40)],screen=picture(1280,900,80);
const palette={canvas:'#fffaf0',surface:'#ffffff',surfaceAlt:'#f0e4d1',ink:'#241827',muted:'#4e334f',accent:'#6c263d',onAccent:'#ffffff',border:'#806c80',decor:'#b94d28'};
const manifest={version:1,day:palette,night:palette,layout:{hero:'split',cards:'grid',density:'relaxed'},decoration:{pattern:'web',corners:'arcs',shape:'bevel',weight:2,scale:24,opacity:.07}};
const source=`import {createManagerAutonomy} from './server/live/tower-autonomy.ts';
import {createLobbyTheme} from './server/live/tower-theme.ts';
import {LOBBY_RENDERER_BUILD_HASH} from './src/shared/lobby-base-css.ts';
let images=0,rendererAttempts=0,original=null;
const text=v=>Response.json({id:crypto.randomUUID(),model:'muse-spark-1.3',status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(v)}]}]});
const transport=async(url,init)=>{const p=JSON.parse(init.body);if(String(url).endsWith('/input_tokens'))return Response.json({input_tokens:100});if(String(url).endsWith('/images/edits'))return Response.json({usage:{input_tokens:100,output_tokens:100},data:[{b64_json:${JSON.stringify(images)}[images++]}]});if(p.tools){const theme=p.tools[0].name==='submit_lobby_theme';return Response.json({id:crypto.randomUUID(),model:'muse-spark-1.3',status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'function_call',name:theme?'submit_lobby_theme':'edit_tower_images',call_id:'native-guard-tool',arguments:JSON.stringify(theme?{purpose:'Synthetic native boundary proof',acceptance:['native atomic scope'],manifest:${JSON.stringify(manifest)}}:{dayPrompt:'Synthetic day edit',nightPrompt:'Synthetic night edit'})}]});}if(String(p.instructions).includes('Think independently'))return text({kind:'appearance',purpose:'Original native guard task',acceptance:['original pair'],budgetMicro:Math.max(3500000,JSON.parse(p.input).planningBudget.minimumMicro.appearance),permissions:['read-public-health','edit-exterior-images','activate-reviewed-exterior'],reason:'Synthetic native test only',dayPrompt:'Synthetic day',nightPrompt:'Synthetic night'});if(String(p.instructions).includes('independent TaskAudit'))return text({verdict:'PASS',reason:'Synthetic external adapter'});if(String(p.instructions).includes('tool has returned')||String(p.instructions).includes('requested tool has returned'))return text({received:true});return text({memory:'Synthetic native private memory',nextTasks:[]});};
const nativeClockSQL=sql=>sql.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",'(SELECT instant FROM synthetic_native_clock)').replaceAll("julianday('now')",'julianday((SELECT instant FROM synthetic_native_clock))');
export default {async fetch(request,env){
 const raw=env.DB;const db={prepare(sql){return raw.prepare(nativeClockSQL(sql));},batch(statements){return raw.batch(statements);},exec(sql){return raw.exec(nativeClockSQL(sql));}};
 const now=()=>new Date('${at}');let theme;
 const renderer={ready:async()=>true,async render(input){rendererAttempts++;return fetch('https://renderer.fixture/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,rendererBuildHash:LOBBY_RENDERER_BUILD_HASH})});}};
 const manager=createManagerAutonomy({db,bucket:env.R2,now,apiKey:'synthetic-native-provider',transport,wake:async()=>{},assetFetch:async()=>new Response(new Uint8Array(200))});
 theme=createLobbyTheme({db,bucket:env.R2,now,apiKey:'synthetic-native-provider',transport,renderer});
 const url=new URL(request.url),path=url.pathname;
 if(path==='/seed'){await manager.enable();for(let i=0;i<14;i++)await manager.step();original={cycle:await raw.prepare('SELECT * FROM tower_autonomy_cycles').first(),calls:(await raw.prepare('SELECT * FROM tower_autonomy_calls ORDER BY rowid').all()).results,assets:(await raw.prepare('SELECT * FROM tower_autonomy_assets ORDER BY scene').all()).results};return Response.json({state:original.cycle.state,images});}
 if(path==='/enable')return Response.json(await theme.enable());
 if(path==='/ensure')return Response.json(await theme.ensureDue());
 if(path==='/step')return Response.json(await theme.step());
 if(path==='/claim'){try{const claim=await theme.claimRender(url.searchParams.get('id'));return Response.json({receiptId:claim.receiptId,manifestHash:claim.manifestHash});}catch{return Response.json({rejected:true},{status:409});}}
 if(path==='/disable'){await manager.disable();return Response.json({themePending:await theme.pending(),managerPending:await manager.pending()});}
 return Response.json({original,cycle:await raw.prepare('SELECT * FROM tower_autonomy_cycles').first(),baseCalls:(await raw.prepare("SELECT * FROM tower_autonomy_calls WHERE purpose NOT LIKE 'lobby-theme-v1:%' ORDER BY rowid").all()).results,assets:(await raw.prepare('SELECT * FROM tower_autonomy_assets ORDER BY scene').all()).results,theme:await theme.inspect(),calls:(await raw.prepare('SELECT * FROM tower_autonomy_calls').all()).results,events:(await raw.prepare('SELECT * FROM tower_autonomy_events').all()).results,images,rendererAttempts,clock:await raw.prepare('SELECT instant FROM synthetic_native_clock').first(),mandate:await raw.prepare('SELECT * FROM tower_autonomy_mandate').first()});
}};`;
const bundle=(await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'})).outputFiles[0].text;
const substituteClock=sql=>sql.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')",'(SELECT instant FROM synthetic_native_clock)').replaceAll("julianday('now')",'julianday((SELECT instant FROM synthetic_native_clock))');
async function migrate(db){
 await db.exec('CREATE TABLE synthetic_native_clock(instant TEXT NOT NULL)');await db.prepare('INSERT INTO synthetic_native_clock VALUES(?)').bind(at).run();
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  const sql=await readFile('migrations/'+file,'utf8');const statements=JSON.parse(execFileSync('python3',['-c',"import sys,sqlite3,json\ns='';r=[]\nfor c in sys.stdin.read():\n s+=c\n if c==';' and sqlite3.complete_statement(s):r.append(s);s=''\nif s.strip() and not s.strip().startswith('--'):raise ValueError('Incomplete migration')\nprint(json.dumps(r))"],{input:sql,encoding:'utf8'}));
  await db.batch(statements.map(s=>db.prepare(['0026_tower_manager_autonomy.sql','0027_tower_lobby_theme.sql','0028_tower_theme_zero_dispatch_recovery.sql'].includes(file)?substituteClock(s):s)));
 }
}
const mutations={
 window:"UPDATE synthetic_native_clock SET instant='2026-11-01T07:00:00.010Z';",
 lease:"UPDATE synthetic_native_clock SET instant='2026-10-31T20:06:00.000Z';",
 disabled:'UPDATE tower_autonomy_mandate SET enabled=0 WHERE id=1;',
 budget:'UPDATE tower_autonomy_mandate SET daily_limit_micro=1 WHERE id=1;',
 // A valid original-pair revision change uses all existing base activation guards, not a trigger bypass.
 revision:"UPDATE tower_autonomy_cycles SET state='activate',lease_until='2026-10-31T20:10:00.000Z' WHERE id='manager-2026-10-31'; UPDATE tower_autonomy_current SET revision=revision+1 WHERE id=1;",
};
async function fixture(){
 let waiting;
 const config={modules:true,script:bundle,compatibilityDate:'2026-10-30',d1Databases:['DB'],r2Buckets:['R2'],outboundService:async request=>{assert.equal(request.url,'https://renderer.fixture/render','all other external traffic is forbidden');const input=await request.json();return new Promise(resolve=>{waiting={input,resolve};});}};
 const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config),db=await mf.getD1Database('DB');
 try{await migrate(db);const seeded=await (await mf.dispatchFetch(origin+'/seed')).json();assert.equal(seeded.state,'complete');assert.equal(seeded.images,2);return {mf,db,get waiting(){return waiting;}};}catch(error){await mf.dispose();throw error;}
}
async function report(mf){return (await mf.dispatchFetch(origin+'/inspect')).json();}
function preserved(result){assert.deepEqual(result.cycle,result.original.cycle);assert.deepEqual(result.baseCalls,result.original.calls);assert.deepEqual(result.assets,result.original.assets);assert.equal(result.images,2);assert.equal(result.cycle.budget_micro,3500000);}
async function holdRender(f){
 const render=f.mf.dispatchFetch(origin+'/step');
 for(let i=0;i<100&&!f.waiting;i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.ok(f.waiting,'product render must reach the external adapter after its native reservation');return {render,id:f.waiting.input.receiptId,resolve:f.waiting.resolve,buildHash:f.waiting.input.rendererBuildHash};
}
function finish(held,manifestHash){
 held.resolve(manifestHash?new Response(Uint8Array.from(Buffer.from(screen,'base64')),{headers:{'X-Browser-Ms-Used':'1000','X-Lobby-Renderer-Version':'lobby-theme-v1','X-Lobby-Renderer-Build':held.buildHash,'X-Lobby-Manifest-Hash':manifestHash,'X-Lobby-HTML-Hash':'a'.repeat(64)}}):Response.json({error:'render_claim_denied'},{status:409,headers:{'X-Lobby-Render-Dispatched':'false'}}));
}
async function preservedR2(mf,result){const bucket=await mf.getR2Bucket('R2');for(const asset of result.assets){const object=await bucket.get(asset.object_key);assert(object);assert.equal(object.size,asset.bytes);assert.equal(createHash('sha256').update(new Uint8Array(await object.arrayBuffer())).digest('hex'),asset.sha256);}}
for(const scenario of ['concurrent-claim','window','lease','disabled','budget','revision']){
 const f=await fixture(),{mf,db}=f;let held;
 try{
  assert.equal((await (await mf.dispatchFetch(origin+'/enable')).json()).theme,'due');await mf.dispatchFetch(origin+'/step');
  held=await holdRender(f);
  if(scenario==='concurrent-claim'){
   const claims=await Promise.all([mf.dispatchFetch(origin+'/claim?id='+held.id),mf.dispatchFetch(origin+'/claim?id='+held.id),mf.dispatchFetch(origin+'/claim?id='+held.id)]);assert.equal(claims.filter(r=>r.status===200).length,1,JSON.stringify(claims.map(r=>r.status)));assert.equal(claims.filter(r=>r.status===409).length,2,JSON.stringify(claims.map(r=>r.status)));const accepted=await claims.find(r=>r.status===200).json();
   finish(held,accepted.manifestHash);await held.render;const result=await report(mf);preserved(result);assert.equal(result.events.filter(e=>e.id==='theme-render-dispatch:'+held.id).length,1);assert.equal(result.rendererAttempts,1);assert.equal(result.calls.filter(c=>c.model==='tool:browser-screenshot').length,1);assert.equal(result.calls.find(c=>c.id===held.id).state,'received');assert.equal(result.calls.find(c=>c.id===held.id).actual_micro,25);assert.equal(result.theme.extensions[0].state,'render-1');assert.equal((await mf.dispatchFetch(origin+'/claim?id='+held.id)).status,409);
  }else{
   const before=await report(mf);await db.prepare(`CREATE TRIGGER synthetic_render_race AFTER INSERT ON tower_autonomy_events WHEN NEW.kind='lobby-theme-render-dispatched' BEGIN ${mutations[scenario]} END;`).run();
   assert.equal((await mf.dispatchFetch(origin+'/claim?id='+held.id)).status,409,scenario+' must reject at its final native transaction boundary');
   const after=await report(mf);preserved(after);assert.deepEqual(after.clock,before.clock);assert.deepEqual(after.mandate,before.mandate);assert.equal(after.events.filter(e=>e.id==='theme-render-dispatch:'+held.id).length,0);assert.equal(after.theme.extensions[0].state,'render-0');assert.equal(after.calls.find(c=>c.id===held.id).state,'dispatching');
   finish(held);await held.render;const finished=await report(mf);assert.equal(finished.calls.find(c=>c.id===held.id).state,'rejected');assert.equal(finished.calls.find(c=>c.id===held.id).actual_micro,0);assert.equal(finished.rendererAttempts,1);assert.equal(finished.events.filter(e=>e.kind==='lobby-theme-rendered').length,0);preserved(finished);
  }
  await preservedR2(mf,await report(mf));
  console.log('PASS native renderer '+scenario+': real D1 claim/provenance and rollback, original cycle/receipts/two R2 images/budget preserved');
 }finally{if(held){finish(held);await held.render.catch(()=>{});}await mf.dispose();}
}
for(const scenario of ['window','disabled','budget','revision']){
 const {mf,db}=await fixture();try{
  const before=await report(mf);await db.prepare(`CREATE TRIGGER synthetic_enable_race AFTER INSERT ON tower_autonomy_extensions BEGIN ${mutations[scenario]} END;`).run();
  const enabled=await (await mf.dispatchFetch(origin+'/enable')).json();assert.equal(enabled.theme,'authority_or_budget_blocked',scenario+' must roll back original-task extension authority');
  const after=await report(mf);preserved(after);assert.deepEqual(after.clock,before.clock);assert.deepEqual(after.mandate,before.mandate);assert.equal(after.theme.extensions.length,0);assert.equal(after.events.filter(e=>e.kind==='lobby-theme-mandate-enabled').length,0);assert.equal(after.events.filter(e=>e.kind==='lobby-theme-duty-blocked').length,1);assert.equal(after.rendererAttempts,0);assert.equal(after.calls.length,after.original.calls.length);
  await preservedR2(mf,after);
  console.log('PASS native authority '+scenario+': final guard rolls back extension and its authority receipt; failure audit remains without paid calls');
 }finally{await mf.dispose();}
}
{
 const {mf}=await fixture();try{
  await mf.dispatchFetch(origin+'/enable');const stopped=await (await mf.dispatchFetch(origin+'/disable')).json();assert.deepEqual(stopped,{themePending:false,managerPending:false});await mf.dispatchFetch(origin+'/step');const result=await report(mf);preserved(result);assert.equal(result.theme.extensions[0].state,'plan');assert.equal(result.rendererAttempts,0);assert.equal(result.calls.length,result.original.calls.length);
  await preservedR2(mf,result);
  console.log('PASS native disable: both pending lanes stop, no paid dispatch, no original-account mutation');
 }finally{await mf.dispose();}
}

// 0028 known-zero recovery is tested against real workerd D1, including mutations after its permanent receipt.
for(const scenario of ['concurrent','window','disabled','budget','task-cap','revision','claimed','unknown']){
 const f=await fixture(),{mf,db}=f;let held;
 try{
  await mf.dispatchFetch(origin+'/enable');await mf.dispatchFetch(origin+'/step');held=await holdRender(f);
  if(scenario==='claimed')assert.equal((await mf.dispatchFetch(origin+'/claim?id='+held.id)).status,200);
  if(scenario==='unknown')held.resolve(new Response(null,{status:502,headers:{'X-Lobby-Render-Dispatched':'true'}}));else finish(held);
  await held.render;await mf.dispatchFetch(origin+'/step');const before=await report(mf);assert.equal(before.theme.extensions[0].state,'blocked');
  if(['window','disabled','budget','task-cap','revision'].includes(scenario))await db.prepare(`CREATE TRIGGER synthetic_recovery_race AFTER INSERT ON tower_autonomy_events WHEN NEW.kind='lobby-theme-zero-dispatch-recovery' BEGIN ${scenario==='task-cap'?'UPDATE tower_autonomy_mandate SET task_limit_micro=1 WHERE id=1;':mutations[scenario]} END;`).run();
  const results=await Promise.all([mf.dispatchFetch(origin+'/ensure'),mf.dispatchFetch(origin+'/ensure'),mf.dispatchFetch(origin+'/ensure')]);const values=await Promise.all(results.map(r=>r.json()));const after=await report(mf);preserved(after);assert.deepEqual(after.calls,before.calls,'all previous paid/zero receipts must remain unchanged');assert.equal(after.rendererAttempts,1);await preservedR2(mf,after);
  const receipts=after.events.filter(e=>e.kind==='lobby-theme-zero-dispatch-recovery');
  if(scenario==='concurrent'){assert.equal(values.filter(v=>v.theme==='known-undispatched-resumed').length,1);assert.equal(receipts.length,1);assert.equal(after.theme.extensions[0].state,'render-0');assert.equal(after.theme.extensions[0].step_seq,before.theme.extensions[0].step_seq+1);assert.equal(after.theme.extensions[0].review_json,before.theme.extensions[0].review_json);assert.equal(after.theme.extensions[0].artifact_id,before.theme.extensions[0].artifact_id);assert.equal(after.theme.extensions[0].repair,0);}
  else{assert.equal(receipts.length,0);assert.deepEqual(after.theme.extensions,before.theme.extensions);assert.deepEqual(after.clock,before.clock);assert.deepEqual(after.mandate,before.mandate);}
  console.log('PASS native zero-dispatch recovery '+scenario+': one immutable recovery receipt or full rollback; no new paid call, unchanged original budget/images/memory/receipts');
 }finally{if(held){finish(held);await held.render.catch(()=>{});}await mf.dispose();}
}
