import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {calendarPeriods,createManagerSchedule} from '../server/live/tower-manager-schedule.ts';
import scheduler from '../workers/tower-manager/worker.ts';
function database(){const db=new LocalDatabase(':memory:');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));return db;}
test('Vancouver periods hold across UTC month boundary, Monday and DST repetition',()=>{
 assert.deepEqual(calendarPeriods(new Date('2026-11-01T06:59:59Z')),{day:'2026-10-31',week:'2026-10-26',month:'2026-10'});
 assert.deepEqual(calendarPeriods(new Date('2026-11-01T07:00:00Z')),{day:'2026-11-01',week:'2026-10-26',month:'2026-11'});
 assert.deepEqual(calendarPeriods(new Date('2026-11-01T08:30:00Z')),calendarPeriods(new Date('2026-11-01T09:30:00Z')));
 assert.equal(calendarPeriods(new Date('2026-11-02T08:00:00Z')).week,'2026-11-02');
});
test('one tick runs bounded DB-only registry once per local period, retries only failed safe jobs twice',async()=>{
 const db=database();let fail=true;const clock=()=>new Date('2026-11-01T16:00:00Z');try{
 const registry=createManagerSchedule(db,clock,{beforeJob:async job=>{if(job==='public-health'&&fail)throw Error('PRIVATE_DO_NOT_LEAK');}});
 await Promise.all([registry.runDue(clock()),registry.runDue(clock())]);const rows=db.sqlite.prepare('SELECT * FROM tower_manager_runs').all();assert.equal(rows.length,5);assert.equal(rows.filter(r=>r.state==='complete').length,4);assert.equal(rows.find(r=>r.job==='public-health')!.attempts,2);assert.doesNotMatch(JSON.stringify(rows),/PRIVATE_DO_NOT_LEAK/);
 fail=false;assert.equal((await registry.runDue(clock())).executed,0);db.sqlite.exec("UPDATE tower_manager_runs SET state='running',attempts=1,lease_until='2026-10-31T00:00:00.000Z' WHERE job='public-health'");await registry.runDue(clock());assert.equal(db.sqlite.prepare("SELECT state FROM tower_manager_runs WHERE job='public-health'").get()!.state,'complete');
 assert.throws(()=>db.sqlite.exec('DELETE FROM tower_manager_runs'),/permanent/);assert.throws(()=>db.sqlite.exec("UPDATE tower_manager_runs SET period='other'"),/immutable/);
 }finally{db.close();}
});
test('native scheduler uses only scoped trigger, no public execution, network retry or paid calls',async()=>{
 assert.equal((await scheduler.fetch()).status,404);const original=globalThis.fetch;const calls:{url:string;headers:Headers;redirect?:RequestRedirect}[]=[];globalThis.fetch=async(input,init)=>{calls.push({url:String(input),headers:new Headers(init?.headers),redirect:init?.redirect});return new Response('{}');};try{
 await scheduler.scheduled({scheduledTime:Date.parse('2026-11-01T16:00:00Z')},{PUBLIC_ORIGIN:'https://tower.example',MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic-schedule-key'});
 assert.equal(calls.length,1);assert.equal(calls[0].redirect,'manual');assert.equal(calls[0].url,'https://tower.example/api/v1/manager/run-due');assert.equal(calls[0].headers.get('X-Manager-Schedule-Key'),'synthetic-schedule-key');assert.equal(calls[0].headers.get('X-Tower-Operator-Key'),null);
 }finally{globalThis.fetch=original;}
});
