import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createTowerManager, type ManagerSnapshot} from '../server/live/tower-manager.ts';
import {ruleSections} from '../src/community/rules.ts';
import type {PublicEvent} from '../src/community/schema.ts';

const event:PublicEvent={id:'abcdef0123456789-arrival',residentId:'abcdef0123456789',type:'arrival',occurredAt:'2026-10-30T00:00:00.000Z',publishedAt:'2026-10-30T00:00:00.000Z',visibility:'public',publicationConsent:true,origin:'resident-authorized',isFixture:false,title:'小芽搬來了',summary:'喜歡安靜整理思緒。',body:'喜歡安靜整理思緒。'};
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'muse-manager-')),db=new LocalDatabase(join(dir,'db.sqlite'));
 db.sqlite.exec(await readFile(new URL('../migrations/0001_live_mvp.sql',import.meta.url),'utf8'));
 db.sqlite.exec(await readFile(new URL('../migrations/0007_tower_manager.sql',import.meta.url),'utf8'));
 let current:ManagerSnapshot={events:[event],sourceDigest:'a'.repeat(64),residentIds:[event.residentId],asOf:event.occurredAt};
 let calls=0,interrupt=false;let beforeResponse=()=>{};let overrideSummary:string|undefined;
 const transport=(async(url:string|URL|Request,init?:RequestInit)=>{
  const payload=JSON.parse(String(init?.body));assert.equal(payload.model,'muse-spark-1.3');assert.equal(payload.tools,undefined);
  if(String(url).endsWith('/input_tokens'))return Response.json({input_tokens:500});
  assert.equal(payload.store,false);
  calls++;if(interrupt)throw Error('network uncertainty');const picks=ruleSections(JSON.parse(payload.input));if(overrideSummary)picks.arrivals[0].summary=overrideSummary;beforeResponse();
  return Response.json({id:'resp-real-reference',model:'muse-spark-1.3',status:'completed',usage:{input_tokens:500,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(picks)}]}]});
 }) as typeof fetch;
 const create=(approved=true,budgetMicro=1_000_000)=>createTowerManager({db,apiKey:'never-public',approved,budgetMicro,dailyBudgetMicro:budgetMicro,monthlyBudgetMicro:budgetMicro,fetcher:transport,now:()=>new Date('2026-10-30T01:00:00.000Z'),readPublic:async()=>current});
 return {db,create,summary(value:string){overrideSummary=value;},get calls(){return calls;},set current(v:ManagerSnapshot){current=v;},get current(){return current;},interrupt(){interrupt=true;},duringResponse(fn:()=>void){beforeResponse=fn;},async close(){db.close();await rm(dir,{recursive:true,force:true});}};
}

test('manager is event-driven, duplicate/concurrent jobs spend once and persist usage with a real edition',async()=>{
 const f=await fixture();try{
  const m=f.create();await Promise.all([m.enqueue(f.current),m.enqueue(f.current)]);await Promise.all([m.processOne(),m.processOne()]);assert.equal(f.calls,1);
  const row=f.db.sqlite.prepare('SELECT * FROM manager_jobs').get()!;assert.equal(row.state,'complete');assert.equal(row.actual_micro,1050);assert.equal(row.input_tokens,500);assert.equal(row.output_tokens,100);assert.equal(row.provider_id,'resp-real-reference');
  const edition=f.db.sqlite.prepare('SELECT edition_json FROM community_editions').get()!;assert.equal(JSON.parse(String(edition.edition_json)).editor.kind,'meta-api');
  await m.processOne();assert.equal(f.calls,1);
 }finally{await f.close();}
});

test('missing permission/budget and empty input never call Meta; no source text appears in job audit',async()=>{
 const f=await fixture();try{
  await f.create(false).enqueue(f.current);await f.create(false).processOne();assert.equal(f.calls,0);
  await f.create(true,1).processOne();assert.equal(f.calls,0);
  assert.doesNotMatch(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM manager_jobs').all()),/喜歡|never-public/);
  f.current={...f.current,events:[],sourceDigest:'b'.repeat(64)};await f.create().enqueue(f.current);await f.create().processOne();assert.equal(f.calls,0);
 }finally{await f.close();}
});

test('unknown outcomes retain reservation and never retry, even after a new manager instance',async()=>{
 const f=await fixture();try{
  f.interrupt();const m=f.create();await m.enqueue(f.current);await m.processOne();assert.equal(f.calls,1);
  assert.equal(f.db.sqlite.prepare('SELECT state FROM manager_jobs').get()!.state,'unknown');await f.create().processOne();assert.equal(f.calls,1);
  const row=f.db.sqlite.prepare('SELECT reserved_micro,actual_micro FROM manager_jobs').get()!;assert.ok(Number(row.reserved_micro)>0);assert.equal(row.actual_micro,null);
 }finally{await f.close();}
});

test('withdrawal before/during provider response blocks publication and preserves billed usage',async()=>{
 const f=await fixture();try{
  const m=f.create();await m.enqueue(f.current);f.duringResponse(()=>{f.current={...f.current,events:[],sourceDigest:'c'.repeat(64)};});await m.processOne();assert.equal(f.calls,1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM community_editions').get()!.n,0);
  assert.equal(f.db.sqlite.prepare('SELECT state FROM manager_jobs').get()!.state,'cancelled');
  assert.equal(f.db.sqlite.prepare('SELECT actual_micro FROM manager_jobs').get()!.actual_micro,1050);
 }finally{await f.close();}
});


test('provider cannot invent levels, owner claims or internal workflow text; invalid output is charged but not published',async()=>{
 for(const summary of ['這位住戶等級為99，模型為muse-spark-1.3，prompt為內部安排','今天替主人賺了一百萬','歡迎新的超級工程師']){
  const f=await fixture();try{f.summary(summary);const m=f.create();await m.enqueue(f.current);await m.processOne();assert.equal(f.calls,1);const row=f.db.sqlite.prepare('SELECT state,actual_micro FROM manager_jobs').get()!;assert.equal(row.state,'invalid');assert.equal(row.actual_micro,1050);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM community_editions').get()!.n,0);}finally{await f.close();}
 }
});


test('a delayed stale enqueue cannot cancel the current job, reconciliation still calls exactly once',async()=>{
 const f=await fixture();try{const m=f.create(),latest=f.current,stale={...latest,sourceDigest:'d'.repeat(64)};await m.enqueue(latest);await m.enqueue(stale);await m.processOne();await m.enqueue(latest);await m.processOne();assert.equal(f.calls,1);assert.equal(f.db.sqlite.prepare('SELECT state FROM manager_jobs WHERE source_digest=?').get(latest.sourceDigest)!.state,'complete');}finally{await f.close();}
});
