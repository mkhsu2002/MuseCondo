import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createIdentityMailCoordinator} from '../server/live/identity-mail-coordinator.ts';
import {workerdFetch} from './helpers/workerd-fetch.ts';
const key='9'.repeat(64),origin='https://identity.example',time='2026-10-31T00:00:00.000Z';
const nativeDates=new LocalDatabase(':memory:');
test.after(()=>nativeDates.close());
const modulePath=new URL('../server/live/identity-private.ts',import.meta.url);
async function privateModule(){assert(existsSync(modulePath),'private identity encryption is implemented');return import('../server/live/identity-private.ts');}
export async function mailFixture(fetcher:typeof fetch=async()=>new Response(JSON.stringify({id:'provider-id'}))){
 const p=await privateModule();assert(existsSync(new URL('../server/live/identity-mail.ts',import.meta.url)),'persistent identity mail is implemented');
 const {createIdentityMail}=await import('../server/live/identity-mail.ts');
 const db=new LocalDatabase(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const account='a'.repeat(16),agent='mcid:'+'a'.repeat(64),id='b'.repeat(32),event='c'.repeat(32),email='Guardian.Local@example.com',token='d'.repeat(64),expiry='2026-11-01T00:00:00.000Z';
 db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,'mail-login',time);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Test','Test','resident','external-ready',?)").run(account,account,time);
 db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)").run(account,account,account,'https://source.example/a',time,time);
 db.sqlite.prepare('INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,version,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,3,1,?,?)').run(agent,account,account,account,time,time);
 const recipient=await p.encryptPrivate(key,'guardian-recipient',agent,email),emailHash=await p.hashPrivate(key,'guardian-email',email),tokenHash=await p.hashPrivate(key,'guardian-confirmation:'+id,token);
 db.sqlite.prepare("INSERT INTO identity_guardian_invites(id,agent_id,account_id,version,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,invite_token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,2,3,1,'accepted',?,?,?,?,?,?)").run(id,agent,account,recipient,emailHash,tokenHash,expiry,time,time);
 const payload=await p.encryptPrivate(key,'mail-payload',event,JSON.stringify({token}));
 db.sqlite.prepare("INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,state,created_at,updated_at) VALUES(?,'guardian-invitation',?,?,?, ?,?,'pending',?,?)").run(event,id,'guardian-invitation:'+id+':'+emailHash,recipient,emailHash,payload,time,time);
 let now=new Date(time);db.sqlite.function('strftime',{varargs:true},(...args)=>args[1]==='now'?now.toISOString():nativeDates.sqlite.prepare('SELECT strftime('+args.map(()=>'?').join(',')+') value').get(...args)!.value);
 const coordinator={idFromName:(n:string)=>n,get:()=>({fetch:(request:Request)=>createIdentityMailCoordinator({db,origin,contactKey:key,from:'MuseCondo <identity@example.com>',trustedKeys:new Map(),now:()=>now}).fetch(request)})};
 const env={db,origin,coordinator,deliveryEnabled:'true',contactKey:key,apiKey:'arbitrary-runtime-key',from:'MuseCondo <identity@example.com>',fetcher:workerdFetch(async(request,_index,init)=>request.url.includes('/suppressions/')?new Response(null,{status:404}):fetcher(request.url,{...init,body:await request.text()})).fetcher,now:()=>now};
 return {db,p,env,mail:createIdentityMail(env),account,agent,id,event,email,token,key,recipient,emailHash,tokenHash,setTime:(s:string)=>{now=new Date(s);}};
}
test('private envelopes authenticate purpose and entity and keep normalized local part intact',async()=>{
 const p=await privateModule();const email=p.validateGuardianEmail('Guardian.Local@EXAMPLE.COM');assert.equal(email,'Guardian.Local@example.com');
 const a=await p.encryptPrivate(key,'guardian-recipient','agent',email),b=await p.encryptPrivate(key,'guardian-recipient','agent',email);assert.notEqual(a,b);assert(!a.includes(email));assert.equal(await p.decryptPrivate(key,'guardian-recipient','agent',a),email);
 for(const args of [[key,'other','agent',a],[key,'guardian-recipient','other',a],['8'.repeat(64),'guardian-recipient','agent',a]] as const)await assert.rejects(p.decryptPrivate(args[0],args[1],args[2],args[3]));
 assert.match(await p.hashPrivate(key,'guardian-email',email),/^[a-f0-9]{64}$/);assert.notEqual(await p.hashPrivate(key,'guardian-email',email),await p.hashPrivate(key,'other',email));
 for(const bad of ['', 'a@b', 'a\r\nb@example.com','A <a@example.com>','a@example.com,b@example.com','a@example.com;z@example.com','a'.repeat(255)+'@example.com'])assert.throws(()=>p.validateGuardianEmail(bad));
 await assert.rejects(p.encryptPrivate('bad','p','i','value'));
});
test('persisted exact event targets one guardian using authenticated ciphertext; accepted is not delivered',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];const f=await mailFixture(async(url,init)=>{calls.push({url:String(url),init:init!});return new Response(JSON.stringify({id:'provider-id'}));});try{
  const result=await f.mail.processOne(f.event);assert.equal(result!.state,'accepted');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.resend.com/emails');
  const headers=new Headers(calls[0].init.headers);assert.equal(headers.get('Idempotency-Key'),f.event);assert.equal(headers.get('Authorization'),'Bearer arbitrary-runtime-key');const body=JSON.parse(String(calls[0].init.body));assert.deepEqual(body.to,[f.email]);assert.equal(body.from,f.env.from);assert(body.text.includes(f.token));assert(body.text.includes('Agent ID：'+f.agent));assert(body.text.includes(origin+'/identity'));assert(!body.text.includes('?'));assert(body.text.includes('短效初次確認碼'));
  assert.deepEqual(await f.mail.processOne(f.event),result);assert.equal(calls.length,1);const stored=JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_events').all())+JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_audit').all());assert(!stored.includes(f.email));assert(!stored.includes(f.token));assert.equal(f.db.sqlite.prepare('SELECT attempt_count FROM identity_mail_events').get()!.attempt_count,1);
  assert.deepEqual(Object.keys(result!).sort(),['attemptCount','errorCode','id','providerId','state'].sort());
 }finally{f.db.close();}
});
test('unknown provider outcomes never cause a blind resend and errors contain no provider body',async()=>{
 for(const response of ['throw','malformed','server','throttle','rejected']){let sends=0;const f=await mailFixture(async()=>{sends++;if(response==='throw')throw new Error('private@example.com secret');if(response==='malformed')return new Response('{');return new Response('private@example.com secret',{status:response==='server'?500:response==='throttle'?429:422});});try{
  const first=await f.mail.processOne(f.event);assert.equal(first!.state,response==='rejected'?'failed':'unknown');await f.mail.processOne(f.event);assert.equal(sends,1);assert(!JSON.stringify(first).includes('private@example.com'));assert(!JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_audit').all()).includes('secret'));
 }finally{f.db.close();}}
});
test('only one concurrent worker leases a persistent event, and invalidated invitations cancel before sending',async()=>{
 let calls=0;const f=await mailFixture(async()=>{calls++;return new Response(JSON.stringify({id:'once'}));});try{await Promise.all([f.mail.processOne(f.event),f.mail.processOne(f.event)]);assert.equal(calls,1);}finally{f.db.close();}
 for(const mutation of ["UPDATE identity_guardian_invites SET state='cancelled'","UPDATE identity_guardian_invites SET expires_at='2026-10-30T00:00:00.000Z'","UPDATE agent_identities SET authority_epoch=2","UPDATE agent_identities SET version=4","UPDATE agent_identities SET state='retired'","UPDATE identity_mail_events SET recipient_hash='"+'e'.repeat(64)+"'","UPDATE tower_residencies SET resident_id='"+'e'.repeat(16)+"'"]){let sends=0;const f=await mailFixture(async()=>{sends++;return new Response('{}');});try{f.db.sqlite.exec('PRAGMA ignore_check_constraints=ON');f.db.sqlite.exec(mutation);assert.equal((await f.mail.processOne(f.event))!.state,'pending');assert.equal(sends,0);}finally{f.db.close();}}
});
test('missing configuration leaves event pending and missing or reserved event kinds never send',async()=>{
 let sends=0;const f=await mailFixture(async()=>{sends++;return new Response('{}');});try{const {createIdentityMail}=await import('../server/live/identity-mail.ts');for(const extra of [{apiKey:''},{from:''},{contactKey:''},{origin:'https://evil.example/path'}]){const m=createIdentityMail({...f.env,...extra});assert.equal(m.configured(),false);await m.processOne(f.event);assert.equal((await m.status(f.event))!.state,'pending');}assert.equal(await f.mail.processOne('f'.repeat(32)),null);f.db.sqlite.prepare("UPDATE identity_mail_events SET kind='identity-card'").run();assert.equal((await f.mail.processOne(f.event))!.state,'pending');assert.equal(sends,0);}finally{f.db.close();}
});

test('mail transaction revalidates the live invitation before lease and audit failures cannot send',async()=>{
 for(const auditFailure of [false,true]){let calls=0;const f=await mailFixture(async()=>{calls++;return new Response('{}');});try{
  if(auditFailure)f.db.sqlite.exec("CREATE TRIGGER fail_mail_audit BEFORE INSERT ON identity_mail_audit BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  else {const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{f.db.sqlite.prepare("UPDATE identity_guardian_invites SET state='cancelled'").run();return batch(statements);};}
  await f.mail.processOne(f.event);assert.equal(calls,0);assert.equal((await f.mail.status(f.event))!.state,'pending');
 }finally{f.db.close();}}
});
test('native SQLite clock rejects expiry even when injected application clock is earlier',async()=>{
 let calls=0;const f=await mailFixture(async()=>{calls++;return new Response('{}');});try{
  // Replace the fixture connection with one that uses SQLite's actual native clock.
  const native=new LocalDatabase(':memory:');const snapshot=f.db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END").all();
  for(const row of snapshot)native.sqlite.exec(String(row.sql));
  for(const table of ['accounts','rooms','tower_residencies','agent_identities','identity_guardian_invites','identity_mail_events']){const rows=f.db.sqlite.prepare('SELECT * FROM '+table).all();for(const row of rows){const cols=Object.keys(row);native.sqlite.prepare('INSERT INTO '+table+'('+cols.join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').run(...Object.values(row));}}
  native.sqlite.exec('DROP TRIGGER identity_guardian_immutable_binding');native.sqlite.prepare("UPDATE identity_guardian_invites SET created_at='2000-01-01T00:00:00.000Z',expires_at='2000-01-02T00:00:00.000Z'").run();
  const {createIdentityMail}=await import('../server/live/identity-mail.ts');const mail=createIdentityMail({...f.env,db:native,coordinator:{idFromName:(n:string)=>n,get:()=>({fetch:(request:Request)=>createIdentityMailCoordinator({db:native,origin,contactKey:key,from:f.env.from,trustedKeys:new Map(),now:()=>new Date('2000-01-01T00:00:00.000Z')}).fetch(request)})},now:()=>new Date('2000-01-01T00:00:00.000Z')});
  try{assert.equal((await mail.processOne(f.event))!.state,'pending');assert.equal(calls,0);}finally{native.close();}
 }finally{f.db.close();}
});
test('guardian storage prevents cross-account identity bindings and duplicate active designation',async()=>{
 const f=await mailFixture();try{
  f.db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run('e'.repeat(16),'other-login',time);
  const insert=f.db.sqlite.prepare("INSERT INTO identity_guardian_invites(id,agent_id,account_id,version,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,expires_at,created_at,updated_at) VALUES(?,?,?,1,3,1,'proposed',?,?,?,?,?)");
  assert.throws(()=>insert.run('e'.repeat(32),f.agent,'e'.repeat(16),f.recipient,f.emailHash,time,time,time));assert.throws(()=>insert.run('e'.repeat(32),f.agent,f.account,f.recipient,f.emailHash,time,time,time));
 }finally{f.db.close();}
});
test('a confirmation hash changed while claiming the lease cancels the stale encrypted message',async()=>{
 let calls=0;const f=await mailFixture(async()=>{calls++;return new Response(JSON.stringify({id:'should-not-send'}));});try{
  const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{if(statements.some(s=>(s as unknown as {sql:string}).sql.startsWith("UPDATE identity_mail_events SET state='sending'")))f.db.sqlite.prepare('UPDATE identity_guardian_invites SET invite_token_hash=?').run('f'.repeat(64));return batch(statements);};
  assert.equal((await f.mail.processOne(f.event))!.state,'pending');assert.equal(calls,0);
 }finally{f.db.close();}
});
test('guardian storage rejects unbounded, malformed, unordered and noncanonical confirmation lifetimes',async()=>{
 const f=await mailFixture();try{
  for(const expiry of ['2099-01-01T00:00:00.000Z','invalid','2026-10-30T23:59:59.999Z',time,'2026-11-01T00:00:00Z','2026-11-01T00:00:00.001Z'])assert.throws(()=>f.db.sqlite.prepare('UPDATE identity_guardian_invites SET expires_at=?').run(expiry),expiry);
  f.db.sqlite.prepare("UPDATE identity_guardian_invites SET state='cancelled'").run();
  const insert=f.db.sqlite.prepare("INSERT INTO identity_guardian_invites(id,agent_id,account_id,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,expires_at,created_at,updated_at) VALUES(?,?,?,3,1,'proposed',?,?,?,?,?)");
  for(const created of ['invalid','2026-10-31T00:00:00Z','2026-11-02T00:00:00.000Z'])assert.throws(()=>insert.run('f'.repeat(32),f.agent,f.account,f.recipient,f.emailHash,'2026-11-01T00:00:00.000Z',created,time),created);
 }finally{f.db.close();}
});
test('dispatch independently rejects corrupted unbounded or invalid lifetimes and future issuance',async()=>{
 const cases=[{created:time,expires:'2099-01-01T00:00:00.000Z',now:'2026-11-03T00:00:00.000Z'},{created:'invalid',expires:'2099-01-01T00:00:00.000Z',now:time},{created:time,expires:'invalid',now:time},{created:'2026-10-31T00:00:00Z',expires:'2026-11-01T00:00:00.000Z',now:time},{created:'2026-11-01T00:00:00.000Z',expires:'2026-11-02T00:00:00.000Z',now:time}];
 for(const c of cases){let calls=0;const f=await mailFixture(async()=>{calls++;return new Response(JSON.stringify({id:'unbounded'}));});try{
  // Defense in depth for imported/corrupted rows independently of schema validation.
  f.db.sqlite.exec('PRAGMA ignore_check_constraints=ON; DROP TRIGGER identity_guardian_immutable_binding');
  f.db.sqlite.prepare('UPDATE identity_guardian_invites SET created_at=?,expires_at=?').run(c.created,c.expires);f.setTime(c.now);
  assert.equal((await f.mail.processOne(f.event))!.state,'pending',JSON.stringify(c));assert.equal(calls,0);
 }finally{f.db.close();}}
});

test('provider rejection retains only a bounded ASCII error name with HTTP status',async()=>{
 for(const name of ['validation_error','private@example.com','x'.repeat(65),'unsafe\nname','d'.repeat(64),'runtime-key']){const f=await mailFixture(async()=>new Response(JSON.stringify({name,message:'private@example.com '+('d'.repeat(64))}),{status:403}));try{const result=await f.mail.processOne(f.event);assert.equal(result!.errorCode,name==='validation_error'?'provider_rejected_403:validation_error':'provider_rejected_403');assert(!JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_audit').all()).includes('private@example.com'));}finally{f.db.close();}}
});

test('the fixed guardian invitation email supplies both manual UI inputs without leaking proof into status, URLs or stored audit',async()=>{
 const calls:RequestInit[]=[];const f=await mailFixture(async(_url,init)=>{calls.push(init!);return new Response(JSON.stringify({id:'manual-inputs-provider'}));});try{
  const result=await f.mail.processOne(f.event);assert.equal(result!.state,'accepted');assert.equal(calls.length,1);
  const body=JSON.parse(String(calls[0].body));assert(body.text.includes('邀請識別碼：'+f.id));assert(body.text.includes('短效初次確認碼：'+f.token));assert(body.text.includes('Agent ID：'+f.agent));
  const machine=JSON.parse(readFileSync(new URL('../public/identity-onboarding.json',import.meta.url),'utf8')),html=readFileSync(new URL('../public/identity.html',import.meta.url),'utf8');assert.deepEqual(Object.keys(machine.guardianRegistration.invitationMailFields).sort(),['confirmationCode','invitationId']);assert(html.includes('邀請識別碼'));assert(html.includes('短效初次確認碼'));assert.equal(machine.guardianRegistration.uiPath,'/identity');
  const links=String(body.text).match(/https:\/\/\S+/g)??[];assert.deepEqual(links,[origin+'/identity']);assert(!links.some((v:string)=>v.includes(f.token)||v.includes(f.id)));assert(!body.subject.includes(f.token));
  const {text,...other}=body;assert(!JSON.stringify(other).includes(f.token));assert(!JSON.stringify(result).includes(f.token));assert(!JSON.stringify(await f.mail.status(f.event)).includes(f.token));assert(text.includes('並非長期復原碼'));
  const stored=['identity_guardian_invites','identity_mail_events','identity_mail_audit','identity_audit','guardian_invite_requests'].map(table=>JSON.stringify(f.db.sqlite.prepare('SELECT * FROM '+table).all())).join('');assert(!stored.includes(f.token));assert(!stored.includes(f.email));
  await f.mail.processOne(f.event);assert.equal(calls.length,1);
 }finally{f.db.close();}
});

for(const status of [301,302,303,307,308])test('workerd guardian mail records redirect '+status+' as unknown and never follows or resends',async()=>{
 const network=workerdFetch(()=>new Response(JSON.stringify({id:'must-not-be-accepted'}),{status,headers:{Location:'https://untrusted.example/collect'}}));
 const f=await mailFixture(network.fetcher);try{
  const result=await f.mail.processOne(f.event);assert.equal(result!.state,'unknown');assert.equal(result!.errorCode,'provider_outcome_unknown');assert.equal(result!.providerId,null);assert.equal(result!.attemptCount,1);
  assert.deepEqual(await f.mail.processOne(f.event),result);assert.deepEqual(network.requests.map(r=>r.url),['https://api.resend.com/emails']);assert.equal(network.requests[0].headers.get('Authorization'),'Bearer arbitrary-runtime-key');
  assert.deepEqual(f.db.sqlite.prepare('SELECT action FROM identity_mail_audit ORDER BY rowid').all().map(r=>r.action),['prepared','sending','dispatch-finished']);
  assert(!JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_audit').all()).includes('untrusted.example'));
 }finally{f.db.close();}
});
