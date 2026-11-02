import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';import {createManagerAdmission} from '../server/live/manager-admission.ts';import {createTowerReception} from '../server/live/reception.ts';import {validateTowerSnapshot} from '../server/live/tower-intake.ts';import {CONDO_PROFILE_FIELDS} from '../src/framework/condo.ts';import {createAgentIdentity} from '../server/live/identity.ts';import {createIdentityOffer} from '../server/live/identity-offer.ts';import {hashIdentityInput,decryptPrivate} from '../server/live/identity-private.ts';
const origin='https://tower.example',source='https://synthetic.example/home/condo.json',resident='f'.repeat(16),secret='a'.repeat(64),key='8'.repeat(64),at='2026-11-01T23:00:00.000Z';
const site=validateTowerSnapshot({templateVersion:'muse-condo-1',example:false,home:{frameworkVersion:'0.01',id:resident,name:'Synthetic',intro:'A home.',assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[],dreams:[]},homeAlt:'A home',profile:Object.fromEntries(CONDO_PROFILE_FIELDS.map(k=>[k,'Public.'])),dream:null},resident);
async function fixture(){
 const db=new LocalDatabase(':memory:'),native=new LocalDatabase(':memory:');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(v=>v.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 let now=at;db.sqlite.function('strftime',{varargs:true},(...args)=>args[1]==='now'?now:native.sqlite.prepare('SELECT strftime('+args.map(()=>'?').join(',')+') v').get(...args)!.v);db.sqlite.exec('UPDATE tower_autonomy_mandate SET enabled=1');
 const preflight=async()=>({ready:true,sourceURL:source,residentId:resident,sourceDigest:'d'.repeat(64),site,images:[],issues:[]}),manager=createManagerAdmission({db,now:()=>new Date(now),preflight});
 const reception=createTowerReception({db,origin,preflight,now:()=>new Date(now),operator:async()=>false,onReview:manager.enqueue,reviewStatus:manager.status,assistanceStatus:manager.assistance.status});
 const opened=await reception.fetch(new Request(origin+'/api/v1/reception/cases',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({requestKey:'synthetic-open-01',name:'Synthetic',requestKind:'new',request:'Please help.',homeURL:'https://synthetic.example/home/',isMuseAgent:true,authorization:{contact:true,application:true,towerAccess:true},sharing:{snapshot:false,directory:false,announcement:false,dream:false},visitPlan:{mode:'manual-return'}})}));assert.equal(opened!.status,201);const c=await opened!.json();await manager.step();
 const account=String(db.sqlite.prepare('SELECT account_id FROM tower_reception_cases WHERE id=?').get(c.case.id)!.account_id),room='b'.repeat(16);db.sqlite.prepare("UPDATE tower_reception_cases SET state='active',version=version+1 WHERE id=?").run(c.case.id);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,published,created_at) VALUES(?,?,'Synthetic','Hello','resident','external-ready',1,?)").run(room,account,at);
 db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,snapshot_consent,directory_consent,public_revision,publication_epoch,created_at,updated_at) VALUES(?,?,?,?,'owner-attested',1,1,1,1,?,?)").run(room,account,resident,source,at,at);db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,1,?,?,?)').run(room,JSON.stringify(site),'d'.repeat(64),at);
 db.sqlite.prepare('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)').run('resident-key',account,await hashIdentityInput('b'.repeat(64)),'["tower:read","tower:write"]','2027-01-01T00:00:00.000Z',at);
 const identity=createAgentIdentity({db,origin,now:()=>new Date(now)}),offer=createIdentityOffer({db,origin,contactKey:key,now:()=>new Date(now),verifyCompletion:async()=>({complete:true,publicURL:origin+'/home/'+room,roomId:room,residentId:resident,revision:1,publicationEpoch:Number(db.sqlite.prepare('SELECT publication_epoch FROM tower_residencies WHERE account_id=?').get(account)!.publication_epoch),snapshotDigest:'d'.repeat(64),checks:{}})});
 const send=(path:string,body:unknown,token='b'.repeat(64))=>new Request(origin+path,{method:'POST',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});
 const input={requestKey:'synthetic-enroll-01',expectedResidencyRevision:1,residentId:resident,recoveryConsent:true};
 const enroll=(value:unknown=input)=>identity.fetch(send('/api/v1/agent/identity/enroll',value));
 async function invite(decision?:'accept'|'decline'){
  const response=await offer.fetch(send('/api/v1/agent/identity/offer',{guardianEmail:'synthetic@example.com',guardianDesignated:true,mailConsent:true}));assert.equal(response!.status,201);
  if(decision){const e=db.sqlite.prepare('SELECT * FROM identity_mail_events').get()!,p=JSON.parse(await decryptPrivate(key,'mail-payload',String(e.id),String(e.payload_ciphertext))),o=db.sqlite.prepare('SELECT offer_digest FROM identity_offers').get()!;
   const r=await offer.fetch(send('/api/v1/identity/offer/decision',{offerId:e.entity_id,token:p.token,decision,expectedOfferDigest:o.offer_digest},''));assert.equal(r!.status,200);
  }
 }
 return {db,account,room,input,enroll,invite,offer,send,setNow:(v:string)=>{now=v;},close:()=>{db.close();native.close();}};
}
test('assisted enrollment cannot bypass absent, pending or declined human opt-in',async()=>{
 for(const decision of ['none','pending','decline'] as const){const f=await fixture();try{if(decision!=='none')await f.invite(decision==='decline'?'decline':undefined);const r=(await f.enroll())!;assert.equal(r.status,409,decision+': '+await r.clone().text());assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM agent_identities').get()!.n,0);}finally{f.close();}}
});
test('accepted consent receipt stays valid after token expiry, requires separate recovery consent, and permits one immutable enrollment',async()=>{
 const f=await fixture();try{await f.invite('accept');assert.equal((await f.enroll({...f.input,recoveryConsent:false}))!.status,400);f.setNow('2026-11-05T23:00:00.000Z');const first=(await f.enroll())!;assert.equal(first.status,201);const value=await first.json();
  f.setNow('2026-11-05T23:00:00.000Z');f.db.sqlite.exec('UPDATE tower_residencies SET publication_epoch=2,public_revision=NULL,snapshot_consent=0');const replay=(await f.enroll())!;assert.equal(replay.status,201);assert.deepEqual(await replay.json(),value);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM agent_identities').get()!.n,1);
 }finally{f.close();}
});
test('expired pending offer and publication change before identity commit cannot create provisional authority',async()=>{
 for(const mode of ['expired','epoch-race','consent-race']){const f=await fixture();try{
  await f.invite(mode==='expired'?undefined:'accept');if(mode==='expired')f.setNow('2026-11-04T23:00:00.000Z');
  else {const batch=f.db.batch.bind(f.db);f.db.batch=async rows=>{if(rows.some(s=>(s as unknown as {sql:string}).sql.startsWith('INSERT INTO agent_identities'))){f.db.sqlite.exec(mode==='epoch-race'?'UPDATE tower_residencies SET publication_epoch=2':'UPDATE tower_residencies SET directory_consent=0');}return batch(rows);};}
  const r=(await f.enroll())!;assert.equal(r.status,409,mode+': '+await r.clone().text());assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM agent_identities').get()!.n,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM identity_audit').get()!.n,0);
 }finally{f.close();}}
});
function directIdentity(f:Awaited<ReturnType<typeof fixture>>){return f.db.sqlite.prepare("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,'provisional',1,?,?)").run('mcid:'+'e'.repeat(64),f.account,f.room,resident,at,at);}
test('database refuses direct assisted identity inserts without a valid accepted audited public offer',async()=>{
 for(const state of ['none','private','pending','declined','accepted-no-audit']){const f=await fixture();try{
  if(state==='private')f.db.sqlite.exec('UPDATE tower_residencies SET snapshot_consent=0,public_revision=NULL; UPDATE rooms SET published=0');
  if(state==='pending'||state==='declined'||state==='accepted-no-audit')await f.invite(state==='declined'?'decline':undefined);
  if(state==='accepted-no-audit')f.db.sqlite.prepare("UPDATE identity_offers SET state='accepted',decided_at=?").run(at);
  assert.throws(()=>directIdentity(f),/identity-offer-enrollment-required/,state);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM agent_identities').get()!.n,0);
 }finally{f.close();}}
});
test('database human acceptance checks native expiry and current public tuple even with a forged earlier decision timestamp',async()=>{
 for(const mode of ['expired','epoch','directory','snapshot','unpublished','digest']){const f=await fixture();try{
  await f.invite();
  if(mode==='expired')f.setNow('2026-11-05T23:00:00.000Z');if(mode==='epoch')f.db.sqlite.exec('UPDATE tower_residencies SET publication_epoch=2');if(mode==='directory')f.db.sqlite.exec('UPDATE tower_residencies SET directory_consent=0');if(mode==='snapshot')f.db.sqlite.exec('UPDATE tower_residencies SET snapshot_consent=0');if(mode==='unpublished')f.db.sqlite.exec('UPDATE rooms SET published=0');if(mode==='digest')f.db.sqlite.exec("UPDATE tower_snapshots SET content_digest='changed'");
  assert.throws(()=>f.db.sqlite.prepare("UPDATE identity_offers SET state='accepted',decided_at=?").run(at),/identity-offer-acceptance-required/,mode);
  assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_offers').get()!.state,'pending');
 }finally{f.close();}}
});
test('database permits accepted audited receipt after token expiry and rejects later publication loss',async()=>{
 const f=await fixture();try{await f.invite('accept');f.setNow('2026-11-05T23:00:00.000Z');directIdentity(f);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM agent_identities').get()!.n,1);}finally{f.close();}
 const g=await fixture();try{await g.invite('accept');g.db.sqlite.exec('UPDATE tower_residencies SET publication_epoch=2');assert.throws(()=>directIdentity(g),/identity-offer-enrollment-required/);}finally{g.close();}
});
test('database legacy identity insertion remains compatible without an assisted approval marker',async()=>{
 const f=await fixture();try{
  const {openSyntheticTower}=await import('./helpers/tower-admission-fixture.ts');openSyntheticTower(f.db);
  const legacy='1'.repeat(16);f.db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(legacy,await hashIdentityInput('legacy-synthetic'),at);
  f.db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Legacy','Hello','resident','external-ready',?)").run(legacy,legacy,at);
  f.db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,'https://legacy.synthetic.example/home/condo.json','owner-attested',?,?)").run(legacy,legacy,legacy,at,at);
  f.db.sqlite.prepare("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,'provisional',1,?,?)").run('mcid:'+'1'.repeat(64),legacy,legacy,legacy,at,at);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM agent_identities').get()!.n,1);
 }finally{f.close();}
});
test('database cannot initialize an offer as accepted instead of recording a pending human choice',async()=>{
 const f=await fixture();try{
  const id='0'.repeat(32),event='2'.repeat(32),cipher='v1.synthetic.synthetic',hash='3'.repeat(64);
  f.db.sqlite.prepare("INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,created_at,updated_at) VALUES(?,'guardian-invitation',?,?,?,?,?,?,?)").run(event,id,'identity-offer:'+id,cipher,hash,cipher,at,at);
  assert.throws(()=>f.db.sqlite.prepare("INSERT INTO identity_offers(id,account_id,room_id,resident_id,public_revision,publication_epoch,snapshot_digest,offer_digest,public_url,guardian_designated,mail_consent,recipient_ciphertext,recipient_hash,token_hash,mail_event_id,state,created_at,expires_at,decided_at) VALUES(?,?,?,?,1,1,?,?,?,1,1,?,?,?,?,'accepted',?,?,?)").run(id,f.account,f.room,resident,'d'.repeat(64),'4'.repeat(64),origin+'/home/'+f.room,cipher,hash,'5'.repeat(64),event,at,'2026-11-02T23:00:00.000Z',at),/identity-offer-binding/);
 }finally{f.close();}
});
test('database opt-in cannot be reused to replace an existing assisted identity',async()=>{
 const f=await fixture();try{
  await f.invite('accept');directIdentity(f);
  assert.throws(()=>f.db.sqlite.prepare("INSERT OR REPLACE INTO agent_identities(agent_id,account_id,room_id,resident_id,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,'provisional',1,?,?)").run('mcid:'+'9'.repeat(64),f.account,f.room,resident,at,at),/constraint failed|identity-offer-enrollment-required/);
  assert.equal(f.db.sqlite.prepare('SELECT agent_id FROM agent_identities').get()!.agent_id,'mcid:'+'e'.repeat(64));
 }finally{f.close();}
});
test('renewed current generation requires its own human opt-in and then resumes the existing enrollment contract',async()=>{
 const f=await fixture();try{
  await f.invite();const old=f.db.sqlite.prepare('SELECT * FROM identity_offers').get()!;f.setNow('2026-11-04T23:00:00.000Z');
  const renewed=await f.offer.fetch(f.send('/api/v1/agent/identity/offer/renew',{requestKey:'renew-enroll-0001',expectedOfferId:old.id,guardianEmail:'synthetic@example.com',guardianDesignated:true,mailConsent:true}));assert.equal(renewed!.status,201);assert.equal((await f.enroll())!.status,409);
  const current=f.db.sqlite.prepare('SELECT o.* FROM identity_offers o JOIN identity_offer_heads h ON h.offer_id=o.id').get()!,e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events WHERE id=?').get(current.mail_event_id)!,p=JSON.parse(await decryptPrivate(key,'mail-payload',String(e.id),String(e.payload_ciphertext)));
  const choice=await f.offer.fetch(f.send('/api/v1/identity/offer/decision',{offerId:current.id,token:p.token,decision:'accept',expectedOfferDigest:current.offer_digest},''));assert.equal(choice!.status,200);
  f.setNow('2026-11-09T23:00:00.000Z');assert.equal((await f.enroll())!.status,201);assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_offers WHERE id=?').get(old.id)!.state,'pending');assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM agent_identities').get()!.n,1);
 }finally{f.close();}
});
test('accepted-but-stale explicit renewal preserves the old receipt but cannot enroll until the new head is accepted',async()=>{
 const f=await fixture();try{
  await f.invite('accept');const old=f.db.sqlite.prepare('SELECT * FROM identity_offers').get()!;f.db.sqlite.exec('UPDATE tower_residencies SET publication_epoch=2');
  const renewed=await f.offer.fetch(f.send('/api/v1/agent/identity/offer/renew',{requestKey:'accepted-renew-01',expectedOfferId:old.id,guardianEmail:'synthetic@example.com',guardianDesignated:true,mailConsent:true}));assert.equal(renewed!.status,201);
  f.db.sqlite.exec('UPDATE tower_residencies SET publication_epoch=1');assert.equal((await f.enroll())!.status,409);assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_offers WHERE id=?').get(old.id)!.state,'accepted');
  f.db.sqlite.exec('UPDATE tower_residencies SET publication_epoch=2');const current=f.db.sqlite.prepare('SELECT o.* FROM identity_offers o JOIN identity_offer_heads h ON h.offer_id=o.id').get()!,e=f.db.sqlite.prepare('SELECT * FROM identity_mail_events WHERE id=?').get(current.mail_event_id)!,p=JSON.parse(await decryptPrivate(key,'mail-payload',String(e.id),String(e.payload_ciphertext)));
  assert.equal((await f.offer.fetch(f.send('/api/v1/identity/offer/decision',{offerId:current.id,token:p.token,decision:'accept',expectedOfferDigest:current.offer_digest},'')))!.status,200);assert.equal((await f.enroll())!.status,201);
 }finally{f.close();}
});
