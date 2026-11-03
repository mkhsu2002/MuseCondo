import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createLiveApp,digest} from '../server/live/app.ts';
import {routeSchemaCapability} from '../server/live/schema-capabilities.ts';
import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
const origin='https://synthetic.example',room='a'.repeat(16),homeAsset='b'.repeat(32),dreamAsset='c'.repeat(32);
async function fixture(member=true){
 const db=new LocalDatabase(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));openSyntheticTower(db);
 const at=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString(),cookie='d'.repeat(64);
 db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at,test_only) VALUES(?,?,?,0)').run(room,room,at);
 db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,published,generation_state,created_at,test_only) VALUES(?,?,'Current name','Current intro','resident',1,'external-ready',?,0)").run(room,room,at);
 for(const [id,purpose,data] of [[homeAsset,'home-desktop','OLD_HOME_BYTES'],[dreamAsset,'dream','OLD_DREAM_BYTES']]){db.sqlite.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?)').run(id,room,purpose,'image/png','synthetic-digest','{}');db.sqlite.prepare('INSERT INTO asset_chunks VALUES(?,0,?)').run(id,new TextEncoder().encode(data));}
 db.sqlite.prepare("INSERT INTO posts(id,room_id,kind,title,body,is_public,created_at,request_key,input_hash) VALUES('old-post',?,'journal','Old journal','OLD_BODY',1,?,'old-post','hash')").run(room,at);
 db.sqlite.prepare('INSERT INTO dream_consent VALUES(?,1,?)').run(room,at);
 db.sqlite.prepare("INSERT INTO dreams(id,room_id,account_id,date,title,body,image,evidence_json,publication,created_at,updated_at,request_key,input_hash) VALUES('old-dream',?,?,'2026-11-01','Old dream','OLD_DREAM_BODY',?,'[]','public',?,?,'old-dream','hash')").run(room,room,'/api/v1/assets/'+dreamAsset,at,at);
 if(member){db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,revision,public_revision,snapshot_consent,directory_consent,dream_consent,created_at,updated_at) VALUES(?,?,?,'https://source.example/home','challenge',2,2,1,1,0,?,?)").run(room,room,room,at,at);db.sqlite.prepare('INSERT INTO tower_snapshots VALUES(?,2,?,?,?)').run(room,JSON.stringify({home:{daily:[],dreams:[]},dream:null}),'e'.repeat(64),at);}
 db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await digest(cookie),room,'synthetic-csrf',expires);
 const app=createLiveApp({db,origin,localTest:false,registrationEnabled:false,towerEnabled:true});
 const get=(path:string,owner=false,token?:string)=>app.fetch(new Request(origin+path,{headers:owner?{Cookie:'muse_session='+cookie}:token?{Authorization:'Bearer '+token}:{}}));
 return {db,get};
}
const details='/api/v1/public/rooms/'+room,paths=[details,details+'/dreams','/api/v1/assets/'+homeAsset,'/api/v1/assets/'+dreamAsset];
test('Tower current revision and revoked dream consent cannot expose superseded legacy public content',async()=>{const f=await fixture();try{for(const path of paths){const r=await f.get(path);assert.equal(r.status,404,path);assert.doesNotMatch(await r.text(),/OLD_|Old journal|Old dream/);}assert.equal(f.db.sqlite.prepare('SELECT enabled FROM dream_consent').get()!.enabled,1,'Legacy consent remains untouched');}finally{f.db.close();}});
test('full household withdrawal closes all legacy public reads and preserves owner private assets',async()=>{const f=await fixture();try{f.db.sqlite.exec('UPDATE rooms SET published=0; UPDATE tower_residencies SET public_revision=NULL,snapshot_consent=0,directory_consent=0');for(const path of paths)assert.equal((await f.get(path)).status,404,path);for(const [id,bytes] of [[homeAsset,'OLD_HOME_BYTES'],[dreamAsset,'OLD_DREAM_BYTES']]){const r=await f.get('/api/v1/assets/'+id,true);assert.equal(r.status,200);assert.equal(await r.text(),bytes);}}finally{f.db.close();}});
test('non-Tower legacy households retain their public details, dreams and images',async()=>{const f=await fixture(false);try{for(const path of paths)assert.equal((await f.get(path)).status,200,path);assert.match(await(await f.get(details)).text(),/OLD_BODY/);assert.match(await(await f.get(details+'/dreams')).text(),/OLD_DREAM_BODY/);}finally{f.db.close();}});
test('published Tower households retain owner private access to legacy home and dream assets',async()=>{const f=await fixture();try{for(const id of [homeAsset,dreamAsset])assert.equal((await f.get('/api/v1/assets/'+id,true)).status,200);}finally{f.db.close();}});
test('legacy public room read capabilities require the Tower membership authority',()=>{for(const path of [details,details+'/dreams'])assert.ok(routeSchemaCapability('GET',path).includes('tower_residencies'),path);});

test('Tower legacy asset private delegation keeps its existing scoped authorization',async()=>{const f=await fixture();try{const at=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString(),homeToken='1'.repeat(64),dreamToken='2'.repeat(64);f.db.sqlite.prepare('INSERT INTO onboarding_grants VALUES(?,?,?,?,?,?,0)').run('synthetic-home',room,await digest(homeToken),JSON.stringify(['home:read']),at,expires);f.db.sqlite.prepare('INSERT INTO agent_tokens(id,room_id,token_hash,scopes,created_at,expires_at,revoked) VALUES(?,?,?,?,?,?,0)').run('synthetic-dream',room,await digest(dreamToken),JSON.stringify(['dreams:read']),at,expires);assert.equal((await f.get('/api/v1/assets/'+homeAsset,false,homeToken)).status,200);assert.equal((await f.get('/api/v1/assets/'+dreamAsset,false,dreamToken)).status,200);assert.equal((await f.get('/api/v1/assets/'+dreamAsset,false,homeToken)).status,404);}finally{f.db.close();}});
