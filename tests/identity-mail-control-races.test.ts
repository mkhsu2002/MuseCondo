import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createIdentityMailControl,IDENTITY_MAIL_WEBHOOK_EVENTS} from '../server/live/identity-mail-control.ts';
const origin='https://mail.example',key='a'.repeat(64),secret='whsec_'+btoa('synthetic-existing-webhook-secret');

test('concurrent adoption of the same existing webhook preserves the encrypted winner and both durable results',async()=>{
 const db=new LocalDatabase(':memory:');try{
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  let posts=0;
  const control=createIdentityMailControl({db,origin,contactKey:key,apiKey:'synthetic-key',operator:async()=>true,fetcher:async(input,init)=>{
   if(init?.method==='POST'){posts++;throw Error('An existing hook must never be created again');}
   return String(input).includes('/webhooks/existing-hook')?Response.json({object:'webhook',id:'existing-hook',endpoint:origin+'/api/v1/identity/mail/webhook',events:IDENTITY_MAIL_WEBHOOK_EVENTS,status:'enabled',signing_secret:secret}):Response.json({object:'list',has_more:false,data:[{id:'existing-hook',endpoint:origin+'/api/v1/identity/mail/webhook'}]});
  }});
  const req=(requestKey:string)=>control.fetch(new Request(origin+'/api/v1/operator/identity/mail-delivery/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey})}));
  const responses=await Promise.all([req('concurrent-adopt-one'),req('concurrent-adopt-two')]);
  assert.equal(posts,0);assert.equal(db.sqlite.prepare('SELECT state FROM identity_mail_webhook_setups').get()!.state,'ready');
  for(const response of responses){assert.equal(response!.status,200);assert.equal((await response!.json()).webhook.configured,true);}
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM identity_mail_control_results').get()!.n,2);
  const ciphertext=db.sqlite.prepare('SELECT secret_ciphertext FROM identity_mail_webhook_setups').get()!.secret_ciphertext;
  assert.equal((await req('concurrent-adopt-one'))!.status,200);assert.equal(db.sqlite.prepare('SELECT secret_ciphertext FROM identity_mail_webhook_setups').get()!.secret_ciphertext,ciphertext);
 }finally{db.close();}
});
test('a fresh reconcile failure still disables the same ready snapshot without enabling another create',async()=>{
 const db=new LocalDatabase(':memory:');try{
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  let failed=false,posts=0;
  const control=createIdentityMailControl({db,origin,contactKey:key,apiKey:'synthetic-key',operator:async()=>true,fetcher:async(_input,init)=>{
   if(init?.method==='POST')posts++;
   if(failed)return new Response(null,{status:503});
   return String(_input).includes('/webhooks/existing-hook')?Response.json({object:'webhook',id:'existing-hook',endpoint:origin+'/api/v1/identity/mail/webhook',events:IDENTITY_MAIL_WEBHOOK_EVENTS,status:'enabled',signing_secret:secret}):Response.json({object:'list',has_more:false,data:[{id:'existing-hook',endpoint:origin+'/api/v1/identity/mail/webhook'}]});
  }});
  const req=(action:string,requestKey:string)=>control.fetch(new Request(origin+'/api/v1/operator/identity/mail-delivery/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey})}));
  await req('setup','initial-existing-setup');failed=true;
  const response=await req('reconcile','failed-fresh-reconcile');assert.equal(response!.status,200);assert.equal((await response!.json()).webhook.configured,false);
  assert.equal(db.sqlite.prepare('SELECT state FROM identity_mail_webhook_setups').get()!.state,'unknown');assert.equal(posts,0);
 }finally{db.close();}
});
for(const failure of ['empty-body','oversize-body','finish-receipt'])test('provider '+failure+' leaves a safe setup outcome and atomic audit',async()=>{
 const db=new LocalDatabase(':memory:');try{
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  let failed=false;const batch=db.batch.bind(db);db.batch=async rows=>{if(failed&&failure==='finish-receipt'&&rows.some(r=>(r as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_mail_control_results')))throw Error('Synthetic lost finish');return batch(rows);};
  const control=createIdentityMailControl({db,origin,contactKey:key,apiKey:'synthetic-key',operator:async()=>true,fetcher:async input=>{
   if(failed)return failure==='empty-body'?new Response(null,{status:200}):failure==='oversize-body'?new Response('x'.repeat(65537),{status:200}):new Response(null,{status:503});
   return String(input).includes('/webhooks/existing-hook')?Response.json({object:'webhook',id:'existing-hook',endpoint:origin+'/api/v1/identity/mail/webhook',events:IDENTITY_MAIL_WEBHOOK_EVENTS,status:'enabled',signing_secret:secret}):Response.json({object:'list',has_more:false,data:[{id:'existing-hook',endpoint:origin+'/api/v1/identity/mail/webhook'}]});
  }});
  const req=(action:string,requestKey:string)=>control.fetch(new Request(origin+'/api/v1/operator/identity/mail-delivery/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey})}));
  await req('setup','first-valid-setup');failed=true;const response=await req('reconcile','reconcile-failure');
  assert.equal(response!.status,failure==='finish-receipt'?503:200);assert.equal(db.sqlite.prepare('SELECT state FROM identity_mail_webhook_setups').get()!.state,'unknown');
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM identity_mail_control_audit WHERE request_key='reconcile-failure' AND action='setup-unknown'").get()!.n,1);
 }finally{db.close();}
});
test('setup state changes roll back when their atomic outcome audit cannot be written',async()=>{
 const db=new LocalDatabase(':memory:');try{
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  let failed=false;const control=createIdentityMailControl({db,origin,contactKey:key,apiKey:'synthetic-key',operator:async()=>true,fetcher:async input=>failed?new Response(null,{status:503}):String(input).includes('/webhooks/existing-hook')?Response.json({object:'webhook',id:'existing-hook',endpoint:origin+'/api/v1/identity/mail/webhook',events:IDENTITY_MAIL_WEBHOOK_EVENTS,status:'enabled',signing_secret:secret}):Response.json({object:'list',has_more:false,data:[{id:'existing-hook',endpoint:origin+'/api/v1/identity/mail/webhook'}]})});
  const req=(action:string,requestKey:string)=>control.fetch(new Request(origin+'/api/v1/operator/identity/mail-delivery/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey})}));
  await req('setup','first-audited-setup');const before=db.sqlite.prepare('SELECT * FROM identity_mail_webhook_setups').get();
  db.sqlite.exec("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON identity_mail_control_audit WHEN NEW.action='setup-unknown' BEGIN SELECT RAISE(ABORT,'synthetic audit failure');END");failed=true;
  assert.equal((await req('reconcile','audit-rollback-reconcile'))!.status,503);assert.deepEqual(db.sqlite.prepare('SELECT * FROM identity_mail_webhook_setups').get(),before);
 }finally{db.close();}
});
