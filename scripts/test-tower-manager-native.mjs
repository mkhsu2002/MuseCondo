/* global Response */
// Explicit optional runtime dependency path; uses existing cache, never installs or reaches a provider.
import assert from 'node:assert/strict';
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
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config);
try{
 const db=await mf.getD1Database('DB');
 for(const file of (await readdir('migrations')).filter(x=>x.endsWith('.sql')).sort()){
  // sqlite3.complete_statement preserves trigger bodies and quoted semicolons.
  const statements=JSON.parse(execFileSync('python3',['-c',"import sys,sqlite3,json\nsql=sys.stdin.read(); current=''; result=[]\nfor char in sql:\n current+=char\n if char==';' and sqlite3.complete_statement(current):\n  result.append(current); current=''\nif current.strip() and not current.strip().startswith('--'): raise ValueError('Incomplete migration')\nprint(json.dumps(result))"],{input:await readFile('migrations/'+file,'utf8'),encoding:'utf8'}));
  await db.batch(statements.map(sql=>db.prepare(sql)));
 }
 const post=(path,body,header='X-Tower-Operator-Key',key='synthetic-native-operator')=>mf.dispatchFetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',[header]:key},body:JSON.stringify(body)});
 const before=await mf.dispatchFetch(origin+'/api/v1/tower/appearance');assert.equal(before.status,200);assert.equal((await before.json()).theme,'standard');
 const start=new Date(Date.now()-60000).toISOString(),end=new Date(Date.now()+3600000).toISOString();
 let response=await post('/api/v1/operator/manager/appearance',{action:'preview',requestKey:'native-preview-001',theme:'halloween',startsAt:start,endsAt:end,timezone:'America/Vancouver'});assert.equal(response.status,201,await response.text());
 const command={action:'activate',requestKey:'native-activate-001',previewKey:'native-preview-001',expectedRevision:0};response=await post('/api/v1/operator/manager/appearance',command);assert.equal(response.status,201);const receipt=await response.json();
 assert.deepEqual(await (await post('/api/v1/operator/manager/appearance',command)).json(),receipt);assert.equal((await (await mf.dispatchFetch(origin+'/api/v1/tower/appearance')).json()).theme,'halloween');
 assert.equal((await post('/api/v1/operator/manager/appearance',{...command,expectedRevision:1})).status,409);
 assert.equal((await post('/api/v1/manager/run-due',{scheduledTime:new Date().toISOString()})).status,401);
 const tick=()=>post('/api/v1/manager/run-due',{scheduledTime:new Date().toISOString()},'X-Manager-Schedule-Key','synthetic-native-schedule');
 assert.equal((await tick()).status,200);assert.equal((await (await tick()).json()).executed,0);
 const rows=await db.prepare('SELECT state,attempts FROM tower_manager_runs').all();assert.equal(rows.results.length,5);assert(rows.results.every(row=>row.state==='complete'&&row.attempts===1));
 await assert.rejects(db.exec('DELETE FROM tower_appearance_audit'));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM tower_appearance_audit').first()).n,2);
 console.log('PASS native compiled Pages + D1: migrations, private preview, activation, immutable replay, conflict, public projection, scope isolation, calendar ledger, audit permanence');
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
