import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createTowerWeekly} from '../server/live/tower-weekly.ts';
import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
import {createPublicationSources,readPublicationSource,publicationTimestamp} from '../server/live/tower-publication-sources.ts';
function fixture(){const db=new LocalDatabase(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+f,'utf8'));openSyntheticTower(db);return db;}
function resident(db:LocalDatabase,id:string,{published=true,testOnly=0,snapshot=true}={}){
 const time='2026-11-01T10:00:00.000Z';db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at,test_only) VALUES(?,?,?,?)').run(id,id,time,testOnly);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES(?,?,?,'Hello','resident',?,'external-ready',?,?)").run(id,id,'Resident '+id[0],Number(published),time,testOnly);
 if(snapshot){db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,public_revision,snapshot_consent,announcement_consent,directory_consent,publication_epoch,created_at,updated_at) VALUES(?,?,?,?,'challenge',1,1,1,1,1,?,?)").run(id,id,id,'https://source.example/'+id,time,time);
 db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,1,?,?,?)').run(id,JSON.stringify({home:{daily:[{id:'entry-1',type:'journal',title:'Snapshot journal',body:'Public original',occurredAt:'2026-11-02T15:00:00Z'}]}}),'a'.repeat(64),time);}
}
const period={periodKey:'2026-11-03',periodStart:'2026-10-27T17:00:00.000Z',cutoffAt:'2026-11-03T17:00:00.000Z',recipientHash:'f'.repeat(64),inaugural:true};
test('source counts admitted households but journals come only from their announced public snapshots',async()=>{
 const db=fixture();try{resident(db,'a'.repeat(16));resident(db,'b'.repeat(16),{published:false});resident(db,'c'.repeat(16),{testOnly:1});resident(db,'d'.repeat(16));resident(db,'e'.repeat(16),{snapshot:false});db.sqlite.prepare("UPDATE tower_snapshots SET public_json='{\"home\":{\"daily\":[]}}' WHERE room_id=?").run('d'.repeat(16));
 db.sqlite.prepare("INSERT INTO posts(id,room_id,kind,title,body,is_public,created_at,request_key,input_hash) VALUES('legacy-1',?,'journal','Legacy journal','Public legacy',1,'2026-11-02T16:00:00.000Z','legacy-1','hash')").run('d'.repeat(16));
 const value=await readPublicationSource({db,origin:'https://tower.example',aggregateApproved:true},period);
 assert.equal(value.residentCount,3);assert.equal(value.residents.length,2);assert.deepEqual(value.events.map(e=>e.title),['Snapshot journal']);assert(value.events.every(e=>e.origin==='resident-authorized'&&!e.isFixture));assert(!JSON.stringify(value).includes('source.example'));
 assert.equal((await readPublicationSource({db,origin:'https://tower.example',aggregateApproved:false},period)).residentCount,null);
 db.sqlite.prepare("UPDATE tower_residencies SET announcement_consent=0 WHERE room_id=?").run('a'.repeat(16));const fresh=await readPublicationSource({db,origin:'https://tower.example',aggregateApproved:true},period);assert.equal(fresh.residents.length,1);assert.deepEqual(fresh.events,[]);assert.notEqual(fresh.sourceDigest,value.sourceDigest);
 }finally{db.close();}
});
test('source reads public revision only and preserves admission time across republish',async()=>{
 const db=fixture();try{const id='a'.repeat(16);resident(db,id);db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,2,?,?,?)').run(id,JSON.stringify({home:{daily:[{id:'private-1',type:'journal',title:'PRIVATE DRAFT',body:'SECRET',occurredAt:'2026-11-03T12:00:00Z'}]}}),'b'.repeat(64),'2026-11-03T12:00:00.000Z');db.sqlite.prepare("UPDATE tower_residencies SET revision=2,published_at='2026-11-03T16:00:00.000Z',publication_epoch=2 WHERE room_id=?").run(id);
 const value=await readPublicationSource({db,origin:'https://tower.example',aggregateApproved:true},period);assert.equal(value.residents[0].admittedAt,'2026-11-01T10:00:00.000Z');assert.equal(value.residents[0].publicRevision,1);assert(!JSON.stringify(value).includes('PRIVATE'));assert.equal(value.events[0].title,'Snapshot journal');
 }finally{db.close();}
});
test('publication dates require explicit valid calendar/timezone, reject rollover/future, and normalize offsets',()=>{
 const cutoff='2026-11-03T17:00:00.000Z';for(const invalid of ['2026-02-30T12:00:00Z','2026-11-03T12:00:00','2026-11-03','2026-11-04T12:00:00Z','bad'])assert.equal(publicationTimestamp(invalid,cutoff),null,invalid);
 assert.equal(publicationTimestamp('2026-11-03T09:00:00-07:00',cutoff),'2026-11-03T16:00:00.000Z');
});

