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
   assert.equal(await identityMailDeliveryReady(f.db,env.origin,env.contactKey),false,mode);
   let calls=0,rpcs=0;
   const coordinator={idFromName:(n:string)=>n,get:()=>({fetch:async()=>{rpcs++;throw Error('Gate must precede DO access');}})};
   const mail=createIdentityMail({...env,apiKey:'synthetic',deliveryEnabled:'true',coordinator,fetcher:async()=>{calls++;throw Error('Gate must precede provider access');}});
   assert.equal((await mail.processOne(f.event))!.state,'pending');assert.equal(rpcs,0,mode);assert.equal(calls,0,mode);assert.equal(f.count('identity_mail_dispatches'),0);
  }finally{f.close();}
 }
});

test('every control and delivery schema object protects Pages transport and private DO before preparation or claim',async()=>{
 for(const name of [...IDENTITY_MAIL_CONTROL_SCHEMA,...IDENTITY_MAIL_DELIVERY_SCHEMA]){
  const f=await envelopeFixture();try{
   const type=f.db.sqlite.prepare('SELECT type FROM sqlite_master WHERE name=?').get(name)!.type;
   f.db.sqlite.exec('DROP '+String(type)+' '+name);
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
