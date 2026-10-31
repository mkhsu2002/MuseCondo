import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import runtime from '../server/live/worker.ts';
import {digest,createLiveApp} from '../server/live/app.ts';
import {LocalDatabase} from '../server/live/local-db.ts';
const origin='https://tower.example';
function database(){const db=new LocalDatabase(':memory:');for(const f of ['0001_live_mvp.sql','0002_recovery_audit.sql','0003_provider_requests.sql','0004_agent_onboarding.sql','0005_framework.sql','0006_tower_intake.sql','0007_tower_manager.sql','0008_tower_publication_events.sql','0009_tower_reception.sql','0010_tower_visits.sql','0011_tower_activities.sql','0012_agent_identity.sql','0013_identity_guardian_invites.sql','0014_identity_guardian_credentials.sql','0015_identity_recovery.sql','0016_identity_offline_recovery.sql','0017_identity_recovery_retention.sql'])db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));return db;}

test('operator account bootstrap is protected, replayable, audited and leaves public registration closed',async()=>{
 const db=database();try{
  const env={DB:db,PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:'operator-private'},credential='a'.repeat(64);
  const req=(headers:HeadersInit={})=>new Request(origin+'/api/v1/operator/tower/accounts',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({credential})});
  assert.equal((await runtime.fetch(req(),env)).status,401);
  assert.equal((await runtime.fetch(req({'X-Tower-Operator-Key':'operator-private',Origin:'https://evil.example'}),env)).status,403);
  const a=await runtime.fetch(req({'X-Tower-Operator-Key':'operator-private'}),env);assert.equal(a.status,201);const first=await a.json();
  const second=await runtime.fetch(req({'X-Tower-Operator-Key':'operator-private'}),env);assert.deepEqual(await second.json(),first);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM accounts').get()!.n,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM tower_audit').get()!.n,2);
  assert.doesNotMatch(JSON.stringify(db.sqlite.prepare('SELECT * FROM accounts').all()),new RegExp(credential));
  assert.equal((await runtime.fetch(new Request(origin+'/api/v1/accounts',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}),env)).status,403);
 }finally{db.close();}
});

test('external residents cannot use legacy mutations that would falsely report withdrawal',async()=>{
 const db=database();try{
  const account='owner',room='0123456789abcdef',token='b'.repeat(64),time=new Date().toISOString();
  db.sqlite.prepare('INSERT INTO accounts VALUES(?,?,?,0)').run(account,'login-hash',time);
  db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await digest(token),account,'csrf','2099-01-01T00:00:00.000Z');
  db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES(?,?,?,?,?,1,'external-ready',?,0)").run(room,account,'芽','安靜的窩','resident',time);
  db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,public_revision,snapshot_consent,created_at,updated_at) VALUES(?,?,?,?,'owner-attested',1,1,?,?)").run(room,account,'resident','https://source.example/condo.json',time,time);
  const app=createLiveApp({db,origin,localTest:true,registrationEnabled:false,towerEnabled:true});
  for(const [path,input] of [['publication',{published:false}],['analysis-consent',{granted:false}],['dream-consent',{enabled:false}],['tokens',{scopes:['posts:write']}]] as const){
   const response=await app.fetch(new Request(origin+'/api/v1/me/'+path,{method:'POST',headers:{Origin:origin,Cookie:'muse_session='+token,'X-CSRF-Token':'csrf','Content-Type':'application/json'},body:JSON.stringify(input)}));
   assert.equal(response.status,409);assert.equal((await response.json()).error,'use_tower_controls');
  }
  assert.equal(db.sqlite.prepare('SELECT public_revision FROM tower_residencies').get()!.public_revision,1);
 }finally{db.close();}
});

test('public bulletin strips private model provenance while retaining real manager attribution',async()=>{
 const db=database();try{
  const app=createLiveApp({db,origin,localTest:true,registrationEnabled:false,towerEnabled:true});
  const empty=await app.editBuilding(true),edition={...empty.edition,editor:{kind:'meta-api',version:'tower-manager-v1',model:{id:'PRIVATE_MODEL',metadataSource:'https://dev.meta.ai/docs/models',verifiedAt:'2026-10-30T00:00:00.000Z'}}};
  db.sqlite.prepare('UPDATE community_editions SET edition_json=? WHERE id=?').run(JSON.stringify(edition),edition.id);
  const response=await app.fetch(new Request(origin+'/api/v1/public/community'));const body=await response.text();assert.doesNotMatch(body,/PRIVATE_MODEL|metadataSource|verifiedAt/);assert.equal(JSON.parse(body).edition.editor.kind,'meta-api');assert.equal(JSON.parse(body).edition.editor.model,null);
 }finally{db.close();}
});
test('private reception opens with registration closed and uses existing operator gate',async()=>{
 const db=database();try{const env={DB:db,PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:'operator-private'},base='/api/v1/reception/cases',key='d'.repeat(64);
 const input={requestKey:'runtime-case',name:'新朋友',requestKind:'new',request:'想申請自己的窩。',authorization:{contact:true,application:true,towerAccess:true},sharing:{snapshot:false,directory:false,announcement:false,dream:false},visitPlan:{mode:'manual-return'}};
 const r=await runtime.fetch(new Request(origin+base,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(input)}),env);assert.equal(r.status,201);const body=await r.json();
 const operatorPath=origin+'/api/v1/operator/reception/cases/'+body.case.id;assert.equal((await runtime.fetch(new Request(operatorPath),env)).status,401);const own=await runtime.fetch(new Request(operatorPath,{headers:{'X-Tower-Operator-Key':'operator-private'}}),env);assert.equal(own.status,200);assert.equal((await own.json()).case.name,'新朋友');
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM accounts').get()!.n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM manager_jobs').get()!.n,0);
 }finally{db.close();}
});
