import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import type {Database,Statement} from '../server/live/db.ts';
import {createTowerIntake} from '../server/live/tower-intake.ts';
const origin='https://tower.example',now='2026-10-30T00:00:00.000Z',base='/api/v1/tower/activities',op='/api/v1/operator/tower/activities',own='/api/v1/me/tower-intake/activities';
const sha=async(s:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
async function fixture(){
 const db=new LocalDatabase(':memory:');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 for(const id of ['a','b']){
  db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(id,await sha(id.repeat(64)),now);
  db.sqlite.prepare('INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)').run(await sha(id.repeat(64)),id,'csrf-'+id,'2027-01-01T00:00:00Z');
  const room=id.repeat(16);db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at) VALUES(?,?,'PRIVATE NAME','test','resident',1,'external-ready',?)").run(room,id,now);
  db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,revision,public_revision,snapshot_consent,created_at,updated_at) VALUES(?,?,?,?, 'challenge',1,1,1,?,?)").run(room,id,'synthetic-'+id,'https://'+id+'.example/condo.json',now,now);
  db.sqlite.prepare('INSERT INTO tower_snapshots(room_id,revision,public_json,content_digest,created_at) VALUES(?,1,?,?,?)').run(room,JSON.stringify({home:{name:'Public Synthetic '+id}}),'synthetic',now);
 }
 let hook:(()=>void)|null=null,operatorValid=true;
 const wrapped:Database={prepare:sql=>db.prepare(sql),batch:async(s:Statement[])=>{const fn=hook;hook=null;fn?.();return db.batch(s);}};
 const app=createTowerIntake({db:wrapped,origin,localTest:false,sourceOrigins:[],now:()=>new Date(now),operator:async(req:Request)=>operatorValid&&req.headers.get('X-Tower-Operator-Key')==='synthetic-operator',fetcher:async()=>{throw new Error('No paid or source calls');}});
 async function req(path:string,method='GET',body?:unknown,identity='anonymous',extra:Record<string,string>={}){
  const headers:Record<string,string>={'Content-Type':'application/json'};if(identity==='operator')headers['X-Tower-Operator-Key']='synthetic-operator';else if(identity!=='anonymous'){headers.Cookie='muse_session='+identity.repeat(64);headers.Origin=origin;headers['X-CSRF-Token']='csrf-'+identity;}
  Object.assign(headers,extra);const res=await app.fetch(new Request(origin+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}));assert.ok(res,'activity route handled');return res;
 }
 const create=(extra={},key=crypto.randomUUID())=>req(op,'POST',{id:'synthetic-window',title:'A synthetic moment',description:'Voluntary synthetic activity.',state:'open',requestKey:key,...extra},'operator');
 const act=(action='join',version=0,extra={},identity='a',key=crypto.randomUUID())=>req(own+'/synthetic-window/participation','POST',{action,expectedVersion:version,requestKey:key,...extra},identity);
 return {db,req,create,act,hook:(fn:()=>void)=>{hook=fn;},revokeOperator:()=>{operatorValid=false;}};
}
test('operator-only draft/open/closed activities and private independent consent; no fake outcomes',async()=>{
 const f=await fixture();try{
  assert.equal((await f.req(op,'POST',{},'a')).status,403);
  assert.equal((await f.req(op,'POST',{})).status,401);
  assert.equal((await f.create({state:'draft'})).status,201);
  assert.deepEqual((await (await f.req(base)).json()).activities,[]);
  assert.equal((await f.req(base+'/synthetic-window')).status,404);
  const update={expectedVersion:1,requestKey:crypto.randomUUID(),title:'Window',description:'Choose freely.',state:'open'};
  assert.equal((await f.req(op+'/synthetic-window','POST',update,'operator')).status,200);
  assert.equal((await f.act()).status,200);
  let pub=await (await f.req(base+'/synthetic-window')).json();assert.deepEqual(pub.participants,[]);
  assert.equal((await f.act('join',1,{showParticipation:true})).status,200);
  pub=await (await f.req(base+'/synthetic-window')).json();assert.equal(pub.participants[0].name,'Public Synthetic a');
  assert.doesNotMatch(JSON.stringify(pub),/PRIVATE|account|declined|left|xp|score|result|token/i);
  assert.equal((await f.act('decline',2)).status,200);assert.deepEqual((await (await f.req(base+'/synthetic-window')).json()).participants,[]);
  assert.equal((await f.act('join',3)).status,200);assert.deepEqual((await (await f.req(base+'/synthetic-window')).json()).participants,[]);
  assert.equal((await f.act('leave',4)).status,200);const me=await (await f.req(own+'/synthetic-window','GET',undefined,'a')).json();assert.equal(me.participation.state,'left');
  const other=await (await f.req(own+'/synthetic-window','GET',undefined,'b')).json();assert.equal(other.participation.state,'none');
  assert.equal((await f.req(op+'/synthetic-window','POST',{...update,expectedVersion:2,requestKey:crypto.randomUUID(),state:'closed'},'operator')).status,200);
  assert.equal((await f.act('join',5)).status,409);
 }finally{f.db.close();}
});
test('permanent replay never restores participation; CAS, home closure, session and operator guards are atomic',async()=>{
 const f=await fixture();try{
  const createKey=crypto.randomUUID();assert.equal((await f.create({},createKey)).status,201);assert.equal((await f.create({},createKey)).status,201);
  const key=crypto.randomUUID();assert.equal((await f.act('join',0,{showParticipation:true},'a',key)).status,200);
  assert.equal((await f.act('leave',1)).status,200);assert.equal((await f.act('join',0,{showParticipation:true},'a',key)).status,200);
  assert.deepEqual((await (await f.req(base+'/synthetic-window')).json()).participants,[]);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_activity_participation').get()?.n,1);
  assert.equal((await f.act('join',0)).status,409);
  f.hook(()=>f.db.sqlite.prepare('DELETE FROM sessions WHERE account_id=?').run('b'));
  assert.equal((await f.act('join',0,{},'b')).status,403);
  f.db.sqlite.prepare('UPDATE tower_residencies SET snapshot_consent=0 WHERE account_id=?').run('a');
  assert.equal((await f.act('join',2,{showParticipation:true})).status,200);assert.deepEqual((await (await f.req(base+'/synthetic-window')).json()).participants,[]);
  const update={title:'Changed',description:'Safe',state:'closed',expectedVersion:1,requestKey:crypto.randomUUID()};
  f.revokeOperator();assert.equal((await f.req(op+'/synthetic-window','POST',update,'operator')).status,401);
  assert.equal(f.db.sqlite.prepare('SELECT version FROM tower_activities').get()?.version,1);
  assert.doesNotMatch(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM tower_activity_audit').all()),/Voluntary synthetic|Choose freely|PRIVATE/);
 }finally{f.db.close();}
});
test('strict JSON bounds, no URL keys, scope isolation, limited lists and audit rollback',async()=>{
 const f=await fixture();try{
  assert.equal((await f.create({unknown:true})).status,400);assert.equal((await f.create({description:'x'.repeat(9000)})).status,413);
  assert.equal((await f.create({startsAt:'tomorrow'})).status,400);assert.equal((await f.create({startsAt:'2026-11-01T00:00:00.000Z',endsAt:'2026-10-01T00:00:00.000Z'})).status,400);
  assert.equal((await f.create()).status,201);
  assert.equal((await f.req(own+'/synthetic-window/participation','POST',{action:'join',expectedVersion:0,requestKey:crypto.randomUUID()},'a',{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await f.act('join',0,{reason:'not required'})).status,400);
  assert.equal((await f.req(base+'?key=secret')).status,400);assert.equal((await f.req(own+'/synthetic-window')).status,401);
  const token='f'.repeat(64);f.db.sqlite.prepare('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)').run('synthetic-token','a',await sha(token),'["tower:read"]','2027-01-01T00:00:00Z',now);
  assert.equal((await f.req('/api/v1/agent/tower-intake/activities/synthetic-window','GET',undefined,'anonymous',{Authorization:'Bearer '+token})).status,200);
  assert.equal((await f.req('/api/v1/agent/tower-intake/activities/synthetic-window/participation','POST',{},'anonymous',{Authorization:'Bearer '+token})).status,403);
  f.db.sqlite.exec("CREATE TRIGGER synthetic_activity_failure BEFORE INSERT ON tower_audit BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  assert.equal((await f.act()).status,503);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_activity_participation').get()?.n,0);
 }finally{f.db.close();}
});
test('concurrent identical choices have one durable receipt; changed CAS and revoked write token roll back',async()=>{
 const f=await fixture();try{
  await f.create();const key=crypto.randomUUID(),responses=await Promise.all([f.act('join',0,{},'a',key),f.act('join',0,{},'a',key)]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_audit WHERE action='activity-join'").get()?.n,1);
  assert.equal((await f.act('join',0,{showParticipation:true},'a',key)).status,409);
  const race=await Promise.all([f.act('leave',1),f.act('decline',1)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  f.hook(()=>f.db.sqlite.prepare("UPDATE tower_activities SET state='closed',version=2").run());assert.equal((await f.act('join',0,{},'b')).status,409);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_activity_participation WHERE account_id='b'").get()?.n,0);
  f.db.sqlite.prepare("UPDATE tower_activities SET state='open',version=3").run();
  const token='f'.repeat(64);f.db.sqlite.prepare('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)').run('synthetic-write','b',await sha(token),'["tower:read","tower:write"]','2027-01-01T00:00:00Z',now);
  f.hook(()=>f.db.sqlite.prepare("UPDATE tower_tokens SET revoked=1 WHERE id='synthetic-write'").run());
  assert.equal((await f.req('/api/v1/agent/tower-intake/activities/synthetic-window/participation','POST',{action:'join',showParticipation:true,expectedVersion:0,requestKey:crypto.randomUUID()},'anonymous',{Authorization:'Bearer '+token})).status,403);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_audit WHERE account_id='b'").get()?.n,0);
 }finally{f.db.close();}
});
test('activity and participant keyset pages cap at 50; private choices never leak into public lists',async()=>{
 const f=await fixture();try{
  const insert=f.db.sqlite.prepare('INSERT INTO tower_activities VALUES(?,?,?,NULL,NULL,?,1,?,?)');for(let i=0;i<52;i++)insert.run('synthetic-'+i.toString().padStart(2,'0'),'Synthetic','Only synthetic data','open',now,now);
  for(const path of [base,op,own]){
   const who=path===op?'operator':path===own?'a':'anonymous',first=await(await f.req(path,'GET',undefined,who)).json();assert.equal(first.activities.length,50);const second=await(await f.req(path+'?cursor='+encodeURIComponent(first.nextCursor),'GET',undefined,who)).json();assert.equal(second.activities.length,2);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.activities,...second.activities].map((a:{id:string})=>a.id)).size,52);
  }
  const accountInsert=f.db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)'),roomInsert=f.db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at) VALUES(?,?,'PRIVATE','test','resident',1,'external-ready',?)"),residentInsert=f.db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,revision,public_revision,snapshot_consent,created_at,updated_at) VALUES(?,?,?,?,'challenge',1,1,1,?,?)"),snapshotInsert=f.db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,1,?,?,?)'),participationInsert=f.db.sqlite.prepare("INSERT INTO tower_activity_participation VALUES('synthetic-00',?,?, 'joined',1,1,?)");
  for(let i=0;i<52;i++){const account='synthetic-'+i,room=i.toString(16).padStart(16,'0');accountInsert.run(account,await sha(account),now);roomInsert.run(room,account,now);residentInsert.run(room,account,account,'https://'+account+'.example/condo.json',now,now);snapshotInsert.run(room,JSON.stringify({home:{name:'Public '+i}}),'synthetic',now);participationInsert.run(account,room,now);}
  const first=await(await f.req(base+'/synthetic-00')).json();assert.equal(first.participants.length,50);const next=await(await f.req(base+'/synthetic-00?cursor='+first.nextCursor)).json();assert.equal(next.participants.length,2);assert.equal(next.nextCursor,null);assert.doesNotMatch(JSON.stringify(first),/PRIVATE|account_id|show_participation|declined|left/);
  f.db.sqlite.prepare("UPDATE tower_residencies SET public_revision=NULL WHERE account_id='synthetic-0'").run();const closed=await(await f.req(base+'/synthetic-00')).json();assert.equal(closed.participants.some((p:{name:string})=>p.name==='Public 0'),false);
 }finally{f.db.close();}
});
test('global activity capacity, per-home joined capacity, rate and schedule are enforced without blocking exit',async()=>{
 const f=await fixture();try{
  await f.create({startsAt:'2026-11-01T00:00:00.000Z'});assert.equal((await f.act()).status,409);
  f.db.sqlite.prepare('UPDATE tower_activities SET starts_at=NULL,ends_at=?').run('2026-10-01T00:00:00.000Z');assert.equal((await f.act()).status,409);
  f.db.sqlite.prepare('UPDATE tower_activities SET ends_at=NULL').run();
  const insert=f.db.sqlite.prepare("INSERT INTO tower_activities VALUES(?,?,?,NULL,NULL,'open',1,?,?)");for(let i=0;i<20;i++){const id='synthetic-'+i;insert.run(id,'Synthetic','Safe',now,now);f.db.sqlite.prepare("INSERT INTO tower_activity_participation VALUES(?,'a',?,'joined',0,1,?)").run(id,'a'.repeat(16),now);}
  assert.equal((await f.act()).status,409);f.db.sqlite.prepare("DELETE FROM tower_activity_participation WHERE activity_id='synthetic-0'").run();assert.equal((await f.act()).status,200);
  const receipt=f.db.sqlite.prepare("INSERT INTO tower_requests VALUES('a',?,'activity-join','synthetic','{}',?)");for(let i=0;i<20;i++)receipt.run('synthetic-quota-'+i,now);
  assert.equal((await f.act('join',1,{showParticipation:true})).status,429);assert.equal((await f.act('leave',1)).status,200);assert.equal((await f.act('decline',2)).status,200);
  for(let i=20;i<99;i++)insert.run('synthetic-'+i,'Synthetic','Safe',now,now);
  assert.equal((await f.create({id:'over-capacity'})).status,409);
 }finally{f.db.close();}
});
for(const value of [['open'],{},null,1,true])test('activity state rejects non-string '+JSON.stringify(value),async()=>{
 const f=await fixture();try{assert.equal((await f.create({state:value})).status,400);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_activities').get()?.n,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_activity_operator_requests').get()?.n,0);}finally{f.db.close();}
});
for(const value of [['join'],{},null,1,true])test('participation action rejects non-string '+JSON.stringify(value),async()=>{
 const f=await fixture();try{await f.create();assert.equal((await f.req(own+'/synthetic-window/participation','POST',{action:value,expectedVersion:0,requestKey:crypto.randomUUID()},'a')).status,400);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_activity_participation').get()?.n,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_requests').get()?.n,0);}finally{f.db.close();}
});
test('operator duplicate requests, competing versions and audit failure are atomic',async()=>{
 const f=await fixture();try{
  const key=crypto.randomUUID(),both=await Promise.all([f.create({},key),f.create({},key)]);assert.deepEqual(both.map(r=>r.status),[201,201]);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_activity_audit').get()?.n,1);
  const input={title:'Changed',description:'Synthetic',state:'closed',expectedVersion:1,requestKey:crypto.randomUUID()};
  f.hook(()=>f.db.sqlite.prepare('UPDATE tower_activities SET version=2').run());assert.equal((await f.req(op+'/synthetic-window','POST',input,'operator')).status,409);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_activity_audit').get()?.n,1);
  f.db.sqlite.exec("CREATE TRIGGER synthetic_operator_audit_failure BEFORE INSERT ON tower_activity_audit BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  assert.equal((await f.req(op+'/synthetic-window','POST',{...input,expectedVersion:2,requestKey:crypto.randomUUID()},'operator')).status,503);
  assert.equal(f.db.sqlite.prepare('SELECT state FROM tower_activities').get()?.state,'open');assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_activity_operator_requests').get()?.n,1);
 }finally{f.db.close();}
});
test('operator callback is rechecked immediately before commit',async()=>{
 const f=await fixture();try{
  let calls=0;const app=createTowerIntake({db:f.db,origin,localTest:false,sourceOrigins:[],now:()=>new Date(now),operator:async()=>++calls===1});
  const res=await app.fetch(new Request(origin+op,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'synthetic-recheck',title:'Synthetic',description:'Synthetic',state:'open',requestKey:'synthetic-recheck'})}));assert.equal(res?.status,401);assert.equal(calls,2);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_activities').get()?.n,0);
 }finally{f.db.close();}
});
