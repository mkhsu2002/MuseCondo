import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LocalDatabase } from '../server/live/local-db.ts';
import { inspectRecovery, closeRecovery } from '../server/live/recovery.ts';
import { createLiveApp,digest } from '../server/live/app.ts';
const account='a'.repeat(32),room='b'.repeat(16),job='c'.repeat(32),at='2026-10-29T00:00:00.000Z';
function setup(){const db=new LocalDatabase(':memory:');for(const file of ['0001_live_mvp.sql','0002_recovery_audit.sql'])db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,'private-login-hash',at);db.sqlite.prepare('INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,?,?,?,?,?)').run(room,account,'Home','Intro','Role','recovery',at);db.sqlite.prepare('INSERT INTO generation_jobs(id,account_id,room_id,input_hash,provider_key,state,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(job,account,room,'input-hash','PRIVATE_PROVIDER_KEY','recovery',1,at,at);return db;}
const input=()=>({jobId:job,expectedUpdatedAt:at,outcome:'abandoned-unknown' as const,evidenceRef:'incident:2026-042',operatorRef:'operator:K',attestEvidenceReviewed:true as const});
test('offline inspection is allowlisted; closure is auditable, atomic and terminal',async()=>{const db=setup();try{
 const i=await inspectRecovery(db,job);assert.equal(i.closable,true);assert(!JSON.stringify(i).includes('PRIVATE'));assert(!JSON.stringify(i).includes(account));
 const c=await closeRecovery(db,input(),new Date('2026-10-29T01:00:00.000Z'));assert.equal(c.state,'closed-unknown');assert.equal(c.providerOutcomeVerifiedBySystem,false);assert.equal(c.regenerationAllowed,false);
 assert.equal(db.sqlite.prepare('SELECT state FROM generation_jobs').get()!.state,'closed-unknown');assert.equal(db.sqlite.prepare('SELECT generation_state FROM rooms').get()!.generation_state,'closed-unknown');assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM recovery_audit').get()!.n,1);
 await assert.rejects(closeRecovery(db,input()),/closure_conflict/);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM recovery_audit').get()!.n,1);
}finally{db.close();}});
test('closure rejects stale version, active running, existing assets, missing or sensitive evidence',async()=>{const db=setup();try{
 await assert.rejects(closeRecovery(db,{...input(),expectedUpdatedAt:'2026-10-28T00:00:00.000Z'}),/closure_conflict/);
 for(const ref of ['', 'https://example.org/private?token=x','LLM_private_key','Bearer:abc','password:abc'])await assert.rejects(closeRecovery(db,{...input(),evidenceRef:ref}),/reviewed_evidence/);
 await assert.rejects(closeRecovery(db,{...input(),attestEvidenceReviewed:false as unknown as true}),/reviewed_evidence/);
 db.sqlite.prepare("UPDATE generation_jobs SET state='running'").run();await assert.rejects(closeRecovery(db,input()),/closure_conflict/);
 db.sqlite.prepare("UPDATE generation_jobs SET state='recovery'").run();db.sqlite.prepare('INSERT INTO assets(id,room_id,purpose,mime,digest,provenance) VALUES(?,?,?,?,?,?)').run('asset',room,'home-desktop','image/png','hash','{}');await assert.rejects(closeRecovery(db,input()),/closure_conflict/);
 assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM recovery_audit').get()!.n,0);assert.equal(db.sqlite.prepare('SELECT state FROM generation_jobs').get()!.state,'recovery');
}finally{db.close();}});
test('competing operators cannot both close a job and closed jobs never call generator',async()=>{const db=setup();try{
 const attempts=await Promise.allSettled([closeRecovery(db,{...input(),outcome:'provider-confirmed-no-output'}),closeRecovery(db,input())]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM recovery_audit').get()!.n,1);
 let calls=0;const app=createLiveApp({db,origin:'http://local',localTest:true,registrationEnabled:false,generator:{kind:'local-test',async generate(){calls++;throw Error('must not run');}}});
 const token='d'.repeat(64),csrf='e'.repeat(64);db.sqlite.prepare('INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)').run(await digest(token),account,csrf,'2099-01-01T00:00:00.000Z');
 const response=await app.fetch(new Request('http://local/api/v1/me/generation',{method:'POST',headers:{Origin:'http://local',Cookie:`muse_session=${token}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{}'}));assert.equal(response.status,200);assert.match((await response.json()).job.state,/^closed-/);assert.equal(calls,0);
}finally{db.close();}});
test('late provider success cannot overwrite operator closure after stale-running recovery',async()=>{
 const db=setup();try{
  db.sqlite.prepare("UPDATE generation_jobs SET state='prepared',attempts=0").run();db.sqlite.prepare("UPDATE rooms SET generation_state='prepared'").run();
  db.sqlite.prepare('INSERT INTO private_profiles(account_id,personality,input_hash,analysis_consent,created_at) VALUES(?,?,?,?,?)').run(account,'PRIVATE_MINIMAL_PROFILE','input-hash',1,at);
  let time=new Date(at),calls=0,release!:()=>void,started!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;}),providerStarted=new Promise<void>(resolve=>{started=resolve;});
  const app=createLiveApp({db,origin:'http://local',localTest:true,registrationEnabled:false,now:()=>time,generator:{kind:'local-test',async generate(){
   calls++;started();await waiting;
   return (['home-desktop','home-mobile'] as const).map(purpose=>({purpose,mime:'image/png' as const,bytes:Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZxkAAAAASUVORK5CYII=','base64')),provenance:{provider:'local-test' as const,model:null,metadataSource:null,generatedAt:time.toISOString(),promptVersion:'test-only',generationId:'late-'+purpose,prompt:'PRIVATE_PROMPT'}}));
  }}});
  const token='f'.repeat(64),csrf='a'.repeat(64);db.sqlite.prepare('INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)').run(await digest(token),account,csrf,'2099-01-01T00:00:00.000Z');
  const request=(path:string,method='GET')=>new Request('http://local/api/v1'+path,{method,headers:{Origin:'http://local',Cookie:`muse_session=${token}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
  const pending=app.fetch(request('/me/generation','POST'));await providerStarted;
  assert.equal(db.sqlite.prepare('SELECT state FROM generation_jobs').get()!.state,'running');
  time=new Date(time.getTime()+10*60*1000+1);
  const status=await app.fetch(request('/me'));assert.equal(status.status,200);assert.equal((await status.json()).job.state,'recovery');
  const inspection=await inspectRecovery(db,job);assert.equal(inspection.closable,true);
  await closeRecovery(db,{...input(),expectedUpdatedAt:inspection.updatedAt},time);
  release();const returned=await pending;assert.equal(returned.status,200);assert.equal((await returned.json()).job.state,'closed-unknown');
  assert.equal(db.sqlite.prepare('SELECT state FROM generation_jobs').get()!.state,'closed-unknown');
  assert.equal(db.sqlite.prepare('SELECT generation_state FROM rooms').get()!.generation_state,'closed-unknown');
  for(const table of ['assets','asset_chunks'])assert.equal(db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,0);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM recovery_audit').get()!.n,1);
  const retried=await app.fetch(request('/me/generation','POST'));assert.equal(retried.status,200);assert.equal((await retried.json()).job.state,'closed-unknown');assert.equal(calls,1);
 }finally{db.close();}
});
