import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {envelopeFixture} from './helpers/identity-mail-fixture.ts';
const modulePath=new URL('../server/live/identity-mail-coordinator.ts',import.meta.url);
test('private coordinator commits a permanent claim before returning frozen stream; replay cannot reclaim',async()=>{
 assert(existsSync(modulePath),'private dispatch coordinator is implemented');
 const {createIdentityMailCoordinator}=await import('../server/live/identity-mail-coordinator.ts');
 const f=await envelopeFixture();try{
 const c=createIdentityMailCoordinator(f.env),m=await c.prepare(f.event),r=await c.claim(f.event,m.descriptor.bodyDigest);
 assert.equal(r.status,200);assert.equal((await r.json()).to[0],'shared@example.com');
 assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE id=?').get(f.event)!.state,'sending');
 assert.equal(f.count('identity_mail_dispatches'),1);await assert.rejects(c.claim(f.event,m.descriptor.bodyDigest));
 }finally{f.close();}
});
import {createIdentityMail} from '../server/live/identity-mail.ts';
import {createIdentityMailCoordinator} from '../server/live/identity-mail-coordinator.ts';
import type {IdentityCardNamespace} from '../server/live/identity-card-proxy.ts';
async function transportFixture(size=64){
 const f=await envelopeFixture(size),c=createIdentityMailCoordinator(f.env),calls:{url:string;init:RequestInit;bytes:string}[]=[],controls:string[]=[];
 const binding:IdentityCardNamespace={idFromName:n=>n,get:()=>({fetch:async request=>{controls.push(new URL(request.url).pathname);return createIdentityMailCoordinator(f.env).fetch(request);}})};
 const env={...f.env,apiKey:'runtime-key',deliveryEnabled:'true',coordinator:binding,fetcher:async(url:RequestInfo|URL,init?:RequestInit)=>{const u=String(url);let bytes='';if(init?.method==='POST'){assert(init.body instanceof ReadableStream,'Pages body must remain a stream');bytes=await new Response(init.body).text();}calls.push({url:u,init:init??{},bytes});return u.includes('/suppressions/')?new Response(null,{status:404}):new Response(JSON.stringify({id:'provider-id'}));}};
 return {...f,c,env,calls,controls,mail:createIdentityMail(env)};
}
test('Pages default delivery gate blocks legacy direct POST even with key and FROM',async()=>{
 const f=await transportFixture();try{
 const m=createIdentityMail({...f.env,deliveryEnabled:undefined});assert.equal(m.configured(),false);await m.processOne(f.event);assert.equal(f.calls.length,0);assert.equal(f.count('identity_mail_dispatches'),0);
 }finally{f.close();}
});
test('five real envelope templates cross private transport as frozen stream and accepted stays distinct from delivered',async()=>{
 for(const template of ['guardian-invitation','identity-card-v1','identity-card-revoked-v1','identity-recovery-continued-v1','identity-guardian-repaired-v1']){
 const f=await transportFixture(template==='identity-card-v1'?4400000:64);try{
 if(template==='guardian-invitation')await f.invitation();else if(template!=='identity-card-v1')await f.security(template);
 const expected=await f.c.prepare(f.event),body=await (await import('../server/live/identity-mail-envelope.ts')).createIdentityMailEnvelope(f.env).materialize(f.event);
 const m=createIdentityMail({...f.env,from:'Changed <changed@example.com>'});const result=await m.processOne(f.event);
 assert.equal(result!.state,'accepted');assert.equal(result!.attemptCount,1);assert.equal(f.calls.length,2);assert.equal(f.calls[0].url,'https://api.resend.com/suppressions/shared%40example.com');
 assert.equal(f.calls[1].url,'https://api.resend.com/emails');assert.equal(f.calls[1].init.redirect,'manual');assert.equal(new Headers(f.calls[1].init.headers).get('Idempotency-Key'),f.event);assert.equal(f.calls[1].bytes,body.body);assert.equal(expected.descriptor.bodyLength,new TextEncoder().encode(f.calls[1].bytes).length);
 await m.processOne(f.event);assert.equal(f.calls.length,2);assert.equal(f.count('identity_mail_dispatches'),1);assert.equal(f.count('identity_mail_finish_receipts'),1);
 }finally{f.close();}}
});
test('two independent shards race for a single durable claim and POST',async()=>{
 const f=await transportFixture();try{await Promise.all([f.mail.processOne(f.event),createIdentityMail(f.env).processOne(f.event)]);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);assert.equal(f.count('identity_mail_dispatches'),1);}finally{f.close();}
});
test('suppression unknown fails closed and case-folded provider block is durable without raw addresses',async()=>{
 for(const outcome of ['unknown','bad-shape','wrong-email','suppressed']){
 const f=await transportFixture();try{
 const fetcher:typeof fetch=async()=>outcome==='unknown'?new Response('{}',{status:500}):new Response(JSON.stringify(outcome==='bad-shape'?{}:{object:'suppression',id:'id',email:outcome==='wrong-email'?'other@example.com':'SHARED@EXAMPLE.COM',origin:'bounce',source_id:null,created_at:'2026-10-31 00:00:00+00'}));
 await createIdentityMail({...f.env,fetcher}).processOne(f.event);assert.equal(f.count('identity_mail_dispatches'),0);assert.equal((await f.mail.status(f.event))!.state,'pending');assert.equal(f.count('identity_mail_suppressions'),outcome==='suppressed'?1:0);
 if(outcome==='suppressed'){await f.mail.processOne(f.event);assert.equal(f.calls.length,0);assert(!JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_suppressions').all()).includes('shared'));}
 }finally{f.close();}}
});
test('lost claim acknowledgement and provider timeout leave one attempt with no automatic second POST',async()=>{
 for(const lost of ['claim','post']){const f=await transportFixture();try{
 let posts=0;const binding:IdentityCardNamespace={idFromName:n=>n,get:()=>({fetch:async req=>{const r=await f.c.fetch(req);if(lost==='claim'&&new URL(req.url).pathname.endsWith('/claim')&&r.ok)throw Error('lost');return r;}})};
 const fetcher:typeof fetch=async url=>{if(String(url).includes('/suppressions/'))return new Response(null,{status:404});posts++;throw Error('timeout private@example.com');};
 const m=createIdentityMail({...f.env,coordinator:binding,fetcher});await m.processOne(f.event);assert.equal((await m.status(f.event))!.state,lost==='claim'?'sending':'unknown');await m.processOne(f.event);assert.equal(posts,lost==='claim'?0:1);assert.equal(f.count('identity_mail_dispatches'),1);
 }finally{f.close();}}
});
test('local suppression and last native context guard races cannot claim',async()=>{
 for(const race of ['suppression','guardian','clock','audit']){const f=await transportFixture();try{
 if(race==='guardian')await f.invitation();
 const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{if(statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_mail_dispatches'))){
 if(race==='suppression'){const {hashPrivate}=await import('../server/live/identity-private.ts');f.db.sqlite.prepare('INSERT INTO identity_mail_suppressions VALUES(?,?,?)').run(await hashPrivate(f.env.contactKey,'mail-suppression','shared@example.com'),'manual','2026-10-31T00:00:00.000Z');}
 if(race==='guardian')f.db.sqlite.exec("UPDATE identity_guardian_invites SET state='cancelled'");
 if(race==='clock'){await f.invitation();f.setNative('2026-11-02T00:00:00.000Z');}
 if(race==='audit')f.db.sqlite.exec("CREATE TRIGGER fail_sending BEFORE INSERT ON identity_mail_audit WHEN NEW.action='sending' BEGIN SELECT RAISE(ABORT,'fail'); END");
 }return batch(statements);};
 await f.mail.processOne(f.event);assert.equal(f.calls.filter(c=>c.init.method==='POST').length,0);assert.equal(f.count('identity_mail_dispatches'),0);assert.equal((await f.mail.status(f.event))!.attemptCount,0);
 }finally{f.close();}}
});
test('finish exact replay is permanent; conflict and provider mismatch reject; early delivery never downgrades',async()=>{
 for(const early of ['sending','delivered','bounced','failed']){const f=await transportFixture();try{
 const meta=await f.c.prepare(f.event),body=await f.c.claim(f.event,meta.descriptor.bodyDigest),leaseId=body.headers.get('X-Identity-Mail-Lease')!;
 if(early!=='sending')f.db.sqlite.prepare('UPDATE identity_mail_events SET state=?,provider_id=? WHERE id=?').run(early,'provider-id',f.event);
 const v={eventId:f.event,leaseId,state:'accepted' as const,providerId:'provider-id',errorCode:null};await f.c.finish(v);await f.c.finish(v);assert.equal((await f.mail.status(f.event))!.state,early==='sending'?'accepted':early);assert.equal(f.count('identity_mail_finish_receipts'),1);
 await assert.rejects(f.c.finish({...v,providerId:'different'}),/conflict/);assert.throws(()=>f.db.sqlite.exec('DELETE FROM identity_mail_dispatches'));assert.throws(()=>f.db.sqlite.exec('DELETE FROM identity_mail_finish_receipts'));
 }finally{f.close();}}
 const f=await transportFixture();try{const meta=await f.c.prepare(f.event),body=await f.c.claim(f.event,meta.descriptor.bodyDigest);f.db.sqlite.prepare("UPDATE identity_mail_events SET state='delivered',provider_id='first'").run();await assert.rejects(f.c.finish({eventId:f.event,leaseId:body.headers.get('X-Identity-Mail-Lease')!,state:'accepted',providerId:'second',errorCode:null}),/conflict/);assert.equal(f.count('identity_mail_finish_receipts'),0);}finally{f.close();}
});
import runtime from '../server/live/worker.ts';
import publicWorker,{IdentityCardCoordinator} from '../workers/identity-card/worker.ts';
import {proxyIdentityCard} from '../server/live/identity-card-proxy.ts';
test('private mail RPC is available only through real coordinator binding; both public routers reject it',async()=>{
 const f=await transportFixture();try{
 const publicJwk=await crypto.subtle.exportKey('jwk',f.pair.publicKey);const coordinator=new IdentityCardCoordinator({}, {DB:f.db,PUBLIC_ORIGIN:f.env.origin,IDENTITY_CONTACT_KEY:f.env.contactKey,IDENTITY_PUBLIC_KEYS:JSON.stringify({fixture:{...publicJwk,alg:'EdDSA'}}),IDENTITY_MAIL_FROM:f.env.from});
 const url=f.env.origin+'/__internal/identity-mail/prepare',req=()=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:f.event})});
 assert.equal((await coordinator.fetch(req())).status,200);
 let calls=0;const binding={idFromName:n=>n,get:()=>({async fetch(){calls++;return new Response('PRIVATE');}})} satisfies IdentityCardNamespace;
 assert.equal((await proxyIdentityCard(req(),binding)).status,404);assert.equal((await runtime.fetch(req(),{PUBLIC_ORIGIN:f.env.origin,IDENTITY_CARDS:binding,ASSETS:{async fetch(){return new Response('SPA');}}})).status,404);assert.equal(calls,0);assert.equal((await publicWorker.fetch()).status,404);
 const bad=new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:f.event,to:'evil@example.com'})});assert.equal((await coordinator.fetch(bad)).status,400);
 assert.equal((await coordinator.fetch(new Request(url))).status,405);
 }finally{f.close();}
});
test('all missing configuration and schema prevent any HTTP; normal home changes still dispatch',async()=>{
 for(const extra of [{deliveryEnabled:undefined},{deliveryEnabled:'false'},{apiKey:undefined},{from:undefined},{coordinator:undefined},{contactKey:undefined},{origin:'https://bad.example/path'}]){
 const f=await transportFixture();try{const m=createIdentityMail({...f.env,...extra});assert.equal(m.configured(),false);await m.processOne(f.event);assert.equal(f.calls.length,0);assert.equal(f.count('identity_mail_dispatches'),0);}finally{f.close();}}
 const f=await transportFixture();try{f.db.sqlite.exec('DROP TRIGGER identity_mail_finish_binding');await f.mail.processOne(f.event);assert.equal(f.calls.length,0);assert.equal(f.count('identity_mail_dispatches'),0);}finally{f.close();}
 for(const template of ['identity-card-v1','identity-recovery-continued-v1','identity-guardian-repaired-v1']){const good=await transportFixture();try{if(template!=='identity-card-v1')await good.security(template);await good.c.prepare(good.event);good.db.sqlite.exec('UPDATE tower_residencies SET revision=revision+1');good.db.sqlite.exec('UPDATE agent_identities SET version=version+1,authority_epoch=authority_epoch+1');good.db.sqlite.exec('UPDATE identity_guardians SET version=version+1');assert.equal((await good.mail.processOne(good.event))!.state,'accepted');}finally{good.close();}}
});
test('early webhook states survive unknown or failed finish with no provider ID',async()=>{
 for(const state of ['delivered','bounced','failed','accepted'])for(const result of ['unknown','failed'] as const){const f=await transportFixture();try{
 const meta=await f.c.prepare(f.event),body=await f.c.claim(f.event,meta.descriptor.bodyDigest);f.db.sqlite.prepare('UPDATE identity_mail_events SET state=?,provider_id=? WHERE id=?').run(state,'known-provider',f.event);
 await f.c.finish({eventId:f.event,leaseId:body.headers.get('X-Identity-Mail-Lease')!,state:result,providerId:null,errorCode:result==='unknown'?'provider_outcome_unknown':'provider_rejected_422'});
 assert.equal((await f.mail.status(f.event))!.state,state);assert.equal((await f.mail.status(f.event))!.providerId,'known-provider');assert.equal(f.count('identity_mail_finish_receipts'),1);
 }finally{f.close();}}
});
import {spawnSync} from 'node:child_process';
test('full max-size Pages prepare/claim/finish path stays in D1 Free budget and compiles at official limits',async(t)=>{
 const f=await transportFixture(8388608);try{
 const queries:{sql:string;binds:unknown[]}[]=[],prepare=f.db.prepare.bind(f.db);
 f.db.prepare=sql=>{const s=prepare(sql),bind=s.bind.bind(s),entry={sql,binds:[] as unknown[]};queries.push(entry);s.bind=(...values)=>{entry.binds=values;return bind(...values);};return s;};
 assert.equal((await f.mail.processOne(f.event))!.state,'accepted');assert(queries.length<=50,'full Pages+DO path counts every SQL statement conservatively: '+queries.length);t.diagnostic('full Pages + DO path: '+queries.length+' SQL statements including control schema checks and finish');
 for(const q of queries){assert(q.binds.length<=100);assert(Buffer.byteLength(q.sql)<100000);for(const value of q.binds)if(typeof value==='string')assert(Buffer.byteLength(value)<1000000);}
 const result=spawnSync('python3',['-c',String.raw`
import base64,json,re,sqlite3,sys
v=json.load(sys.stdin);db=sqlite3.connect(':memory:');db.deserialize(base64.b64decode(v['database']))
for limit,n in [(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32),(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100),(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000),(sqlite3.SQLITE_LIMIT_LENGTH,2000000),(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)]: db.setlimit(limit,n)
for q in v['queries']: db.execute('EXPLAIN '+q['sql'],q['binds'])
print(len(v['queries']))
`],{input:JSON.stringify({database:Buffer.from(f.db.sqlite.serialize()).toString('base64'),queries}),encoding:'utf8',maxBuffer:1000000});
 assert.equal(result.status,0,result.stderr);assert.equal(Number(result.stdout),queries.length);
 }finally{f.close();}
});
test('small metadata revalidates current permission and native clock after prepare without materializing attachments',async()=>{
 for(const mutation of ['cancel','clock','recipient','template']){const f=await transportFixture();try{
 await f.invitation();const core=(await import('../server/live/identity-mail-envelope.ts')).createIdentityMailEnvelope(f.env);await core.prepare(f.event);
 if(mutation==='cancel')f.db.sqlite.exec("UPDATE identity_guardian_invites SET state='cancelled'");
 if(mutation==='clock')f.setNative('2026-11-02T00:00:00.000Z');
 if(mutation==='recipient'){f.db.sqlite.exec('DROP TRIGGER identity_guardian_immutable_binding');f.db.sqlite.prepare("UPDATE identity_guardian_invites SET email_hash=? WHERE id=?").run('0'.repeat(64),f.invite);}
 if(mutation==='template')await f.patchPayload({template:'wrong'});
 await assert.rejects(core.metadata(f.event));assert.equal(f.count('identity_mail_dispatches'),0);
 }finally{f.close();}}
});
test('dispatch audit evidence and canonical schema timestamps cannot be rewritten or removed',async()=>{
 const f=await transportFixture();try{
 await f.mail.processOne(f.event);
 for(const sql of ["DELETE FROM identity_mail_audit WHERE action='sending'","UPDATE identity_mail_audit SET detail_json='{}' WHERE action='sending'","DELETE FROM identity_mail_audit WHERE action='dispatch-finished'"])assert.throws(()=>f.db.sqlite.exec(sql));
 for(const t of ['invalid','2026-10-31T00:00:00Z',''])assert.throws(()=>f.db.sqlite.prepare('INSERT INTO identity_mail_suppressions VALUES(?,?,?)').run('0'.repeat(64),'manual',t));
 }finally{f.close();}
});
test('max-size lost prepare acknowledgement still fits Free budget and preserves frozen claim bytes',async(t)=>{
 const f=await transportFixture(8388608);try{
 let count=0,lost=false;const prepare=f.db.prepare.bind(f.db),batch=f.db.batch.bind(f.db);f.db.prepare=sql=>{count++;return prepare(sql);};
 f.db.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_mail_envelopes'))){lost=true;throw Error('lost acknowledgement');}return result;};
 assert.equal((await f.mail.processOne(f.event))!.state,'accepted');assert(lost);assert(count<=50,'lost acknowledgement full path uses '+count+' SQL statements');t.diagnostic('lost prepare ack Pages + DO path: '+count+' SQL statements');assert.equal(f.calls.filter(c=>c.init.method==='POST').length,1);assert.equal(f.count('identity_mail_dispatches'),1);
 }finally{f.close();}
});
test('provider suppression persists even when another claim already changed the event state',async()=>{
 const f=await transportFixture();try{const m=await f.c.prepare(f.event);await f.c.claim(f.event,m.descriptor.bodyDigest);await f.c.suppress(f.event,m.descriptor.bodyDigest,'complaint');assert.equal(f.count('identity_mail_suppressions'),1);assert.equal((await f.mail.status(f.event))!.state,'sending');await assert.rejects(f.c.claim(f.event,m.descriptor.bodyDigest));}finally{f.close();}
});
