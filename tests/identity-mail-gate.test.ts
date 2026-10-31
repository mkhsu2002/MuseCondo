import {syntheticSenderReady} from './helpers/identity-mail-ready-fixture.ts';
import {IDENTITY_MAIL_PROVIDER_SCHEMA} from '../server/live/identity-mail-readiness.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {envelopeFixture} from './helpers/identity-mail-fixture.ts';
import {createIdentityMail} from '../server/live/identity-mail.ts';
import {createIdentityMailCoordinator} from '../server/live/identity-mail-coordinator.ts';
import {identityMailDeliveryReady} from '../server/live/identity-mail-control.ts';
import {IDENTITY_MAIL_CONTROL_SCHEMA} from '../server/live/identity-mail-control.ts';
import {IDENTITY_MAIL_DELIVERY_SCHEMA} from '../server/live/identity-mail-delivery.ts';

test('async readiness fails closed for missing probe, wrong key, origin, unavailable schema and undecryptable setup',async()=>{
 for(const mode of ['unprobed','unknown','blocked','wrong-key','wrong-origin','missing-table','corrupt-secret']){
  const f=await envelopeFixture();try{
   if(mode==='unprobed')f.db.sqlite.exec('UPDATE identity_mail_webhook_setups SET handler_probe_at=NULL');
   if(mode==='unknown'||mode==='blocked')f.db.sqlite.prepare('UPDATE identity_mail_webhook_setups SET state=?').run(mode);
   if(mode==='missing-table')f.db.sqlite.exec('DROP TABLE identity_mail_webhook_setups');
   if(mode==='corrupt-secret'){f.db.sqlite.exec('DROP TRIGGER identity_mail_webhook_binding');f.db.sqlite.exec("UPDATE identity_mail_webhook_setups SET secret_ciphertext='invalid'");}
   const env={...f.env,...mode==='wrong-key'?{contactKey:'8'.repeat(64)}:{},...mode==='wrong-origin'?{origin:'https://other.example'}:{}};
   assert.equal(await identityMailDeliveryReady(f.db,env.origin,env.contactKey,env.from,env.now()),false,mode);
   let calls=0,rpcs=0;
   const coordinator={idFromName:(n:string)=>n,get:()=>({fetch:async()=>{rpcs++;throw Error('Gate must precede DO access');}})};
   const mail=createIdentityMail({...env,apiKey:'synthetic',deliveryEnabled:'true',coordinator,fetcher:async()=>{calls++;throw Error('Gate must precede provider access');}});
   assert.equal((await mail.processOne(f.event))!.state,'pending');assert.equal(rpcs,0,mode);assert.equal(calls,0,mode);assert.equal(f.count('identity_mail_dispatches'),0);
  }finally{f.close();}
 }
});

