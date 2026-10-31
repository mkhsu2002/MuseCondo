import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
const origin='https://mail.example',secret='whsec_'+btoa('synthetic-webhook-secret-32-bytes!'),key='a'.repeat(64),time='2026-10-31T00:00:00.000Z';
const events=['email.delivered','email.bounced','email.complained','email.failed','email.suppressed'];
async function fixture(fetcher:typeof fetch){const db=new LocalDatabase(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));db.sqlite.function('strftime',(_format,input)=>input==='now'?time:new Date(String(input)).toISOString());const {createIdentityMailControl}=await import('../server/live/identity-mail-control.ts');const control=createIdentityMailControl({db,origin,contactKey:key,apiKey:'synthetic-deployment-key',fetcher,now:()=>new Date(time),operator:async r=>r.headers.get('X-Tower-Operator-Key')==='synthetic'});const req=(action:string,body:unknown={requestKey:'setup-request-001'},operator=true)=>control.fetch(new Request(origin+'/api/v1/operator/identity/mail-delivery/'+action,{method:action==='status'?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...operator?{'X-Tower-Operator-Key':'synthetic'}:{}},...action==='status'?{}:{body:JSON.stringify(body)}}));return {db,control,req};}
test('webhook setup persists intent before provider mutation, encrypts secret and registers exactly five events',async()=>{
 let calls=0,creates=0;const f=await fixture(async(input,init)=>{const u=String(input);calls++;assert(f.db.sqlite.prepare('SELECT 1 FROM identity_mail_control_requests').get());if(init?.method==='POST'){creates++;assert.equal(u,'https://api.resend.com/webhooks');assert.deepEqual(JSON.parse(String(init.body)),{endpoint:origin+'/api/v1/identity/mail/webhook',events});assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_webhook_setups').get()!.state,'creating');return Response.json({object:'webhook',id:'hook-1',signing_secret:secret},{status:201});}if(u.includes('/webhooks/hook-1'))return Response.json({object:'webhook',id:'hook-1',endpoint:origin+'/api/v1/identity/mail/webhook',events,status:'enabled',signing_secret:secret});return Response.json({object:'list',has_more:false,data:[]});});try{
 assert.equal((await f.req('setup',undefined,false))!.status,401);assert.equal(calls,0);
 const r=(await f.req('setup'))!;assert.equal(r.status,200);const out=await r.text();assert(!out.includes(secret));assert(!out.includes('synthetic-deployment-key'));assert(out.includes('configured'));
 const row=f.db.sqlite.prepare('SELECT * FROM identity_mail_webhook_setups').get()!;assert.equal(row.state,'ready');assert(!String(row.secret_ciphertext).includes(secret));
 const previous=calls;assert.equal((await f.req('setup'))!.status,200);assert.equal(calls,previous);assert.equal(creates,1);
 }finally{f.db.close();}
});
test('unknown webhook create never blindly repeats POST even when list currently returns zero',async()=>{
 let posts=0;const f=await fixture(async(_input,init)=>{if(init?.method==='POST'){posts++;throw Error('synthetic timeout');}return Response.json({object:'list',has_more:false,data:[]});});try{
 assert.equal((await f.req('setup'))!.status,200);assert.equal(posts,1);assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_webhook_setups').get()!.state,'unknown');
 assert.equal((await f.req('reconcile',{requestKey:'reconcile-001'}))!.status,200);assert.equal(posts,1);assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_webhook_setups').get()!.state,'unknown');
 }finally{f.db.close();}
});
test('deployment-owned signed handler probe records only handler readiness and never email delivery',async()=>{
 const f:Awaited<ReturnType<typeof fixture>>=await fixture(async(input,init)=>{const u=String(input);if(u.startsWith(origin))return (await f.control.fetch(new Request(u,init)))!;if(u.includes('/webhooks/hook-1'))return Response.json({object:'webhook',id:'hook-1',endpoint:origin+'/api/v1/identity/mail/webhook',events,status:'enabled',signing_secret:secret});if(init?.method==='POST')return Response.json({object:'webhook',id:'hook-1',signing_secret:secret},{status:201});return Response.json({object:'list',has_more:false,data:[]});});try{
 await f.req('setup');const probe=(await f.req('probe',{requestKey:'handler-probe-1'}))!;assert.equal(probe.status,200);const v=await probe.json();assert.equal(v.handlerVerified,true);assert.equal(v.deliveryVerified,false);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM identity_mail_delivery_receipts').get()!.n,0);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM identity_mail_handler_probes WHERE consumed_at IS NOT NULL').get()!.n,1);
 }finally{f.db.close();}
});
test('bounded unknown-send reconciliation uses exact persisted tag and envelope, never sends again, and replays permanent facts without a fresh GET',async()=>{
 const {envelopeFixture}=await import('./helpers/identity-mail-fixture.ts'),{createIdentityMailCoordinator}=await import('../server/live/identity-mail-coordinator.ts'),{createIdentityMailControl}=await import('../server/live/identity-mail-control.ts');
 const f=await envelopeFixture();try{
 const c=createIdentityMailCoordinator(f.env),m=await c.prepare(f.event),claimed=await c.claim(f.event,m.descriptor.bodyDigest),body=await claimed.json();
 await c.finish({eventId:f.event,leaseId:claimed.headers.get('X-Identity-Mail-Lease')!,state:'unknown',providerId:null,errorCode:'provider_outcome_unknown'});
 let calls=0;const email={id:'known-provider',from:body.from,to:body.to,subject:body.subject,tags:[{name:'identity_event',value:f.event}],last_event:'delivered',created_at:time};
 const control=createIdentityMailControl({...f.env,apiKey:'synthetic',operator:async()=>true,fetcher:async(input,init)=>{calls++;assert.notEqual(init?.method,'POST');return String(input).includes('/emails/known-provider')?Response.json(email):Response.json({object:'list',has_more:false,data:[email]});}});
 const req=()=>control.fetch(new Request(f.env.origin+'/api/v1/operator/identity/mail-delivery/event-reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestKey:'reconcile-mail-1',eventId:f.event})}));
 const r=(await req())!;assert.equal(r.status,200);const data=await r.json();assert.equal(data.delivery.deliveryVerified,true);assert.equal(calls,2);assert.equal(f.count('identity_mail_dispatches'),1);assert.equal(f.count('identity_mail_delivery_facts'),1);
 assert.deepEqual(await(await req())!.json(),data);assert.equal(calls,2);
 }finally{f.close();}
});
