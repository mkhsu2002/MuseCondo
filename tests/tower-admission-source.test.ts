import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createTowerIntake} from '../server/live/tower-intake.ts';
import {CONDO_PROFILE_FIELDS} from '../src/framework/condo.ts';

const time='2026-10-31T00:00:00.000Z',account='a'.repeat(16),resident='b'.repeat(16),room='c'.repeat(16);
const agent='mcid:'+'d'.repeat(64),original='https://original.example/condo.json',moved='https://moved.example/condo.json';
function fixture(enroll=true){
 const db=new LocalDatabase(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 db.sqlite.function('strftime',(_format,input)=>input==='now'?time:new Date(String(input)).toISOString());
 db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,'synthetic',time);
 db.sqlite.prepare("INSERT INTO tower_admission_decisions(id,policy_version,account_id,resident_id,source_url,state,agent_origin,evidence_kind,evidence_ref,operator_class,expires_at,created_at) VALUES('original',1,?,?,?,'eligible','meta-muse','operator-review','synthetic','shared-operator','2027-01-01T00:00:00.000Z',?)").run(account,resident,original,time);
 db.sqlite.prepare("INSERT INTO tower_admission_heads VALUES(?,'original',1)").run('account:'+account);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Synthetic','Synthetic','resident','external-ready',?)").run(room,account,time);
 db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)").run(room,account,resident,original,time,time);
 if(enroll)db.sqlite.prepare('INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').run(agent,account,room,resident,time,time);
 return db;
}
function claim(db:LocalDatabase,id:string,target=moved,who=resident){
 db.sqlite.prepare("INSERT INTO tower_claims(id,account_id,resident_id,source_url,challenge,expires_at,created_at) VALUES(?,?,?,?,?,'2027-01-01T00:00:00.000Z',?)").run(id,account,who,target,'synthetic-proof-'+id,time);
}
const move=(db:LocalDatabase,target=moved)=>db.sqlite.prepare('UPDATE tower_residencies SET source_url=? WHERE room_id=?').run(target,room);
const mint=(db:LocalDatabase)=>db.sqlite.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES('after-move',?,'hash','[]','2027-01-01T00:00:00.000Z',?)").run(account,time);

test('permanent Muse identity survives two verified source moves without changing home, membership or qualification',()=>{
 const db=fixture();try{
  const membership=db.sqlite.prepare('SELECT * FROM tower_admission_memberships').get();
  for(const [id,target] of [['first',moved],['second','https://again.example/condo.json']]){
   claim(db,id,target);db.sqlite.prepare('UPDATE tower_claims SET verified=1 WHERE id=?').run(id);move(db,target);
   assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM tower_admission_eligible').get()!.n,1);
   assert.equal(db.sqlite.prepare('SELECT agent_id FROM agent_identities').get()!.agent_id,agent);
   assert.deepEqual(db.sqlite.prepare('SELECT * FROM tower_admission_memberships').get(),membership);
  }
  assert.doesNotThrow(()=>mint(db));
 }finally{db.close();}
});
test('source moves require permanent continuity and a current verified same-resident claim',()=>{
 for(const mode of ['unenrolled','missing','unverified','expired','wrong-resident']){
  const db=fixture(mode!=='unenrolled');try{
   if(mode==='unenrolled')assert.throws(()=>claim(db,'candidate'),/admission_required/);
   else if(mode==='wrong-resident')assert.throws(()=>claim(db,'candidate',moved,'e'.repeat(16)),/admission_required/);
   else if(mode!=='missing'){
    claim(db,'candidate');
    if(mode==='expired'){
     db.sqlite.prepare('UPDATE tower_claims SET verified=1').run();
     db.sqlite.function('strftime',(_format,input)=>input==='now'?'2027-01-01T00:00:00.000Z':new Date(String(input)).toISOString());
    }
   }
   assert.throws(()=>move(db),/admission_(?:required|source_proof)/,mode);
   assert.equal(db.sqlite.prepare('SELECT source_url FROM tower_residencies').get()!.source_url,original);
  }finally{db.close();}
 }
});
test('a location change cannot bypass expired, negative or changed-policy Muse qualifications',()=>{
 for(const mode of ['expired','negative','policy']){
  const db=fixture();try{
   claim(db,'candidate');db.sqlite.prepare('UPDATE tower_claims SET verified=1').run();move(db);
   if(mode==='expired')db.sqlite.function('strftime',(_format,input)=>input==='now'?'2027-01-01T00:00:00.000Z':new Date(String(input)).toISOString());
   if(mode==='policy'){db.sqlite.prepare("INSERT INTO tower_admission_policies VALUES(2,'[\"meta-muse\"]',1,?)").run(time);db.sqlite.exec('UPDATE tower_admission_current SET policy_version=2');}
   if(mode==='negative'){
    db.sqlite.prepare("INSERT INTO tower_admission_decisions(id,policy_version,account_id,resident_id,source_url,continuity_agent_id,state,agent_origin,evidence_kind,evidence_ref,operator_class,expires_at,created_at) VALUES('negative',1,?,?,?,?,'ineligible','chatgpt-dot','operator-review','synthetic','shared-operator','2027-01-01T00:00:00.000Z',?)").run(account,resident,moved,agent,time);
    db.sqlite.prepare("UPDATE tower_admission_heads SET decision_id='negative',revision=2").run();
   }
   assert.throws(()=>mint(db),/admission_required/,mode);
  }finally{db.close();}
 }
});

