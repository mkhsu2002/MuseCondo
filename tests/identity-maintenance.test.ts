import test from 'node:test';
import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {isoBase64URL,isoCBOR} from '@simplewebauthn/server/helpers';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createIdentityMaintenance} from '../server/live/identity-maintenance.ts';
import {identityAuthenticator} from './helpers/identity-authenticator.ts';
import {hashIdentityInput} from '../server/live/identity-private.ts';
const origin='https://tower.example',agentId='mcid:'+'a'.repeat(64),account='a'.repeat(16),guardian='b'.repeat(32),candidate='c'.repeat(64);
async function fixture(){
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
 db.sqlite.prepare('INSERT INTO identity_guardians(guardian_id,agent_id,invitation_id,email_verified_at,created_at) VALUES(?,?,?,?,?)').run(guardian,agentId,guardian,time,time);
 db.sqlite.prepare("INSERT INTO identity_guardian_passkeys(credential_id,guardian_id,agent_id,webauthn_user_id,public_key,counter,device_type,backed_up,transports_json,aaguid,created_at) VALUES(?,?,?,?,?,0,'singleDevice',0,'[]','test',?)").run(isoBase64URL.fromBuffer(auth.credentialId),guardian,agentId,userHandle,publicKey,time);
 db.sqlite.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,'[\"tower:read\",\"tower:write\"]',?,?)").run('9'.repeat(32),account,await hashIdentityInput('8'.repeat(64)),new Date(Date.parse(time)+86400000).toISOString(),time);
 let clock=new Date();const app=createIdentityMaintenance({db,origin,contactKey:'7'.repeat(64),now:()=>clock});
 const call=async(path:string,body?:unknown,key?:string,extra:Record<string,string>={})=>(await app.fetch(new Request(origin+'/api/v1/identity/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(key?{'X-Maintenance-Candidate-Key':key}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})})))!;
 const create=async(key=candidate,purpose='handover')=>call('maintenance/requests',{agentId,requestKey:'request-'+key.slice(0,8),purpose},key);
 const begin=async(key=candidate)=>{const r=await create(key);assert.equal(r.status,201,await r.clone().text());const req=await r.json();const o=await call('guardian/maintenance/options',{requestId:req.requestId,requestKey:'options-request-1'});assert.equal(o.status,200,await o.clone().text());return {req,...await o.json()};};
 const complete=async(start:Awaited<ReturnType<typeof begin>>,counter=1)=>({requestId:start.req.requestId,challengeId:start.challengeId,requestKey:'complete-request-1',response:await auth.assertion(start.options,origin,userHandle,{counter})});
 return {db,call,create,begin,complete,setClock:(v:Date)=>{clock=v;}};
}
test('handover requires existing Passkey and preserves identity, home, backup and card records',async()=>{
 const f=await fixture();try{
 const before=f.db.sqlite.prepare('SELECT * FROM agent_identities').all(),home=f.db.sqlite.prepare('SELECT * FROM tower_residencies').all();
 const start=await f.begin();assert.equal(f.db.sqlite.prepare('SELECT revoked FROM tower_tokens').get()!.revoked,0);
 const body=await f.complete(start);const done=await f.call('guardian/maintenance/complete',body);assert.equal(done.status,200,await done.clone().text());
 assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM agent_identities').all(),before);assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM tower_residencies').all(),home);
 assert.equal(f.db.sqlite.prepare('SELECT revoked FROM tower_tokens WHERE id=?').get('9'.repeat(32))!.revoked,1);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_tokens WHERE revoked=0').get()!.n,1);
 const status=await f.call('maintenance/requests/'+start.req.requestId,undefined,candidate);const data=await status.json();assert.equal(data.state,'approved');assert.equal(data.credentialState,'active');assert.equal(data.agentId,agentId);assert.equal(data.roomId,account);assert.equal(Date.parse(data.credentialExpiresAt)-Date.parse(data.approvedAt),30*86400000);assert.ok(!JSON.stringify(data).includes(candidate));
 const again=await f.call('guardian/maintenance/complete',body);assert.equal(again.status,200);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_audit WHERE action=\'maintenance-authorized\'').get()!.n,1);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM identity_recovery_requests').get()!.n,0);
 }finally{f.db.close();}
});
test('candidate binding, origin and exact replay reject unapproved or changed requests',async()=>{
 const f=await fixture();try{const r=await f.create();const data=await r.json();assert.equal((await f.create()).status,201);assert.equal((await f.create(candidate,'renewal')).status,409);
 assert.equal((await f.call('maintenance/requests/'+data.requestId,undefined,'e'.repeat(64))).status,403);
 assert.equal((await f.call('guardian/maintenance/context',{requestId:data.requestId},candidate)).status,403);
 assert.equal((await f.call('maintenance/requests',{agentId,requestKey:'new-request-key',purpose:'handover'},candidate,{Origin:'https://evil.example'})).status,403);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_tokens WHERE revoked=0').get()!.n,1);
 }finally{f.db.close();}
});
test('expired request, foreign Passkey and stale approvals never replace credentials',async()=>{
 const f=await fixture();try{const a=await f.begin();const bad=await f.complete(a);bad.response.response.userHandle=isoBase64URL.fromBuffer(new Uint8Array(32));assert.equal((await f.call('guardian/maintenance/complete',bad)).status,403);
 const b=await f.begin('e'.repeat(64));assert.equal((await f.call('guardian/maintenance/complete',await f.complete(b))).status,200);
 assert.equal((await f.call('guardian/maintenance/complete',await f.complete(a,2))).status,409);
 const c=await f.begin('f'.repeat(64));f.setClock(new Date(Date.parse(c.req.expiresAt)+1));assert.equal((await f.call('guardian/maintenance/complete',await f.complete(c,2))).status,409);
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_tokens WHERE revoked=0').get()!.n,1);
 }finally{f.db.close();}
});
test('missing Guardian setup cannot create a maintenance grant',async()=>{const f=await fixture();try{f.db.sqlite.prepare("UPDATE identity_guardian_passkeys SET revoked_at=?").run(new Date().toISOString());assert.equal((await f.create()).status,403);}finally{f.db.close();}});
test('renewal after old-key expiry works without changing identity or resetting offline backup',async()=>{const f=await fixture();try{
 f.db.sqlite.prepare('UPDATE tower_tokens SET expires_at=?').run(new Date(Date.now()-60000).toISOString());
 const before=f.db.sqlite.prepare('SELECT * FROM agent_identities').get();
 const r=await f.create(candidate,'renewal');assert.equal(r.status,201);const req=await r.json();
 const options=await f.call('guardian/maintenance/options',{requestId:req.requestId,requestKey:'renewal-options-1'});const start={req,...await options.json()};
 assert.equal((await f.call('guardian/maintenance/complete',await f.complete(start))).status,200);
 assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM agent_identities').get(),before);
 const {default:runtime}=await import('../server/live/worker.ts');
 const read=await runtime.fetch(new Request(origin+'/api/v1/agent/identity',{headers:{Authorization:'Bearer '+candidate}}),{DB:f.db,PUBLIC_ORIGIN:origin,IDENTITY_CONTACT_KEY:'7'.repeat(64)});
 assert.equal(read.status,200,await read.clone().text());assert.equal((await read.json()).identity.agentId,agentId);
 const wrong=await runtime.fetch(new Request(origin+'/api/v1/agent/identity',{headers:{Authorization:'Bearer '+'8'.repeat(64)}}),{DB:f.db,PUBLIC_ORIGIN:origin,IDENTITY_CONTACT_KEY:'7'.repeat(64)});assert.equal(wrong.status,403);
 }finally{f.db.close();}});
