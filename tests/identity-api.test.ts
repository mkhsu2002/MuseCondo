import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import type {Statement} from '../server/live/db.ts';
import runtime from '../server/live/worker.ts';
import {validateIdentityRecord} from '../src/identity/index.ts';
const origin='https://identity.example',time='2026-10-31T00:00:00.000Z',path='/api/v1/agent/identity';
const sha=async(v:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))).toString('hex');
async function fixture(){
 const db=new LocalDatabase(':memory:');
 for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 openSyntheticTower(db);
 for(const x of ['a','b']){
  const account=x.repeat(16),room=x.repeat(16),resident=(x==='a'?'c':'d').repeat(16);
  db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,await sha(x+'login'),time);
  db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Test','Test','resident','external-ready',?)").run(room,account,time);
  db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)").run(room,account,resident,'https://source.example/'+x,time,time);
  db.sqlite.prepare('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)').run(x,account,await sha(x.repeat(64)),JSON.stringify(['tower:read','tower:write']),'2027-01-01T00:00:00.000Z',time);
 }
 db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run('e'.repeat(16),await sha('extra'),time);
 let now=new Date(time);
 db.sqlite.function('strftime',(format,source)=>{assert.equal(format,'%Y-%m-%dT%H:%M:%fZ');assert.equal(source,'now');return now.toISOString();});
 let handler:{fetch(r:Request):Promise<Response|null>}|undefined;
 if(existsSync(new URL('../server/live/identity.ts',import.meta.url))){const {createAgentIdentity}=await import('../server/live/identity.ts');handler=createAgentIdentity({db,origin,now:()=>now});}
 const send=(r:Request)=>handler?handler.fetch(r):runtime.fetch(r,{DB:db,PUBLIC_ORIGIN:origin});
 const input={requestKey:'enroll-0001',expectedResidencyRevision:1,residentId:'c'.repeat(16),recoveryConsent:true};
 const req=(suffix='',method='GET',body:unknown=undefined,token='a',headers:Record<string,string>={})=>send(new Request(origin+path+suffix,{method,headers:{Authorization:'Bearer '+token.repeat(64),...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 const count=(table:string)=>Number(db.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get()!.n);
 return {db,input,req,send,count,setTime:(s:string)=>{now=new Date(s);}};
}
test('enrollment persists one provisional independent identity, exact portable record and no Tower side effects',async()=>{
 const f=await fixture();try{
  assert.deepEqual(await(await f.req())!.json(),{identity:null});assert.equal((await f.req('/record'))!.status,404);
  const tables=f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('agent_identities','identity_requests','identity_audit','identity_rate_attempts','rate_limits')").all().map(r=>String(r.name));
  const before=Object.fromEntries(tables.map(t=>[t,f.db.sqlite.prepare('SELECT * FROM '+t).all()]));
  const r=(await f.req('/enroll','POST',f.input))!;assert.equal(r.status,201);const result=await r.json();
  assert.deepEqual(Object.keys(result),['identity']);const i=result.identity;assert.match(i.agentId,/^mcid:[a-f0-9]{64}$/);assert.equal(i.state,'provisional');assert.equal(i.version,1);assert.equal(i.authorityEpoch,1);assert.equal(i.recoveryConfigured,false);assert.equal(i.issuanceReady,false);assert.equal(i.residentId,f.input.residentId);
  assert.deepEqual(await(await f.req())!.json(),result);const record=await(await f.req('/record'))!.json();assert.equal(validateIdentityRecord(record),true);assert.deepEqual(record,{version:'0.01',agentId:i.agentId,createdAt:time});
  assert.equal(f.count('agent_identities'),1);assert.equal(f.count('identity_requests'),1);assert.equal(f.count('identity_audit'),1);assert.equal(f.count('identity_rate_attempts'),1);
  for(const [t,rows] of Object.entries(before))assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM '+t).all(),rows,t);
  assert.deepEqual(await(await f.req('', 'GET',undefined,'b'))!.json(),{identity:null});assert.equal((await f.req('/record','GET',undefined,'b'))!.status,404);
 }finally{f.db.close();}
});
test('permanent receipts bind exact operation and input, require current authorization and never allocate twice',async()=>{
 const f=await fixture();try{
  const first=(await f.req('/enroll','POST',f.input))!;assert.equal(first.status,201);const data=await first.json();
  f.db.sqlite.prepare('UPDATE tower_residencies SET revision=2').run();
  assert.deepEqual(await(await f.req('/enroll','POST',f.input))!.json(),data);
  assert.equal((await f.req('/enroll','POST',{...f.input,expectedResidencyRevision:2}))!.status,409);
  assert.equal((await f.req('/enroll','POST',{...f.input,requestKey:'another-key',expectedResidencyRevision:2}))!.status,409);
  f.db.sqlite.prepare("UPDATE identity_requests SET operation='other'").run();assert.equal((await f.req('/enroll','POST',f.input))!.status,409);
  f.db.sqlite.prepare("UPDATE tower_tokens SET revoked=1 WHERE id='a'").run();assert.equal((await f.req('/enroll','POST',f.input))!.status,403);
  assert.equal(f.count('agent_identities'),1);assert.equal(f.count('identity_audit'),1);assert.equal(f.count('identity_requests'),1);
 }finally{f.db.close();}
});
test('strict transport, scoped Tower bearer and exact schema reject alternate authorization and inputs',async()=>{
 const f=await fixture();try{
  for(const headers of [{Cookie:'muse_session=ignored'},{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}] as Record<string,string>[])assert.equal((await f.req('/enroll','POST',f.input,'a',headers))!.status,403);
  assert.equal((await f.send(new Request('https://evil.example'+path,{headers:{Authorization:'Bearer '+'a'.repeat(64)}})))!.status,403);
  for(const auth of ['', 'Bearer '+'A'.repeat(64),'Bearer case-token'])assert.equal((await f.req('','GET',undefined,'a',{Authorization:auth,'X-Tower-Operator-Key':'operator'}))!.status,401);
  f.db.sqlite.prepare("UPDATE tower_tokens SET scopes='[\"tower:read\"]' WHERE id='a'").run();assert.equal((await f.req('/enroll','POST',f.input))!.status,403);assert.equal((await f.req())!.status,200);
  f.db.sqlite.prepare("UPDATE tower_tokens SET scopes='[\"tower:write\"]' WHERE id='a'").run();assert.equal((await f.req())!.status,403);
  f.db.sqlite.prepare("UPDATE tower_tokens SET scopes='[\"tower:read\",\"tower:write\"]' WHERE id='a'").run();
  for(const suffix of ['', '/record','/enroll'])for(const method of ['PUT','DELETE','PATCH','HEAD','OPTIONS'])assert.equal((await f.req(suffix,method))!.status,405);
  assert.equal((await f.req('/enroll'))!.status,405);assert.equal((await f.req('','POST',f.input))!.status,405);
  const invalid=[{},null,[],{...f.input,email:'private@example.com'},{...f.input,agentId:'mcid:'+'e'.repeat(64)},...['short','界'.repeat(8),'x'.repeat(97),'bad\nkey'].map(requestKey=>({...f.input,requestKey})),...[0,-1,1.5,'1'].map(expectedResidencyRevision=>({...f.input,expectedResidencyRevision})),{...f.input,recoveryConsent:false},{...f.input,residentId:'C'.repeat(16)}];
  for(const input of invalid)assert.equal((await f.req('/enroll','POST',input))!.status,400,JSON.stringify(input));
  assert.equal((await f.req('/enroll','POST',f.input,'a',{'Content-Type':'text/plain'}))!.status,415);
  assert.equal((await f.req('/enroll','POST',f.input,'a',{'Content-Type':'application/json; charset=latin1'}))!.status,415);
  const raw=(body:BodyInit,headers:Record<string,string>={})=>f.send(new Request(origin+path+'/enroll',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json',...headers},body,...(body instanceof ReadableStream?{duplex:'half' as const}:{})}));
  assert.equal((await raw(new Uint8Array([0xff])))!.status,400);assert.equal((await raw('{'))!.status,400);
  let reads=0;const stream=new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(4096).fill(32));if(reads===10)c.close();}});assert.equal((await raw(stream))!.status,413);assert(reads<10);
  const rejectingCancel=new ReadableStream({start(c){c.enqueue(new Uint8Array(8193));},cancel(){return Promise.reject(new Error('synthetic cancel failure'));}});assert.equal((await raw(rejectingCancel))!.status,413);
  assert.equal((await raw('{}',{'Content-Length':'8193'}))!.status,413);assert.equal(f.count('agent_identities'),0);
  assert.equal(await f.req('/arbitrary-id'),null);
 }finally{f.db.close();}
});
test('cross-account, stale revision, changed binding and expiry cannot enroll',async()=>{
 const f=await fixture();try{
  assert.equal((await f.req('/enroll','POST',f.input,'b'))!.status,409);
  assert.equal((await f.req('/enroll','POST',{...f.input,expectedResidencyRevision:2}))!.status,409);
  f.db.sqlite.prepare("UPDATE rooms SET account_id=? WHERE id=?").run('e'.repeat(16),'a'.repeat(16));assert.equal((await f.req('/enroll','POST',f.input))!.status,409);
  f.setTime('2027-01-01T00:00:00.000Z');assert.equal((await f.req('/enroll','POST',f.input))!.status,403);
  for(const t of ['agent_identities','identity_audit','identity_requests'])assert.equal(f.count(t),0);
 }finally{f.db.close();}
});
test('concurrent exact replays return one ID; competing keys return conflict',async()=>{
 for(const same of [true,false]){const f=await fixture();try{
  const results=await Promise.all([f.req('/enroll','POST',f.input),f.req('/enroll','POST',{...f.input,requestKey:same?f.input.requestKey:'competing-key'})]);
  assert.deepEqual(results.map(r=>r!.status).sort(),same?[201,201]:[201,409]);
  if(same)assert.deepEqual(await results[0]!.json(),await results[1]!.json());
  for(const t of ['agent_identities','identity_audit','identity_requests'])assert.equal(f.count(t),1);
 }finally{f.db.close();}}
});
test('commit guards roll back revocation, scope, account, expiry and live tuple races with no audit or receipt',async()=>{
 const mutations=[
  (f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare("UPDATE tower_tokens SET revoked=1 WHERE id='a'").run(),
  (f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare("UPDATE tower_tokens SET scopes='[\"tower:read\"]' WHERE id='a'").run(),
  (f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare("UPDATE tower_tokens SET account_id=? WHERE id='a'").run('b'.repeat(16)),
  (f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare("UPDATE tower_tokens SET expires_at=? WHERE id='a'").run(time),
  (f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare('UPDATE tower_residencies SET revision=2 WHERE account_id=?').run('a'.repeat(16)),
  (f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare('UPDATE tower_residencies SET account_id=? WHERE account_id=?').run('e'.repeat(16),'a'.repeat(16)),
  (f:Awaited<ReturnType<typeof fixture>>)=>{f.db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Test','Test','resident','external-ready',?)").run('f'.repeat(16),'e'.repeat(16),time);f.db.sqlite.prepare('UPDATE tower_residencies SET room_id=? WHERE account_id=?').run('f'.repeat(16),'a'.repeat(16));},
  (f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare('UPDATE tower_residencies SET resident_id=? WHERE account_id=?').run('e'.repeat(16),'a'.repeat(16)),
  (f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.prepare('UPDATE rooms SET account_id=? WHERE id=?').run('e'.repeat(16),'a'.repeat(16)),
 ];
 for(const [index,mutate] of mutations.entries()){const f=await fixture();try{
  const batch=f.db.batch.bind(f.db);f.db.batch=async(statements:Statement[])=>{if(statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO agent_identities')))mutate(f);return batch(statements);};
  assert.equal((await f.req('/enroll','POST',f.input))!.status,index<4?403:409,String(index));
  for(const t of ['agent_identities','identity_audit','identity_requests'])assert.equal(f.count(t),0);
 }finally{f.db.close();}}
});
test('guard creation re-reads current time and audit failure rolls the whole enrollment back',async()=>{
 const f=await fixture();try{
  const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{const result=await batch(statements);f.setTime('2027-01-01T00:00:00.000Z');return result;};
  assert.equal((await f.req('/enroll','POST',f.input))!.status,403);assert.equal(f.count('agent_identities'),0);
  f.db.batch=batch;f.setTime(time);f.db.sqlite.exec("CREATE TRIGGER fail_identity_audit BEFORE INSERT ON identity_audit BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  assert.equal((await f.req('/enroll','POST',f.input))!.status,503);for(const t of ['agent_identities','identity_audit','identity_requests'])assert.equal(f.count(t),0);
 }finally{f.db.close();}
});
test('database enforces strict IDs, immutable binding and identity cap; rate limits are account and global',async()=>{
 const f=await fixture();try{
  const expiry='2026-10-31T01:00:00.000Z';
  f.db.sqlite.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?)').run('identity:account:'+'a'.repeat(16),20,expiry);
  assert.equal((await f.req('/enroll','POST',f.input))!.status,429);f.db.sqlite.exec('DELETE FROM rate_limits');
  f.db.sqlite.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?)').run('identity:global',1000,expiry);assert.equal((await f.req('/enroll','POST',f.input))!.status,429);
  f.setTime(expiry);assert.equal((await f.req('/enroll','POST',f.input))!.status,201);
  for(const [column,value] of [['agent_id','mcid:'+'e'.repeat(64)],['account_id','b'.repeat(16)],['room_id','b'.repeat(16)],['resident_id','d'.repeat(16)],['created_at','2026-01-01T00:00:00.000Z']])assert.throws(()=>f.db.sqlite.prepare('UPDATE agent_identities SET '+column+'=?').run(value));
  assert.equal(f.db.sqlite.prepare('SELECT detail_json FROM identity_audit').get()!.detail_json,'{}');
 }finally{f.db.close();}
});
test('schema rejects malformed IDs and invalid identity versions, epochs, states and recovery flags',async()=>{
 const f=await fixture();try{
  const insert=f.db.sqlite.prepare('INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,version,authority_epoch,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const values=['mcid:'+'f'.repeat(64),'a'.repeat(16),'a'.repeat(16),'c'.repeat(16),1,1,'provisional',1,time,time];
  for(const [idx,bad] of [[0,'mcid:'+'f'.repeat(64)+'\u0000hidden'],[2,'a'.repeat(16)+'\u0000hidden'],[3,'c'.repeat(16)+'\u0000hidden'],[0,'mcid:'+'F'.repeat(64)],[0,'mcid:'+'f'.repeat(63)],[2,'A'.repeat(16)],[3,'c'.repeat(15)],[4,0],[5,0],[6,'unknown'],[7,0]] as const){const v=[...values];v[idx]=bad;assert.throws(()=>insert.run(...v));}
 }finally{f.db.close();}
});
test('the 10000 identity ceiling is guarded atomically and creates no receipt or audit',async()=>{
 const f=await fixture();try{
  f.db.sqlite.exec(`
   CREATE TEMP TABLE capacity_seed AS WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10000) SELECT i,printf('%016x',i) id FROM n;
   INSERT INTO accounts(id,login_hash,created_at) SELECT id,'capacity-'||id,'${time}' FROM capacity_seed;
   INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) SELECT id,id,'Test','Test','resident','external-ready','${time}' FROM capacity_seed;
   INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) SELECT id,id,id,'https://source.example/capacity/'||id,'challenge','${time}','${time}' FROM capacity_seed;
   INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,recovery_consent,created_at,updated_at) SELECT 'mcid:'||printf('%064x',i),id,id,id,1,'${time}','${time}' FROM capacity_seed;
  `);
  assert.equal((await f.req('/enroll','POST',f.input))!.status,409);assert.equal(f.count('agent_identities'),10000);assert.equal(f.count('identity_audit'),0);assert.equal(f.count('identity_requests'),0);
 }finally{f.db.close();}
});
test('machine onboarding makes the provisional boundary explicit and never solicits private identity material',()=>{
 const machine=JSON.parse(readFileSync(new URL('../public/identity-onboarding.json',import.meta.url),'utf8'));
 assert.equal(machine.mode,'provisional-only');assert.equal(machine.status.recoveryConfigured,false);assert.equal(machine.status.issuanceReady,false);assert.equal(machine.privacy.publicDirectory,false);
 assert.deepEqual(Object.keys(machine.enrollExample).sort(),['expectedResidencyRevision','recoveryConsent','requestKey','residentId']);
 assert(!JSON.stringify(machine).includes(String.fromCodePoint(0x4e3b,0x4eba)));
});
test('an identical replay delayed behind the first commit still returns the permanent receipt',async()=>{
 const f=await fixture();try{
  let charges=0;let release!:()=>void;const secondReady=new Promise<void>(resolve=>{release=resolve;});
  const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{const sql=statements.map(s=>(s as unknown as {sql:string}).sql);if(sql.some(s=>s.startsWith('INSERT INTO agent_identities')))await secondReady;if(sql.some(s=>s.startsWith('INSERT INTO rate_limits'))&&++charges===2){release();await first;}return batch(statements);};
  const first:Promise<Response|null>=f.req('/enroll','POST',f.input);const second=f.req('/enroll','POST',f.input);const results=await Promise.all([first,second]);assert.deepEqual(results.map(r=>r!.status),[201,201]);assert.deepEqual(await results[0]!.json(),await results[1]!.json());assert.equal(f.count('agent_identities'),1);assert.equal(f.count('identity_requests'),1);
  assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('identity:account:'+'a'.repeat(16))!.count,1);
  assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('identity:global')!.count,1);
 }finally{f.db.close();}
});

test('Pages runtime returns the same private identity contract and leaves arbitrary identity paths closed',async()=>{
 const f=await fixture();try{
  const env={DB:f.db,PUBLIC_ORIGIN:origin};
  const enrolled=await runtime.fetch(new Request(origin+path+'/enroll',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'},body:JSON.stringify(f.input)}),env);assert.equal(enrolled.status,201);const result=await enrolled.json();
  const get=await runtime.fetch(new Request(origin+path,{headers:{Authorization:'Bearer '+'a'.repeat(64)}}),env);assert.deepEqual(await get.json(),result);
  assert.equal((await runtime.fetch(new Request(origin+path+'/'+result.identity.agentId,{headers:{Authorization:'Bearer '+'b'.repeat(64)}}),env)).status,404);
 }finally{f.db.close();}
});

test('the initial identity version is one and can advance for future authority transitions',async()=>{
 const f=await fixture();try{
  assert.equal((await f.req('/enroll','POST',f.input))!.status,201);
  f.db.sqlite.prepare('UPDATE agent_identities SET version=version+1,authority_epoch=authority_epoch+1').run();
  const stored=f.db.sqlite.prepare('SELECT version,authority_epoch FROM agent_identities').get()!;assert.equal(stored.version,2);assert.equal(stored.authority_epoch,2);
  assert.throws(()=>f.db.sqlite.prepare('UPDATE agent_identities SET version=0').run());assert.throws(()=>f.db.sqlite.prepare('UPDATE agent_identities SET version=1.5').run());
 }finally{f.db.close();}
});

test('the SQL clock rejects a token that expires while its enrollment batch is queued',async()=>{
 const f=await fixture();try{
  const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{if(statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO agent_identities')))f.setTime('2027-01-01T00:00:00.001Z');return batch(statements);};
  assert.equal((await f.req('/enroll','POST',f.input))!.status,403);
  for(const table of ['agent_identities','identity_audit','identity_requests'])assert.equal(f.count(table),0);
 }finally{f.db.close();}
});
test('permanent rate reservations count distinct invalid keys, bind failed input and survive exhausted quota',async()=>{
 const f=await fixture();try{
  const bad={...f.input,expectedResidencyRevision:2};
  for(let i=0;i<20;i++)assert.equal((await f.req('/enroll','POST',{...bad,requestKey:'invalid-key-'+i}))!.status,409);
  assert.equal(f.count('identity_rate_attempts'),20);
  assert.equal((await f.req('/enroll','POST',{...bad,requestKey:'invalid-key-20'}))!.status,429);assert.equal(f.count('identity_rate_attempts'),20);
  assert.equal((await f.req('/enroll','POST',{...bad,requestKey:'invalid-key-0'}))!.status,409);
  const changed=(await f.req('/enroll','POST',{...f.input,requestKey:'invalid-key-0'}))!;assert.equal(changed.status,409);assert.equal((await changed.json()).error,'idempotency_conflict');
  for(const key of ['identity:account:'+'a'.repeat(16),'identity:global'])assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get(key)!.count,20);
  f.setTime('2026-10-31T02:00:00.000Z');assert.equal((await f.req('/enroll','POST',{...bad,requestKey:'invalid-key-0'}))!.status,409);
  assert.equal((await f.req('/enroll','POST',{...f.input,requestKey:'new-hour-key'}))!.status,201);
  for(const key of ['identity:account:'+'a'.repeat(16),'identity:global'])assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get(key)!.count,1);
 }finally{f.db.close();}
});
test('a duplicate rate reservation never swallows commit-time revocation or SQL-clock expiry',async()=>{
 for(const expiry of [false,true]){const f=await fixture();try{
  const bad={...f.input,expectedResidencyRevision:2};assert.equal((await f.req('/enroll','POST',bad))!.status,409);
  const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{if(statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_rate_attempts'))){if(expiry)f.setTime('2027-01-01T00:00:00.001Z');else f.db.sqlite.prepare("UPDATE tower_tokens SET revoked=1 WHERE id='a'").run();}return batch(statements);};
  assert.equal((await f.req('/enroll','POST',bad))!.status,403);
  assert.equal(f.count('identity_rate_attempts'),1);for(const key of ['identity:account:'+'a'.repeat(16),'identity:global'])assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get(key)!.count,1);
  for(const table of ['agent_identities','identity_audit','identity_requests'])assert.equal(f.count(table),0);
 }finally{f.db.close();}}
});
test('SQL-clock expiry while the initial rate batch is queued rolls back the reservation and both counters',async()=>{
 const f=await fixture();try{
  const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{f.setTime('2027-01-01T00:00:00.001Z');return batch(statements);};
  assert.equal((await f.req('/enroll','POST',f.input))!.status,403);
  for(const table of ['agent_identities','identity_audit','identity_requests','identity_rate_attempts','rate_limits'])assert.equal(f.count(table),0);
 }finally{f.db.close();}
});
test('concurrent exact requests at both quota boundaries reserve the last slot only once',async()=>{
 const f=await fixture();try{
  for(const [key,count] of [['identity:account:'+'a'.repeat(16),19],['identity:global',999]])f.db.sqlite.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?)').run(key,count,'2026-10-31T01:00:00.000Z');
  const results=await Promise.all([f.req('/enroll','POST',f.input),f.req('/enroll','POST',f.input)]);assert.deepEqual(results.map(r=>r!.status),[201,201]);assert.deepEqual(await results[0]!.json(),await results[1]!.json());
  assert.equal(f.count('identity_rate_attempts'),1);assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('identity:account:'+'a'.repeat(16))!.count,20);assert.equal(f.db.sqlite.prepare('SELECT count FROM rate_limits WHERE key=?').get('identity:global')!.count,1000);
  assert.equal((await f.req('/enroll','POST',f.input))!.status,201);
 }finally{f.db.close();}
});
