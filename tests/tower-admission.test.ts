import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
const now='2026-10-31T00:00:00.000Z',account='a'.repeat(16),resident='b'.repeat(16),room='c'.repeat(16),source='https://source.example/condo.json';
function fixture(){
 const db=new LocalDatabase(':memory:');
 for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 db.sqlite.function('strftime',(_format,input)=>input==='now'?now:new Date(String(input)).toISOString());
 db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,'login',now);
 return db;
}
const token=(db:LocalDatabase,id='token')=>db.sqlite.prepare('INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?)').run(id,account,id,'["tower:read","tower:write"]','2027-01-01T00:00:00.000Z',now);
function decision(db:LocalDatabase,state='eligible',origin='meta-muse'){
 db.sqlite.prepare("INSERT INTO tower_admission_decisions(id,policy_version,case_id,account_id,resident_id,source_url,continuity_agent_id,state,agent_origin,evidence_kind,evidence_ref,operator_class,expires_at,created_at) VALUES(?,1,NULL,?,?,?,NULL,?,?,?,'opaque-evidence','shared-operator','2027-01-01T00:00:00.000Z',?)").run('d',account,resident,source,state,origin,state==='eligible'?'operator-review':'statement',now);
 db.sqlite.prepare('INSERT INTO tower_admission_heads(scope_key,decision_id,revision) VALUES(?,?,1)').run('account:'+account,'d');
}
test('official Muse policy is fail closed for every unreviewed account, including preexisting account rows',()=>{const db=fixture();try{assert.throws(()=>token(db),/admission_required/);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM tower_tokens').get()!.n,0);}finally{db.close();}});
test('pending and known non-Muse decisions cannot issue privileges',()=>{for(const [state,origin] of [['pending-evidence','unknown'],['ineligible','chatgpt-dot'],['eligible','chatgpt-dot']]){const db=fixture();try{decision(db,state,origin);assert.throws(()=>token(db),/admission_required/);}finally{db.close();}}});
test('reviewed exact source tuple supports only that first placement and model-independent continuity',()=>{const db=fixture();try{
 decision(db);token(db);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Synthetic','Synthetic','resident','external-ready',?)").run(room,account,now);
 assert.throws(()=>db.sqlite.prepare("INSERT INTO tower_claims(id,account_id,resident_id,source_url,challenge,expires_at,created_at) VALUES('wrong',?,?,?,'proof','2027-01-01T00:00:00.000Z',?)").run(account,resident,source+'/other',now),/admission_required/);
 db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'owner-attested',?,?)").run(room,account,resident,source,now,now);
 token(db,'second');
 db.sqlite.prepare('UPDATE tower_tokens SET revoked=1').run();
 db.sqlite.prepare("INSERT INTO tower_admission_policies VALUES(2,'[\"meta-muse\"]',1,?)").run(now);db.sqlite.prepare('UPDATE tower_admission_current SET policy_version=2').run();
 assert.throws(()=>token(db,'after-policy'),/admission_required/);
 assert.doesNotThrow(()=>db.sqlite.prepare('UPDATE rooms SET published=0').run());
 assert.doesNotThrow(()=>db.sqlite.prepare('UPDATE tower_tokens SET revoked=1').run());
}finally{db.close();}});
test('private operator review is durable, exact and does not trust applicant statements or leak evidence publicly',async()=>{
 const db=fixture();try{
 const {createTowerAdmission}=await import('../server/live/tower-admission.ts');
 const service=createTowerAdmission({db,origin:'https://tower.example',now:()=>new Date(now),operator:async r=>r.headers.get('X-Tower-Operator-Key')==='synthetic'});
 const body={requestKey:'review-00001',expectedPolicyVersion:1,expectedHeadRevision:0,caseId:null,accountId:account,residentId:resident,sourceURL:source,continuityAgentId:null,state:'eligible',agentOrigin:'meta-muse',evidenceKind:'operator-review',evidenceRef:'evidence:synthetic',expiresAt:'2027-01-01T00:00:00.000Z',existingResidency:null};
 const req=(v:unknown,key='synthetic')=>service.fetch(new Request('https://tower.example/api/v1/operator/tower-admission/decisions',{method:'POST',headers:{'X-Tower-Operator-Key':key,'Content-Type':'application/json',Origin:'https://tower.example'},body:JSON.stringify(v)}));
 assert.equal((await req(body,'wrong'))!.status,401);
 assert.equal((await req({...body,evidenceKind:'platform-attestation'}))!.status,400);
 assert.equal((await req({...body,evidenceKind:'statement'}))!.status,400);
 const first=(await req(body))!;assert.equal(first.status,201);const response=await first.json();
 assert.deepEqual(await(await req(body))!.json(),response);token(db);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM tower_admission_requests').get()!.n,1);
 const publicReply=(await service.fetch(new Request('https://tower.example/api/v1/tower/admission-policy')))!;
 assert.deepEqual(await publicReply.json(),{policy:{version:1,allowedAgentOrigins:['meta-muse'],requireOperatorReview:true}});
 assert.equal((await req({...body,evidenceRef:'other'}))!.status,409);
 const revoked=await req({...body,requestKey:'review-00002',expectedHeadRevision:1,state:'ineligible',agentOrigin:'chatgpt-dot'});assert.equal(revoked!.status,201);assert.throws(()=>token(db,'after-negative-review'),/admission_required/);
 assert.equal(db.sqlite.prepare('SELECT revision FROM tower_admission_heads').get()!.revision,2);
 }finally{db.close();}
});
test('native guards cover alternate minting, active registration, recovery epoch and card issue while permitting security revocation',()=>{
 const db=fixture();try{
 db.sqlite.prepare("INSERT INTO tower_admission_policies VALUES(2,'[\"*\"]',0,?)").run(now);db.sqlite.prepare('UPDATE tower_admission_current SET policy_version=2').run();
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Synthetic','Synthetic','resident','external-ready',?)").run(room,account,now);
 db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'owner-attested',?,?)").run(room,account,resident,source,now,now);
 const agent='mcid:'+'d'.repeat(64);
 db.sqlite.prepare("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,'provisional',1,?,?)").run(agent,account,room,resident,now,now);
 token(db);db.sqlite.prepare("INSERT INTO sessions VALUES('old-session',?,'csrf','2027-01-01T00:00:00.000Z')").run(account);
 db.sqlite.prepare("INSERT INTO tower_admission_policies VALUES(3,'[\"meta-muse\"]',1,?)").run(now);db.sqlite.prepare('UPDATE tower_admission_current SET policy_version=3').run();
 const denied:[string,unknown[]][]=[
 ["INSERT INTO sessions VALUES('new-session',?,'csrf','2027-01-01T00:00:00.000Z')",[account]],
 ["INSERT INTO onboarding_grants(id,account_id,token_hash,scopes,created_at,expires_at) VALUES('g',?,'hash','[]',?,'2027-01-01T00:00:00.000Z')",[account,now]],
 ["INSERT INTO agent_tokens(id,room_id,token_hash,scopes,created_at,expires_at) VALUES('g',?,'hash','[]',?,'2027-01-01T00:00:00.000Z')",[room,now]],
 ["UPDATE agent_identities SET state='active'",[]],
 ["UPDATE agent_identities SET authority_epoch=authority_epoch+1",[]],
 ["UPDATE rooms SET published=1",[]],
 ["UPDATE tower_residencies SET directory_consent=1",[]],
 ["INSERT INTO tower_snapshots VALUES(?,1,'{}','digest',?)",[room,now]],
 ["INSERT INTO identity_card_attempts VALUES(?,'request-key','issue',?,'{}',?, '{}',?)",[account,'e'.repeat(64),'f'.repeat(32),now]],
 ];
 for(const [sql,args] of denied)assert.throws(()=>db.sqlite.prepare(sql).run(...args as never[]),/admission_required/,sql);
 assert.doesNotThrow(()=>db.sqlite.prepare("UPDATE agent_identities SET state='suspended'").run());
 assert.doesNotThrow(()=>db.sqlite.prepare('UPDATE tower_tokens SET revoked=1').run());
 assert.doesNotThrow(()=>db.sqlite.prepare('DELETE FROM sessions').run());
 assert.doesNotThrow(()=>db.sqlite.prepare('UPDATE tower_residencies SET public_revision=NULL,directory_consent=0,announcement_consent=0,dream_consent=0,snapshot_consent=0').run());
 }finally{db.close();}
});
test('policy and private review history cannot be rolled back, rewritten or deleted',()=>{const db=fixture();try{
 decision(db);for(const table of ['tower_admission_policies','tower_admission_decisions']){assert.throws(()=>db.sqlite.exec('DELETE FROM '+table),/admission_history_immutable/);}
 assert.throws(()=>db.sqlite.exec("UPDATE tower_admission_decisions SET agent_origin='chatgpt-dot'"),/admission_history_immutable/);
 assert.throws(()=>db.sqlite.exec('DELETE FROM tower_admission_heads'),/admission_history_permanent/);
 assert.throws(()=>db.sqlite.exec('UPDATE tower_admission_current SET policy_version=1'),/admission_policy_version/);
 assert.throws(()=>db.sqlite.exec('DELETE FROM tower_admission_current'),/admission_history_permanent/);
}finally{db.close();}});
test('expired decisions and wrong continuity IDs never grant new authority',()=>{
 const db=fixture();try{decision(db);db.sqlite.function('strftime',(_format,input)=>input==='now'?'2027-01-01T00:00:00.000Z':new Date(String(input)).toISOString());assert.throws(()=>token(db),/admission_required/);}finally{db.close();}
 const other=fixture();try{assert.throws(()=>other.sqlite.prepare("INSERT INTO tower_admission_decisions(id,policy_version,account_id,resident_id,source_url,continuity_agent_id,state,agent_origin,evidence_kind,evidence_ref,operator_class,expires_at,created_at) VALUES('wrong',1,?,?,?,?,'eligible','meta-muse','operator-review','opaque','shared-operator','2027-01-01T00:00:00.000Z',?)").run(account,resident,source,'mcid:'+'f'.repeat(64),now),/admission_continuity_binding/);}finally{other.close();}
});
test('native rejection rolls back privileges, their audit and permanent success receipt together',async()=>{
 const db=fixture();try{
 await assert.rejects(db.batch([db.prepare("INSERT INTO tower_audit VALUES('audit',?,NULL,'synthetic',NULL,'{}',?)").bind(account,now),db.prepare("INSERT INTO tower_requests VALUES(?,'key','synthetic','hash','{}',?)").bind(account,now),db.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES('token',?,'hash','[]','2027-01-01T00:00:00.000Z',?)").bind(account,now)]),/admission_required/);
 for(const table of ['tower_audit','tower_requests','tower_tokens'])assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get()!.n,0);
 }finally{db.close();}
});