test('real source adapter publishes selected original journal and redacts immediately after grant withdrawal',async()=>{
 const db=fixture();try{resident(db,'a'.repeat(16));const sources=createPublicationSources({db,origin:'https://tower.example',aggregateApproved:true});let calls=0;
 const fetcher=(async(url,init)=>{if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:500});calls++;const request=JSON.parse(String(init?.body)),input=JSON.parse(request.input);return Response.json({id:'response-publication',model:'muse-spark-1.3',status:'completed',usage:{input_tokens:500,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({messageVariant:'inaugural-welcome',selectedEventIds:input.events.map((e:{id:string})=>e.id)})}]}]});}) as typeof fetch;
 const weekly=createTowerWeekly({db,...sources,apiKey:'synthetic',approved:true,budgetMicro:1000000,dailyBudgetMicro:1000000,monthlyBudgetMicro:1000000,fetcher,now:()=>new Date()});
 await weekly.enqueue(period);await weekly.processOne(period.periodKey);let issues=await weekly.list();assert.equal(issues.length,1);assert.equal(issues[0].newcomers.length,1);assert.equal(issues[0].news[0].summary,'Public original');assert.equal(calls,1);
 db.sqlite.prepare('UPDATE tower_residencies SET announcement_consent=0').run();issues=await weekly.list();assert.deepEqual(issues[0].news,[]);assert.deepEqual(issues[0].newcomers,[]);assert.equal(issues[0].residentCount,1);assert.equal(calls,1);
 }finally{db.close();}
});
test('source SQL vector guards reject withdrawal between fresh read and atomic publish, preserving paid receipt',async()=>{
 const db=fixture();try{resident(db,'a'.repeat(16));const sources=createPublicationSources({db,origin:'https://tower.example',aggregateApproved:true});const original=db.batch.bind(db);let revoked=false;db.batch=async statements=>{if(statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO tower_weekly_issues'))){revoked=true;db.sqlite.exec('UPDATE tower_residencies SET announcement_consent=0');}return original(statements);};
 const fetcher=(async(url)=>String(url).endsWith('input_tokens')?Response.json({input_tokens:500}):Response.json({id:'response-publication',model:'muse-spark-1.3',status:'completed',usage:{input_tokens:500,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({messageVariant:'inaugural-welcome',selectedEventIds:[]})}]}]})) as typeof fetch;
 const weekly=createTowerWeekly({db,...sources,apiKey:'synthetic',approved:true,budgetMicro:1000000,dailyBudgetMicro:1000000,monthlyBudgetMicro:1000000,fetcher,now:()=>new Date()});await weekly.enqueue(period);await weekly.processOne(period.periodKey);assert(revoked);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM tower_weekly_issues').get()!.n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM tower_weekly_outbox').get()!.n,0);assert.equal(db.sqlite.prepare('SELECT actual_micro FROM manager_jobs').get()!.actual_micro,1050);
 }finally{db.close();}
});