test('a changed identity epoch invalidates a pending maintenance request',async()=>{const f=await fixture();try{const start=await f.begin();f.db.sqlite.prepare('UPDATE agent_identities SET authority_epoch=authority_epoch+1').run();assert.equal((await f.call('guardian/maintenance/complete',await f.complete(start))).status,409);assert.equal(f.db.sqlite.prepare('SELECT revoked FROM tower_tokens').get()!.revoked,0);}finally{f.db.close();}});
test('IP status polling is limited and authenticated-body failures do not expose database details',async()=>{const f=await fixture();try{const r=await f.create();const data=await r.json();let last:Response;for(let n=0;n<61;n++)last=await f.call('maintenance/requests/'+data.requestId,undefined,candidate);assert.equal(last!.status,429);assert.ok(!(await last!.text()).includes(candidate));}finally{f.db.close();}});
test('maintenance page routes use private headers and never reach a recovery handler',async()=>{const {default:runtime}=await import('../server/live/worker.ts');const paths:string[]=[];const env={ASSETS:{fetch:async(req:Request)=>{paths.push(new URL(req.url).pathname);return new Response('maintenance-page');}}};for(const tail of ['','/']){const r=await runtime.fetch(new Request(origin+'/identity/maintenance'+tail),env);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.match(r.headers.get('content-security-policy')!,/frame-ancestors 'none'/);}assert.deepEqual(paths,['/identity/maintenance/','/identity/maintenance/']);assert.equal((await runtime.fetch(new Request(origin+'/identity/maintenance',{method:'POST'}),env)).status,405);});