test('every control and delivery schema object protects Pages transport and private DO before preparation or claim',async()=>{
 for(const name of [...IDENTITY_MAIL_PROVIDER_SCHEMA,...IDENTITY_MAIL_CONTROL_SCHEMA,...IDENTITY_MAIL_DELIVERY_SCHEMA]){
  const f=await envelopeFixture();try{
   const type=f.db.sqlite.prepare('SELECT type FROM sqlite_master WHERE name=?').get(name)!.type;
   f.db.sqlite.exec('PRAGMA foreign_keys=OFF');f.db.sqlite.exec('DROP '+String(type)+' '+name);f.db.sqlite.exec('PRAGMA foreign_keys=ON');
   let calls=0;const c=createIdentityMailCoordinator(f.env),binding={idFromName:(n:string)=>n,get:()=>({fetch:(r:Request)=>c.fetch(r)})};
   const mail=createIdentityMail({...f.env,apiKey:'synthetic',deliveryEnabled:'true',coordinator:binding,fetcher:async()=>{calls++;throw Error('No provider access');}});
   assert.equal((await mail.processOne(f.event))!.state,'pending',name);assert.equal(calls,0,name);
   const response=await c.fetch(new Request(f.env.origin+'/__internal/identity-mail/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:f.event})}));
   assert.equal(response.status,503,name);assert.equal((await response.json()).error,'identity_mail_schema_not_ready');assert.equal(f.count('identity_mail_dispatches'),0);
  }finally{f.close();}
 }
});

test('both readiness state and probe removal at the last native transaction prevent a lease and audit',async()=>{
 for(const mutation of ["state='unknown'",'handler_probe_at=NULL']){
  const f=await envelopeFixture();try{
   const c=createIdentityMailCoordinator(f.env),prepared=await c.prepare(f.event),batch=f.db.batch.bind(f.db);
   f.db.batch=async rows=>{if(rows.some(r=>(r as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_mail_dispatches')))f.db.sqlite.exec('UPDATE identity_mail_webhook_setups SET '+mutation);return batch(rows);};
   await assert.rejects(c.claim(f.event,prepared.descriptor.bodyDigest));assert.equal(f.count('identity_mail_dispatches'),0);
   assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM identity_mail_audit WHERE action='sending'").get()!.n,0);
   assert.equal(f.db.sqlite.prepare('SELECT attempt_count FROM identity_mail_events WHERE id=?').get(f.event)!.attempt_count,0);
  }finally{f.close();}
 }
});
async function sending(f:Awaited<ReturnType<typeof envelopeFixture>>,extra={}){
 const c=createIdentityMailCoordinator(f.env);let posts=0,requests=0;
 const mail=createIdentityMail({...f.env,...extra,apiKey:'synthetic',deliveryEnabled:'true',coordinator:{idFromName:(n:string)=>n,get:()=>({fetch:(r:Request)=>c.fetch(r)})},fetcher:async(_u,init)=>{requests++;if(init?.method==='POST'){posts++;await new Response(init.body).arrayBuffer();return Response.json({id:'synthetic-provider'});}return new Response(null,{status:404});}});
 return {result:await mail.processOne(f.event),posts,requests};
}
test('absence of a successful sender snapshot blocks a send despite a probed handler',async()=>{
 const f=await envelopeFixture(64,false);try{assert.equal(f.count('identity_mail_provider_checks'),0);const r=await sending(f);assert.equal(r.result!.state,'pending');assert.equal(r.posts,0);assert.equal(r.requests,0);}finally{f.close();}
});
for(const probeAt of ['2000-01-01T00:00:00.000Z','2026-11-01T00:00:00.000Z','invalid'])test('stale or future handler probe cannot authorize sending: '+probeAt,async()=>{
 const f=await envelopeFixture();try{f.db.sqlite.prepare('UPDATE identity_mail_webhook_setups SET handler_probe_at=?').run(probeAt);const r=await sending(f);assert.equal(r.result!.state,'pending');assert.equal(r.posts,0);assert.equal(r.requests,0);}finally{f.close();}
});

for(const mode of ['old','future','wrong-domain','not-ready','changed-from','wrong-hash'])test('sender snapshot fails closed: '+mode,async()=>{
 const f=await envelopeFixture();try{
  const at=mode==='old'?'2000-01-01T00:00:00.000Z':mode==='future'?'2026-11-01T00:00:00.000Z':'2026-10-31T00:00:00.000Z';
  if(mode==='changed-from'){const r=await sending(f,{from:'Changed <identity@example.com>'});assert.equal(r.posts,0);assert.equal(r.requests,0);return;}
  await syntheticSenderReady(f.db,f.env.origin,mode==='wrong-hash'?'Wrong <other@example.com>':f.env.from,at,mode==='wrong-domain'?{domain:'wrong.example'}:mode==='not-ready'?{state:'not_ready',senderReady:false}:{});
  // A different input hash cannot displace the current FROM's previous success: test a FROM with only that mismatching proof.
  const r=await sending(f,mode==='wrong-hash'?{from:'Different <identity@example.com>'}:{});assert.equal(r.result!.state,'pending');assert.equal(r.posts,0);assert.equal(r.requests,0);
 }finally{f.close();}
});
for(const expiring of ['sender','probe'])test('native final batch rejects '+expiring+' expiration after async preflight',async()=>{
 const f=await envelopeFixture();try{
  const boundary='2026-11-01T00:00:00.000Z';f.setClock(boundary);f.setNative(boundary);
  if(expiring==='sender')f.db.sqlite.prepare('UPDATE identity_mail_webhook_setups SET handler_probe_at=?').run(boundary);
  else await syntheticSenderReady(f.db,f.env.origin,f.env.from,boundary);
  const c=createIdentityMailCoordinator(f.env),prepared=await c.prepare(f.event),batch=f.db.batch.bind(f.db);let crossed=false;
  f.db.batch=async rows=>{if(rows.some(r=>(r as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_mail_dispatches'))){crossed=true;f.setNative('2026-11-01T00:00:00.001Z');}return batch(rows);};
  await assert.rejects(c.claim(f.event,prepared.descriptor.bodyDigest));assert(crossed);assert.equal(f.count('identity_mail_dispatches'),0);
  assert.equal(f.db.sqlite.prepare('SELECT attempt_count FROM identity_mail_events WHERE id=?').get(f.event)!.attempt_count,0);
 }finally{f.close();}
});
test('fresh proof for a changed FROM cannot release a frozen old-FROM envelope through Pages or private DO',async()=>{
 const f=await envelopeFixture();try{
  const c=createIdentityMailCoordinator(f.env),prepared=await c.prepare(f.event),from='Changed <changed@example.com>';
  await syntheticSenderReady(f.db,f.env.origin,from);
  const result=await sending(f,{from});assert.equal(result.result!.state,'pending');assert.equal(result.posts,0);assert.equal(result.requests,0);
  await assert.rejects(createIdentityMailCoordinator({...f.env,from}).claim(f.event,prepared.descriptor.bodyDigest));assert.equal(f.count('identity_mail_dispatches'),0);
 }finally{f.close();}
});
