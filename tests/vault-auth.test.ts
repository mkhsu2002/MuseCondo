import test from 'node:test';
import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {isoBase64URL,isoCBOR} from '@simplewebauthn/server/helpers';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createVaultAuthorization} from '../server/live/vault-auth.ts';
import {createPrivateVaultStore} from '../server/live/vault-store.ts';
import {identityAuthenticator} from './helpers/identity-authenticator.ts';
import {hashIdentityInput} from '../server/live/identity-private.ts';
const origin='https://tower.example',agentId='mcid:'+'a'.repeat(64),account='a'.repeat(16),guardian='b'.repeat(32),candidate='c'.repeat(64);
async function fixture(registered=true){
 const db=new LocalDatabase(':memory:');
 for(const n of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 openSyntheticTower(db);
 const time=new Date().toISOString(),auth=await identityAuthenticator(),userHandle=isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(32))),jwk=await crypto.subtle.exportKey('jwk',auth.keys.publicKey);
 const publicKey=isoBase64URL.fromBuffer(isoCBOR.encode(new Map<number,number|Uint8Array>([[1,2],[3,-7],[-1,1],[-2,isoBase64URL.toBuffer(jwk.x!)],[-3,isoBase64URL.toBuffer(jwk.y!)]])));
 db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,await hashIdentityInput('d'.repeat(64)),time);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Synthetic home','Private','resident','external-ready',?)").run(account,account,time);
 db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,'https://source.example/condo.json','challenge',?,?)").run(account,account,account,time,time);
 db.sqlite.prepare("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,'active',1,?,?)").run(agentId,account,account,account,time,time);
 db.sqlite.prepare("INSERT INTO identity_guardian_invites(id,agent_id,account_id,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,invite_token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,1,1,'registered','private',?,?,?, ?,?)").run(guardian,agentId,account,'e'.repeat(64),'f'.repeat(64),new Date(Date.parse(time)+86400000).toISOString(),time,time);
 const register=()=>{
 db.sqlite.prepare('INSERT INTO identity_guardians(guardian_id,agent_id,invitation_id,email_verified_at,created_at) VALUES(?,?,?,?,?)').run(guardian,agentId,guardian,time,time);
 db.sqlite.prepare("INSERT INTO identity_guardian_passkeys(credential_id,guardian_id,agent_id,webauthn_user_id,public_key,counter,device_type,backed_up,transports_json,aaguid,created_at) VALUES(?,?,?,?,?,0,'singleDevice',0,'[]','test',?)").run(isoBase64URL.fromBuffer(auth.credentialId),guardian,agentId,userHandle,publicKey,time);
 };if(registered)register();
 db.sqlite.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,'[\"tower:read\",\"tower:write\"]',?,?)").run('9'.repeat(32),account,await hashIdentityInput('8'.repeat(64)),new Date(Date.parse(time)+86400000).toISOString(),time);
 let clock=new Date();const app=createVaultAuthorization({db,origin,contactKey:'7'.repeat(64),now:()=>clock});
 const call=async(path:string,body?:unknown,key?:string,extra:Record<string,string>={})=>(await app.fetch(new Request(origin+'/api/v1/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(key?{'X-Vault-Candidate-Key':key}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})})))!;
 const create=async(key=candidate)=>call('vault/requests',{agentId,requestKey:'request-'+key.slice(0,8),scopes:['vault:read','vault:write']},key);
 const begin=async(key=candidate)=>{const r=await create(key);assert.equal(r.status,201,await r.clone().text());const req=await r.json();const o=await call('identity/guardian/vault/options',{requestId:req.requestId,requestKey:'options-request-1'});assert.equal(o.status,200,await o.clone().text());return {req,...await o.json()};};
 const complete=async(start:Awaited<ReturnType<typeof begin>>,counter=1)=>({requestId:start.req.requestId,challengeId:start.challengeId,requestKey:'complete-request-1',response:await auth.assertion(start.options,origin,userHandle,{counter})});
 const approve=async(key=candidate,counter=1)=>{const start=await begin(key);const body=await complete(start,counter);const r=await call('identity/guardian/vault/complete',body);assert.equal(r.status,200,await r.clone().text());return {start,body};};
 const claim=async(id:string,key=candidate)=>call('vault/requests/'+id+'/claim',{requestKey:'claim-request-1'},key);
 const bearer=(key=candidate)=>new Request(origin+'/api/v1/agent/vault/files',{headers:{Authorization:'Bearer '+key}});
 return {db,app,auth,userHandle,register,call,create,begin,complete,approve,claim,bearer,setClock:(v:Date)=>{clock=v;}};
}
test('real synthetic UV approval and same-key claim yield a vault-only grant, preserving all Tower authority',async()=>{
 const f=await fixture();try{
  const identities=f.db.sqlite.prepare('SELECT * FROM agent_identities').all(),tokens=f.db.sqlite.prepare('SELECT * FROM tower_tokens').all();
  const {start,body}=await f.approve();assert.equal((await f.app.fetch(f.bearer()))===null,true);
  await assert.rejects(f.app.authenticate(f.bearer(),'vault:read'));
  assert.equal((await f.claim(start.req.requestId)).status,200);
  const access=await f.app.authenticate(f.bearer(),'vault:read');assert.equal(access.roomId,account);await f.db.batch([await access.guard()]);
  const data=await (await f.call('vault/requests/'+start.req.requestId,undefined,candidate)).json();assert.equal(data.state,'claimed');assert.equal(data.nextActor,'agent');assert.equal(data.nextAction,'use-vault');assert.equal(Date.parse(data.credentialExpiresAt)-Date.parse(data.claimedAt),30*86400000);assert.ok(!JSON.stringify(data).includes(candidate));
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM agent_identities').all(),identities);assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM tower_tokens').all(),tokens);
  assert.equal((await f.call('identity/guardian/vault/complete',body)).status,200);assert.equal((await f.claim(start.req.requestId)).status,200);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM vault_grants').get()!.n,1);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_audit WHERE action=\'vault-access-approved\'').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM identity_recovery_requests').get()!.n,0);
 }finally{f.db.close();}
});
test('Guardian registration can finish before the same candidate resumes, without recovery or a new key',async()=>{
 const f=await fixture(false);try{
  const r=await f.create();assert.equal(r.status,201);const req=await r.json();assert.equal(req.state,'waiting-for-guardian');assert.equal(Date.parse(req.expiresAt)-Date.now()>23*3600000,true);assert.equal(req.registrationURL,origin+'/identity');
  const resume={requestKey:'resume-request-1'};assert.equal((await f.call('vault/requests/'+req.requestId+'/resume',resume,candidate)).status,403);
  f.register();const waiting=await (await f.call('vault/requests/'+req.requestId,undefined,candidate)).json();assert.equal(waiting.nextActor,'agent');assert.equal(waiting.nextAction,'resume-with-saved-candidate-key');const resumed=await f.call('vault/requests/'+req.requestId+'/resume',resume,candidate);assert.equal(resumed.status,200,await resumed.clone().text());assert.equal((await resumed.json()).state,'pending');assert.equal((await f.call('vault/requests/'+req.requestId+'/resume',resume,candidate)).status,200);
  const options=await f.call('identity/guardian/vault/options',{requestId:req.requestId,requestKey:'options-request-1'});const start={req,...await options.json()};assert.equal((await f.call('identity/guardian/vault/complete',await f.complete(start))).status,200);assert.equal((await f.claim(req.requestId)).status,200);await f.app.authenticate(f.bearer(),'vault:write');
 }finally{f.db.close();}
});
test('missing UV, foreign key, wrong challenge, wrong origin and user handle cannot approve',async()=>{
 const f=await fixture();try{
  const start=await f.begin();for(const overrides of [{flags:1},{challenge:isoBase64URL.fromBuffer(new Uint8Array(32))}]){const body=await f.complete(start);body.response=await f.auth.assertion(start.options,origin,f.userHandle,{counter:1,...overrides});assert.equal((await f.call('identity/guardian/vault/complete',body)).status,403);}
  const wrongHandle=await f.complete(start);wrongHandle.response.response.userHandle=isoBase64URL.fromBuffer(new Uint8Array(32));assert.equal((await f.call('identity/guardian/vault/complete',wrongHandle)).status,403);
  const foreign=await identityAuthenticator();const bad=await f.complete(start);bad.response=await foreign.assertion(start.options,origin,f.userHandle,{counter:1});assert.equal((await f.call('identity/guardian/vault/complete',bad)).status,403);
  const wrongOrigin=await f.complete(start);wrongOrigin.response=await f.auth.assertion(start.options,'https://evil.example',f.userHandle,{counter:1});assert.equal((await f.call('identity/guardian/vault/complete',wrongOrigin)).status,403);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM vault_grants').get()!.n,0);
 }finally{f.db.close();}
});
test('request proof, exact bodies, scopes and separate origins/authentication fail closed',async()=>{
 const f=await fixture();try{
  const data=await (await f.create()).json();assert.equal((await f.create()).status,201);
  assert.equal((await f.call('vault/requests/'+data.requestId,undefined,'e'.repeat(64))).status,403);
  assert.equal((await f.call('identity/guardian/vault/context',{requestId:data.requestId},candidate)).status,403);
  for(const extra of ([{Origin:'https://evil.example'},{Cookie:'x=1'},{Authorization:'Bearer '+candidate},{'X-Maintenance-Candidate-Key':candidate}] as Record<string,string>[]))assert.equal((await f.call('vault/requests',{agentId,requestKey:'request-cccccccc',scopes:['vault:read','vault:write']},candidate,extra)).status,403);
  assert.equal((await f.call('vault/requests',{agentId,requestKey:'new-request-1',scopes:['tower:write']},'e'.repeat(64))).status,400);
  assert.equal((await f.call('vault/requests',{agentId,requestKey:'new-request-1',scopes:['vault:read','vault:write'],extra:true},'e'.repeat(64))).status,400);
  assert.equal((await f.call('vault/requests/'+data.requestId+'/claim',{requestKey:'claim-request-1'},candidate)).status,403);
  assert.equal((await f.call('vault/requests',{agentId:'mcid:'+'b'.repeat(64),requestKey:'new-request-1',scopes:['vault:read','vault:write']},'e'.repeat(64))).status,403);
 }finally{f.db.close();}
});
test('daily grants survive ordinary identity version and Passkey counter changes, but a new claim revokes only old vault access',async()=>{
 const f=await fixture();try{
  const a=await f.approve();await f.claim(a.start.req.requestId);f.db.sqlite.prepare('UPDATE agent_identities SET version=version+1').run();f.db.sqlite.prepare('UPDATE identity_guardian_passkeys SET counter=counter+1').run();await f.app.authenticate(f.bearer(),'vault:read');
  const b=await f.approve('e'.repeat(64),3);await f.claim(b.start.req.requestId,'e'.repeat(64));await assert.rejects(f.app.authenticate(f.bearer(),'vault:read'));await f.app.authenticate(f.bearer('e'.repeat(64)),'vault:write');
  assert.equal((await (await f.claim(a.start.req.requestId)).json()).state,'revoked');await assert.rejects(f.app.authenticate(f.bearer(),'vault:read'));assert.equal(f.db.sqlite.prepare('SELECT revoked FROM tower_tokens').get()!.revoked,0);
 }finally{f.db.close();}
});
test('approval freezes identity version, epoch and current Guardian; expiry never grants credentials',async()=>{
 for(const sql of ['UPDATE agent_identities SET version=version+1','UPDATE agent_identities SET authority_epoch=authority_epoch+1','UPDATE identity_guardians SET version=version+1']){
  const f=await fixture();try{const s=await f.begin();f.db.sqlite.exec(sql);assert.equal((await f.call('identity/guardian/vault/complete',await f.complete(s))).status,409);assert.equal(f.db.sqlite.prepare('SELECT counter FROM identity_guardian_passkeys').get()!.counter,0);}finally{f.db.close();}
 }
 const f=await fixture();try{const s=await f.begin();f.setClock(new Date(Date.parse(s.expiresAt)+1));assert.equal((await f.call('identity/guardian/vault/complete',await f.complete(s))).status,409);}finally{f.db.close();}
});
test('every captured DB guard rejects revoked passkey/epoch/Guardian/maintenance/state and expired grants',async()=>{
 for(const sql of ["UPDATE identity_guardian_passkeys SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",'UPDATE agent_identities SET authority_epoch=authority_epoch+1','UPDATE identity_guardians SET version=version+1',"INSERT INTO maintenance_authorities(account_id,version) VALUES('"+account+"',1)","UPDATE agent_identities SET state='suspended'","UPDATE vault_grants SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"]){
  const f=await fixture();try{const a=await f.approve();await f.claim(a.start.req.requestId);const access=await f.app.authenticate(f.bearer(),'vault:read');const pending=await access.guard();f.db.sqlite.exec(sql);await assert.rejects(f.db.batch([pending]));await assert.rejects(access.guard(),{status:403});await assert.rejects(f.app.authenticate(f.bearer(),'vault:read'));}finally{f.db.close();}
 }
 const f=await fixture();try{const a=await f.approve();await f.claim(a.start.req.requestId);const data=await (await f.call('vault/requests/'+a.start.req.requestId,undefined,candidate)).json();f.setClock(new Date(Date.parse(data.credentialExpiresAt)+1));await assert.rejects(f.app.authenticate(f.bearer(),'vault:read'));}finally{f.db.close();}
});
test('two concurrent signed approvals use counter CAS and consumed challenge, with no partial audit',async()=>{
 const f=await fixture();try{
  const a=await f.begin(),b=await f.begin('e'.repeat(64));const responses=await Promise.all([f.call('identity/guardian/vault/complete',await f.complete(a)),f.call('identity/guardian/vault/complete',await f.complete(b))]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM vault_authorization_requests WHERE state=\'approved\'').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_audit WHERE action=\'vault-access-approved\'').get()!.n,1);
 }finally{f.db.close();}
});
test('dedicated bearer self-revocation and safe response headers leave stored files and Tower credentials alone',async()=>{
 const f=await fixture();try{const a=await f.approve();await f.claim(a.start.req.requestId);const status=await f.call('agent/vault/status',undefined,undefined,{Authorization:'Bearer '+candidate});assert.equal(status.status,200);for(const [name,value] of [['cache-control','no-store'],['referrer-policy','no-referrer'],['x-content-type-options','nosniff']])assert.equal(status.headers.get(name),value);assert.equal((await f.call('agent/vault/revoke',{},undefined,{Authorization:'Bearer '+candidate})).status,200);await assert.rejects(f.app.authenticate(f.bearer(),'vault:write'));assert.equal(f.db.sqlite.prepare('SELECT revoked FROM tower_tokens').get()!.revoked,0);}finally{f.db.close();}
});
test('waiting setup and approved claim windows expire without silently renewing authority',async()=>{
 const f=await fixture(false);try{const r=await (await f.create()).json();f.setClock(new Date(Date.parse(r.expiresAt)+1));f.register();assert.equal((await (await f.call('vault/requests/'+r.requestId,undefined,candidate)).json()).state,'expired');assert.equal((await f.call('vault/requests/'+r.requestId+'/resume',{requestKey:'resume-request-1'},candidate)).status,409);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM vault_grants').get()!.n,0);}finally{f.db.close();}
 const g=await fixture();try{const a=await g.approve();g.setClock(new Date(Date.parse(a.start.req.expiresAt)+1));assert.equal((await g.claim(a.start.req.requestId)).status,409);assert.equal(g.db.sqlite.prepare('SELECT COUNT(*) n FROM vault_grants').get()!.n,0);}finally{g.db.close();}
});
test('original approval Passkey revocation rejects claim even when another current Passkey remains',async()=>{
 const f=await fixture();try{const a=await f.approve();const p=f.db.sqlite.prepare('SELECT * FROM identity_guardian_passkeys').get()!;f.db.sqlite.prepare("INSERT INTO identity_guardian_passkeys(credential_id,guardian_id,agent_id,webauthn_user_id,public_key,counter,device_type,backed_up,transports_json,aaguid,created_at) VALUES('ZQ',?,?,?,?,0,'singleDevice',0,'[]','test',?)").run(p.guardian_id,p.agent_id,'Z'.repeat(43),p.public_key,p.created_at);f.db.sqlite.prepare("UPDATE identity_guardian_passkeys SET revoked_at=? WHERE credential_id=?").run(new Date().toISOString(),p.credential_id);assert.equal((await (await f.call('vault/requests/'+a.start.req.requestId,undefined,candidate)).json()).state,'authorization-changed');assert.equal((await f.claim(a.start.req.requestId)).status,409);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM vault_grants').get()!.n,0);}finally{f.db.close();}
});
test('concurrent same-key claims create one grant and one audit; exact retry resolves the saved result',async()=>{
 const f=await fixture();try{const a=await f.approve();const results=await Promise.all([f.claim(a.start.req.requestId),f.claim(a.start.req.requestId)]);assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));assert.equal((await f.claim(a.start.req.requestId)).status,200);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM vault_grants').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_audit WHERE action=\'vault-access-claimed\'').get()!.n,1);}finally{f.db.close();}
});
test('authorization guard aborts a whole store batch, and revoked status explains a new approval',async()=>{
 const f=await fixture();try{const a=await f.approve();await f.claim(a.start.req.requestId);const access=await f.app.authenticate(f.bearer(),'vault:write'),guard=await access.guard();f.db.sqlite.exec('CREATE TABLE synthetic_private_write(value TEXT)');f.db.sqlite.prepare('UPDATE agent_identities SET authority_epoch=authority_epoch+1').run();await assert.rejects(f.db.batch([f.db.prepare("INSERT INTO synthetic_private_write VALUES('never commit')"),guard]));assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM synthetic_private_write').get()!.n,0);const status=await f.call('agent/vault/status',undefined,undefined,{Authorization:'Bearer '+candidate});assert.equal(status.status,403);assert.deepEqual(await status.json(),{error:'vault_access_rejected',state:'authorization-changed',nextActor:'agent',nextAction:'create-new-authorization-request',startURL:origin+'/vault/start',guideURL:origin+'/vault-guide.md'});}finally{f.db.close();}
});
test('existing Tower credentials cannot become vault candidates or authenticate as vault grants',async()=>{
 const f=await fixture();try{assert.equal((await f.create('8'.repeat(64))).status,409);await assert.rejects(f.app.authenticate(f.bearer('8'.repeat(64)),'vault:read'));const a=await f.approve();await f.claim(a.start.req.requestId);for(const headers of ([{Authorization:'Bearer '+candidate,Cookie:'muse_session=x'},{Authorization:'Bearer '+candidate,Origin:'https://evil.example'},{Authorization:'Bearer '+candidate,'X-Vault-Candidate-Key':candidate}] as Record<string,string>[]))await assert.rejects(f.app.authenticate(new Request(origin+'/api/v1/agent/vault/files',{headers}),'vault:read'));}finally{f.db.close();}
});
test('status and revoke recheck commit-time revocation and return actionable 403 instead of a request-status dead end',async()=>{
 for(const operation of ['status','revoke']){
  const f=await fixture();try{
   const a=await f.approve();await f.claim(a.start.req.requestId);
   const original=f.db.batch.bind(f.db);let inject=true;
   f.db.batch=async statements=>{if(inject){inject=false;f.db.sqlite.prepare('UPDATE vault_grants SET revoked_at=? WHERE revoked_at IS NULL').run(new Date().toISOString());}return original(statements);};
   const response=await f.call('agent/vault/'+operation,operation==='revoke'?{}:undefined,undefined,{Authorization:'Bearer '+candidate});
   assert.equal(response.status,403,await response.clone().text());const value=await response.json();assert.equal(value.error,'vault_access_rejected');assert.equal(value.state,'revoked');assert.equal(value.nextActor,'agent');assert.equal(value.nextAction,'create-new-authorization-request');assert.equal(value.guideURL,origin+'/vault-guide.md');assert.ok(!JSON.stringify(value).includes(candidate));
   assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_audit WHERE action='vault-access-revoked'").get()!.n,0);
  }finally{f.db.close();}
 }
});
test('Guardian UV revokes only the original claimed grant; replay cannot revoke a newer grant or touch files and Tower authority',async()=>{
 const f=await fixture();try{
  const a=await f.approve();await f.claim(a.start.req.requestId);const store=createPrivateVaultStore({db:f.db,key:'6'.repeat(64)});await store.put(await f.app.authenticate(f.bearer(),'vault:write'),{path:'SOUL.md',content:'Synthetic retained private text',expectedRevision:0,requestKey:'retained-file-1'});const files=f.db.sqlite.prepare('SELECT * FROM agent_private_vault_documents').all();const tokens=f.db.sqlite.prepare('SELECT * FROM tower_tokens').all(),identity=f.db.sqlite.prepare('SELECT * FROM agent_identities').all();
  const context=await (await f.call('identity/guardian/vault/context',{requestId:a.start.req.requestId})).json();assert.equal(context.state,'claimed');assert.equal(context.grantState,'active');
  const options=await f.call('identity/guardian/vault/revoke/options',{requestId:a.start.req.requestId,requestKey:'revoke-options-1'});assert.equal(options.status,200,await options.clone().text());const start={req:a.start.req,...await options.json()},body=await f.complete(start,2);body.requestKey='revoke-complete-1';
  const p=f.db.sqlite.prepare('SELECT * FROM identity_guardian_passkeys').get()!;const done=await f.call('identity/guardian/vault/revoke/complete',body);assert.equal(done.status,200,await done.clone().text());assert.equal((await done.json()).state,'revoked');await assert.rejects(f.app.authenticate(f.bearer(),'vault:read'));
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM tower_tokens').all(),tokens);assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM agent_identities').all(),identity);assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM agent_private_vault_documents').all(),files);assert.equal(f.db.sqlite.prepare('SELECT revoked_at FROM identity_guardian_passkeys WHERE credential_id=?').get(p.credential_id)!.revoked_at,null);
  const b=await f.approve('e'.repeat(64),3);await f.claim(b.start.req.requestId,'e'.repeat(64));assert.equal((await f.call('identity/guardian/vault/revoke/complete',body)).status,200);assert.equal((await store.get(await f.app.authenticate(f.bearer('e'.repeat(64)),'vault:read'),'SOUL.md')).content,'Synthetic retained private text');assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_audit WHERE action='vault-access-guardian-revoked'").get()!.n,1);
 }finally{f.db.close();}
});
test('Guardian revoke challenges reject approval-purpose swaps and expired assertions without revocation',async()=>{
 const f=await fixture();try{
  const a=await f.approve();await f.claim(a.start.req.requestId);assert.equal((await f.call('identity/guardian/vault/revoke/complete',a.body)).status,403);
  const options=await f.call('identity/guardian/vault/revoke/options',{requestId:a.start.req.requestId,requestKey:'revoke-options-1'});const start={req:a.start.req,...await options.json()},body=await f.complete(start,2);assert.equal((await f.call('identity/guardian/vault/complete',body)).status,403);await f.app.authenticate(f.bearer(),'vault:read');
  f.setClock(new Date(Date.parse(start.expiresAt)+1));assert.equal((await f.call('identity/guardian/vault/revoke/complete',body)).status,409);assert.equal(f.db.sqlite.prepare('SELECT revoked_at FROM vault_grants').get()!.revoked_at,null);
 }finally{f.db.close();}
});
