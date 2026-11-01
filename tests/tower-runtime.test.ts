import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import runtime from '../server/live/worker.ts';
import {digest,createLiveApp} from '../server/live/app.ts';
import {LocalDatabase} from '../server/live/local-db.ts';
const origin='https://tower.example';
function database(){const db=new LocalDatabase(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));openSyntheticTower(db);return db;}

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
test('public editorial reasons are English without rewriting a legacy edition or resident source digest',async()=>{
 const db=database();try{
  const time='2026-10-30T00:00:00.000Z',room='0123456789abcdef';let changed=0;
  db.sqlite.prepare('INSERT INTO accounts VALUES(?,?,?,0)').run('resident-account','login-hash',time);
  db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES(?,?,?,?,?,1,'complete',?,0)").run(room,'resident-account','方','  我的原始小日子。  ','resident',time);
  const app=createLiveApp({db,origin,localTest:true,registrationEnabled:false,towerEnabled:true,onCommunityChanged:async()=>{changed++;}});
  const first=await app.editBuilding(true),legacy=structuredClone(first.edition);
  legacy.editor.version='public-community-four-sections-v1';legacy.sections.arrivals[0].reason='已刊登的舊中文理由';
  const stored=JSON.stringify(legacy);db.sqlite.prepare('UPDATE community_editions SET edition_json=? WHERE id=?').run(stored,legacy.id);
  const body=await (await app.fetch(new Request(origin+'/api/v1/public/community'))).json();
  assert.equal(body.edition.sections.arrivals[0].reason,'Welcoming a new neighbor');
  assert.equal(body.edition.sections.arrivals[0].summary,'  我的原始小日子。  ');assert.equal(body.edition.sourceDigest,first.edition.sourceDigest);
  assert.equal(body.events[0].title,'方 has moved in');assert.equal(db.sqlite.prepare('SELECT edition_json FROM community_editions WHERE id=?').get(legacy.id)!.edition_json,stored);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM community_editions').get()!.n,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM manager_jobs').get()!.n,0);assert.equal(changed,1);
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

test('existing published arrival source bytes stay fixed while an unseen arrival defaults to English',async()=>{
 const db=database();try{const time='2026-10-30T00:00:00.000Z',id='0123456789abcdef';db.sqlite.prepare('INSERT INTO accounts VALUES(?,?,?,0)').run('original-account','hash-old',time);db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES(?,?,?,?,?,1,'complete',?,0)").run(id,'original-account','方','原來的日常。','resident',time);let changed=0;const app=createLiveApp({db,origin,localTest:true,registrationEnabled:false,towerEnabled:true,onCommunityChanged:async()=>{changed++;}}),initial=await app.editBuilding(true),file=JSON.parse(String(db.sqlite.prepare('SELECT events_json FROM community_editions').get()!.events_json)),edition=structuredClone(initial.edition);file.events[0].title='方搬來了';file.sourceDigest=await digest(JSON.stringify(file.events));edition.sourceDigest=file.sourceDigest;const historicalFile=JSON.stringify(file),historicalEdition=JSON.stringify(edition);db.sqlite.prepare('UPDATE community_editions SET events_json=?,edition_json=?').run(historicalFile,historicalEdition);const beforeChanged=changed,preserved=await app.editBuilding(true);assert.equal(preserved.events[0].title,'方搬來了');assert.equal(preserved.edition.sourceDigest,file.sourceDigest);assert.equal(changed,beforeChanged);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM community_editions').get()!.n,1);
 db.sqlite.prepare('INSERT INTO accounts VALUES(?,?,?,0)').run('new-account','hash-new',time);db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES(?,?,?,?,?,1,'complete',?,0)").run('fedcba9876543210','new-account','新鄰居','自己的文字。','resident',time);const next=await app.editBuilding(true);assert.equal(next.events.find(e=>e.residentId===id)!.title,'方搬來了');assert.equal(next.events.find(e=>e.residentId==='fedcba9876543210')!.title,'新鄰居 has moved in');assert.equal(next.events.find(e=>e.residentId===id)!.body,'原來的日常。');assert.equal(db.sqlite.prepare('SELECT events_json FROM community_editions WHERE id=?').get(edition.id)!.events_json,historicalFile);assert.equal(db.sqlite.prepare('SELECT edition_json FROM community_editions WHERE id=?').get(edition.id)!.edition_json,historicalEdition);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM manager_jobs').get()!.n,0);
 }finally{db.close();}
});