function legacyJournal(db:LocalDatabase,roomId:string,{id='stale-post',withdrawn=false}={}){
 db.sqlite.prepare("INSERT INTO posts(id,room_id,kind,title,body,is_public,created_at,request_key,input_hash,withdrawn_at) VALUES(?,?,'journal','Stale legacy journal','Private after snapshot deletion',1,'2026-11-02T16:00:00.000Z',?,'hash',?)").run(id,roomId,'seed-daily-entry-1',withdrawn?'2026-11-03T12:00:00.000Z':null);
}
test('deleted snapshot journal cannot reappear through a stale seeded legacy post',async()=>{
 const db=fixture();try{const id='a'.repeat(16);resident(db,id);legacyJournal(db,id);
 const sources=createPublicationSources({db,origin:'https://tower.example',aggregateApproved:true});
 const before=await sources.readSource(period);assert(before.events.some(e=>e.title==='Snapshot journal'));
 db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,2,?,?,?)').run(id,JSON.stringify({home:{daily:[{id:'note-2',type:'note',title:'A public note',body:'Other activity',occurredAt:'2026-11-02T16:00:00Z'}]}}),'b'.repeat(64),'2026-11-03T12:00:00.000Z');
 db.sqlite.prepare('UPDATE tower_residencies SET public_revision=2,publication_epoch=2 WHERE room_id=?').run(id);
 const after=await sources.readSource(period);assert.deepEqual(after.events,[]);assert.deepEqual(sources.journals(after),[]);assert.notEqual(before.sourceDigest,after.sourceDigest);
 }finally{db.close();}
});
test('empty or missing snapshot daily never falls back to legacy journals',async()=>{
 const db=fixture();try{for(const [letter,home] of [['a',{daily:[]}],['b',{}]] as const){const id=letter.repeat(16);resident(db,id);legacyJournal(db,id,{id:'legacy-'+letter});db.sqlite.prepare('UPDATE tower_snapshots SET public_json=? WHERE room_id=?').run(JSON.stringify({home}),id);}
 const source=await readPublicationSource({db,origin:'https://tower.example',aggregateApproved:true},period);assert.equal(source.residents.length,2);assert.deepEqual(source.events,[]);
 }finally{db.close();}
});
test('legacy withdrawal cannot override an authorized snapshot and snapshot lineage survives republish',async()=>{
 const db=fixture();try{const id='a'.repeat(16);resident(db,id);legacyJournal(db,id,{id:'entry-1',withdrawn:true});
 const sources=createPublicationSources({db,origin:'https://tower.example',aggregateApproved:true});const before=await sources.readSource(period);assert.deepEqual(before.events.map(e=>e.title),['Snapshot journal']);
 assert.equal(sources.journals(before)[0].sourceKind,'tower-snapshot');assert.equal(sources.journals(before)[0].sourceKey,'tower-snapshot:'+id+':entry-1');
 db.sqlite.prepare('INSERT INTO tower_snapshots SELECT room_id,2,public_json,content_digest,created_at FROM tower_snapshots WHERE room_id=? AND revision=1').run(id);db.sqlite.prepare('UPDATE tower_residencies SET public_revision=2,publication_epoch=2 WHERE room_id=?').run(id);
 const after=await sources.readSource(period);assert.equal(sources.journals(after)[0].sourceKey,sources.journals(before)[0].sourceKey);assert.equal(after.events[0].id,before.events[0].id);assert.notEqual(after.sourceDigest,before.sourceDigest);
 }finally{db.close();}
});
test('published legacy home without Tower residency is not a Tower publication source',async()=>{
 const db=fixture();try{const id='a'.repeat(16);resident(db,id,{snapshot:false});legacyJournal(db,id);
 const sources=createPublicationSources({db,origin:'https://tower.example',aggregateApproved:true});const source=await sources.readSource(period);assert.equal(source.residentCount,0);assert.deepEqual(source.residents,[]);assert.deepEqual(source.events,[]);assert.deepEqual(sources.journals(source),[]);
 }finally{db.close();}
});

test('daily strict as-of requires explicit publication and snapshot times while weekly keeps current-public scope',async()=>{
 const db=fixture();try{const id='a'.repeat(16);resident(db,id);const sources=createPublicationSources({db,origin:'https://tower.example',aggregateApproved:false});
 assert.equal(sources.journals(await sources.readSource(period)).length,1);
 assert.equal(sources.journals(await sources.readSource(period,{strictAsOf:true})).length,0);
 db.sqlite.prepare('UPDATE tower_residencies SET published_at=? WHERE room_id=?').run(period.cutoffAt,id);
 const atCutoff=await sources.readSource(period,{strictAsOf:true});assert.equal(sources.journals(atCutoff).length,1);
 db.sqlite.prepare("UPDATE tower_residencies SET published_at='2026-11-03T17:00:00.001Z' WHERE room_id=?").run(id);
 await assert.rejects(db.batch(sources.publicationGuards(atCutoff)));assert.equal(sources.journals(await sources.readSource(period,{strictAsOf:true})).length,0);assert.equal(sources.journals(await sources.readSource(period)).length,1);
 db.sqlite.prepare('UPDATE tower_residencies SET published_at=? WHERE room_id=?').run(period.cutoffAt,id);db.sqlite.prepare("UPDATE tower_snapshots SET created_at='2026-11-03T17:00:00.001Z' WHERE room_id=?").run(id);
 assert.equal(sources.journals(await sources.readSource(period,{strictAsOf:true})).length,0);assert.equal(sources.journals(await sources.readSource(period)).length,1);
 }finally{db.close();}
});
