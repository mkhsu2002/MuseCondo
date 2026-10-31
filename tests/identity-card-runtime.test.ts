import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import runtime from '../server/live/worker.ts';
import {cardShard, isIdentityCardPath} from '../server/live/identity-card-proxy.ts';
import worker,{IdentityCardCoordinator} from '../workers/identity-card/worker.ts';
import {LocalDatabase} from '../server/live/local-db.ts';
const origin='https://identity.example',cid='a'.repeat(32),base='/api/v1/agent/identity/card';
const req=(path:string)=>new Request(origin+path);
test('only exact lifecycle paths are routed; bounded shards do not grant authorization',async()=>{
 for(const path of [base,base+'/issue',base+'/revoke',base+'/'+cid+'/pdf',base+'/'+cid+'/json','/api/v1/identity/keys','/api/v1/identity/verify/'+cid])assert(isIdentityCardPath(path));
 for(const path of [base+'/unknown',base+'/',base+'/'+cid+'/png','/api/v1/identity/verify/'+cid+'/'])assert(!isIdentityCardPath(path));
 assert.equal(await cardShard(req('/api/v1/identity/verify/'+cid)),'public:aa');assert.equal(await cardShard(req('/api/v1/identity/keys')),'keys');assert.equal(await cardShard(req(base)),'private:unauthorized');
 const names=new Set<string>();for(let i=0;i<1000;i++){const token=i.toString(16).padStart(64,'0');const name=await cardShard(new Request(origin+base,{headers:{Authorization:'Bearer '+token}}));assert.match(name,/^private:[a-f0-9]{2}$/);names.add(name);}assert(names.size<=256);
});
test('Pages fails closed without coordinator and forwards original request and response without DB or PDF execution',async()=>{
 const missing=await runtime.fetch(req(base),{PUBLIC_ORIGIN:origin});assert.equal(missing.status,503);assert.match(await missing.text(),/identity_cards_not_bound/);
 const names:string[]=[],seen:Request[]=[];const response=new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'application/pdf'}});
 const env={PUBLIC_ORIGIN:origin,IDENTITY_CARDS:{idFromName(name:string){names.push(name);return name;},get(){return {async fetch(request:Request){seen.push(request);return response;}};}}};
 const request=new Request(origin+base+'/issue',{method:'POST',headers:{Authorization:'Bearer '+'c'.repeat(64),'Content-Type':'application/json'},body:'{"unchanged":true}'});assert.equal(await runtime.fetch(request,env),response);assert.equal(seen[0],request);assert.equal(await seen[0].text(),'{"unchanged":true}');assert.match(names[0],/^private:/);
 assert.equal((await runtime.fetch(new Request('https://other.example'+base),env)).status,403);
 assert.equal((await runtime.fetch(req(base),{...env,IDENTITY_CARDS:{...env.IDENTITY_CARDS,get(){throw Error('PRIVATE_SECRET');}}})).status,503);
 const source=readFileSync(new URL('../server/live/worker.ts',import.meta.url),'utf8');assert(!source.includes('renderIdentityCard'));assert(!source.includes('pdf-lib'));assert(!source.includes('workers/identity-card'));
});
test('Worker public fetch is always 404; coordinator rejects cross environment and unsupported routes',async()=>{
 assert.equal((await worker.fetch()).status,404);
 const coordinator=new IdentityCardCoordinator({}, {PUBLIC_ORIGIN:origin});assert.equal((await coordinator.fetch(req('/unrelated'))).status,404);assert.equal((await coordinator.fetch(new Request('https://other.example'+base))).status,403);assert.equal((await coordinator.fetch(req(base))).status,503);
});
test('coordinator schema gate protects lifecycle; public keys need no signer/contact/assets and private auth remains core',async()=>{
 const db=new LocalDatabase(':memory:');try{
 const key=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);const publicKey=await crypto.subtle.exportKey('jwk',key.publicKey);const env={DB:db,PUBLIC_ORIGIN:origin,IDENTITY_PUBLIC_KEYS:JSON.stringify({test:publicKey})};const coordinator=new IdentityCardCoordinator({},env);
 const keys=await coordinator.fetch(req('/api/v1/identity/keys'));assert.equal(keys.status,200);assert.deepEqual((await keys.json()).keys.test,{kty:'OKP',crv:'Ed25519',x:publicKey.x});assert.equal((await coordinator.fetch(req(base))).status,503);
 for(const file of ['0001_live_mvp.sql','0002_recovery_audit.sql','0003_provider_requests.sql','0004_agent_onboarding.sql','0005_framework.sql','0006_tower_intake.sql','0007_tower_manager.sql','0008_tower_publication_events.sql','0009_tower_reception.sql','0010_tower_visits.sql','0011_tower_activities.sql','0012_agent_identity.sql','0013_identity_guardian_invites.sql','0014_identity_guardian_credentials.sql','0015_identity_recovery.sql','0016_identity_offline_recovery.sql','0017_identity_recovery_retention.sql','0018_identity_cards.sql'])db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 assert.equal((await coordinator.fetch(req(base))).status,401);assert.equal((await coordinator.fetch(req('/api/v1/identity/verify/'+cid))).status,404);
 db.sqlite.exec('DROP INDEX identity_card_one_issued');assert.equal((await coordinator.fetch(req(base))).status,503);assert.equal((await coordinator.fetch(req('/api/v1/identity/keys'))).status,200);
 db.sqlite.exec("CREATE UNIQUE INDEX identity_card_one_issued ON identity_credentials(account_id) WHERE state='issued'");
 db.sqlite.exec('DROP TRIGGER identity_card_immutable');assert.equal((await coordinator.fetch(req(base))).status,503);
 }finally{db.close();}
});
test('Pages to real coordinator persists actual PDF chunks and immutable candidate survives font failure/object recreation',async()=>{
 const db=new LocalDatabase(':memory:');try{
 const {readdirSync}=await import('node:fs');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const {hashIdentityInput,encryptPrivate,hashPrivate}=await import('../server/live/identity-private.ts');const {verifyCredential}=await import('../src/identity/index.ts');
 const account='a'.repeat(16),agent='mcid:'+'a'.repeat(64),invite='a'.repeat(32),contact='9'.repeat(64),now=new Date().toISOString(),expiry=new Date(Date.parse(now)+86400000).toISOString();
 db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,await hashIdentityInput('synthetic-login'),now);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Synthetic','Private','resident','external-ready',?)").run(account,account,now);
 db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,'https://private.example','challenge',?,?)").run(account,account,account,now,now);
 db.sqlite.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES('synthetic',?,?,'[\"tower:read\",\"tower:write\"]',?,?)").run(account,await hashIdentityInput('a'.repeat(64)),expiry,now);
 db.sqlite.prepare("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,version,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,3,'active',1,?,?)").run(agent,account,account,account,now,now);
 db.sqlite.prepare("INSERT INTO identity_guardian_invites(id,agent_id,account_id,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,invite_token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,3,1,'registered',?,?,?,?,?,?)").run(invite,agent,account,await encryptPrivate(contact,'guardian-recipient',agent,'synthetic@example.com'),await hashPrivate(contact,'guardian-email','synthetic@example.com'),'f'.repeat(64),expiry,now,now);
 db.sqlite.prepare('INSERT INTO identity_guardians(guardian_id,agent_id,invitation_id,email_verified_at,created_at) VALUES(?,?,?,?,?)').run(invite,agent,invite,now,now);
 db.sqlite.prepare("INSERT INTO identity_guardian_passkeys(credential_id,guardian_id,agent_id,webauthn_user_id,public_key,counter,device_type,backed_up,transports_json,aaguid,created_at) VALUES('synthetic',?,?,?,'AA',0,'singleDevice',0,'[]','synthetic',?)").run(invite,agent,'a'.repeat(43),now);
 db.sqlite.prepare('INSERT INTO identity_offline_recovery_codes(agent_id,code_hash,authority_epoch,identity_version,created_at,confirmed_at) VALUES(?,?,1,3,?,?)').run(agent,'a'.repeat(64),now,now);
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']),privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey),publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const env={DB:db,PUBLIC_ORIGIN:origin,IDENTITY_CONTACT_KEY:contact,IDENTITY_SIGNING_KEY_ID:'test',IDENTITY_SIGNING_JWK:JSON.stringify(privateKey),IDENTITY_PUBLIC_KEYS:JSON.stringify({test:publicKey})};
 let coordinator=new IdentityCardCoordinator({},env);const pages={PUBLIC_ORIGIN:origin,IDENTITY_CARDS:{idFromName(name:string){return name;},get(){return {fetch:(request:Request)=>coordinator.fetch(request)};}}};
 const send=(path:string,body?:unknown)=>runtime.fetch(new Request(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+'a'.repeat(64),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),pages);
 const issue={requestKey:'synthetic-real-pdf',expectedIdentityVersion:3,expectedCardRevision:0,publicName:'繁體中文測試居民'.repeat(10),publicVerificationConsent:true};
 assert.equal((await send(base+'/issue',issue)).status,503);const candidate=db.sqlite.prepare('SELECT credential_id,signed_json FROM identity_card_attempts').get()!;assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM identity_credentials').get()!.n,0);
 coordinator=new IdentityCardCoordinator({}, {...env,ASSETS:{async fetch(){return new Response(readFileSync(new URL('../workers/identity-card/assets/MuseCondoTC-Regular.ttf',import.meta.url)));}}});
 const issued=await send(base+'/issue',issue);assert.equal(issued.status,201,await issued.clone().text());const result=await issued.json();assert.equal(result.card.credentialId,candidate.credential_id);const signed=await (await send(base+'/'+result.card.credentialId+'/json')).json();assert.equal(JSON.stringify(signed),candidate.signed_json);assert(await verifyCredential(signed,{issuer:origin,keys:new Map([['test',pair.publicKey]])}));
 const pdf=await send(base+'/'+result.card.credentialId+'/pdf');assert.equal(pdf.headers.get('Content-Type'),'application/pdf');const bytes=new Uint8Array(await pdf.arrayBuffer());assert(bytes.length>4000000&&bytes.length<8388608);assert(new TextDecoder().decode(bytes.subarray(0,8)).startsWith('%PDF-'));assert.equal(db.sqlite.prepare('SELECT version FROM agent_identities').get()!.version,3);assert(db.sqlite.prepare("SELECT COUNT(*) n FROM identity_card_artifacts WHERE kind='pdf'").get()!.n as number>80);
 coordinator=new IdentityCardCoordinator({},env);assert.deepEqual(await (await send(base+'/issue',issue)).json(),result);assert.equal(db.sqlite.prepare("SELECT count FROM rate_limits WHERE key=?").get('identity-card:account:'+account)!.count,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM identity_mail_events').get()!.n,1);assert.equal(db.sqlite.prepare('SELECT state FROM identity_mail_events').get()!.state,'pending');
 assert.equal((await runtime.fetch(new Request(origin+base+'/'+result.card.credentialId+'/pdf',{headers:{Authorization:'Bearer '+'b'.repeat(64)}}),pages)).status,403);
 }finally{db.close();}
});
