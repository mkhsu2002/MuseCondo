/* global Response, setTimeout */
// Explicit optional runtime dependency path; uses existing cache, never installs or reaches a provider.
import assert from 'node:assert/strict';
import {managerLocalDay,managerLocalDaySQL} from '../server/live/tower-calendar.ts';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const runtimeRoot=process.argv[2];if(!runtimeRoot)throw Error('Pass a local node_modules directory containing miniflare and esbuild');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(join(resolve(runtimeRoot),'miniflare/dist/src/index.js')).href);
const {build}=await import(pathToFileURL(join(resolve(runtimeRoot),'esbuild/lib/main.js')).href);
const compiled=await build({entryPoints:['server/live/worker.ts'],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'});
const origin='https://synthetic-tower.example';
const config={modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-30',d1Databases:['DB'],bindings:{PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:'synthetic-native-operator',MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic-native-schedule'},outboundService:()=>{throw Error('External network forbidden');}};
async function migrate(db){
 for(const file of (await readdir('migrations')).filter(x=>x.endsWith('.sql')).sort()){
  // sqlite3.complete_statement preserves trigger bodies and quoted semicolons.
  const statements=JSON.parse(execFileSync('python3',['-c',"import sys,sqlite3,json\nsql=sys.stdin.read(); current=''; result=[]\nfor char in sql:\n current+=char\n if char==';' and sqlite3.complete_statement(current):\n  result.append(current); current=''\nif current.strip() and not current.strip().startswith('--'): raise ValueError('Incomplete migration')\nprint(json.dumps(result))"],{input:await readFile('migrations/'+file,'utf8'),encoding:'utf8'}));
  await db.batch(statements.map(sql=>db.prepare(sql)));
 }
}
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config);
try{
 const db=await mf.getD1Database('DB');
 await migrate(db);
 const calendarMatrix=[['2026-11-01T06:59:59.999Z','2026-10-31'],['2026-11-01T07:00:00.000Z','2026-11-01'],['2026-11-02T07:30:00.000Z','2026-11-02'],['2026-12-01T06:59:59.999Z','2026-11-30'],['2026-12-01T07:00:00.000Z','2026-12-01'],['2027-01-01T07:30:00.000Z','2027-01-01']];
 const calendarSource=await build({stdin:{contents:`import {managerLocalDay} from './server/live/tower-calendar.ts';export default {fetch(){return Response.json(${JSON.stringify(calendarMatrix)}.map(([at])=>({at,day:managerLocalDay(new Date(at)),hostIntlDay:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at))})));}};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'});
 const calendarConfig={modules:true,script:calendarSource.outputFiles[0].text,compatibilityDate:'2026-10-30',outboundService:()=>{throw Error('External network forbidden');}};
 const nativeCalendar=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(calendarConfig):calendarConfig);
 try{const result=await (await nativeCalendar.dispatchFetch(origin+'/calendar')).json();for(let i=0;i<calendarMatrix.length;i++){const [at,day]=calendarMatrix[i];assert.equal(result[i].day,day);assert.equal(managerLocalDay(new Date(at)),day);assert.equal((await db.prepare(`SELECT ${managerLocalDaySQL('instant')} day FROM (SELECT ? instant)`).bind(at).first()).day,day);}assert.ok((await db.prepare("SELECT sql FROM sqlite_master WHERE name='tower_autonomy_call_billing_guard'").first()).sql.includes(managerLocalDaySQL('NEW.created_at')));console.log(`PASS native versioned BC Pacific policy: Node + compiled workerd + D1 agree across November, winter midnight and year boundary; host Intl differences=${result.filter(row=>row.hostIntlDay!==row.day).length}`);}finally{await nativeCalendar.dispose();}
 const post=(path,body,header='X-Tower-Operator-Key',key='synthetic-native-operator')=>mf.dispatchFetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',[header]:key},body:JSON.stringify(body)});
 const before=await mf.dispatchFetch(origin+'/api/v1/tower/appearance');assert.equal(before.status,200);assert.equal((await before.json()).theme,'standard');
 const start=new Date(Date.now()-60000).toISOString(),end=new Date(Date.now()+3600000).toISOString();
 let response=await post('/api/v1/operator/manager/appearance',{action:'preview',requestKey:'native-preview-001',theme:'halloween',startsAt:start,endsAt:end,timezone:'America/Vancouver'});assert.equal(response.status,201,await response.text());
 const command={action:'activate',requestKey:'native-activate-001',previewKey:'native-preview-001',expectedRevision:0};response=await post('/api/v1/operator/manager/appearance',command);assert.equal(response.status,201);const receipt=await response.json();
 assert.deepEqual(await (await post('/api/v1/operator/manager/appearance',command)).json(),receipt);assert.equal((await (await mf.dispatchFetch(origin+'/api/v1/tower/appearance')).json()).theme,'standard');
 assert.equal((await post('/api/v1/operator/manager/appearance',{...command,expectedRevision:1})).status,409);
 assert.equal((await post('/api/v1/manager/run-due',{scheduledTime:new Date().toISOString()})).status,401);
 const tick=()=>post('/api/v1/manager/run-due',{scheduledTime:new Date().toISOString()},'X-Manager-Schedule-Key','synthetic-native-schedule');
 assert.equal((await tick()).status,200);assert.equal((await (await tick()).json()).executed,0);
 const rows=await db.prepare('SELECT state,attempts FROM tower_manager_runs').all();assert.equal(rows.results.length,5);assert(rows.results.every(row=>row.state==='complete'&&row.attempts===1));
 await assert.rejects(db.exec('DELETE FROM tower_appearance_audit'));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM tower_appearance_audit').first()).n,2);
 assert.equal((await post('/api/v1/operator/manager/autonomy',{action:'enable'})).status,503);
 assert.equal((await post('/api/v1/manager/autonomy/step',{},'X-Manager-Schedule-Key','synthetic-native-schedule')).status,200);
 assert.equal((await db.prepare('SELECT enabled FROM tower_autonomy_mandate WHERE id=1').first()).enabled,0);
 // Recovery must keep today's thinking runnable after an older dispatch lease expires.
 await db.prepare('UPDATE tower_autonomy_mandate SET enabled=1 WHERE id=1').run();
 const previousDay=new Date(Date.now()-86400000).toISOString().slice(0,10),previousId=`manager-${previousDay}`;
 await db.prepare("INSERT INTO tower_autonomy_cycles(id,day,state,purpose,budget_micro,created_at,updated_at,lease_until) VALUES(?,?,'image-day','synthetic interrupted prior task',1000000,?,?,?)").bind(previousId,previousDay,start,start,new Date(Date.now()-60000).toISOString()).run();
 await db.prepare("INSERT INTO tower_autonomy_calls(id,cycle_id,step_key,purpose,model,state,reserved_micro,billing_day,created_at) VALUES('synthetic-interrupted',?,'synthetic-expired','image-day-r0','muse-image-1.0','dispatching',10000,?,?)").bind(previousId,managerLocalDay(new Date(start)),start).run();
 const recover=()=>post('/api/v1/manager/autonomy/step',{},'X-Manager-Schedule-Key','synthetic-native-schedule');
 const recovered=await (await recover()).json();assert.equal(recovered.state,'selfreview');assert.equal(recovered.pending,true);
 const unavailableReview=await (await recover()).json();assert.equal(unavailableReview.state,'blocked');assert.equal(unavailableReview.pending,true);assert.equal((await db.prepare("SELECT state FROM tower_autonomy_calls WHERE id='synthetic-interrupted'").first()).state,'unknown');assert.equal((await db.prepare("SELECT reserved_micro FROM tower_autonomy_calls WHERE id='synthetic-interrupted'").first()).reserved_micro,10000);
 assert.equal((await db.prepare("SELECT count(*) n FROM tower_autonomy_cycles WHERE state='thinking'").first()).n,1);
 const dispatchDay=managerLocalDay(new Date(start));
 assert.equal((await db.prepare("SELECT billing_day FROM tower_autonomy_calls WHERE id='synthetic-interrupted'").first()).billing_day,dispatchDay);
 await assert.rejects(db.prepare("INSERT INTO tower_autonomy_calls(id,cycle_id,step_key,purpose,model,billing_day,state,reserved_micro,created_at) VALUES('native-wrong-day',?,'native-wrong-day','audit','muse-spark-1.3',?,'dispatching',1,?)").bind(previousId,previousDay,start).run());
 await db.prepare('UPDATE tower_autonomy_mandate SET daily_limit_micro=10000 WHERE id=1').run();
 await assert.rejects(db.prepare("INSERT INTO tower_autonomy_calls(id,cycle_id,step_key,purpose,model,billing_day,state,reserved_micro,created_at) VALUES('native-daily-over',?,'native-daily-over','audit','muse-spark-1.3',?,'dispatching',1,?)").bind(previousId,dispatchDay,start).run());

 console.log('PASS native compiled Pages + D1: provider-disabled autonomy fail-closed, actual dispatch-day ledger and native cap guards, migrations, private preview, activation, immutable replay, conflict, public projection, scope isolation, calendar ledger, audit permanence');
}finally{await mf.dispose();}
let calls=0;
const scheduleSource=await build({stdin:{contents:`import scheduler from './workers/tower-manager/worker.ts'; let error=null;export default {fetch(r){return new URL(r.url).pathname==='/synthetic-error'?Response.json(error):scheduler.fetch();},async scheduled(e,env){try{await scheduler.scheduled(e,env);}catch(err){error={name:err.name,message:err.message,eventTime:e.scheduledTime};throw err;}}};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'});
const scheduleConfig={modules:true,script:scheduleSource.outputFiles[0].text,compatibilityDate:'2026-10-30',bindings:{PUBLIC_ORIGIN:origin,MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic-native-schedule'},outboundService:async request=>{calls++;assert.equal(request.url,origin+'/api/v1/manager/run-due');assert.equal(request.headers.get('X-Manager-Schedule-Key'),'synthetic-native-schedule');assert.equal(request.headers.get('X-Tower-Operator-Key'),null);assert.equal(request.method,'POST');return new Response('{}',{headers:{'Content-Type':'application/json'}});}};
const scheduled=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(scheduleConfig):scheduleConfig);
try{
 assert.equal((await scheduled.dispatchFetch(origin+'/')).status,404);
 const worker=await scheduled.getWorker();const result=await worker.scheduled({scheduledTime:new Date(),cron:'0 16 * * *'});assert.equal(result.outcome,'ok',JSON.stringify(await (await scheduled.dispatchFetch(origin+'/synthetic-error')).json()));assert.equal(calls,1);
 console.log('PASS native compiled scheduled Worker: public 404, one scoped dispatch, no operator/provider key or external traffic');
}finally{await scheduled.dispose();}
// Real workerd Durable Object alarm: a scoped wake leads to one stage and clears its alarm.
const clockSource=await build({entryPoints:['workers/tower-manager/worker.ts'],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'});
let alarmCalls=0;
const clockConfig={modules:true,script:clockSource.outputFiles[0].text,compatibilityDate:'2026-10-30',durableObjects:{MANAGER_CLOCK:{className:'ManagerClock',useSQLite:true}},bindings:{PUBLIC_ORIGIN:origin,MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic-native-schedule'},outboundService:async request=>{alarmCalls++;assert.equal(request.url,origin+'/api/v1/manager/autonomy/step');assert.equal(request.headers.get('X-Manager-Schedule-Key'),'synthetic-native-schedule');return Response.json({pending:alarmCalls===1,state:alarmCalls===1?'blocked':'complete'});}};
const nativeClock=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(clockConfig):clockConfig);
try{
 assert.equal((await nativeClock.dispatchFetch('https://manager.internal/wake',{method:'POST'})).status,401);
 assert.equal((await nativeClock.dispatchFetch('https://manager.internal/wake',{method:'POST',headers:{'X-Manager-Schedule-Key':'synthetic-native-schedule'}})).status,200);
 for(let attempt=0;attempt<30&&alarmCalls<2;attempt++)await new Promise(resolve=>setTimeout(resolve,200));
 assert.equal(alarmCalls,2);await new Promise(resolve=>setTimeout(resolve,500));assert.equal(alarmCalls,2);
 console.log('PASS native compiled ManagerClock SQLite DO: protected wake, actual alarm continues after blocked previous task while today is pending, scoped Pages dispatch, stop without polling');
}finally{await nativeClock.dispose();}

// Awaited native D1 claim crossing local midnight must never dispatch a wrongly billed provider call.
const seamSource=await build({stdin:{contents:`import {createManagerAutonomy} from './server/live/tower-autonomy.ts';export default {async fetch(request,env){const seam=new URL(request.url).pathname;let time=new Date('2026-10-31T06:59:59.990Z'),crossed=false,counts=0,paid=0;const raw=env.DB;const db={prepare(sql){const wrap=statement=>({bind(...values){return wrap(statement.bind(...values));},first(){return statement.first();},all(){return statement.all();},async run(){const result=await statement.run();if(!crossed&&(seam==='/paid'?sql.includes('ON CONFLICT(step_key) DO NOTHING'):sql.includes("VALUES(?,?,?,?,?,'dispatching',0,?,?)"))){crossed=true;time=new Date('2026-10-31T07:00:00.010Z');}return result;}});return wrap(raw.prepare(sql));},batch:statements=>raw.batch(statements)};const transport=async url=>{if(String(url).endsWith('/input_tokens')){counts++;return Response.json({input_tokens:120});}paid++;throw Error('A paid dispatch must not happen');};const manager=createManagerAutonomy({db,apiKey:'synthetic-provider',now:()=>time,transport,wake:async()=>{}});await manager.enable();const result=await manager.step();return Response.json({result,counts,paid,calls:(await raw.prepare('SELECT state,actual_micro,billing_day FROM tower_autonomy_calls').all()).results});}};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'});
for(const seam of ['count','paid']){
 const seamConfig={modules:true,script:seamSource.outputFiles[0].text,compatibilityDate:'2026-10-30',d1Databases:['DB'],outboundService:()=>{throw Error('External network forbidden');}};
 const nativeSeam=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(seamConfig):seamConfig);
 try{await migrate(await nativeSeam.getD1Database('DB'));const result=await (await nativeSeam.dispatchFetch(origin+'/'+seam)).json();assert.equal(result.result.state,'selfreview');assert.equal(result.paid,0);assert.equal(result.counts,seam==='count'?0:1);assert(result.calls.some(call=>call.state==='rejected'&&call.actual_micro===0&&call.billing_day==='2026-10-30'));}finally{await nativeSeam.dispose();}
}
console.log('PASS native D1 awaited count/paid claim midnight seam: unsent receipt rejected at zero, no provider HTTP, no rekey');
