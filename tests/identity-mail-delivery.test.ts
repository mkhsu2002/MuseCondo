import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {envelopeFixture} from './helpers/identity-mail-fixture.ts';
import {createIdentityMailCoordinator} from '../server/live/identity-mail-coordinator.ts';
const path=new URL('../server/live/identity-mail-delivery.ts',import.meta.url);
const secret='whsec_plJ3nmyCDGBKInavdOK15jsl',encoder=new TextEncoder();
const stamp='1793404800';
async function sign(raw:Uint8Array,id='msg_synthetic',timestamp=stamp,key=secret){
 const hmac=await crypto.subtle.importKey('raw',Buffer.from(key.slice(6),'base64'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=Buffer.concat([Buffer.from(id+'.'+timestamp+'.'),raw]);
 return 'v1,'+Buffer.from(await crypto.subtle.sign('HMAC',hmac,bytes)).toString('base64');
}
async function request(origin:string,value:unknown,id='msg_synthetic',timestamp=stamp,raw?:Uint8Array){
 const bytes=raw??encoder.encode(JSON.stringify(value));return new Request(origin+'/dormant-webhook',{method:'POST',headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':await sign(bytes,id,timestamp)},body:Buffer.from(bytes)});
}
test('dormant delivery factory validates official Svix fixed vector with an 18 byte secret',async()=>{
 assert(existsSync(path),'private delivery core is implemented');
 const {verifyIdentityMailWebhook}=await import('../server/live/identity-mail-delivery.ts');
 const raw=encoder.encode('{"event_type":"ping","data":{"success":true}}');
 assert(await verifyIdentityMailWebhook(raw,new Headers({'svix-id':'msg_loFOjxBNrRLzqYUf','svix-timestamp':'1731705121','svix-signature':'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='}),secret,new Date(1731705121000)));
});
test('real prepare and claim accept an early delivery; HTTP finish and exact replay preserve terminal fact',async()=>{
 assert(existsSync(path),'private delivery core is implemented');
 const {createIdentityMailDelivery}=await import('../server/live/identity-mail-delivery.ts');
 const f=await envelopeFixture();try{
 const c=createIdentityMailCoordinator(f.env),m=await c.prepare(f.event),claimed=await c.claim(f.event,m.descriptor.bodyDigest),body=await claimed.json();
 const core=createIdentityMailDelivery({...f.env,webhookSecret:secret});
 const event={type:'email.delivered',created_at:'2026-10-30T12:00:00.000Z',data:{email_id:'provider-id',from:body.from,to:body.to,subject:body.subject,tags:{identity_event:f.event},created_at:'2026-10-30T10:00:00.000Z'}};
 const r=await core.handleWebhook(await request(f.env.origin,event));assert.equal(r.status,200);const result=await r.json();assert.equal(result.state,'delivered');
 await c.finish({eventId:f.event,leaseId:claimed.headers.get('X-Identity-Mail-Lease')!,state:'accepted',providerId:'provider-id',errorCode:null});
 assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE id=?').get(f.event)!.state,'delivered');
 assert.deepEqual(await (await core.handleWebhook(await request(f.env.origin,event))).json(),result);
 assert.equal(f.count('identity_mail_delivery_receipts'),1);assert.equal(f.count('identity_mail_delivery_facts'),1);
 const fact=f.db.sqlite.prepare('SELECT * FROM identity_mail_delivery_facts').get()!;assert.equal(fact.observed_at,'2026-10-31T00:00:00.000Z');
 assert.deepEqual(await core.receipt('webhook','msg_synthetic'),result);
 }finally{f.close();}
});
async function claimedFixture(){
 const f=await envelopeFixture(),c=createIdentityMailCoordinator(f.env),m=await c.prepare(f.event),response=await c.claim(f.event,m.descriptor.bodyDigest),body=await response.json();
 const {createIdentityMailDelivery}=await import('../server/live/identity-mail-delivery.ts');
 const event=(type='email.delivered')=>({type,created_at:'2026-10-30T10:00:00.000Z',data:{email_id:'provider-id',from:body.from,to:body.to,subject:body.subject,tags:{identity_event:f.event},created_at:'2026-10-30T09:00:00.000Z'}});
 const email=(last_event='delivered')=>({id:'provider-id',from:body.from,to:body.to,subject:body.subject,tags:[{name:'identity_event',value:f.event}],last_event,created_at:'2026-10-30 09:00:00+00'});
 return {...f,c,body,response,event,email,core:createIdentityMailDelivery({...f.env,webhookSecret:secret})};
}
test('raw bytes verify Unicode and whitespace, reject BOM mutation, byte flips, wrong keys and stale attempts',async()=>{
 const {verifyIdentityMailWebhook}=await import('../server/live/identity-mail-delivery.ts');
 for(const text of [' {"note":"繁體中文☁️"}\n','\ufeff{"note":"繁體中文"}','{"note":"a"}']){
 const raw=encoder.encode(text),r=await request('https://identity.example',null,'crypto',stamp,raw);
 assert(await verifyIdentityMailWebhook(raw,r.headers,secret,new Date('2026-10-31T00:00:00Z')));
 const changed=Uint8Array.from(raw);changed[changed.length-1]^=1;
 assert.equal(await verifyIdentityMailWebhook(changed,r.headers,secret,new Date('2026-10-31T00:00:00Z')),false);
 assert.equal(await verifyIdentityMailWebhook(raw,r.headers,'whsec_'+Buffer.from('wrong secret').toString('base64'),new Date('2026-10-31T00:00:00Z')),false);
 assert.equal(await verifyIdentityMailWebhook(raw,r.headers,secret,new Date('2026-10-31T00:05:01Z')),false);
 const multi=new Headers(r.headers);multi.set('svix-signature','v2,ignored v1,'+Buffer.alloc(32).toString('base64')+' '+r.headers.get('svix-signature'));
 assert(await verifyIdentityMailWebhook(raw,multi,secret,new Date('2026-10-31T00:00:00Z')));
 assert(await verifyIdentityMailWebhook(raw,r.headers,secret+'==',new Date('2026-10-31T00:00:00Z'))===false,'noncanonical padding rejected');
 }
 const padded='whsec_'+Buffer.from('synthetic 19 bytes!X').toString('base64'),raw=encoder.encode('{}'),h=new Headers({'svix-id':'canonical','svix-timestamp':stamp,'svix-signature':await sign(raw,'canonical',stamp,padded)});
 assert(await verifyIdentityMailWebhook(raw,h,padded,new Date(Number(stamp)*1000)));assert(await verifyIdentityMailWebhook(raw,h,padded.replace(/=+$/,''),new Date(Number(stamp)*1000)));
});
test('same signed Svix id with a different supported, unsupported or foreign payload always conflicts',async()=>{
 const f=await claimedFixture();try{
 assert.equal((await f.core.handleWebhook(await request(f.env.origin,f.event(),'permanent'))).status,200);
 for(const type of ['email.bounced','email.opened'])assert.equal((await f.core.handleWebhook(await request(f.env.origin,f.event(type),'permanent'))).status,409);
 const foreign=f.event();foreign.data.tags.identity_event='f'.repeat(32);assert.equal((await f.core.handleWebhook(await request(f.env.origin,foreign,'permanent'))).status,409);
 assert.equal(f.count('identity_mail_delivery_receipts'),1);assert.equal(f.count('identity_mail_delivery_facts'),1);
 }finally{f.close();}
});
test('five facts accumulate permanently with negative priority and safe status',async()=>{
 for(const order of [['delivered','failed','suppressed','bounced','complained'],['complained','bounced','suppressed','failed','delivered']]){
 const f=await claimedFixture();try{
 for(const [i,type] of order.entries()){
 const e=f.event('email.'+type);const r=await f.core.handleWebhook(await request(f.env.origin,e,'fact_'+i));assert.equal(r.status,200);
 }
 assert.equal(f.count('identity_mail_delivery_facts'),5);const state=await f.core.status(f.event().data.tags.identity_event);assert.equal(state!.state,'bounced');assert.equal(state!.deliveryVerified,false);assert.deepEqual(state!.flags,{delivered:true,bounced:true,complained:true,failed:true,suppressed:true});
 const blocks=f.db.sqlite.prepare('SELECT * FROM identity_mail_suppressions').all();assert.equal(blocks.length,1);
 for(const table of ['identity_mail_delivery_receipts','identity_mail_delivery_facts','identity_mail_delivery_audit']){assert.throws(()=>f.db.sqlite.exec('DELETE FROM '+table));assert.throws(()=>f.db.sqlite.exec('UPDATE '+table+" SET event_id='"+'f'.repeat(32)+"'"));}
 }finally{f.close();}}
});
test('private readback confirms existence without inventing delivery and reuses immutable operation receipts',async()=>{
 const f=await claimedFixture();try{
 for(const [i,last] of ['sent','delivery_delayed','opened','clicked','queued','scheduled','canceled'].entries()){
 const result=await f.core.applyReadback('op_'+i,f.email(last));assert(!('ignored' in result));assert.equal(result.state,'accepted');assert.equal(result.deliveryVerified,false);assert.equal(f.count('identity_mail_delivery_facts'),0);
 }
 const found=await f.core.applyReadback('op_delivered',f.email());assert(!('ignored' in found));assert.equal(found.state,'delivered');assert.equal(found.observedAt,'2026-10-31T00:00:00.000Z');
 const result=await f.core.applyReadback('op_negative',f.email('complained'));assert(!('ignored' in result));assert.equal(result.state,'bounced');
 assert.deepEqual(await f.core.receipt('readback','op_delivered'),found);assert.deepEqual(await f.core.applyReadback('op_delivered',f.email()),found);
 await assert.rejects(f.core.applyReadback('op_delivered',f.email('bounced')),/delivery_receipt_conflict/);
 const changed={...f.email(),last_event:'future-value'};await assert.rejects(f.core.applyReadback('op_delivered',changed),/delivery_receipt_conflict/);
 const state=await f.core.status(f.event().data.tags.identity_event);assert.equal(state!.deliveryVerified,false);assert.equal(state!.flags.complained,true);
 }finally{f.close();}
});
test('readback and webhook metadata, tenant and permanent-lease binding reject unrelated data without writes',async()=>{
 for(const mutation of ['foreign','no-ledger','bad-tag','from','to','two-to','subject','provider','missing-tag','array-tag']){
 const f=await claimedFixture();try{
 const e=f.event();
 if(mutation==='foreign')e.data.tags.identity_event='f'.repeat(32);
 if(mutation==='no-ledger'){e.data.tags.identity_event='f'.repeat(32);await f.c.prepare('f'.repeat(32));}
 if(mutation==='bad-tag')e.data.tags.identity_event='invalid';
 if(mutation==='from')e.data.from='Other <other@example.com>';
 if(mutation==='to')e.data.to=['other@example.com'];
 if(mutation==='two-to')e.data.to=['shared@example.com','shared@example.com'];
 if(mutation==='subject')e.data.subject+='changed';
 if(mutation==='provider')f.db.sqlite.prepare('UPDATE identity_mail_events SET provider_id=? WHERE id=?').run('another-id',f.event().data.tags.identity_event);
 if(mutation==='missing-tag')e.data.tags={} as typeof e.data.tags;
 if(mutation==='array-tag')e.data.tags=[{name:'identity_event',value:f.event().data.tags.identity_event}] as unknown as typeof e.data.tags;
 const r=await f.core.handleWebhook(await request(f.env.origin,e));assert.equal(r.status,200);assert.deepEqual(await r.json(),{ignored:true});
 assert.equal(f.count('identity_mail_delivery_receipts'),0);assert.equal(f.count('identity_mail_delivery_facts'),0);assert.equal(f.count('identity_mail_suppressions'),0);
 const email=f.email();email.to=['another@example.com'];assert.deepEqual(await f.core.applyReadback('ignored_readback',email),{ignored:true});
 }finally{f.close();}}
});
test('historical delivery remains true after card revocation, current guardian changes and identity retirement and public consent removal',async()=>{
 const f=await claimedFixture();try{
 f.db.sqlite.prepare("UPDATE identity_credentials SET state='revoked' WHERE credential_id=?").run(f.cid);
 f.db.sqlite.prepare("UPDATE agent_identities SET state='retired',version=version+1,authority_epoch=authority_epoch+1 WHERE agent_id=?").run(f.agent);
 f.db.sqlite.prepare('UPDATE identity_card_heads SET current_credential_id=NULL,revision=revision+1,public_verification_consent=0 WHERE account_id=?').run(f.account);
 f.db.sqlite.prepare('UPDATE identity_guardians SET version=version+1 WHERE agent_id=?').run(f.agent);
 f.db.sqlite.prepare('DELETE FROM identity_guardians WHERE agent_id=?').run(f.agent);
 const r=await f.core.handleWebhook(await request(f.env.origin,f.event()));assert.equal(r.status,200);assert.equal((await r.json()).deliveryVerified,true);
 }finally{f.close();}
});
test('suppression uses case-folded full address policy and provider-safe reason without rewriting original block',async()=>{
 for(const [reason,expected] of [['previous_bounce','bounce'],['previous_complaint','complaint'],['future-provider-value','manual']]){
 const f=await claimedFixture();try{
 const e=f.event('email.suppressed');e.data.to=['SHARED@EXAMPLE.COM'];e.data.from='Changed display <IDENTITY@EXAMPLE.COM>';
 Object.assign(e.data,{suppressed:{reason,type:'OnAccountSuppressionList',message:'private shared@example.com',diagnosticCode:['private shared@example.com']}});
 const r=await f.core.handleWebhook(await request(f.env.origin,e));assert.equal(r.status,200);const result=await r.json();assert.equal(result.state,'failed');assert.equal(result.suppressionReason,reason==='future-provider-value'?'unknown':reason);
 const block=f.db.sqlite.prepare('SELECT * FROM identity_mail_suppressions').get()!;assert.equal(block.reason,expected);
 await f.core.applyReadback('severe',f.email('complained'));assert.equal(f.db.sqlite.prepare('SELECT reason FROM identity_mail_suppressions').get()!.reason,expected);
 const {hashPrivate}=await import('../server/live/identity-private.ts');assert.equal(block.recipient_hash,await hashPrivate(f.env.contactKey,'mail-suppression','shared@example.com'));
 assert.equal(f.db.sqlite.prepare('SELECT recipient_hash FROM identity_mail_events WHERE id=?').get(f.event().data.tags.identity_event)!.recipient_hash,await hashPrivate(f.env.contactKey,'guardian-email','shared@example.com'));
 const safe=JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_delivery_audit').all());assert(!safe.includes('shared@example.com'));assert(!safe.includes('future-provider-value'));assert(!safe.includes('diagnosticCode'));
 }finally{f.close();}}
 const f=await claimedFixture();try{await f.core.handleWebhook(await request(f.env.origin,f.event('email.failed')));assert.equal(f.count('identity_mail_suppressions'),0);}finally{f.close();}
});
test('signed but unrelated supported or unsupported events do not retain shared-account tracking data',async()=>{
 const f=await claimedFixture();try{
 for(const type of ['email.opened','email.clicked','contact.created','email.delivered']){
 const e=f.event(type);e.data.tags.identity_event='0'.repeat(32);Object.assign(e.data,{ipAddress:'192.0.2.1',link:'https://private.example',userAgent:'private'});
 const r=await f.core.handleWebhook(await request(f.env.origin,e,'foreign_'+type.replace('.','_')));assert.equal(r.status,200);assert.deepEqual(await r.json(),{ignored:true});
 }
 assert.equal(f.count('identity_mail_delivery_audit'),0);assert.equal(f.count('identity_mail_delivery_receipts'),0);
 }finally{f.close();}
});
test('two independent runtimes, concurrent duplicates and lost commit acknowledgements keep one atomic receipt',async()=>{
 const {createIdentityMailDelivery}=await import('../server/live/identity-mail-delivery.ts');
 const f=await claimedFixture();try{
 const other=createIdentityMailDelivery({...f.env,webhookSecret:async()=>secret}),responses=await Promise.all([f.core.handleWebhook(await request(f.env.origin,f.event(),'race')),other.handleWebhook(await request(f.env.origin,f.event(),'race'))]);
 assert(responses.every(r=>r.status===200));assert.deepEqual(await responses[0].json(),await responses[1].json());assert.equal(f.count('identity_mail_delivery_receipts'),1);
 const batch=f.db.batch.bind(f.db);let lost=false;f.db.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_mail_delivery_receipts'))){lost=true;throw Error('lost commit acknowledgement');}return result;};
 const negative=await f.core.handleWebhook(await request(f.env.origin,f.event('email.bounced'),'lost'));assert.equal(negative.status,200);assert(lost);assert.equal((await negative.json()).state,'bounced');
 assert.equal((await other.handleWebhook(await request(f.env.origin,f.event('email.bounced'),'lost'))).status,200);assert.equal(f.count('identity_mail_delivery_receipts'),2);assert.equal(f.count('identity_mail_delivery_audit'),2);assert.equal(f.count('identity_mail_delivery_facts'),2);
 }finally{f.close();}
});
test('final native transaction guard rejects queued expiry, changed immutable event context and provider races atomically',async()=>{
 for(const race of ['clock','context','provider','audit']){const f=await claimedFixture();try{
 const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{
 if(statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_mail_delivery_receipts'))){
 if(race==='clock')f.setNative('2026-10-31T00:05:01.000Z');
 if(race==='context')f.db.sqlite.prepare('UPDATE identity_mail_events SET payload_ciphertext=? WHERE id=?').run('changed',f.event().data.tags.identity_event);
 if(race==='provider')f.db.sqlite.prepare('UPDATE identity_mail_events SET provider_id=? WHERE id=?').run('raced-id',f.event().data.tags.identity_event);
 if(race==='audit')f.db.sqlite.exec("CREATE TRIGGER fail_delivery_audit BEFORE INSERT ON identity_mail_delivery_audit BEGIN SELECT RAISE(ABORT,'fail'); END");
 }return batch(statements);};
 const r=await f.core.handleWebhook(await request(f.env.origin,f.event('email.complained')));assert.equal(r.status,503,race);assert.deepEqual(await r.json(),{error:'delivery_unavailable'});
 for(const table of ['identity_mail_delivery_receipts','identity_mail_delivery_facts','identity_mail_delivery_audit','identity_mail_suppressions'])assert.equal(f.count(table),0,race+' '+table);
 assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE id=?').get(f.event().data.tags.identity_event)!.state,'sending');
 }finally{f.close();}}
});
test('attempt timestamp is checked with app and native clocks separately; old event can be retried with a new timestamp',async()=>{
 for(const clock of ['app','native','queued-app']){const f=await claimedFixture();try{
 if(clock==='app')f.setClock('2026-10-31T00:05:01.000Z');
 if(clock==='native')f.setNative('2026-10-31T00:05:01.000Z');
 if(clock==='queued-app'){
 const prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{if(sql.startsWith('SELECT e.*,v.metadata_ciphertext'))f.setClock('2026-10-31T00:05:01.000Z');return prepare(sql);};
 }
 assert.equal((await f.core.handleWebhook(await request(f.env.origin,f.event()))).status,400);assert.equal(f.count('identity_mail_delivery_receipts'),0);
 }finally{f.close();}}
 const f=await claimedFixture();try{
 const event=f.event();event.created_at='2020-01-01T00:00:00.000Z';event.data.created_at='2019-12-31T00:00:00.000Z';
 const a=await f.core.handleWebhook(await request(f.env.origin,event,'retry'));assert.equal(a.status,200);const old=await a.json();
 f.setClock('2026-11-01T00:00:00.000Z');f.setNative('2026-11-01T00:00:00.000Z');const next=String(Number(stamp)+86400);
 const b=await f.core.handleWebhook(await request(f.env.origin,event,'retry',next));assert.equal(b.status,200);assert.deepEqual(await b.json(),old);assert.equal(f.count('identity_mail_delivery_receipts'),1);
 }finally{f.close();}
});
test('malformed signatures, bytes, bodies, hosts and methods reject before any database access',async()=>{
 const f=await claimedFixture();try{
 let reads=0;const prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{reads++;return prepare(sql);};
 const raw=encoder.encode(JSON.stringify(f.event()));
 const cases=[new Request(f.env.origin+'/dormant-webhook'),new Request('https://foreign.example/hook',{method:'POST',body:'{}'}),new Request(f.env.origin+'/hook',{method:'POST',body:'{}'}),new Request(f.env.origin+'/hook',{method:'POST',headers:{'svix-id':'x','svix-timestamp':stamp,'svix-signature':'v1,wrong'},body:Buffer.from(raw)}),new Request(f.env.origin+'/hook',{method:'POST',headers:{'svix-id':'x','svix-timestamp':stamp,'svix-signature':'x'.repeat(4097)},body:Buffer.from(raw)}),await request(f.env.origin,null,'huge',stamp,new Uint8Array(65537))];
 for(const r of cases){const response=await f.core.handleWebhook(r);assert(response.status>=400);assert.equal(reads,0);}
 }finally{f.close();}
});
test('signed malformed UTF8, BOM and duplicate JSON names are rejected without retaining a receipt',async()=>{
 const f=await claimedFixture();try{
 for(const raw of [new Uint8Array([0xff]),encoder.encode('\ufeff'+JSON.stringify(f.event())),encoder.encode('{"type":"email.delivered","type":"email.bounced","data":{}}')]){
 const response=await f.core.handleWebhook(await request(f.env.origin,null,'malformed',stamp,raw));assert.equal(response.status,400);assert.equal(f.count('identity_mail_delivery_receipts'),0);
 }
 const raw=encoder.encode(' \n'+JSON.stringify(f.event())+'\t\n');assert.equal((await f.core.handleWebhook(await request(f.env.origin,null,'whitespace',stamp,raw))).status,200);
 }finally{f.close();}
});
test('safe receipt, status, facts and audit never reveal raw controls or an unkeyed payload digest',async()=>{
 const f=await claimedFixture();try{
 const e=f.event('email.failed');Object.assign(e.data,{failed:{reason:'shared@example.com private-token'}});const raw=encoder.encode(JSON.stringify(e));
 const r=await f.core.handleWebhook(await request(f.env.origin,e));assert.equal(r.status,200);
 const safe=JSON.stringify([await r.json(),await f.core.status(f.event().data.tags.identity_event),await f.core.receipt('webhook','msg_synthetic'),f.db.sqlite.prepare('SELECT * FROM identity_mail_delivery_receipts').all(),f.db.sqlite.prepare('SELECT * FROM identity_mail_delivery_facts').all(),f.db.sqlite.prepare('SELECT * FROM identity_mail_delivery_audit').all()]);
 const digest=Buffer.from(await crypto.subtle.digest('SHA-256',raw)).toString('hex');
 for(const privateValue of ['shared@example.com',f.body.from,f.body.subject,f.body.text,'private-token',f.response.headers.get('X-Identity-Mail-Lease')!,digest,await sign(raw)])assert(!safe.includes(privateValue),privateValue);
 assert(!safe.includes('payload_ciphertext'));assert(!safe.includes('mail-body'));assert(!safe.includes('signature'));
 }finally{f.close();}
});
test('origin isolation and authenticated frozen metadata shape remain mandatory for historical controls',async()=>{
 const {createIdentityMailDelivery}=await import('../server/live/identity-mail-delivery.ts');
 const {encryptPrivate,decryptPrivate}=await import('../server/live/identity-private.ts');
 const f=await claimedFixture();try{
 await f.core.handleWebhook(await request(f.env.origin,f.event()));const foreign=createIdentityMailDelivery({...f.env,origin:'https://other.example',webhookSecret:secret});
 assert.equal(await foreign.receipt('webhook','msg_synthetic'),null);assert.equal(await foreign.status(f.event().data.tags.identity_event),null);
 }finally{f.close();}
 for(const change of ['template','refs','cross-event','origin','binding']){const f=await claimedFixture();try{
 const id=f.event().data.tags.identity_event,row=f.db.sqlite.prepare('SELECT metadata_ciphertext FROM identity_mail_envelopes WHERE event_id=?').get(id)!;
 const metadata=JSON.parse(await decryptPrivate(f.env.contactKey,'mail-envelope',id,String(row.metadata_ciphertext)));
 if(change==='template')metadata.templateVersion='invalid-version';
 if(change==='refs')metadata.attachmentRefs=[];
 if(change==='origin')metadata.origin='https://other.example';
 if(change==='binding')metadata.binding='{}';
 const cipher=await encryptPrivate(f.env.contactKey,'mail-envelope',change==='cross-event'?'f'.repeat(32):id,JSON.stringify(metadata));
 f.db.sqlite.exec('DROP TRIGGER identity_mail_envelope_immutable');f.db.sqlite.prepare('UPDATE identity_mail_envelopes SET metadata_ciphertext=? WHERE event_id=?').run(cipher,id);
 const r=await f.core.handleWebhook(await request(f.env.origin,f.event()));assert.equal(r.status,200);assert.deepEqual(await r.json(),{ignored:true},change);assert.equal(f.count('identity_mail_delivery_receipts'),0);
 }finally{f.close();}}
});
test('actual early delivery and negative signals survive accepted or null unknown HTTP finish without rewriting its receipt',async()=>{
 for(const fact of ['delivered','bounced','complained','failed','suppressed'])for(const state of ['accepted','unknown'] as const){const f=await claimedFixture();try{
 await f.core.handleWebhook(await request(f.env.origin,f.event('email.'+fact)));
 const before=f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE id=?').get(f.event().data.tags.identity_event)!.state;
 await f.c.finish({eventId:f.event().data.tags.identity_event,leaseId:f.response.headers.get('X-Identity-Mail-Lease')!,state,providerId:state==='accepted'?'provider-id':null,errorCode:state==='accepted'?null:'provider_outcome_unknown'});
 assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE id=?').get(f.event().data.tags.identity_event)!.state,before);
 assert.equal(f.db.sqlite.prepare('SELECT provider_id FROM identity_mail_events WHERE id=?').get(f.event().data.tags.identity_event)!.provider_id,'provider-id');
 const receipt=JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_finish_receipts').get());await f.core.applyReadback('after_finish',f.email('delivered'));assert.equal(JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_finish_receipts').get()),receipt);
 }finally{f.close();}}
});
test('readback and webhook negatives agree in either order and retain first-observed times',async()=>{
 for(const fact of ['bounced','complained','suppressed','failed'])for(const negativeFirst of [true,false]){const f=await claimedFixture();try{
 const before=f.event().data.tags.identity_event;
 if(negativeFirst)await f.core.applyReadback('negative',f.email(fact));else await f.core.handleWebhook(await request(f.env.origin,f.event(),'positive'));
 f.setClock('2026-10-31T00:01:00.000Z');f.setNative('2026-10-31T00:01:00.000Z');
 if(negativeFirst)await f.core.handleWebhook(await request(f.env.origin,f.event(),'positive',String(Number(stamp)+60)));else await f.core.applyReadback('negative',f.email(fact));
 const state=await f.core.status(before);assert.equal(state!.state,['bounced','complained'].includes(fact)?'bounced':'failed');assert.equal(state!.deliveryVerified,false);
 const rows=f.db.sqlite.prepare('SELECT * FROM identity_mail_delivery_facts ORDER BY observed_at').all();assert.equal(rows.length,2);assert.equal(rows[0].observed_at,'2026-10-31T00:00:00.000Z');
 await f.core.applyReadback('repeat_negative',f.email(fact));assert.equal(f.count('identity_mail_delivery_facts'),2);assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM identity_mail_delivery_facts ORDER BY observed_at').all(),rows);
 assert.equal(f.count('identity_mail_suppressions'),fact==='failed'?0:1);
 }finally{f.close();}}
});
test('readback validates canonical tags and exact frozen metadata, not arbitrary provider ids',async()=>{
 for(const mutation of ['duplicate-tag','missing-tag','object-tag','to','from','subject','provider','foreign','multiple-recipients']){const f=await claimedFixture();try{
 const email=f.email();
 if(mutation==='duplicate-tag')email.tags.push({...email.tags[0]});
 if(mutation==='missing-tag')email.tags=[];
 if(mutation==='object-tag')email.tags={identity_event:f.event().data.tags.identity_event} as unknown as typeof email.tags;
 if(mutation==='to')email.to=['elsewhere@example.com'];
 if(mutation==='from')email.from='identity@example.net';
 if(mutation==='subject')email.subject+='changed';
 if(mutation==='provider')f.db.sqlite.prepare('UPDATE identity_mail_events SET provider_id=? WHERE id=?').run('known-other',f.event().data.tags.identity_event);
 if(mutation==='foreign')email.tags[0].value='f'.repeat(32);
 if(mutation==='multiple-recipients')email.to.push('other@example.com');
 assert.deepEqual(await f.core.applyReadback('invalid',email),{ignored:true});assert.equal(f.count('identity_mail_delivery_receipts'),0);assert.equal(f.count('identity_mail_delivery_facts'),0);
 }finally{f.close();}}
});
import {spawnSync} from 'node:child_process';
test('actual delivery SQL compiles in native SQLite at every official D1 limit and remains within Free budget',async(t)=>{
 const f=await claimedFixture();try{
 const queries:{sql:string;binds:unknown[]}[]=[],prepare=f.db.prepare.bind(f.db);
 f.db.prepare=sql=>{const s=prepare(sql),bind=s.bind.bind(s),entry={sql,binds:[] as unknown[]};queries.push(entry);s.bind=(...values)=>{entry.binds=values;return bind(...values);};return s;};
 assert.equal((await f.core.handleWebhook(await request(f.env.origin,f.event('email.complained')))).status,200);const webhookCount=queries.length;assert(webhookCount<=50);
 await f.core.applyReadback('limits_readback',f.email('delivered'));const readbackCount=queries.length-webhookCount;assert(readbackCount<=50);
 const receipt=await f.core.receipt('readback','limits_readback');assert(receipt);await f.core.status(receipt.eventId);
 for(const q of queries){assert(q.binds.length<=100);assert(Buffer.byteLength(q.sql)<100000);for(const v of q.binds)if(typeof v==='string')assert(Buffer.byteLength(v)<2000000);}
 const result=spawnSync('python3',['-c',String.raw`
import base64,json,sqlite3,sys
v=json.load(sys.stdin);db=sqlite3.connect(':memory:');db.deserialize(base64.b64decode(v['database']))
for limit,n in [(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32),(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100),(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000),(sqlite3.SQLITE_LIMIT_LENGTH,2000000),(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)]:db.setlimit(limit,n)
for q in v['queries']:db.execute('EXPLAIN '+q['sql'],q['binds'])
print(len(v['queries']))
`],{input:JSON.stringify({database:Buffer.from(f.db.sqlite.serialize()).toString('base64'),queries}),encoding:'utf8',maxBuffer:1000000});assert.equal(result.status,0,result.stderr);assert.equal(Number(result.stdout),queries.length);t.diagnostic('webhook '+webhookCount+' queries; private readback '+readbackCount+'; native limited compile '+queries.length);
 const tables=f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'identity_mail_delivery_%'").all();assert.equal(tables.length,3);
 const triggers=f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'identity_mail_delivery_%'").all();assert.equal(triggers.length,9);
 const receiptRow=f.db.sqlite.prepare('SELECT * FROM identity_mail_delivery_receipts LIMIT 1').get()!;
 for(const [field,value] of [['observed_at','invalid'],['observed_at','2026-10-31T00:00:00Z'],['payload_hmac','é'.repeat(64)],['message_id','é'.repeat(32)],['provider_id','é'.repeat(32)]]){
 const row={...receiptRow,message_id:'new_id',[field]:value},keys=Object.keys(row);assert.throws(()=>f.db.sqlite.prepare('INSERT INTO identity_mail_delivery_receipts('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k])));
 }
 }finally{f.close();}
});
test('supported webhook requires provider event timestamps without using them as attempt or delivery times',async()=>{
 for(const field of ['event','email']){const f=await claimedFixture();try{
 const e=f.event();if(field==='event')e.created_at='invalid';else e.data.created_at='invalid';
 const response=await f.core.handleWebhook(await request(f.env.origin,e));assert.equal(response.status,400);assert.equal(f.count('identity_mail_delivery_receipts'),0);
 }finally{f.close();}}
});
test('private readback and receipt database failures expose only safe unavailable errors',async()=>{
 const f=await claimedFixture();try{
 f.db.prepare=()=>{throw Error('database raw shared@example.com private-token');};
 await assert.rejects(f.core.applyReadback('safe_failure',f.email()),/^Error: delivery_unavailable$/);
 await assert.rejects(f.core.receipt('readback','safe_failure'),/^Error: delivery_unavailable$/);
 await assert.rejects(f.core.status(f.event().data.tags.identity_event),/^Error: delivery_unavailable$/);
 }finally{f.close();}
});
test('one provider message cannot verify two real leases with identical frozen sender, recipient and subject',async()=>{
 const f=await claimedFixture();try{
 const second='f'.repeat(32),m=await f.c.prepare(second);await f.c.claim(second,m.descriptor.bodyDigest);
 assert.equal((await f.core.handleWebhook(await request(f.env.origin,f.event(),'house_a'))).status,200);
 const e=f.event();e.data.tags.identity_event=second;const r=await f.core.handleWebhook(await request(f.env.origin,e,'house_b'));assert.equal(r.status,200);assert.deepEqual(await r.json(),{ignored:true});
 const email=f.email();email.tags[0].value=second;assert.deepEqual(await f.core.applyReadback('same_provider_other_house',email),{ignored:true});
 assert.equal(f.count('identity_mail_delivery_facts'),1);assert.equal(f.count('identity_mail_delivery_receipts'),1);
 assert.equal((await f.core.status(second))!.state,'sending');assert.equal((await f.core.status(second))!.deliveryVerified,false);
 }finally{f.close();}
});
test('provider ownership collision appearing only at the final native guard rolls back every delivery effect',async()=>{
 const f=await claimedFixture();try{
 const other='f'.repeat(32),m=await f.c.prepare(other);await f.c.claim(other,m.descriptor.bodyDigest);
 const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{if(statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_mail_delivery_receipts')))f.db.sqlite.prepare('UPDATE identity_mail_events SET provider_id=? WHERE id=?').run('provider-id',other);return batch(statements);};
 assert.equal((await f.core.handleWebhook(await request(f.env.origin,f.event('email.complained')))).status,503);
 for(const table of ['identity_mail_delivery_receipts','identity_mail_delivery_facts','identity_mail_delivery_audit','identity_mail_suppressions'])assert.equal(f.count(table),0);
 }finally{f.close();}
});
