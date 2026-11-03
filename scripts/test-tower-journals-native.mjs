/* global setTimeout */
// Actual Pages, D1/SQLite and private Manager DO. No production clocks or provider credentials are substituted.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {managerLocalDay} from '../server/live/tower-calendar.ts';
const runtime=process.argv[2];if(!runtime)throw Error('Pass an existing node_modules directory containing miniflare and esbuild');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(join(resolve(runtime),'miniflare/dist/src/index.js')).href);
const {build}=await import(pathToFileURL(join(resolve(runtime),'esbuild/lib/main.js')).href);
const compile=async entry=>(await build({entryPoints:[entry],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'})).outputFiles[0].text;
const [pages,clock]=await Promise.all([compile('server/live/worker.ts'),compile('workers/tower-manager/worker.ts')]);
// An isolated native harness changes a grant between source read and the real D1 atomic batch.
// Production Pages/Manager bundles above are compiled without hooks or clock substitutions.
const race=(await build({stdin:{contents:`import {createTowerDailyJournals} from './server/live/tower-daily-journals.ts';
export default {async fetch(request,env){const db={prepare:sql=>env.DB.prepare(sql),batch:async statements=>{await env.DB.prepare('UPDATE tower_residencies SET announcement_consent=0').run();return env.DB.batch(statements);}};try{await createTowerDailyJournals({db,origin:'https://synthetic-daily-journals.example',enabled:true}).runDue();return Response.json({rejected:false});}catch{return Response.json({rejected:true});}}};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'})).outputFiles[0].text;
const migrations=[];
for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()){
 const statements=JSON.parse(execFileSync('python3',['-c',"import sys,sqlite3,json\ns='';r=[]\nfor c in sys.stdin.read():\n s+=c\n if c==';' and sqlite3.complete_statement(s):r.append(s);s=''\nif s.strip() and not s.strip().startswith('--'):raise ValueError('Incomplete SQL')\nprint(json.dumps(r))"],{input:await readFile('migrations/'+name,'utf8'),encoding:'utf8'}));migrations.push(...statements);
}
const origin='https://synthetic-daily-journals.example',trigger='synthetic-daily-trigger';
async function scenario(empty=false){
 let mf,db,providerCalls=0,steps=0,schedules=0;
 const outbound=async request=>{
  const url=new URL(request.url);
  if(url.origin!==origin){providerCalls++;throw Error('All provider and external networking is forbidden: '+url.origin);}
  assert.equal(request.headers.get('X-Manager-Schedule-Key'),trigger);
  assert.equal(request.headers.get('Authorization'),null);
  assert.ok(['/api/v1/manager/run-due','/api/v1/manager/publications/step','/api/v1/manager/autonomy/step'].includes(url.pathname));
  if(url.pathname==='/api/v1/manager/publications/step')steps++;
  if(url.pathname==='/api/v1/manager/run-due')schedules++;
  const response=await mf.dispatchFetch(request);assert.equal(response.status,200,await response.clone().text());return response;
 };
 const config={workers:[
  {name:'pages',modules:true,script:pages,compatibilityDate:'2026-10-30',d1Databases:{DB:'synthetic-daily'},assets:{directory:resolve('dist'),binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}},serviceBindings:{MANAGER_RUNTIME:'clock'},bindings:{PUBLIC_ORIGIN:origin,MANAGER_SCHEDULE_TRIGGER_KEY:trigger,TOWER_DAILY_JOURNALS_ENABLED:'true',TOWER_WEEKLY_ENABLED:'false',TOWER_PUBLICATION_MAIL_ENABLED:'false',TOWER_SCENES_ENABLED:'false'},outboundService:outbound},
  {name:'clock',modules:true,script:clock,compatibilityDate:'2026-10-30',durableObjects:{MANAGER_CLOCK:{className:'ManagerClock',useSQLite:true}},bindings:{PUBLIC_ORIGIN:origin,MANAGER_SCHEDULE_TRIGGER_KEY:trigger},outboundService:outbound},
  {name:'race',modules:true,script:race,compatibilityDate:'2026-10-30',d1Databases:{DB:'synthetic-daily'},outboundService:outbound},
 ]};
 mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config);
 try{
  db=await mf.getD1Database('DB','pages');for(const sql of migrations)await db.prepare(sql).run();
  // The wildcard admission fixture is confined to this ephemeral database; it does not grant real households eligibility.
  await db.prepare('INSERT INTO tower_admission_policies VALUES(2,?,0,?)').bind('["*"]','2026-10-31T00:00:00.000Z').run();
  await db.prepare('UPDATE tower_admission_current SET policy_version=2 WHERE id=1').run();
  const observed=new Date(),day=managerLocalDay(observed),cutoff=day+'T16:00:00.000Z',due=observed.toISOString()>=cutoff;
  const at=new Date(Date.parse(day+'T00:00:00.000Z')-86400000).toISOString();
  async function resident(letter,{count=1,malformed=false,revoked=false}={}){
   const id=letter.repeat(16),daily=Array.from({length:count},(_,i)=>({id:'journal-'+i,type:'journal',title:'Native journal '+letter+i,body:'Original neighbor story '+letter+i,occurredAt:malformed?'2026-02-30T12:00:00Z':at}));
   await db.batch([
    db.prepare('INSERT INTO accounts(id,login_hash,created_at,test_only) VALUES(?,?,?,0)').bind(id,'synthetic-'+id,at),
    db.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES(?,?,?,'Hello','resident',1,'external-ready',?,0)").bind(id,id,'Native neighbor '+letter,at),
    db.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,public_revision,snapshot_consent,announcement_consent,directory_consent,publication_epoch,created_at,updated_at,published_at) VALUES(?,?,?,?,'challenge',1,1,?,1,1,?,?,?)").bind(id,id,id,'https://source.example/'+id,revoked?0:1,at,at,at),
    db.prepare('INSERT INTO tower_snapshots VALUES(?,1,?,?,?)').bind(id,JSON.stringify({home:{daily}}),'a'.repeat(64),at),
   ]);return id;
  }
  const a=await resident('a',{count:2,malformed:empty}),b=await resident('b',{count:2,revoked:empty});
  await resident('c',{malformed:true});await resident('d',{revoked:true});
  const get=async()=>{const response=await mf.dispatchFetch(origin+'/api/v1/public/tower-journals');assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('Cache-Control'),'no-store');return response.json();};
  const home=async()=>{const response=await mf.dispatchFetch(origin+'/');assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');const html=await response.text();assert.match(html,/id="tower-landscape"/);assert.match(html,/data-tower-video-play/);assert.doesNotMatch(html,/<iframe[^>]+youtube/);return html;};
  const post=(path,key)=>mf.dispatchFetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'X-Manager-Schedule-Key':key}:{})},body:JSON.stringify({scheduledTime:new Date().toISOString()})});
  const rows=async table=>(await db.prepare('SELECT * FROM '+table+' ORDER BY day').all()).results;
  const counts=async()=>Promise.all(['jobs','editions','audit'].map(async name=>(await rows('tower_daily_journal_'+name)).length));
  assert.deepEqual(await get(),{edition:null});
  for(const path of ['/api/v1/manager/run-due','/api/v1/manager/publications/run-due']){assert.equal((await post(path)).status,401);assert.equal((await post(path,'wrong')).status,401);}
  assert.deepEqual(await counts(),[0,0,0]);assert.equal((await db.prepare('SELECT count(*) n FROM tower_manager_runs').first()).n,0);
  assert.equal((await mf.dispatchFetch(origin+'/api/v1/public/tower-journals',{method:'POST'})).status,405);
  const head=await mf.dispatchFetch(origin+'/api/v1/public/tower-journals',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  if(due&&!empty){
   const response=await(await mf.getWorker('race')).fetch(origin+'/synthetic-native-race',{method:'POST'});assert.deepEqual(await response.json(),{rejected:true});
   assert.deepEqual(await counts(),[0,0,0],'A native D1 source/grant race rolls back all daily rows atomically');assert.deepEqual(await get(),{edition:null});
   await db.prepare('UPDATE tower_residencies SET announcement_consent=1 WHERE room_id IN (?,?)').bind(a,b).run();
  }
  const worker=await mf.getWorker('clock');let scheduledEntry=false;
  async function tick(){
   if(typeof worker.scheduled==='function'){scheduledEntry=true;await worker.scheduled({scheduledTime:new Date(),cron:'0 16 * * *'});}
   else {const response=await post('/api/v1/manager/run-due',trigger);assert.equal(response.status,200,await response.clone().text());}
  }
  await tick();
  if(!due){
   const response=await post('/api/v1/manager/publications/run-due',trigger);assert.equal(response.status,200);const state=await response.json();assert.equal(state.daily.state,'not_due');assert.equal(state.weekly,'disabled');
   assert.deepEqual(await counts(),[0,0,0]);assert.deepEqual(await get(),{edition:null});assert.doesNotMatch(await home(),/Native journal/);
   console.log('PASS native pre-09: actual clock refuses early edition; no publication/provider work. Full time matrix is covered by unit tests.');
  }else{
   const deadline=Date.now()+15000;while(Date.now()<deadline&&(await counts())[0]===0)await new Promise(done=>setTimeout(done,50));
   assert.deepEqual(await counts(),[1,1,1]);assert.equal(steps,1,'A real private SQLite DO alarm dispatched the daily task');
   if(scheduledEntry)assert.equal(schedules,1,'The actual Worker scheduled entry reached protected Pages run-due');
   const edition=(await get()).edition;assert.equal(edition.day,day);assert.equal(edition.cutoffAt,cutoff);assert.deepEqual(edition.items.map(i=>i.title),empty?[]:['Native journal a0','Native journal a1','Native journal b0']);
   for(const item of edition.items){assert.equal(item.originalAt,at);assert.equal(item.excerpt,'Original neighbor story '+item.title.slice(-2));assert.match(item.href,/\/home\/[ab]{16}\/inside$/);}
   const html=await home();if(!empty){for(const item of edition.items)assert.ok(html.includes(item.title),'Raw SSR/JavaScript-disabled response includes selected journal');assert.match(html,/data-tower-journals/);}else assert.doesNotMatch(html,/Native journal/);
   assert.doesNotMatch(JSON.stringify(edition),/bodyDigest|sourceKey|publicationEpoch|publicRevision|source_digest|synthetic-daily-trigger/);
   const saved=await Promise.all(['jobs','editions','audit'].map(name=>rows('tower_daily_journal_'+name))),beforeSteps=steps;
   await tick();await tick();await new Promise(done=>setTimeout(done,1300));assert.equal(steps,beforeSteps,'Permanent publications-v2 task receipt prevents repeated DO dispatch');
   const replay=await post('/api/v1/manager/publications/run-due',trigger);assert.equal(replay.status,200);const replayed=await replay.json();assert.equal(replayed.daily.state,'already_complete');assert.equal(replayed.weekly,'disabled');
   assert.deepEqual(await Promise.all(['jobs','editions','audit'].map(name=>rows('tower_daily_journal_'+name))),saved,'Same-day replays never add or alter job/edition/audit');
   for(const table of ['jobs','audit'])assert.equal((await rows('tower_daily_journal_'+table))[0].actual_micro,0);
   if(!empty){
    await db.prepare('UPDATE tower_residencies SET announcement_consent=0 WHERE room_id=?').bind(a).run();
    assert.deepEqual((await get()).edition.items.map(i=>i.title),['Native journal b0']);assert.doesNotMatch(await home(),/Native journal a[01]/);
    // Concurrent revocation and read: only the read after the committed revocation is the authority.
    await Promise.all([get(),db.prepare('DELETE FROM tower_snapshots WHERE room_id=?').bind(b).run()]);
    assert.deepEqual((await get()).edition.items,[]);assert.doesNotMatch(await home(),/Native journal [ab][01]/);
    assert.equal(JSON.parse((await rows('tower_daily_journal_editions'))[0].selection_json).length,3,'Withdrawal hides saved choices without filling or rewriting history');
   }
   for(const name of ['jobs','editions','audit']){
    await assert.rejects(db.prepare('UPDATE tower_daily_journal_'+name+' SET day=day').run(),/daily_immutable/);
    await assert.rejects(db.prepare('DELETE FROM tower_daily_journal_'+name).run(),/daily_immutable/);
   }
   console.log('PASS native '+(empty?'malformed/revoked empty edition':'latest-three SSR/API, live revocation/removal and concurrent read')+'; real D1 clock, atomic immutable zero-cost rows and permanent DO replay protection');
  }
  for(const table of ['manager_jobs','tower_weekly_jobs','tower_weekly_issues','tower_weekly_outbox','tower_scenes'])assert.equal((await db.prepare('SELECT count(*) n FROM '+table).first()).n,0,table+' stays unused without provider credentials or weekly enablement');
  assert.equal(providerCalls,0,'No text, image, email or external provider calls');
  console.log('PASS native entry: '+(scheduledEntry?'actual Worker.scheduled → protected Pages → private SQLite DO alarm':'protected Pages run-due → private SQLite DO alarm (local native test, not production cron proof)'));
 }finally{await mf.dispose();}
}
await scenario();await scenario(true);
console.log('PASS daily journals native runtime; zero provider keys, zero provider calls, no production state touched');
