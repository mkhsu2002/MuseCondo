import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createTowerWeekly} from '../server/live/tower-weekly.ts';
import type {WeeklySource} from '../src/shared/tower-weekly.ts';
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'weekly-')),db=new LocalDatabase(join(dir,'db'));
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 let source:WeeklySource={sourceDigest:'a'.repeat(64),residentCount:0,residents:[],events:[],asOf:'2026-11-03T17:00:00.000Z'};
 let calls=0,unknown=false,invalid=false;let during=()=>{};
 const fetcher=(async(url:string|URL|Request,init?:RequestInit)=>{
  const request=JSON.parse(String(init?.body));assert.equal(request.tools,undefined);assert.equal(request.model,'muse-spark-1.3');
  if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:500});
  calls++;if(unknown)throw Error('uncertain');during();
  return Response.json({id:'weekly-response-1',model:'muse-spark-1.3',status:'completed',usage:{input_tokens:500,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({messageVariant:invalid?'invented':JSON.parse(request.input).inaugural?'inaugural-welcome':'weekly-welcome',selectedEventIds:[]})}]}]});
 }) as typeof fetch;
 const create=(budget=1000000)=>createTowerWeekly({db,apiKey:'test-private',approved:true,budgetMicro:budget,dailyBudgetMicro:budget,monthlyBudgetMicro:budget,readSource:async()=>source,publicationGuards:()=>[],fetcher,now:()=>new Date()});
 const input={periodKey:'inaugural',periodStart:'2026-10-26T16:00:00.000Z',cutoffAt:source.asOf,recipientHash:'a'.repeat(64),inaugural:true};
 return {db,create,input,get calls(){return calls;},setSource(s:WeeklySource){source=s;},get source(){return source;},setUnknown(){unknown=true;},setInvalid(){invalid=true;},during(fn:()=>void){during=fn;},async close(){db.close();await rm(dir,{recursive:true,force:true});}};
}
test('actual constrained Manager publishes zero-news issue once with atomic permanent notice and shared receipt',async()=>{
 const f=await fixture();try{const manager=f.create();await Promise.all([manager.enqueue(f.input),manager.enqueue(f.input)]);await Promise.all([manager.processOne('inaugural'),manager.processOne('inaugural')]);assert.equal(f.calls,1);
 const issues=await manager.list();assert.equal(issues.length,1);assert.equal(issues[0].residentCount,0);assert.match(issues[0].message,/first Tower Weekly/);assert.match(issues[0].message,/NeoBabylon City/);
 assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_weekly_outbox').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT actual_micro FROM manager_jobs').get()!.actual_micro,1050);
 assert.doesNotMatch(JSON.stringify(issues),/test-private|muse-spark|prompt|recipientHash/);
 await manager.processOne('inaugural');assert.equal(f.calls,1);
 }finally{await f.close();}
});
test('unknown is never recalled and charged invalid output cannot publish',async()=>{
 for(const kind of ['unknown','invalid']){const f=await fixture();try{if(kind==='unknown')f.setUnknown();else f.setInvalid();const manager=f.create();await manager.enqueue(f.input);await manager.processOne('inaugural');await f.create().processOne('inaugural');assert.equal(f.calls,1);assert.equal((await manager.list()).length,0);const job=f.db.sqlite.prepare('SELECT * FROM manager_jobs').get()!;assert.equal(job.state,kind);assert.equal(job.actual_micro,kind==='unknown'?null:1050);}finally{await f.close();}}
});
test('source change during response cancels publication but preserves receipt; budget shares existing manager spend',async()=>{
 const f=await fixture();try{const manager=f.create();await manager.enqueue(f.input);f.during(()=>f.setSource({...f.source,sourceDigest:'b'.repeat(64)}));await manager.processOne('inaugural');assert.equal((await manager.list()).length,0);assert.equal(f.db.sqlite.prepare('SELECT actual_micro FROM manager_jobs').get()!.actual_micro,1050);}finally{await f.close();}
 const g=await fixture();try{g.db.sqlite.prepare("INSERT INTO manager_jobs(id,source_digest,state,reserved_micro,actual_micro,created_at,started_at) VALUES('old','old','complete',900000,900000,?,?)").run(g.input.cutoffAt,g.input.cutoffAt);const manager=g.create(900001);await manager.enqueue(g.input);await manager.processOne('inaugural');assert.equal(g.calls,0);}finally{await g.close();}
});
test('duplicate period cannot change cutoff or recipient; durable issue, receipts and audit cannot be rolled back',async()=>{
 const f=await fixture();try{const manager=f.create();await manager.enqueue(f.input);await manager.enqueue({...f.input,recipientHash:'b'.repeat(64)});await manager.processOne('inaugural');assert.equal(f.db.sqlite.prepare('SELECT recipient_hash FROM tower_weekly_outbox').get()!.recipient_hash,f.input.recipientHash);
 for(const sql of ['DELETE FROM tower_weekly_issues','UPDATE tower_weekly_issues SET issue_json=\'{}\'','DELETE FROM tower_weekly_audit','UPDATE manager_jobs SET actual_micro=0','DELETE FROM manager_jobs','DELETE FROM tower_weekly_outbox'])assert.throws(()=>f.db.sqlite.exec(sql));
 }finally{await f.close();}
});
test('notification state changes append durable audit and cannot reopen an unknown outcome',async()=>{
 const f=await fixture();try{const manager=f.create();await manager.enqueue(f.input);await manager.processOne('inaugural');const before=Number(f.db.sqlite.prepare('SELECT count(*) n FROM tower_weekly_audit').get()!.n);
 f.db.sqlite.exec("UPDATE tower_weekly_outbox SET state='dispatching'; UPDATE tower_weekly_outbox SET state='unknown'");
 assert.equal(Number(f.db.sqlite.prepare('SELECT count(*) n FROM tower_weekly_audit').get()!.n),before+2);
 assert.throws(()=>f.db.sqlite.exec("UPDATE tower_weekly_outbox SET state='dispatching'"));
 }finally{await f.close();}
});
test('notification unique-key replacement cannot reset permanent delivery ownership',async()=>{
 const f=await fixture();try{const manager=f.create();await manager.enqueue(f.input);await manager.processOne('inaugural');
 assert.throws(()=>f.db.sqlite.exec("INSERT OR REPLACE INTO tower_weekly_outbox(id,issue_id,recipient_hash,state,idempotency_key,created_at,updated_at) SELECT 'replacement',issue_id,recipient_hash,'pending',idempotency_key,created_at,updated_at FROM tower_weekly_outbox"));
 assert.notEqual(f.db.sqlite.prepare('SELECT id FROM tower_weekly_outbox').get()!.id,'replacement');
 }finally{await f.close();}
});