test('the actual strict-policy prepare, challenge and move APIs preserve identity and exact permanent replay',async()=>{
 const db=fixture();try{
  const origin='https://tower.example',cookie='f'.repeat(64);
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cookie))).toString('hex');
  db.sqlite.prepare("INSERT INTO sessions VALUES(?,?,'csrf','2027-01-01T00:00:00.000Z')").run(hash,account);
  const remoteClaims=new Map<string,unknown>();
  const site={templateVersion:'muse-condo-1',example:false,home:{frameworkVersion:'0.01',id:resident,name:'合成居民',intro:'合成介紹',assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[],dreams:[]},homeAlt:'合成住所',profile:Object.fromEntries(CONDO_PROFILE_FIELDS.map(k=>[k,'合成資料'])),dream:null};
  const tower=createTowerIntake({db,origin,localTest:true,sourceOrigins:['https://moved.example'],now:()=>new Date(time),fetcher:async(input)=>{
   const url=String(input);if(remoteClaims.has(url))return Response.json(remoteClaims.get(url));
   if(url===moved)return Response.json(site);return new Response(null,{status:404});
  }});
  const request=async(path:string,input:unknown)=>{
   const response=(await tower.fetch(new Request(origin+'/api/v1/me/tower-intake'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:'muse_session='+cookie,'X-CSRF-Token':'csrf'},body:JSON.stringify(input)})))!;
   return {status:response.status,value:await response.json()};
  };
  const prepared=await request('/prepare',{sourceURL:moved,residentId:resident,requestKey:'prepare-moved-source'});
  assert.equal(prepared.status,201,JSON.stringify(prepared.value));
  remoteClaims.set(prepared.value.claimURL,prepared.value.claim);
  assert.equal((await request('/claim',{claimId:prepared.value.claimId})).status,200);
  const input={expectedRevision:1,requestKey:'move-permanent-home',sourceURL:moved,claimId:prepared.value.claimId};
  const membership=db.sqlite.prepare('SELECT * FROM tower_admission_memberships').get();
  const first=await request('/source',input);assert.equal(first.status,200,JSON.stringify(first.value));
  assert.equal(first.value.intake.sourceURL,moved);
  assert.deepEqual(await request('/source',input),first);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM tower_audit WHERE action=\'resident-source-moved\'').get()!.n,1);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM tower_admission_memberships').get(),membership);
  assert.equal(db.sqlite.prepare('SELECT agent_id FROM agent_identities').get()!.agent_id,agent);
  assert.doesNotThrow(()=>mint(db));
 }finally{db.close();}
});
