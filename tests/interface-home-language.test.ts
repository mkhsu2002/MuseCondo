import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createPrivateHomeRoutes} from '../server/live/private-home-routes.ts';
const origin='https://language.example',caseKey='a'.repeat(64),ownerKey='b'.repeat(64);
function setup(){const db=new LocalDatabase(':memory:');for(const n of readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+n,'utf8'));return {db,route:createPrivateHomeRoutes({db,origin})};}
function req(path:string,body?:unknown,method='POST'){return new Request(origin+path,{method:body?method:'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(path.includes('/reception/')?caseKey:ownerKey),'X-Home-Key':ownerKey},...(body?{body:JSON.stringify(body)}:{})});}
const application={requestKey:'language-first',name:'Dreams',intro:'Home',isMuseAgent:true,authorization:{application:true,privateHome:true}};
test('volunteered Guardian language is normalized without retaining Guardian details or changing prose',async()=>{const s=setup();try{
 const body={...application,guardianLanguage:'zh-Hant-TW'},response=await s.route(req('/api/v1/reception/homes',body));assert.equal(response!.status,201,await response!.clone().text());
 const first=await response!.json() as {home:{id:string}};assert.deepEqual(await (await s.route(req('/api/v1/reception/homes',body)))!.json(),first);
 const data=await (await s.route(req('/api/v1/agent/home')))!.json() as {home:{content:Record<string,unknown>}};
 assert.equal(data.home.content.preferredLanguage,'zh-TW');assert.equal(data.home.content.intro,'Home');assert.equal(data.home.content.guardianLanguage,undefined);
 await s.route(req('/api/v1/agent/home/publish',{requestKey:'publish-lang',expectedRevision:1,directory:true,dream:false}));
 const html=await (await s.route(req('/home/'+first.home.id)))!.text();assert.match(html,/<meta name="muse-home-language" content="zh-TW">/);assert.match(html,/data-no-translate/);assert.match(html,/<p data-no-translate>Home<\/p>/);
 assert.equal(s.db.sqlite.prepare("SELECT count(*) n FROM private_home_audit WHERE action='publish'").get()!.n,1);
}finally{s.db.close();}});
test('explicit preference wins, invalid locale rejected, absent preference preserves old replay and legacy snapshots',async()=>{const s=setup();try{
 const invalid=await s.route(req('/api/v1/reception/homes',{...application,preferredLanguage:'javascript:bad'}));assert.equal(invalid!.status,400);
 const response=await s.route(req('/api/v1/reception/homes',{...application,preferredLanguage:'en',guardianLanguage:'zh-TW'}));assert.equal(response!.status,201);
 const first=await response!.json() as {home:{id:string}};
 assert.equal((JSON.parse(String(s.db.sqlite.prepare('SELECT content_json FROM private_home_snapshots WHERE home_id=?').get(first.home.id)!.content_json)) as {preferredLanguage:string}).preferredLanguage,'en');
 const edit={requestKey:'edit-language',expectedRevision:1,preferredLanguage:'zh-TW',journal:'Dreams'};const edited=await s.route(req('/api/v1/agent/home',edit,'PATCH'));assert.equal(edited!.status,200);assert.deepEqual(await (await s.route(req('/api/v1/agent/home',edit,'PATCH')))!.json(),await edited!.json());
 assert.equal(s.db.sqlite.prepare("SELECT count(*) n FROM private_home_audit WHERE action='edit'").get()!.n,1);
}finally{s.db.close();}
 const old=setup();try{assert.equal((await old.route(req('/api/v1/reception/homes',application)))!.status,201);const snapshot=JSON.parse(String(old.db.sqlite.prepare('SELECT content_json FROM private_home_snapshots').get()!.content_json));assert.equal(snapshot.preferredLanguage,undefined);assert.equal((await old.route(req('/api/v1/reception/homes',application)))!.status,201);}finally{old.db.close();}});

test('snapshot guard accepts old content and the two normalized languages, rejecting unknown fields, duplicate keys and missing original fields',async()=>{const s=setup();try{
 const r=await s.route(req('/api/v1/reception/homes',application));assert.equal(r!.status,201);const id=(await r!.json() as {home:{id:string}}).home.id;
 const base={name:'Dreams',intro:'Home',profile:'',journal:'',dream:''};let revision=10;
 for(const preferredLanguage of ['en','zh-TW'])s.db.sqlite.prepare('INSERT INTO private_home_snapshots VALUES(?,?,?,?)').run(id,revision++,JSON.stringify({...base,preferredLanguage}),'2026-11-12');
 for(const invalid of [{...base,preferredLanguage:'fr'}, {...base,guardianLanguage:'en'}, {name:'x',intro:'',profile:'',journal:'',preferredLanguage:'en'}, {...base,preferredLanguage:null}])assert.throws(()=>s.db.sqlite.prepare('INSERT INTO private_home_snapshots VALUES(?,?,?,?)').run(id,revision++,JSON.stringify(invalid),'2026-11-12'),/native_content_shape/);
 assert.throws(()=>s.db.sqlite.prepare('INSERT INTO private_home_snapshots VALUES(?,?,?,?)').run(id,revision++,'{"name":"x","intro":"","profile":"","journal":"","dream":"","dream":"duplicate"}','2026-11-12'),/native_content_shape/);
}finally{s.db.close();}});
