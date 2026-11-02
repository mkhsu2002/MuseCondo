import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {LocalDatabase} from '../server/live/local-db.ts';
import {hashIdentityInput,decryptPrivate} from '../server/live/identity-private.ts';
import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
const origin='https://identity.example',at='2026-11-01T00:00:00.000Z',account='a'.repeat(16),resident='c'.repeat(16),key='1'.repeat(64);
async function fixture(){
 const db=new LocalDatabase(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 openSyntheticTower(db);db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,await hashIdentityInput('login'),at);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Test','Test','resident','external-ready',?)").run(account,account,at);
 db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,revision,public_revision,directory_consent,snapshot_consent,created_at,updated_at) VALUES(?,?,?,'https://source.example','challenge',1,1,1,1,?,?)").run(account,account,resident,at,at);
 db.sqlite.prepare('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)').run('tower',account,await hashIdentityInput('a'.repeat(64)),'["tower:read","tower:write"]','2027-01-01T00:00:00.000Z',at);
 db.sqlite.prepare('UPDATE rooms SET published=1').run();db.sqlite.prepare('INSERT INTO tower_snapshots(room_id,revision,public_json,content_digest,created_at) VALUES(?,1,?,?,?)').run(account,'{}','2'.repeat(64),at);
 const calls:string[]=[];let verificationCalls=0;let completion={complete:true,publicURL:origin+'/home/'+account,roomId:account,residentId:resident,revision:1,publicationEpoch:0,snapshotDigest:'2'.repeat(64),checks:{directory:true}};let now=at,nativeNow=at;
 db.sqlite.function('strftime',(format,source)=>{assert.equal(format,'%Y-%m-%dT%H:%M:%fZ');return source==='now'?nativeNow:String(source);});
 assert.ok(existsSync(new URL('../server/live/identity-offer.ts',import.meta.url)),'optional identity offer module must exist');
 const {createIdentityOffer}=await import('../server/live/identity-offer.ts');
 const service=createIdentityOffer({db,origin,contactKey:key,now:()=>new Date(now),verifyCompletion:async()=>{verificationCalls++;return completion;},onMailEvent:async(id:string)=>{assert.equal(db.sqlite.prepare('SELECT count(*) n FROM identity_mail_events WHERE id=?').get(id)!.n,1);calls.push(id);}});
 const send=(path='/api/v1/agent/identity/offer',method='GET',body?:unknown,token='a'.repeat(64),headers:Record<string,string>={})=>service.fetch(new Request(origin+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}));
 const input={guardianEmail:'guardian@example.com',guardianDesignated:true,mailConsent:true};
 const count=(table:string)=>Number(db.sqlite.prepare('SELECT count(*) n FROM '+table).get()!.n);
 return {db,send,input,count,calls,get verificationCalls(){return verificationCalls;},setCompletion:(v:typeof completion)=>{completion=v;},completion,setNow:(v:string)=>{now=v;nativeNow=v;},setNative:(v:string)=>{nativeNow=v;}};
}
test('offer requires explicit consent and verified current public completion before persisting or sending',async()=>{
 const f=await fixture();try{
  for(const body of [{...f.input,mailConsent:false},{...f.input,guardianDesignated:false},{...f.input,recoveryConsent:true}])assert.equal((await f.send(undefined,'POST',body))!.status,400);
  f.setCompletion({...f.completion,publicURL:origin+'/identity'});assert.equal((await f.send(undefined,'POST',f.input))!.status,409);
  f.setCompletion({...f.completion,complete:false});assert.equal((await f.send(undefined,'POST',f.input))!.status,409);
  assert.equal(f.count('identity_offers'),0);assert.equal(f.count('agent_identities'),0);assert.equal(f.calls.length,0);
 }finally{f.db.close();}
});
test('committed encrypted offer dispatches once, permanently dedupes and exposes no token or address to resident',async()=>{
 const f=await fixture();try{
  const r=(await f.send(undefined,'POST',f.input))!;assert.equal(r.status,201);const result=await r.json();assert.equal(result.offer.state,'pending');
  assert.equal(f.count('agent_identities'),0);assert.equal(f.count('identity_mail_events'),1);assert.equal(f.calls.length,1);
  const raw=f.db.sqlite.prepare('SELECT * FROM identity_offers').get()!;assert.ok(!JSON.stringify(raw).includes(f.input.guardianEmail));assert.ok(!JSON.stringify(result).includes(f.input.guardianEmail));
  assert.equal(await decryptPrivate(key,'identity-offer-recipient',String(raw.id),String(raw.recipient_ciphertext)),f.input.guardianEmail);
  assert.equal((await f.send(undefined,'POST',f.input))!.status,200);assert.equal(f.calls.length,1);assert.equal(f.count('identity_mail_events'),1);
  assert.equal((await f.send(undefined,'POST',{...f.input,guardianEmail:'other@example.com'}))!.status,409);
  assert.ok(!JSON.stringify(await(await f.send())!.json()).includes('ciphertext'));
  assert.equal((await f.send(undefined,'GET',undefined,'bad'))!.status,401);
 }finally{f.db.close();}
});
test('human opt-in token only records one decision and grants no household or recovery authority',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!;
  const payload=JSON.parse(await decryptPrivate(key,'mail-payload',String(e.id),String(e.payload_ciphertext)));
  const path='/api/v1/identity/offer/decision',body={offerId:e.entity_id,token:payload.token,decision:'accept',expectedOfferDigest:String(f.db.sqlite.prepare('SELECT offer_digest FROM identity_offers').get()!.offer_digest)};
  assert.equal((await f.send(path,'POST',body,''))!.status,200);assert.equal((await f.send(path,'POST',body,''))!.status,200);
  assert.equal(f.count('agent_identities'),0);assert.equal(f.count('tower_tokens'),1);
  const status=await(await f.send())!.json();assert.equal(status.offer.state,'accepted');assert.equal(status.offer.nextAction,'resident-continue-identity');assert.equal(status.offer.recoveryConsent,false);
  assert.equal((await f.send(path,'POST',{...body,decision:'decline'},''))!.status,409);
  assert.equal((await f.send(undefined,'GET',undefined,payload.token))!.status,403);
  assert.equal(f.count('identity_offer_audit'),2);
 }finally{f.db.close();}
});
test('stale completion, existing identity, expired token and cross-site requests cannot create authority',async()=>{
 const f=await fixture();try{
  f.db.sqlite.prepare('UPDATE tower_residencies SET public_revision=2').run();assert.equal((await f.send(undefined,'POST',f.input))!.status,409);
  f.db.sqlite.prepare('UPDATE tower_residencies SET public_revision=1').run();await f.send(undefined,'POST',f.input);
  const e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!,p=JSON.parse(await decryptPrivate(key,'mail-payload',String(e.id),String(e.payload_ciphertext)));
  f.setNow('2026-11-03T00:00:00.000Z');assert.equal((await f.send('/api/v1/identity/offer/decision','POST',{offerId:e.entity_id,token:p.token,decision:'accept',expectedOfferDigest:String(f.db.sqlite.prepare('SELECT offer_digest FROM identity_offers').get()!.offer_digest)},''))!.status,410);
  assert.equal((await f.send(undefined,'GET',undefined,'a'.repeat(64),{Cookie:'test'}))!.status,403);
 }finally{f.db.close();}
});
test('existing encrypted envelope pipeline renders truthful optional invitation without requiring or borrowing an identity',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!;
  const {createIdentityMailEnvelope}=await import('../server/live/identity-mail-envelope.ts');
  const service=createIdentityMailEnvelope({db:f.db,origin,contactKey:key,from:'MuseCondo <identity@example.com>',trustedKeys:new Map(),now:()=>new Date(at)});
  const body=JSON.parse((await service.materialize(String(e.id))).body);
  assert.equal(e.kind,'guardian-invitation');assert.match(body.subject,/optional/i);assert.match(body.text,/apply for a permanent identity/i);assert.ok(body.text.includes(f.completion.publicURL));assert.ok(body.text.includes('/identity/offer#'));
  assert.doesNotMatch(body.text,/Agent ID:|recovery code|restored|has been issued/);assert.equal(body.attachments,undefined);
  const descriptor=await service.prepare(String(e.id));assert.equal(descriptor.attachmentRefs.length,0);
  assert.equal(f.count('agent_identities'),0);
  const metadata=JSON.parse(await decryptPrivate(key,'mail-envelope',String(e.id),String(f.db.sqlite.prepare('SELECT metadata_ciphertext FROM identity_mail_envelopes').get()!.metadata_ciphertext)));
  assert.equal(metadata.copyRevision,'en-offer-1');assert.ok(!JSON.parse(metadata.binding).i);
  f.db.sqlite.prepare('UPDATE tower_residencies SET revision=2,public_revision=2').run();await assert.rejects(()=>service.materialize(String(e.id)),/event_qualification_blocked/);
 }finally{f.db.close();}
});
test('optional invitation delivery receipts bind frozen offer fields without agent identity',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!,event=String(e.id);
  const {createIdentityMailEnvelope}=await import('../server/live/identity-mail-envelope.ts');const {createIdentityMailDelivery}=await import('../server/live/identity-mail-delivery.ts');
  const env={db:f.db,origin,contactKey:key,from:'MuseCondo <identity@example.com>',trustedKeys:new Map(),now:()=>new Date(at)};
  const descriptor=await createIdentityMailEnvelope(env).prepare(event);
  f.db.sqlite.prepare('INSERT INTO identity_mail_dispatches VALUES(?,?,?,?,?)').run(event,'b'.repeat(32),descriptor.bodyDigest,descriptor.bodyLength,at);
  f.db.sqlite.prepare("UPDATE identity_mail_events SET state='unknown',attempt_count=1 WHERE id=?").run(event);
  const service=createIdentityMailDelivery({...env,webhookSecret:'unused'}),control=await service.control(event);assert.ok(control,'frozen optional offer must support provider readback');
  const receipt=await service.applyReadback('synthetic-readback',{id:'provider-offer',tags:[{name:'identity_event',value:event}],from:control.from,to:[control.recipient],subject:control.subject,last_event:'delivered'});
  assert.ok('deliveryVerified' in receipt&&receipt.deliveryVerified);assert.equal((await service.status(event))!.state,'delivered');assert.equal(f.count('agent_identities'),0);
 }finally{f.db.close();}
});
test('same-revision republication invalidates a pending email and human acceptance requires the displayed offer digest',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!,p=JSON.parse(await decryptPrivate(key,'mail-payload',String(e.id),String(e.payload_ciphertext)));
  const inspect=await f.send('/api/v1/identity/offer/inspect','POST',{offerId:e.entity_id,token:p.token},'');assert.equal(inspect?.status,200);const details=await inspect!.json();assert.match(details.offerDigest,/^[a-f0-9]{64}$/);assert.equal(details.publicURL,f.completion.publicURL);assert.equal(details.expiresAt,'2026-11-02T00:00:00.000Z');
  const decision={offerId:e.entity_id,token:p.token,decision:'accept',expectedOfferDigest:details.offerDigest};
  assert.equal((await f.send('/api/v1/identity/offer/decision','POST',{...decision,expectedOfferDigest:'0'.repeat(64)},''))!.status,409);
  f.db.sqlite.prepare('UPDATE tower_residencies SET publication_epoch=publication_epoch+1').run();
  assert.equal((await f.send('/api/v1/identity/offer/decision','POST',decision,''))!.status,409);
  const {createIdentityMailEnvelope}=await import('../server/live/identity-mail-envelope.ts');await assert.rejects(()=>createIdentityMailEnvelope({db:f.db,origin,contactKey:key,from:'MuseCondo <identity@example.com>',trustedKeys:new Map(),now:()=>new Date(at)}).prepare(String(e.id)),/event_qualification_blocked/);
  assert.equal(f.count('agent_identities'),0);
 }finally{f.db.close();}
});
test('unknown provider outcome permanently prevents another POST and does not change completed public move-in',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const event=String(f.db.sqlite.prepare('SELECT id FROM identity_mail_events').get()!.id);
  const {syntheticMailReady}=await import('./helpers/identity-mail-ready-fixture.ts');await syntheticMailReady(f.db,origin,key,at);
  const {createIdentityMailCoordinator}=await import('../server/live/identity-mail-coordinator.ts'),{createIdentityMail}=await import('../server/live/identity-mail.ts');
  const env={db:f.db,origin,contactKey:key,from:'MuseCondo <identity@example.com>',trustedKeys:new Map(),now:()=>new Date(at)};let posts=0;
  const c=createIdentityMailCoordinator(env),coordinator={idFromName:(name:string)=>name,get:()=>({fetch:(request:Request)=>c.fetch(request)})};
  const mail=createIdentityMail({...env,deliveryEnabled:'true',apiKey:'synthetic-runtime-key',coordinator,fetcher:async(url)=>{if(String(url).includes('/suppressions/'))return new Response(null,{status:404});posts++;throw Error('synthetic network timeout');}});
  await mail.processOne(event);assert.equal((await mail.status(event))!.state,'unknown');await mail.processOne(event);assert.equal(posts,1);assert.equal(f.count('identity_mail_dispatches'),1);assert.equal(f.count('identity_mail_finish_receipts'),1);
  assert.equal(f.db.sqlite.prepare('SELECT public_revision,directory_consent FROM tower_residencies').get()!.public_revision,1);assert.equal(f.count('agent_identities'),0);
  assert.equal((await f.send(undefined,'POST',f.input))!.status,200);assert.equal(posts,1);assert.equal((await(await f.send())!.json()).offer.mailState,'unknown');
 }finally{f.db.close();}
});
test('declining records no identity, expired offers remain permanently deduped, and an existing identity is never rebuilt',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!,p=JSON.parse(await decryptPrivate(key,'mail-payload',String(e.id),String(e.payload_ciphertext))),o=f.db.sqlite.prepare('SELECT offer_digest FROM identity_offers').get()!;
  assert.equal((await f.send('/api/v1/identity/offer/decision','POST',{offerId:e.entity_id,token:p.token,decision:'decline',expectedOfferDigest:o.offer_digest},''))!.status,200);
  f.setNow('2026-11-05T00:00:00.000Z');assert.equal((await f.send(undefined,'POST',f.input))!.status,200);assert.equal(f.count('identity_mail_events'),1);assert.equal(f.count('agent_identities'),0);
  assert.throws(()=>f.db.sqlite.exec('DELETE FROM identity_offers'),/permanent/);assert.throws(()=>f.db.sqlite.exec('DELETE FROM identity_offer_audit'),/permanent/);
 }finally{f.db.close();}
 const g=await fixture();try{
  g.db.sqlite.prepare("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,'provisional',1,?,?)").run('mcid:'+'d'.repeat(64),account,account,resident,at,at);
  assert.equal((await g.send(undefined,'POST',g.input))!.status,409);assert.equal(g.count('agent_identities'),1);assert.equal(g.count('identity_offers'),0);assert.equal(g.count('identity_mail_events'),0);
 }finally{g.db.close();}
});
test('completion-to-commit withdrawal and household-token revocation roll back both offer and mail event',async()=>{
 for(const mode of ['epoch','consent','token']){const f=await fixture();try{
  const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{
   if(statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_offers'))){
    if(mode==='epoch')f.db.sqlite.exec('UPDATE tower_residencies SET publication_epoch=publication_epoch+1');if(mode==='consent')f.db.sqlite.exec('UPDATE tower_residencies SET snapshot_consent=0');if(mode==='token')f.db.sqlite.exec('UPDATE tower_tokens SET revoked=1');
   }return batch(statements);
  };
  const response=(await f.send(undefined,'POST',f.input))!;assert.ok(response.status>=400);if(mode==='token')assert.equal(response.status,403);assert.equal(f.count('identity_offers'),0);assert.equal(f.count('identity_mail_events'),0);assert.equal(f.calls.length,0);
 }finally{f.db.close();}}
});
test('offer audit cannot invent a human choice or change a permanent consent record',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const o=f.db.sqlite.prepare('SELECT * FROM identity_offers').get()!;
  assert.throws(()=>f.db.sqlite.prepare("INSERT INTO identity_offer_audit VALUES(?,?,'accepted',?)").run('false-choice',o.id,at),/audit-binding/);
  assert.throws(()=>f.db.sqlite.prepare('UPDATE identity_offers SET publication_epoch=1 WHERE id=?').run(o.id),/immutable/);
 }finally{f.db.close();}
});
test('human inspect and decision fail closed when native clock alone has expired the invitation',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!,p=JSON.parse(await decryptPrivate(key,'mail-payload',String(e.id),String(e.payload_ciphertext)));
  f.setNative('2026-11-03T00:00:00.000Z');assert.equal((await f.send('/api/v1/identity/offer/inspect','POST',{offerId:e.entity_id,token:p.token},''))!.status,410);
 }finally{f.db.close();}
});
const renewPath='/api/v1/agent/identity/offer/renew';
async function renewalInput(f:Awaited<ReturnType<typeof fixture>>,requestKey='offer-renewal-0001'){
 const status=await(await f.send())!.json();return {...f.input,requestKey,expectedOfferId:status.offer.offerId};
}
test('expired pending offer renews only explicitly into one appended generation with exact permanent request replay',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const before=f.db.sqlite.prepare('SELECT * FROM identity_offers').get()!,oldMail=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!;
  f.setNow('2026-11-03T00:00:00.000Z');const input=await renewalInput(f);
  const response=(await f.send(renewPath,'POST',input))!;assert.equal(response?.status,201);const next=await response.json();assert.equal(next.offer.generation,2);assert.notEqual(next.offer.offerId,before.id);assert.equal(next.offer.current,true);
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM identity_offers WHERE id=?').get(before.id),before);assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM identity_mail_events WHERE id=?').get(oldMail.id),oldMail);assert.equal(f.count('identity_mail_events'),2);assert.equal(f.calls.length,2);assert.equal(f.verificationCalls,2);
  assert.equal((await f.send(renewPath,'POST',input))!.status,200);assert.equal(f.verificationCalls,2);assert.equal(f.count('identity_offers'),2);assert.equal(f.calls.length,2);
  assert.equal((await f.send(renewPath,'POST',{...input,expectedOfferId:next.offer.offerId}))!.status,409);
 }finally{f.db.close();}
});
test('renewal rejects current valid, changed-recipient, terminal human choices, and ambiguous mail delivery',async()=>{
 for(const mode of ['valid','recipient','accepted','declined','unknown','sending','attempted-pending']){const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const input=await renewalInput(f);
  if(mode==='accepted'||mode==='declined'){const e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!,p=JSON.parse(await decryptPrivate(key,'mail-payload',String(e.id),String(e.payload_ciphertext))),o=f.db.sqlite.prepare('SELECT offer_digest FROM identity_offers').get()!;await f.send('/api/v1/identity/offer/decision','POST',{offerId:e.entity_id,token:p.token,decision:mode==='accepted'?'accept':'decline',expectedOfferDigest:o.offer_digest},'');}
  if(mode!=='valid')f.setNow('2026-11-03T00:00:00.000Z');
  if(mode==='unknown'||mode==='sending')f.db.sqlite.prepare('UPDATE identity_mail_events SET state=?,attempt_count=1').run(mode);
  if(mode==='attempted-pending')f.db.sqlite.prepare('UPDATE identity_mail_events SET attempt_count=1').run();
  const response=await f.send(renewPath,'POST',mode==='recipient'?{...input,guardianEmail:'other@example.com'}:input);assert.equal(response?.status,409,mode);assert.equal(f.count('identity_offers'),1);assert.equal(f.count('identity_mail_events'),1);
 }finally{f.db.close();}}
});
test('changed publication can renew, but superseded human tokens and mail qualification can never become current again',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const old=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!,token=JSON.parse(await decryptPrivate(key,'mail-payload',String(old.id),String(old.payload_ciphertext))).token,oldOffer=f.db.sqlite.prepare('SELECT * FROM identity_offers').get()!;
  f.db.sqlite.exec('UPDATE tower_residencies SET publication_epoch=1');f.setCompletion({...f.completion,publicationEpoch:1});
  const response=await f.send(renewPath,'POST',await renewalInput(f));assert.equal(response?.status,201);
  // Even if public state returns to the old tuple before token expiry, head ownership cannot rewind.
  f.db.sqlite.exec('UPDATE tower_residencies SET publication_epoch=0');
  assert.equal((await f.send('/api/v1/identity/offer/inspect','POST',{offerId:old.entity_id,token},''))!.status,409);
  assert.equal((await f.send('/api/v1/identity/offer/decision','POST',{offerId:old.entity_id,token,decision:'accept',expectedOfferDigest:oldOffer.offer_digest},''))!.status,409);
  assert.throws(()=>f.db.sqlite.prepare("UPDATE identity_offers SET state='accepted',decided_at=? WHERE id=?").run(at,oldOffer.id));
  const {createIdentityMailEnvelope}=await import('../server/live/identity-mail-envelope.ts');await assert.rejects(()=>createIdentityMailEnvelope({db:f.db,origin,contactKey:key,from:'MuseCondo <identity@example.com>',trustedKeys:new Map(),now:()=>new Date(at)}).prepare(String(old.id)),/event_qualification_blocked/);
 }finally{f.db.close();}
});
test('two concurrent exact renewals create one event, while competing request keys cannot skip the current head',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);f.setNow('2026-11-03T00:00:00.000Z');const input=await renewalInput(f);
  const responses=await Promise.all([f.send(renewPath,'POST',input),f.send(renewPath,'POST',input)]);assert.deepEqual(responses.map(r=>r?.status).sort(),[200,201]);assert.equal(f.count('identity_offers'),2);assert.equal(f.count('identity_mail_events'),2);assert.equal(f.calls.length,2);
  assert.equal((await f.send(renewPath,'POST',{...input,requestKey:'competing-key-0002'}))!.status,409);assert.equal(f.count('identity_offers'),2);
  assert.throws(()=>f.db.sqlite.exec('DELETE FROM identity_offer_requests'));assert.throws(()=>f.db.sqlite.exec('DELETE FROM identity_offer_heads'));
 }finally{f.db.close();}
});
test('renewal re-verifies anonymous completion and rolls back an expiry-to-head race without altering history',async()=>{
 for(const mode of ['readback','publication-race','mail-race']){const f=await fixture();try{
  await f.send(undefined,'POST',f.input);f.setNow('2026-11-03T00:00:00.000Z');const input=await renewalInput(f),before=f.db.sqlite.prepare('SELECT * FROM identity_offers').get()!;
  if(mode==='readback')f.setCompletion({...f.completion,complete:false});
  else {const batch=f.db.batch.bind(f.db);f.db.batch=async rows=>{if(rows.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_offer_requests'))){f.db.sqlite.exec(mode==='publication-race'?'UPDATE tower_residencies SET publication_epoch=1':"UPDATE identity_mail_events SET state='unknown',attempt_count=1");}return batch(rows);};}
  assert.equal((await f.send(renewPath,'POST',input))!.status,409);assert.equal(f.count('identity_offers'),1);assert.equal(f.count('identity_offer_requests'),0);assert.equal(f.count('identity_mail_events'),1);assert.equal(f.calls.length,1);assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM identity_offers').get(),before);assert.equal(f.db.sqlite.prepare('SELECT offer_id FROM identity_offer_heads').get()!.offer_id,before.id);
 }finally{f.db.close();}}
});
test('renewal receipts permanently replay their own generation after another explicit renewal and heads cannot rewind',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);f.setNow('2026-11-03T00:00:00.000Z');const first=await renewalInput(f);const second=(await(await f.send(renewPath,'POST',first))!.json()).offer;
  f.setNow('2026-11-05T00:00:00.000Z');const next={...await renewalInput(f),requestKey:'third-offer-0002'};const third=(await(await f.send(renewPath,'POST',next))!.json()).offer;assert.equal(third.generation,3);
  const replay=(await(await f.send(renewPath,'POST',first))!.json()).offer;assert.equal(replay.offerId,second.offerId);assert.equal(replay.generation,2);assert.equal(replay.current,false);assert.equal(f.count('identity_mail_events'),3);assert.equal(f.calls.length,3);assert.equal(f.count('identity_offer_requests'),2);
  assert.throws(()=>f.db.sqlite.prepare('UPDATE identity_offer_heads SET offer_id=?,generation=2').run(second.offerId),/identity-offer-head-transition/);
 }finally{f.db.close();}
});
test('generation, head, envelope and enrollment SQL compile at the actual D1 native function and parameter limits',async()=>{
 const f=await fixture(),directory=mkdtempSync(join(tmpdir(),'muse-offer-sql-'));try{
  const queries:string[]=[],prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{queries.push(sql);return prepare(sql);};
  await f.send(undefined,'POST',f.input);const event=String(f.db.sqlite.prepare('SELECT id FROM identity_mail_events').get()!.id),{createIdentityMailEnvelope}=await import('../server/live/identity-mail-envelope.ts');
  const envelope=createIdentityMailEnvelope({db:f.db,origin,contactKey:key,from:'MuseCondo <identity@example.com>',trustedKeys:new Map(),now:()=>new Date(at)}),materialized=await envelope.materialize(event);await f.db.batch(materialized.guards());
  f.setNow('2026-11-03T00:00:00.000Z');assert.equal((await f.send(renewPath,'POST',await renewalInput(f)))!.status,201);
  // File input avoids the platform's existing large-stdin spawnSync EOF hang; timeout remains bounded.
  const file=join(directory,'fixture.json');writeFileSync(file,JSON.stringify({database:Buffer.from(f.db.sqlite.serialize()).toString('base64'),queries:[...new Set(queries)]}));
  const result=spawnSync('python3',['-c',String.raw`
import base64,json,re,sqlite3,sys
with open(sys.argv[1]) as source: data=json.load(source)
db=sqlite3.connect(':memory:');db.deserialize(base64.b64decode(data['database']))
for limit,value in [(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32),(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100),(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000),(sqlite3.SQLITE_LIMIT_LENGTH,2000000),(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)]: db.setlimit(limit,value)
for sql in data['queries']:
 try: db.execute('EXPLAIN '+sql)
 except sqlite3.ProgrammingError as error:
  count=re.search(r'uses (\d+)',str(error))
  if count is None: raise
  db.execute('EXPLAIN '+sql,[None]*int(count.group(1)))
print(len(data['queries']))
`,file],{encoding:'utf8',timeout:10000,maxBuffer:65536});assert.equal(result.status,0,result.stderr||String(result.error));assert.ok(Number(result.stdout)>10);
 }finally{f.db.close();rmSync(directory,{recursive:true,force:true});}
});
test('accepted receipt with a stale public tuple may only explicitly renew and the new generation needs another human choice',async()=>{
 const f=await fixture();try{
  await f.send(undefined,'POST',f.input);const old=f.db.sqlite.prepare('SELECT * FROM identity_offers').get()!,e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!,p=JSON.parse(await decryptPrivate(key,'mail-payload',String(e.id),String(e.payload_ciphertext)));
  await f.send('/api/v1/identity/offer/decision','POST',{offerId:old.id,token:p.token,decision:'accept',expectedOfferDigest:old.offer_digest},'');
  f.db.sqlite.exec('UPDATE tower_residencies SET publication_epoch=1');f.setCompletion({...f.completion,publicationEpoch:1});
  const renewed=(await f.send(renewPath,'POST',await renewalInput(f)))!;assert.equal(renewed.status,201);const next=(await renewed.json()).offer;assert.equal(next.generation,2);assert.equal(next.state,'pending');assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_offers WHERE id=?').get(old.id)!.state,'accepted');assert.equal(f.count('agent_identities'),0);
  assert.equal((await f.send('/api/v1/identity/offer/decision','POST',{offerId:old.id,token:p.token,decision:'accept',expectedOfferDigest:old.offer_digest},''))!.status,409);
 }finally{f.db.close();}
});
test('optional offer body reader has a bounded deadline for a source that never closes',async()=>{
 const f=await fixture();let controller:ReadableStreamDefaultController<Uint8Array>|undefined;try{
  const {createIdentityOffer}=await import('../server/live/identity-offer.ts');const service=createIdentityOffer({db:f.db,origin,contactKey:key,now:()=>new Date(at),verifyCompletion:async()=>f.completion,bodyReadTimeoutMs:10});
  const request=new Request(origin+'/api/v1/agent/identity/offer',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64),'Content-Type':'application/json'},body:new ReadableStream<Uint8Array>({start(c){controller=c;}}),duplex:'half'} as RequestInit&{duplex:'half'});
  const response=await Promise.race([service.fetch(request),new Promise<null>(resolve=>setTimeout(()=>resolve(null),100))]);assert.equal(response?.status,408);
 }finally{try{controller?.close();}catch{/* Timed-out reader has already cancelled. */}f.db.close();}
});
