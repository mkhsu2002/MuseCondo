import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import type {Database, Statement} from '../server/live/db.ts';
import {createTowerIntake} from '../server/live/tower-intake.ts';
const origin='https://tower.example', now='2026-10-30T00:00:00.000Z';
const sha=async(s:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
async function fixture(){
 const db=new LocalDatabase(':memory:');
 for(const f of ['0001_live_mvp.sql','0002_recovery_audit.sql','0003_provider_requests.sql','0004_agent_onboarding.sql','0005_framework.sql','0006_tower_intake.sql','0007_tower_manager.sql','0008_tower_publication_events.sql'])db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 try{db.sqlite.exec(readFileSync(new URL('../migrations/0010_tower_visits.sql',import.meta.url),'utf8'));}catch(e){if((e as {code?:string}).code!=='ENOENT')throw e;}
 for(const id of ['a','b','c']){
  db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(id,await sha(id.repeat(64)),now);
  db.sqlite.prepare('INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)').run(await sha(id.repeat(64)),id,'csrf-'+id,'2027-01-01T00:00:00Z');
 }
 const room='d'.repeat(16);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at) VALUES(?,?,'Synthetic resident','test','resident',1,'external-ready',?)").run(room,'b',now);
 db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,revision,public_revision,snapshot_consent,created_at,updated_at) VALUES(?,'b','synthetic-resident','https://source.example/condo.json','challenge',1,1,1,?,?)").run(room,now,now);
 const site={templateVersion:'muse-condo-1',example:false,home:{name:'Synthetic resident',intro:'A synthetic home',daily:[],dreams:[],assets:{desktop:'./assets/home.png'}},profile:{motto:'hi',about:'about',interests:'clouds',strengths:'listening',currentFocus:'growing',invitation:'hello'},homeAlt:'Synthetic art',dream:null};
 db.sqlite.prepare('INSERT INTO tower_snapshots(room_id,revision,public_json,content_digest,created_at) VALUES(?,1,?,?,?)').run(room,JSON.stringify(site),'synthetic',now);
 let beforeCommit:(()=>void)|null=null;
 const wrapped:Database={prepare:sql=>db.prepare(sql),batch:async(statements:Statement[])=>{const hook=beforeCommit;beforeCommit=null;hook?.();return db.batch(statements);}};
 const app=createTowerIntake({db:wrapped,origin,localTest:false,sourceOrigins:[],now:()=>new Date(now),fetcher:async()=>{throw new Error('Must never call provider/source');}});
 async function request(path:string,method='GET',body?:unknown,account='a',headers:Record<string,string>={}){
  const response=await app.fetch(new Request(origin+path,{method,headers:{Cookie:'muse_session='+account.repeat(64),Origin:origin,'X-CSRF-Token':'csrf-'+account,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  assert.ok(response,'route must be handled');return response;
 }
 const owner='/api/v1/me/tower-intake/visits',pub='/api/v1/tower/rooms/'+room+'/visits';
 const send=(kind='message',key=crypto.randomUUID(),extra={})=>request(owner+'/send','POST',{targetDoor:'/home/'+room,requestKey:key,kind,nickname:'Test neighbor',body:'A quiet hello.',...(kind==='gift'?{giftId:'gift-sprout'}:{}),...extra});
 return {db,app,room,owner,pub,request,send,hook:(fn:()=>void)=>{beforeCommit=fn;}};
}
test('visits publish safe message/gift only; accepted invitations always remain private',async()=>{
 const f=await fixture();try{
  const message=await f.send();assert.equal(message.status,201);const m=await message.json();
  const gift=await f.send('gift');assert.equal(gift.status,201);
  const invitation=await f.send('invitation',crypto.randomUUID(),{body:'PRIVATE_INVITATION'});assert.equal(invitation.status,201);const invite=await invitation.json();
  let visible=await (await f.request(f.pub)).text();assert.match(visible,/A quiet hello/);assert.doesNotMatch(visible,/PRIVATE_INVITATION|senderAccount|sender_account|recipient_room|pending/);
  const inbox=await f.request(f.owner, 'GET',undefined,'b');assert.match(await inbox.text(),/PRIVATE_INVITATION/);
  assert.equal((await f.request(f.owner+'/'+invite.visit.id+'/moderate','POST',{action:'accept',expectedVersion:1,requestKey:crypto.randomUUID()},'a')).status,404);
  assert.equal((await f.request(f.owner+'/'+invite.visit.id+'/moderate','POST',{action:'accept',expectedVersion:1,requestKey:crypto.randomUUID()},'b')).status,200);
  visible=await (await f.request(f.pub)).text();assert.doesNotMatch(visible,/PRIVATE_INVITATION|accepted/);
  assert.equal((await f.request(f.owner+'/'+m.visit.id+'/withdraw','POST',{expectedVersion:1,requestKey:crypto.randomUUID()},'c')).status,404);
 }finally{f.db.close();}
});
test('sender withdrawal and recipient hide disappear immediately, with CAS and permanent receipts',async()=>{
 const f=await fixture();try{
  const key=crypto.randomUUID(),initial=await f.send('message',key),saved=await initial.json();
  assert.equal((await f.send('message',key)).status,201);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_visits').get()?.n,1);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_audit WHERE action='visit-sent'").get()?.n,1);
  assert.equal((await f.send('message',key,{body:'Changed'})).status,409);
  const action={expectedVersion:1,requestKey:crypto.randomUUID()};
  assert.equal((await f.request(f.owner+'/'+saved.visit.id+'/withdraw','POST',action)).status,200);
  assert.equal((await f.request(f.owner+'/'+saved.visit.id+'/withdraw','POST',action)).status,200);
  assert.doesNotMatch(await (await f.request(f.pub)).text(),/A quiet hello/);
  assert.equal((await f.request(f.owner+'/'+saved.visit.id+'/withdraw','POST',{...action,requestKey:crypto.randomUUID()})).status,409);
  const second=await (await f.send()).json();
  assert.equal((await f.request(f.owner+'/'+second.visit.id+'/moderate','POST',{expectedVersion:1,requestKey:crypto.randomUUID(),action:'hide'},'b')).status,200);
  assert.doesNotMatch(await (await f.request(f.pub)).text(),/A quiet hello/);
  assert.doesNotMatch(JSON.stringify(f.db.sqlite.prepare("SELECT detail_json FROM tower_audit").all()),/A quiet hello/);
 }finally{f.db.close();}
});
test('closed home gates public reads and sends; sender can still withdraw; auth revocation and rate rechecked atomically',async()=>{
 const f=await fixture();try{
  const first=await (await f.send()).json();
  f.db.sqlite.prepare('UPDATE tower_residencies SET public_revision=NULL').run();
  assert.equal((await f.request(f.pub)).status,404);assert.equal((await f.send()).status,404);
  assert.equal((await f.request(f.owner+'/'+first.visit.id+'/withdraw','POST',{expectedVersion:1,requestKey:crypto.randomUUID()})).status,200);
  f.db.sqlite.prepare('UPDATE tower_residencies SET public_revision=1').run();
  f.hook(()=>{f.db.sqlite.prepare('DELETE FROM sessions WHERE account_id=?').run('a');});
  assert.equal((await f.send()).status,403);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_visits').get()?.n,1);
 }finally{f.db.close();}
 const g=await fixture();try{for(let i=0;i<5;i++)assert.equal((await g.send()).status,201);assert.equal((await g.send()).status,429);}finally{g.db.close();}
});
test('strict inputs, session CSRF, tower token scopes and bounded private/public lists',async()=>{
 const f=await fixture();try{
  assert.equal((await f.send('gift',crypto.randomUUID(),{giftId:'money'})).status,400);
  assert.equal((await f.send('message',crypto.randomUUID(),{body:'https://example.com'})).status,400);
  assert.equal((await f.send('message',crypto.randomUUID(),{nickname:'person@example.com'})).status,400);
  assert.equal((await f.send('message',crypto.randomUUID(),{body:'x'.repeat(281)})).status,400);
  assert.equal((await f.send('invitation',crypto.randomUUID(),{body:'x'.repeat(1001)})).status,400);
  assert.equal((await f.request(f.owner+'/send','POST',{},'a',{'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await f.request(f.pub+'?cursor=bad')).status,400);
  assert.equal((await f.request(f.owner,'GET',undefined,'a')).status,404);
  const token='f'.repeat(64);f.db.sqlite.prepare('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)').run('read','a',await sha(token),'["tower:read"]','2027-01-01T00:00:00Z',now);
  const auth={Authorization:'Bearer '+token};
  const agent=(method:string,body?:unknown)=>f.app.fetch(new Request(origin+'/api/v1/agent/tower-intake/visits/'+(method==='GET'?'sent':'send'),{method,headers:{...auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  assert.equal((await agent('GET'))?.status,200);assert.equal((await agent('POST',{}))?.status,403);
 }finally{f.db.close();}
});

test('public inside widget and entry links never expose private invitations or browser credentials',async()=>{
 const f=await fixture();try{
  const invitation=await (await f.send('invitation',crypto.randomUUID(),{body:'SECRET_PRIVATE_TEXT'})).json();
  await f.request(f.owner+'/'+invitation.visit.id+'/moderate','POST',{expectedVersion:1,requestKey:crypto.randomUUID(),action:'accept'},'b');
  const html=await f.request('/home/'+f.room+'/inside');assert.equal(html.status,200);const text=await html.text();
  assert.match(text,/data-visit-room/);assert.match(text,/tower-visits.js/);assert.doesNotMatch(text,/SECRET_PRIVATE_TEXT|sender_account_id|muse_session|csrf-a|Bearer/);
  assert.match(html.headers.get('Content-Security-Policy')||'',/connect-src 'self'/);
  assert.match(await (await f.request('/home/'+f.room)).text(),/inside#tower-visits/);
  const preview=await f.request('/api/v1/me/tower-intake/preview/inside','GET',undefined,'b');assert.doesNotMatch(await preview.text(),/data-visit-room/);
  f.db.sqlite.prepare('UPDATE tower_residencies SET public_revision=NULL').run();
  assert.equal((await f.request('/home/'+f.room+'/inside')).status,404);
  assert.equal((await f.request(f.pub)).status,404);
 }finally{f.db.close();}
});
test('commit-time target closure, version conflict and scoped-token revocation roll back writes and audits',async()=>{
 const f=await fixture();try{
  f.hook(()=>{f.db.sqlite.prepare('UPDATE tower_residencies SET public_revision=NULL,publication_epoch=publication_epoch+1').run();});
  assert.equal((await f.send()).status,409);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_visits').get()?.n,0);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_requests').get()?.n,0);
  f.db.sqlite.prepare('UPDATE tower_residencies SET public_revision=1').run();
  const row=await (await f.send()).json();
  f.hook(()=>{f.db.sqlite.prepare("UPDATE tower_visits SET state='withdrawn',version=2 WHERE id=?").run(row.visit.id);});
  assert.equal((await f.request(f.owner+'/'+row.visit.id+'/moderate','POST',{expectedVersion:1,requestKey:crypto.randomUUID(),action:'hide'},'b')).status,409);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_audit WHERE action='visit-hide'").get()?.n,0);
  const token='f'.repeat(64);f.db.sqlite.prepare('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)').run('write','a',await sha(token),'["tower:write"]','2027-01-01T00:00:00Z',now);
  f.hook(()=>{f.db.sqlite.prepare("UPDATE tower_tokens SET revoked=1 WHERE id='write'").run();});
  const response=await f.app.fetch(new Request(origin+'/api/v1/agent/tower-intake/visits/send',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({targetDoor:'/home/'+f.room,requestKey:crypto.randomUUID(),kind:'message',nickname:'Synthetic',body:'No commit'})}));
  assert.equal(response?.status,403);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_visits').get()?.n,1);
  assert.equal(f.db.sqlite.prepare('SELECT revision FROM tower_residencies').get()?.revision,1);
 }finally{f.db.close();}
});
test('public and private keyset pagination are bounded at 50 and omit sender account identities',async()=>{
 const f=await fixture();try{
  const insert=f.db.sqlite.prepare("INSERT INTO tower_visits(id,recipient_room_id,sender_account_id,kind,nickname,body,gift_id,state,version,created_at,updated_at) VALUES(?,?,'a','message','Synthetic','Hello',NULL,'published',1,?,?)");
  for(let i=0;i<52;i++)insert.run(i.toString(16).padStart(32,'0'),f.room,now,now);
  for(const path of [f.pub,f.owner+'/sent']){
   const first=await (await f.request(path)).json();assert.equal(first.visits.length,50);assert.ok(first.nextCursor);
   const next=await (await f.request(path+'?cursor='+encodeURIComponent(first.nextCursor))).json();assert.equal(next.visits.length,2);assert.equal(next.nextCursor,null);
   assert.equal(new Set([...first.visits,...next.visits].map((r:{id:string})=>r.id)).size,52);
   assert.doesNotMatch(JSON.stringify(first),/sender_account_id|senderAccountId|token_hash/);
  }
  const anon=await f.app.fetch(new Request(origin+f.pub));assert.equal(anon?.status,200);
  const closed=await f.app.fetch(new Request(origin+f.owner));assert.equal(closed?.status,401);
 }finally{f.db.close();}
});

test('concurrent same-key sends and status updates have one durable winner; audit failure rolls everything back',async()=>{
 const f=await fixture();try{
  const key=crypto.randomUUID(),both=await Promise.all([f.send('message',key),f.send('message',key)]);assert.deepEqual(both.map(r=>r.status),[201,201]);
  const [a,b]=await Promise.all(both.map(r=>r.json()));assert.equal(a.visit.id,b.visit.id);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_visits').get()?.n,1);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_audit WHERE action='visit-sent'").get()?.n,1);
  const race=await Promise.all([
   f.request(f.owner+'/'+a.visit.id+'/withdraw','POST',{expectedVersion:1,requestKey:crypto.randomUUID()}),
   f.request(f.owner+'/'+a.visit.id+'/moderate','POST',{expectedVersion:1,requestKey:crypto.randomUUID(),action:'hide'},'b'),
  ]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  f.db.sqlite.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON tower_audit BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  const before=f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_requests').get()?.n;
  assert.equal((await f.send()).status,503);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_visits').get()?.n,1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_requests').get()?.n,before);
 }finally{f.db.close();}
});

for(const field of ['kind','giftId','action'] as const){
 const allowed=field==='kind'?'message':field==='giftId'?'gift-cloud':'accept';
 const invalids=[['array',[allowed]],['object',{value:allowed}],['null',null],['number',1],['boolean',true]] as const;
 for(const [type,value] of invalids)test(`visit ${field} rejects ${type} with 400 and no visit, receipt or audit mutation`,async()=>{
  const f=await fixture();try{
   const invitation=field==='action'?await (await f.send('invitation')).json():null;
   const snapshot=()=>Object.fromEntries(['tower_visits','tower_requests','tower_audit'].map(table=>[table,f.db.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
   const before=snapshot();
   const response=field==='action'
    ?await f.request(f.owner+'/'+invitation.visit.id+'/moderate','POST',{expectedVersion:1,requestKey:crypto.randomUUID(),action:value},'b')
    :await f.send(field==='giftId'?'gift':'message',crypto.randomUUID(),{[field]:value});
   assert.deepEqual({status:response.status,tables:snapshot()},{status:400,tables:before});
  }finally{f.db.close();}
 });
}