test('different checked periods publish concurrently without losing paid work to issue-number races',async()=>{
 const f=await fixture();try{const manager=f.create();await manager.enqueue(f.input);await manager.processOne(f.input.periodKey);
 for(const periodKey of ['regular-a','regular-b'])await manager.enqueue({...f.input,periodKey,inaugural:false});
 await Promise.all(['regular-a','regular-b'].map(key=>manager.processOne(key)));
 assert.equal(f.calls,3);assert.deepEqual(f.db.sqlite.prepare('SELECT number FROM tower_weekly_issues ORDER BY number').all().map(r=>r.number),[1,2,3]);assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM manager_jobs WHERE state='invalid'").get()!.n,0);
 }finally{await f.close();}
});

test('a suspended claimant cannot call the paid provider after another invocation expires its lease',async()=>{
 const f=await fixture();try{const weekly=f.create();await weekly.enqueue(f.input);const batch=f.db.batch.bind(f.db);let suspended=false;f.db.batch=async statements=>{const result=await batch(statements);if(!suspended&&statements.some(s=>(s as unknown as {sql:string}).sql.includes("UPDATE manager_jobs SET state='running'"))){suspended=true;f.db.sqlite.exec("UPDATE tower_weekly_jobs SET lease_until='2000-01-01T00:00:00.000Z'");await weekly.processOne(f.input.periodKey);}return result;};await weekly.processOne(f.input.periodKey);assert(suspended);assert.equal(f.calls,0);assert.equal(f.db.sqlite.prepare('SELECT state FROM manager_jobs').get()!.state,'unknown');
 }finally{await f.close();}
});

test('archive cursors preserve all older issues while latest reads stay bounded',async()=>{
 const f=await fixture();try{const weekly=f.create();await weekly.enqueue(f.input);await weekly.processOne('inaugural');for(const periodKey of ['regular-a','regular-b']){await weekly.enqueue({...f.input,periodKey,inaugural:false});await weekly.processOne(periodKey);}
 assert.deepEqual((await weekly.list({limit:2})).map(i=>i.number),[3,2]);assert.deepEqual((await weekly.list({limit:2,before:2})).map(i=>i.number),[1]);assert.deepEqual((await weekly.list({limit:1})).map(i=>i.number),[3]);await assert.rejects(weekly.list({limit:100}),/invalid_archive_window/);await assert.rejects(weekly.list({before:-1}),/invalid_archive_window/);
 }finally{await f.close();}
});
