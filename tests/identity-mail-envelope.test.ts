import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {LocalDatabase} from '../server/live/local-db.ts';
import {encryptPrivate,hashPrivate,hashIdentityInput,decryptPrivate} from '../server/live/identity-private.ts';
import {signCredential} from '../src/identity/index.ts';
const origin='https://identity.example',time='2026-10-31T00:00:00.000Z',key='9'.repeat(64),enc=new TextEncoder();
async function factory(){assert(existsSync(new URL('../server/live/identity-mail-envelope.ts',import.meta.url)),'private frozen-envelope factory is implemented');return import('../server/live/identity-mail-envelope.ts');}
async function fixture(size=64){
 const db=new LocalDatabase(':memory:'),native=new LocalDatabase(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 openSyntheticTower(db);
 let clock=time,nativeClock=time;
 db.sqlite.function('strftime',{varargs:true},(...args)=>args[1]==='now'?nativeClock:native.sqlite.prepare('SELECT strftime('+args.map(()=>'?').join(',')+') v').get(...args)!.v);
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const pdf=new Uint8Array(size);pdf.fill(32);pdf.set(enc.encode('%PDF-1.7\n'));pdf.set(enc.encode('%%EOF'),size-5);
 for(const x of ['a','b']){
  const account=x.repeat(16),agent='mcid:'+x.repeat(64),invite=x.repeat(32),cid=(x==='a'?'c':'d').repeat(32),event=(x==='a'?'e':'f').repeat(32);
  db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,await hashIdentityInput(x),time);
  db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'PRIVATE HOME','PRIVATE RELATION','resident','external-ready',?)").run(account,account,time);
  db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)").run(account,account,account,'https://private.example/'+x,time,time);
  db.sqlite.prepare("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,version,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,3,'active',1,?,?)").run(agent,account,account,account,time,time);
  const cipher=await encryptPrivate(key,'guardian-recipient',agent,'shared@example.com'),hash=await hashPrivate(key,'guardian-email','shared@example.com');
  db.sqlite.prepare("INSERT INTO identity_guardian_invites(id,agent_id,account_id,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,invite_token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,3,1,'registered',?,?,?,'2026-11-01T00:00:00.000Z',?,?)").run(invite,agent,account,cipher,hash,await hashPrivate(key,'guardian-confirmation:'+invite,'7'.repeat(64)),time,time);
  db.sqlite.prepare('INSERT INTO identity_guardians(guardian_id,agent_id,invitation_id,email_verified_at,created_at) VALUES(?,?,?,?,?)').run(invite,agent,invite,time,time);
  const signed=await signCredential({type:'NeoBabylonAgentIdentity',version:'0.01',issuer:origin,agentId:agent,credentialId:cid,publicName:'公開名字 '+x,issuedAt:time,keyId:'fixture',verificationURL:origin+'/identity/verify/'+cid},pair.privateKey),json=JSON.stringify(signed),pdfDigest=await hashIdentityInputBytes(pdf),jsonDigest=await hashIdentityInput(json);
  db.sqlite.prepare("INSERT INTO identity_credentials(credential_id,agent_id,account_id,revision,state,signed_json,pdf_digest,json_digest,pdf_length,json_length,pdf_chunks,json_chunks,issued_at,updated_at) VALUES(?,?,?,1,'issued',?,?,?,?,?,?,1,?,?)").run(cid,agent,account,json,pdfDigest,jsonDigest,pdf.length,enc.encode(json).length,Math.ceil(pdf.length/49152),time,time);
  db.sqlite.prepare('INSERT INTO identity_card_heads VALUES(?,1,?,1,?)').run(account,cid,time);
  for(const [kind,bytes] of [['pdf',pdf],['json',enc.encode(json)]] as const)for(let offset=0;offset<bytes.length;offset+=49152)db.sqlite.prepare('INSERT INTO identity_card_artifacts VALUES(?,?,?,?)').run(cid,kind,offset/49152,Buffer.from(bytes.subarray(offset,offset+49152)).toString('base64'));
  db.sqlite.prepare("INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,created_at,updated_at) VALUES(?,'identity-card',?,?,?,?,?,?,?)").run(event,cid,'card:'+cid,cipher,hash,await encryptPrivate(key,'mail-payload',event,JSON.stringify({credentialId:cid,pdfDigest,jsonDigest,template:'identity-card-v1'})),time,time);
 }
 const env={db,origin,contactKey:key,from:'MuseCondo <identity@example.com>',trustedKeys:new Map([['fixture',pair.publicKey]]),now:()=>new Date(clock)};
 const event='e'.repeat(32),cid='c'.repeat(32),agent='mcid:'+'a'.repeat(64),account='a'.repeat(16),invite='a'.repeat(32);
 const patchPayload=async(payload:unknown)=>db.sqlite.prepare('UPDATE identity_mail_events SET payload_ciphertext=? WHERE id=?').run(await encryptPrivate(key,'mail-payload',event,JSON.stringify(payload)),event);
 const invitation=async()=>{
  db.sqlite.prepare("UPDATE agent_identities SET state='provisional' WHERE account_id=?").run(account);
  db.sqlite.prepare("UPDATE identity_guardian_invites SET state='accepted' WHERE id=?").run(invite);
  db.sqlite.prepare("UPDATE identity_mail_events SET kind='guardian-invitation',entity_id=? WHERE id=?").run(invite,event);await patchPayload({token:'7'.repeat(64)});
 };
 const security=async(template='identity-card-revoked-v1')=>{
  db.sqlite.prepare("UPDATE identity_mail_events SET kind='security-notice' WHERE id=?").run(event);
  if(template==='identity-card-revoked-v1'){db.sqlite.prepare("UPDATE identity_credentials SET state='revoked' WHERE credential_id=?").run(cid);await patchPayload({credentialId:cid,template});}
  else {
   const request='1'.repeat(32),continued=template==='identity-recovery-continued-v1',state=continued?'continued':'new-admission-required';
   db.sqlite.prepare("INSERT INTO identity_recovery_requests(id,agent_id,candidate_hash,request_key,input_hash,state,created_at,expires_at,completed_at) VALUES(?,?,?,'test-key',?,?,?,'2026-10-31T01:00:00.000Z',?)").run(request,agent,'1'.repeat(64),'2'.repeat(64),state,time,time);
   const receipt=continued?{requestId:request,agentId:agent,state,authorityEpoch:1,instanceId:'2'.repeat(32)}:{requestId:request,agentId:agent,state};
   db.sqlite.prepare("INSERT INTO identity_recovery_receipts VALUES(?,'test-key',?,?,?)").run(request,'2'.repeat(64),JSON.stringify(receipt),time);
   if(continued){db.sqlite.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES('recovery-token',?,?,'[]','2027-01-01T00:00:00.000Z',?)").run(account,'3'.repeat(64),time);db.sqlite.prepare("INSERT INTO identity_recovery_instances VALUES(?,?,1,'recovery-token',?,?)").run('2'.repeat(32),agent,request,time);}
   else db.sqlite.prepare('INSERT INTO identity_offline_recovery_codes(agent_id,code_hash,authority_epoch,identity_version,created_at,confirmed_at) VALUES(?,?,1,3,?,?)').run(agent,'4'.repeat(64),time,time);
   db.sqlite.prepare('UPDATE identity_mail_events SET entity_id=? WHERE id=?').run(request,event);await patchPayload({template,agentId:agent,requestId:request,authorityEpoch:1});
  }
 };
 return {db,env,event,cid,agent,account,invite,pdf,pair,patchPayload,invitation,security,setClock:(s:string)=>{clock=s;},setNative:(s:string)=>{nativeClock=s;},close:()=>{db.close();native.close();},count:(t:string)=>Number(db.sqlite.prepare('SELECT count(*) n FROM '+t).get()!.n)};
}
async function hashIdentityInputBytes(bytes:Uint8Array){return Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))).toString('hex');}
test('frozen private envelope has real attachments, exact bytes, safe audit, and never changes pending state',async()=>{
 const {createIdentityMailEnvelope}=await factory(),f=await fixture();try{
  const service=createIdentityMailEnvelope(f.env),descriptor=await service.prepare(f.event),result=await service.materialize(f.event,descriptor.bodyDigest),body=JSON.parse(result.body);
  assert.equal(body.from,f.env.from);assert.deepEqual(body.to,['shared@example.com']);assert.deepEqual(body.tags,[{name:'identity_event',value:f.event}]);
  assert.deepEqual(body.attachments.map((a:{filename:string})=>a.filename),['agent-identity-card.pdf','agent-identity-credential.json']);
  assert.deepEqual(Buffer.from(body.attachments[0].content,'base64'),Buffer.from(f.pdf));assert.equal(await hashPrivate(key,'mail-body:'+f.event,result.body),descriptor.bodyDigest);assert.equal(enc.encode(result.body).length,descriptor.bodyLength);
  assert.equal(Buffer.from(body.attachments[1].content,'base64').toString(),f.db.sqlite.prepare('SELECT signed_json FROM identity_credentials WHERE credential_id=?').get(f.cid)!.signed_json);
  for(const secret of ['PRIVATE HOME','PRIVATE RELATION','private.example','offline'])assert(!body.text.includes(secret));
  const row=f.db.sqlite.prepare('SELECT state,attempt_count FROM identity_mail_events WHERE id=?').get(f.event);assert.equal(row!.state,'pending');assert.equal(row!.attempt_count,0);
  const raw=JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_envelopes').all())+JSON.stringify(f.db.sqlite.prepare('SELECT * FROM identity_mail_audit').all());for(const privateValue of ['shared@example.com',f.env.from,'agent-identity-card.pdf','公開名字',key])assert(!raw.includes(privateValue),privateValue);
  assert.equal(f.count('identity_mail_envelopes'),1);assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM identity_mail_audit WHERE action='prepared'").get()!.n,1);
  for(const sql of ['UPDATE identity_mail_envelopes SET body_length=1','DELETE FROM identity_mail_envelopes',"DELETE FROM identity_mail_audit WHERE action='prepared'","UPDATE identity_mail_audit SET detail_json='{}' WHERE action='prepared'"])assert.throws(()=>f.db.sqlite.exec(sql));
 }finally{f.close();}
});
test('same email across households never merges identity; frozen body survives factory, clock and FROM changes',async()=>{
 const {createIdentityMailEnvelope}=await factory(),f=await fixture();try{
  const s=createIdentityMailEnvelope(f.env);await Promise.all([s.prepare(f.event),s.prepare(f.event)]);const first=await s.materialize(f.event);
  f.setClock('2026-11-15T00:00:00.000Z');const changed=createIdentityMailEnvelope({...f.env,from:'Changed <new@example.com>'});assert.equal((await changed.materialize(f.event)).body,first.body);assert.deepEqual(await changed.prepare(f.event),first.descriptor);
  const other=await s.materialize('f'.repeat(32));assert.notEqual(other.body,first.body);assert.equal(f.count('identity_mail_envelopes'),2);
  await assert.rejects(createIdentityMailEnvelope({...f.env,origin:'https://changed.example'}).materialize(f.event),/origin|unavailable|blocked/);
  await assert.rejects(s.materialize(f.event,'0'.repeat(64)),/digest/);
 }finally{f.close();}
});
test('five fixed templates report only persisted facts and invitation has manual short-lived inputs',async()=>{
 const {createIdentityMailEnvelope}=await factory();
 for(const template of ['guardian-invitation','identity-card-v1','identity-card-revoked-v1','identity-recovery-continued-v1','identity-guardian-repaired-v1']){
  const f=await fixture();try{
   if(template==='guardian-invitation')await f.invitation();else if(template!=='identity-card-v1')await f.security(template);
   if(template.includes('revoked')||template.includes('recovery')||template.includes('repaired'))f.db.sqlite.prepare("UPDATE agent_identities SET state='suspended' WHERE account_id=?").run(f.account);
   const r=await createIdentityMailEnvelope(f.env).materialize(f.event),body=JSON.parse(r.body);assert.equal(r.descriptor.templateVersion,template==='guardian-invitation'?'guardian-invitation-v1':template);assert(body.text.includes(f.agent));assert(body.text.includes(origin+'/identity'));
   for(const secret of ['PRIVATE HOME','PRIVATE RELATION','private.example','levels','長期復原碼：'])assert(!body.text.includes(secret));
   if(template==='guardian-invitation'){assert(body.text.includes('7'.repeat(64)));assert(body.text.includes(f.invite));assert(body.text.includes('短效初次確認碼'));assert(!JSON.stringify(body.tags).includes('7'.repeat(64)));}
   else assert(!r.body.includes('7'.repeat(64)));
   const links=String(body.text).match(/https:\/\/\S+/g)??[];assert(links.every(v=>new URL(v).origin===origin&&!v.includes('?')));
  }finally{f.close();}
 }
});
test('current qualification changes fail closed before preparation or replay without mutating outbox',async()=>{
 const {createIdentityMailEnvelope}=await factory();
 for(const sql of ["UPDATE identity_guardian_invites SET state='cancelled' WHERE id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'","UPDATE agent_identities SET state='suspended' WHERE account_id='aaaaaaaaaaaaaaaa'","UPDATE agent_identities SET recovery_consent=0 WHERE account_id='aaaaaaaaaaaaaaaa'","UPDATE tower_residencies SET resident_id='new-resident' WHERE account_id='aaaaaaaaaaaaaaaa'","UPDATE identity_card_heads SET public_verification_consent=0 WHERE account_id='aaaaaaaaaaaaaaaa'","UPDATE identity_credentials SET state='superseded' WHERE credential_id='cccccccccccccccccccccccccccccccc'","UPDATE identity_mail_events SET state='unknown' WHERE id='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'"]){
  const f=await fixture();try{const s=createIdentityMailEnvelope(f.env);await s.prepare(f.event);f.db.sqlite.exec('PRAGMA ignore_check_constraints=ON');f.db.sqlite.exec(sql);await assert.rejects(s.materialize(f.event));assert.equal(f.count('identity_mail_envelopes'),1);}finally{f.close();}
 }
 for(const mutation of [async(f:Awaited<ReturnType<typeof fixture>>)=>f.patchPayload({template:'stranger'}),async(f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.exec("UPDATE identity_mail_events SET payload_ciphertext='corrupt'"),async(f:Awaited<ReturnType<typeof fixture>>)=>f.db.sqlite.exec("DELETE FROM identity_mail_events WHERE id='ffffffffffffffffffffffffffffffff'; UPDATE identity_mail_events SET entity_id='dddddddddddddddddddddddddddddddd' WHERE id='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'")]){
  const f=await fixture();try{await mutation(f);await assert.rejects(createIdentityMailEnvelope(f.env).prepare(f.event));assert.equal(f.count('identity_mail_envelopes'),0);assert.equal(f.count('identity_mail_audit'),0);}finally{f.close();}
 }
});
test('invitation expiry, authority, consent, token and native clock are rechecked',async()=>{
 const {createIdentityMailEnvelope}=await factory();
 for(const change of ['native','clock','token','version','authority','consent','registered']){const f=await fixture();try{
  await f.invitation();const s=createIdentityMailEnvelope(f.env);await s.prepare(f.event);
  f.db.sqlite.exec('PRAGMA ignore_check_constraints=ON');if(change==='native')f.setNative('2026-11-02T00:00:00.000Z');else if(change==='clock')f.setClock('2026-11-02T00:00:00.000Z');else if(change==='token')f.db.sqlite.exec("UPDATE identity_guardian_invites SET invite_token_hash='"+'8'.repeat(64)+"' WHERE id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'");else if(change==='registered')f.db.sqlite.exec("UPDATE identity_guardian_invites SET state='registered' WHERE id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'");else f.db.sqlite.exec('UPDATE agent_identities SET '+(change==='version'?'version=4':change==='authority'?'authority_epoch=2':'recovery_consent=0')+" WHERE account_id='aaaaaaaaaaaaaaaa'");
  await assert.rejects(s.materialize(f.event));assert.equal(f.db.sqlite.prepare('SELECT attempt_count FROM identity_mail_events WHERE id=?').get(f.event)!.attempt_count,0);
 }finally{f.close();}}
});
test('trusted caller keys are mandatory and tampered signed credentials or artifacts are rejected',async()=>{
 const {createIdentityMailEnvelope}=await factory();
 for(const mutation of ['wrongtrust','missing','duplicate','order','base64','oversize','digest','json','signature','magic']){const f=await fixture();try{
  if(mutation==='wrongtrust'){const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);f.env.trustedKeys=new Map([['fixture',pair.publicKey]]);}
  else {f.db.sqlite.exec('PRAGMA ignore_check_constraints=ON; DROP TRIGGER identity_card_artifact_immutable; DROP TRIGGER identity_card_artifact_permanent; DROP TRIGGER identity_card_immutable;');
   if(mutation==='missing')f.db.sqlite.exec("DELETE FROM identity_card_artifacts WHERE credential_id='cccccccccccccccccccccccccccccccc' AND kind='pdf'");
   if(mutation==='duplicate'||mutation==='order'){f.db.sqlite.exec('DROP TRIGGER identity_card_artifact_count');f.db.sqlite.exec("UPDATE identity_card_artifacts SET chunk_index=1 WHERE credential_id='cccccccccccccccccccccccccccccccc' AND kind='pdf'");}
   if(mutation==='base64'||mutation==='oversize'||mutation==='magic')f.db.sqlite.prepare("UPDATE identity_card_artifacts SET data_base64=? WHERE credential_id=? AND kind='pdf'").run(mutation==='base64'?'AB==':mutation==='oversize'?'A'.repeat(65540):Buffer.alloc(64).toString('base64'),f.cid);
   if(mutation==='digest')f.db.sqlite.exec("UPDATE identity_credentials SET pdf_digest='"+'0'.repeat(64)+"' WHERE credential_id='cccccccccccccccccccccccccccccccc'");
   if(mutation==='json'||mutation==='signature')f.db.sqlite.prepare('UPDATE identity_credentials SET signed_json=? WHERE credential_id=?').run(mutation==='json'?'{}':String(f.db.sqlite.prepare('SELECT signed_json FROM identity_credentials WHERE credential_id=?').get(f.cid)!.signed_json).replace('公開名字','竄改名字'),f.cid);
  }
  await assert.rejects(createIdentityMailEnvelope(f.env).prepare(f.event),mutation);assert.equal(f.count('identity_mail_envelopes'),0);
 }finally{f.close();}}
});
test('4.4 MB synthetic lifecycle payload assembles every base64 byte and both SHA256 manifests',async()=>{
 const {createIdentityMailEnvelope}=await factory(),f=await fixture(4400000);try{
  const result=await createIdentityMailEnvelope(f.env).materialize(f.event),body=JSON.parse(result.body),card=f.db.sqlite.prepare('SELECT * FROM identity_credentials WHERE credential_id=?').get(f.cid)!;
  assert(result.descriptor.bodyLength>5800000&&result.descriptor.bodyLength<12*1024*1024);for(const [i,kind] of ['pdf','json'].entries())assert.equal(await hashIdentityInputBytes(Buffer.from(body.attachments[i].content,'base64')),card[kind+'_digest']);
  assert(f.db.sqlite.prepare('SELECT MAX(length(metadata_ciphertext)) n FROM identity_mail_envelopes').get()!.n as number<32768);
 }finally{f.close();}
});
test('transaction races, audit rollback and lost acknowledgement preserve exactly one frozen winner',async()=>{
 const {createIdentityMailEnvelope}=await factory();
 for(const kind of ['contact','expiry','audit','lost']){const f=await fixture();try{
  if(kind==='expiry')await f.invitation();
  const batch=f.db.batch.bind(f.db);let changed=false;
  f.db.batch=async statements=>{if(!changed&&statements.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO identity_mail_envelopes'))){changed=true;if(kind==='contact')f.db.sqlite.prepare("UPDATE identity_guardian_invites SET state='cancelled' WHERE id=?").run(f.invite);if(kind==='expiry')f.setNative('2026-11-02T00:00:00.000Z');if(kind==='audit')f.db.sqlite.exec("CREATE TRIGGER fail_prepared BEFORE INSERT ON identity_mail_audit WHEN NEW.action='prepared' BEGIN SELECT RAISE(ABORT,'synthetic');END");const result=await batch(statements);if(kind==='lost')throw new Error('synthetic lost ack');return result;}return batch(statements);};
  const s=createIdentityMailEnvelope(f.env);if(kind==='lost'){await s.prepare(f.event);await s.prepare(f.event);assert.equal(f.count('identity_mail_envelopes'),1);assert.equal(f.count('identity_mail_audit'),1);}else{await assert.rejects(s.prepare(f.event));assert.equal(f.count('identity_mail_envelopes'),0);assert.equal(f.count('identity_mail_audit'),0);}
  assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE id=?').get(f.event)!.state,'pending');
 }finally{f.close();}}
});
test('encrypted metadata binds purpose/event and dormant factory cannot reach a provider or existing runtime',async()=>{
 const {createIdentityMailEnvelope}=await factory(),f=await fixture();try{
  await createIdentityMailEnvelope(f.env).prepare(f.event);const row=f.db.sqlite.prepare('SELECT metadata_ciphertext FROM identity_mail_envelopes WHERE event_id=?').get(f.event)!;
  const metadata=JSON.parse(await decryptPrivate(key,'mail-envelope',f.event,String(row.metadata_ciphertext)));assert.equal(metadata.to,'shared@example.com');assert.equal(metadata.from,f.env.from);await assert.rejects(decryptPrivate(key,'mail-envelope','f'.repeat(32),String(row.metadata_ciphertext)));
  const source=readFileSync(new URL('../server/live/identity-mail-envelope.ts',import.meta.url),'utf8');for(const absent of ['fetch(','.processOne(','apiKey','console.','readFile','lease_started_at'])assert(!source.includes(absent),absent);
 }finally{f.close();}
});
test('8 MiB attachment guards stay inside a free D1 invocation and every bound value is below 1 MiB',async()=>{
 const {createIdentityMailEnvelope}=await factory();for(const lostAck of [false,true]){const f=await fixture(8388608);try{
  const batch=f.db.batch.bind(f.db);let executed=0,lost=false;
  f.db.batch=async statements=>{executed+=statements.length;for(const statement of statements){const s=statement as unknown as {sql:string;values:unknown[]};assert(!s.sql.includes('UNION'));assert(s.values.length<100);for(const v of s.values)if(typeof v==='string')assert(enc.encode(v).length<1000000);}const r=await batch(statements);if(lostAck&&!lost){lost=true;throw new Error('synthetic lost ack');}return r;};
  const r=await createIdentityMailEnvelope(f.env).materialize(f.event);assert(r.descriptor.bodyLength<=12582912);assert(executed<=40,'leave room for the initial SELECTs within the free 50-query invocation');
 }finally{f.close();}}
});
test('an event changed after decrypt but before qualification cannot freeze stale payload or recipient',async()=>{
 const {createIdentityMailEnvelope}=await factory(),f=await fixture();try{
  const sign=crypto.subtle.sign.bind(crypto.subtle);let changed=false;
  const originalHash=await hashPrivate(key,'guardian-email','shared@example.com');assert.equal(originalHash,String(f.db.sqlite.prepare('SELECT recipient_hash FROM identity_mail_events WHERE id=?').get(f.event)!.recipient_hash));
  // Guardian invitation computes its token HMAC after decrypt and before context read.
  await f.invitation();const cipher=await encryptPrivate(key,'mail-payload',f.event,JSON.stringify({token:'8'.repeat(64)}));
  const original=crypto.subtle.sign;
  crypto.subtle.sign=async(...args:Parameters<SubtleCrypto['sign']>)=>{const r=await sign(...args);if(!changed){changed=true;f.db.sqlite.prepare('UPDATE identity_mail_events SET payload_ciphertext=? WHERE id=?').run(cipher,f.event);}return r;};
  try{await assert.rejects(createIdentityMailEnvelope(f.env).prepare(f.event));assert.equal(f.count('identity_mail_envelopes'),0);}finally{crypto.subtle.sign=original;}
 }finally{f.close();}
});
test('recovery and revocation templates cannot substitute facts from a payload or another household',async()=>{
 const {createIdentityMailEnvelope}=await factory();
 for(const template of ['identity-card-revoked-v1','identity-recovery-continued-v1','identity-guardian-repaired-v1'])for(const mutation of ['missing-fact','cross-house','cancelled-contact']){
  const f=await fixture();try{
   await f.security(template);
   if(mutation==='cancelled-contact')f.db.sqlite.prepare("UPDATE identity_guardian_invites SET state='cancelled' WHERE id=?").run(f.invite);
   else if(template==='identity-card-revoked-v1'){
    if(mutation==='missing-fact'){f.db.sqlite.exec('DROP TRIGGER identity_card_immutable');f.db.sqlite.prepare("UPDATE identity_credentials SET state='issued' WHERE credential_id=?").run(f.cid);}else{f.db.sqlite.prepare("UPDATE identity_credentials SET state='revoked' WHERE credential_id=?").run('d'.repeat(32));f.db.sqlite.prepare('UPDATE identity_mail_events SET entity_id=? WHERE id=?').run('d'.repeat(32),f.event);await f.patchPayload({credentialId:'d'.repeat(32),template});}
   }else{
    f.db.sqlite.exec('DROP TRIGGER identity_recovery_receipt_immutable');f.db.sqlite.prepare("UPDATE identity_recovery_receipts SET response_json=? WHERE request_id=?").run(JSON.stringify(mutation==='missing-fact'?{state:'pending'}:{requestId:'1'.repeat(32),agentId:'mcid:'+'b'.repeat(64),state:template==='identity-recovery-continued-v1'?'continued':'new-admission-required',authorityEpoch:1,instanceId:'2'.repeat(32)}),'1'.repeat(32));
   }
   await assert.rejects(createIdentityMailEnvelope(f.env).prepare(f.event));assert.equal(f.count('identity_mail_envelopes'),0);
  }finally{f.close();}
 }
});
test('bad origin/FROM/IDs, missing event, unknown kind and nonpending state cannot produce an envelope',async()=>{
 const {createIdentityMailEnvelope}=await factory(),f=await fixture();try{
  for(const origin of ['http://identity.example','https://identity.example/','https://identity.example?q=x','https://u:p@identity.example'])await assert.rejects(createIdentityMailEnvelope({...f.env,origin}).prepare(f.event));
  for(const from of ['', 'Name <bad@example.com', 'Name <a@example.com>\nBcc: secret@example.com','a@localhost'])await assert.rejects(createIdentityMailEnvelope({...f.env,from}).prepare(f.event));
  for(const id of ['',f.event.toUpperCase(),'0'.repeat(32),'../private'])await assert.rejects(createIdentityMailEnvelope(f.env).prepare(id));
  f.db.sqlite.exec('PRAGMA ignore_check_constraints=ON');f.db.sqlite.prepare("UPDATE identity_mail_events SET kind='stranger' WHERE id=?").run(f.event);await assert.rejects(createIdentityMailEnvelope(f.env).prepare(f.event));
  f.db.sqlite.prepare("UPDATE identity_mail_events SET state='delivered' WHERE id=?").run(f.event);await assert.rejects(createIdentityMailEnvelope(f.env).materialize(f.event),{code:'event_already_processed'});assert.equal(f.count('identity_mail_envelopes'),0);assert.equal(f.count('identity_mail_audit'),0);
 }finally{f.close();}
});
test('frozen materialize refuses artifact mutation after await and native guard protects later caller transaction',async()=>{
 const {createIdentityMailEnvelope}=await factory(),f=await fixture();try{
  const s=createIdentityMailEnvelope(f.env);await s.prepare(f.event);const r=await s.materialize(f.event),batch=f.db.batch.bind(f.db);
  f.db.sqlite.exec('DROP TRIGGER identity_card_artifact_immutable');f.db.sqlite.prepare("UPDATE identity_card_artifacts SET data_base64=? WHERE credential_id=? AND kind='pdf'").run(Buffer.alloc(f.pdf.length).toString('base64'),f.cid);await assert.rejects(batch(r.guards()));await assert.rejects(s.materialize(f.event));
 }finally{f.close();}
 for(const mutation of ['contact','payload','artifact']){
  const g=await fixture();try{const s=createIdentityMailEnvelope(g.env);await s.prepare(g.event);const batch=g.db.batch.bind(g.db);let changed=false;g.db.batch=async statements=>{
   if(!changed){changed=true;if(mutation==='contact'){g.db.sqlite.exec('DROP TRIGGER identity_guardian_immutable_binding');g.db.sqlite.prepare('UPDATE identity_guardian_invites SET recipient_ciphertext=?,email_hash=? WHERE id=?').run(await encryptPrivate(key,'guardian-recipient',g.agent,'new@example.com'),await hashPrivate(key,'guardian-email','new@example.com'),g.invite);}else if(mutation==='payload')await g.patchPayload({template:'stranger'});else {g.db.sqlite.exec('DROP TRIGGER identity_card_artifact_immutable');g.db.sqlite.prepare("UPDATE identity_card_artifacts SET data_base64=? WHERE credential_id=? AND kind='pdf'").run(Buffer.alloc(g.pdf.length).toString('base64'),g.cid);}}
   return batch(statements);
  };await assert.rejects(s.materialize(g.event));assert.equal(g.count('identity_mail_envelopes'),1);assert.equal(g.db.sqlite.prepare('SELECT attempt_count FROM identity_mail_events WHERE id=?').get(g.event)!.attempt_count,0);
  }finally{g.close();}
 }
});
test('normal home revision and a later recovery epoch preserve the original frozen body and historical notice',async()=>{
 const {createIdentityMailEnvelope}=await factory();
 for(const template of ['identity-card-v1','identity-recovery-continued-v1','identity-guardian-repaired-v1']){const f=await fixture();try{
  if(template!=='identity-card-v1')await f.security(template);const s=createIdentityMailEnvelope(f.env),first=await s.materialize(f.event);
  f.db.sqlite.prepare('UPDATE tower_residencies SET revision=revision+1 WHERE account_id=?').run(f.account);assert.equal((await s.materialize(f.event)).body,first.body);
  f.db.sqlite.prepare('UPDATE agent_identities SET version=version+1,authority_epoch=authority_epoch+1 WHERE agent_id=?').run(f.agent);f.db.sqlite.prepare('UPDATE identity_guardians SET version=version+1 WHERE guardian_id=?').run(f.invite);assert.equal((await s.materialize(f.event)).body,first.body);
 }finally{f.close();}}
});
test('a fresh materialize can recover after a home revision race without changing the permanent envelope',async()=>{
 const {createIdentityMailEnvelope}=await factory(),f=await fixture();try{const s=createIdentityMailEnvelope(f.env),first=await s.materialize(f.event),batch=f.db.batch.bind(f.db);let changed=false;
  f.db.batch=async statements=>{if(!changed){changed=true;f.db.sqlite.prepare('UPDATE tower_residencies SET revision=revision+1 WHERE account_id=?').run(f.account);}return batch(statements);};
  await assert.rejects(s.materialize(f.event));assert.equal((await s.materialize(f.event)).body,first.body);assert.equal(f.count('identity_mail_envelopes'),1);
 }finally{f.close();}
});
test('max-size replay and b2 final guards plus claim/audit fit one free D1 invocation',async()=>{
 const {createIdentityMailEnvelope}=await factory(),f=await fixture(8388608);try{
  const s=createIdentityMailEnvelope(f.env);await s.prepare(f.event);const batch=f.db.batch.bind(f.db);let statements=0;
  f.db.batch=async q=>{statements+=q.length;return batch(q);};const r=await s.materialize(f.event);await f.db.batch(r.guards());assert(statements+6+2<=50,'include six SELECTs and two future claim/audit statements in same invocation');assert(r.guards().length<=5,'artifact guard statements must be bounded independent of PDF chunk count');
 }finally{f.close();}
});
test('event time must be canonical and security links lead to the actual recovery UI',async()=>{
 const {createIdentityMailEnvelope}=await factory(),f=await fixture();try{
  await f.security();f.db.sqlite.prepare('UPDATE identity_mail_events SET created_at=? WHERE id=?').run('private home details',f.event);await assert.rejects(createIdentityMailEnvelope(f.env).prepare(f.event));assert.equal(f.count('identity_mail_envelopes'),0);
  f.db.sqlite.prepare('UPDATE identity_mail_events SET created_at=? WHERE id=?').run(time,f.event);const body=JSON.parse((await createIdentityMailEnvelope(f.env).materialize(f.event)).body);assert(body.text.includes('事件時間：'+time));assert(body.text.includes('找回身份：'+origin+'/identity/recover'));assert(body.subject.includes('身分證'));
 }finally{f.close();}
});
test('body integrity is keyed and event/purpose-bound, never a DB-only plaintext email dictionary oracle',async()=>{
 const {createIdentityMailEnvelope}=await factory();
 for(const template of ['identity-card-v1','identity-card-revoked-v1','identity-recovery-continued-v1','identity-guardian-repaired-v1','guardian-invitation']){const f=await fixture();try{
  if(template==='guardian-invitation')await f.invitation();else if(template!=='identity-card-v1')await f.security(template);
  const s=createIdentityMailEnvelope(f.env),r=await s.materialize(f.event),plain=await hashIdentityInput(r.body),expected=await hashPrivate(key,'mail-body:'+f.event,r.body);
  assert.notEqual(r.descriptor.bodyDigest,plain);assert.equal(r.descriptor.bodyDigest,expected);assert.equal((await createIdentityMailEnvelope(f.env).materialize(f.event,expected)).descriptor.bodyDigest,expected);
  assert.notEqual(expected,await hashPrivate(key,'mail-body:'+'0'.repeat(32),r.body));assert.notEqual(expected,await hashPrivate(key,'mail-payload:'+f.event,r.body));assert.notEqual(expected,await hashPrivate('8'.repeat(64),'mail-body:'+f.event,r.body));
  const stored=String(f.db.sqlite.prepare('SELECT body_digest FROM identity_mail_envelopes WHERE event_id=?').get(f.event)!.body_digest),audit=String(f.db.sqlite.prepare("SELECT detail_json FROM identity_mail_audit WHERE event_id=? AND action='prepared'").get(f.event)!.detail_json);assert.equal(stored,expected);assert.equal(JSON.parse(audit).bodyDigest,expected);assert(!audit.includes(plain));
  f.db.sqlite.exec('DROP TRIGGER identity_mail_envelope_immutable');f.db.sqlite.prepare('UPDATE identity_mail_envelopes SET body_digest=? WHERE event_id=?').run(plain,f.event);await assert.rejects(s.materialize(f.event),{code:'envelope_digest_mismatch'});
 }finally{f.close();}}
});
test('all five templates and max-size card compile prepare, materialize and returned guards with native SQLite function arity limited to D1 32',async()=>{
 const {createIdentityMailEnvelope}=await factory();
 for(const scenario of ['guardian-invitation','identity-card-v1','identity-card-revoked-v1','identity-recovery-continued-v1','identity-guardian-repaired-v1','identity-card-v1-max']){const template=scenario.replace(/-max$/,''),f=await fixture(scenario.endsWith('-max')?8388608:64);try{
  if(template==='guardian-invitation')await f.invitation();else if(template!=='identity-card-v1')await f.security(template);
  const queries:string[]=[],prepare=f.db.prepare.bind(f.db);f.db.prepare=sql=>{queries.push(sql);return prepare(sql);};
  const s=createIdentityMailEnvelope(f.env);await s.prepare(f.event);const r=await s.materialize(f.event);await f.db.batch(r.guards());
  // Compile actual captured SQL against the complete synthetic database in a
  // second native engine. setlimit applies to every function, not snapshot text.
  const result=spawnSync('python3',['-c',String.raw`
import base64,json,re,sqlite3,sys
data=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.deserialize(base64.b64decode(data['database']))
db.setlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG,32)
db.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER,100)
db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH,100000)
db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH,2000000)
db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)
assert db.getlimit(sqlite3.SQLITE_LIMIT_FUNCTION_ARG)==32
# Prove the engine accepts 32 and rejects 34 real arguments, independently of
# how the application builds SQL or how many nested commas/string commas exist.
db.execute('SELECT json_object('+','.join(["'k%d',%d"%(i,i) for i in range(16)])+')')
try:
 db.execute('SELECT json_object('+','.join(["'k%d',%d"%(i,i) for i in range(17)])+')')
 raise AssertionError('function limit not enforced')
except sqlite3.OperationalError as error:
 assert 'too many arguments' in str(error)
for sql in data['queries']:
 try:
  db.execute('EXPLAIN '+sql)
 except sqlite3.ProgrammingError as error:
  # EXPLAIN compiles before checking bindings. Repeat with the engine-reported
  # binding count, never by counting '?' or parsing application SQL ourselves.
  count=re.search(r'uses (\d+)',str(error))
  if count is None: raise
  db.execute('EXPLAIN '+sql,[None]*int(count.group(1)))
print(json.dumps({'compiled':len(data['queries'])}))
`],{input:JSON.stringify({database:Buffer.from(f.db.sqlite.serialize()).toString('base64'),queries:[...new Set(queries)]}),encoding:'utf8',maxBuffer:1024*1024});
  assert.equal(result.status,0,template+': '+result.stderr);assert(JSON.parse(result.stdout).compiled>5);
 }finally{f.close();}}
});
