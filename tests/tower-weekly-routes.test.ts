import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createTowerWeeklyServices,createTowerWeeklyRoutes} from '../server/live/tower-weekly-routes.ts';
import {LocalDatabase} from '../server/live/local-db.ts';
const origin='https://tower.example';
test('weekly operator and schedule authorization precede any database/provider work',async()=>{
 let touched=0;const db={prepare(){touched++;throw Error('private read');},async batch(){touched++;return [];}};
 const service=createTowerWeeklyServices({db,origin});const handler=createTowerWeeklyRoutes({origin,services:service,operator:async()=>false,scheduled:async()=>false});
 for(const path of ['/api/v1/operator/tower-weekly','/api/v1/manager/publications/run-due']){const response=await handler(new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"inaugural"}'}));assert.equal(response?.status,401);}
 assert.equal(touched,0);
});
test('weekly public reads are empty and side-effect free until an issue is actually published',async()=>{
 const db=new LocalDatabase(':memory:');try{for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+f,'utf8'));
 const services=createTowerWeeklyServices({db,origin});const handler=createTowerWeeklyRoutes({origin,services,operator:async()=>true,scheduled:async()=>true});const response=await handler(new Request(origin+'/api/v1/public/tower-weekly'));assert.equal(response?.status,200);assert.deepEqual(await response!.json(),{issues:[],nextBefore:null});assert.equal(db.sqlite.prepare('SELECT count(*) n FROM manager_jobs').get()!.n,0);
 const refused=await handler(new Request(origin+'/api/v1/operator/tower-weekly',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"inaugural"}'}));assert.equal(refused?.status,503);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM tower_weekly_jobs').get()!.n,0);
 }finally{db.close();}
});
test('native scene tasks cannot expand fixed seed identities or start batch two early',async()=>{
 const db=new LocalDatabase(':memory:');try{for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+f,'utf8'));const services=createTowerWeeklyServices({db,origin,TOWER_SCENES_ENABLED:'true',approved:true,apiKey:'synthetic',budgetMicro:1000000,dailyBudgetMicro:1000000,monthlyBudgetMicro:1000000,bucket:{async put(){},async get(){return null;}},assets:{async fetch(){return new Response('bad reference');}}});
 for(const task of [{id:'seed-v1-00',kind:'scene' as const,sceneKey:'arrival-court',batchId:'initial-v1-1'},{id:'seed-v1-01',kind:'scene' as const,sceneKey:'reading-lounge',batchId:'initial-v1-1'},{id:'seed-v1-06',kind:'scene' as const,sceneKey:'rooftop-telescope',batchId:'initial-v1-2'}])await assert.rejects(services.step(task),/invalid_scene_task|previous_batch_not_published|scene_style_approval_required/);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM tower_scenes').get()!.n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM manager_jobs').get()!.n,0);
 }finally{db.close();}
});
test('an inaugural job already holding a valid lease remains pending without another paid request',async()=>{
 const db=new LocalDatabase(':memory:');try{for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+f,'utf8'));const at=new Date().toISOString(),lease=new Date(Date.now()+120000).toISOString();db.sqlite.prepare("INSERT INTO manager_jobs(id,source_digest,state,created_at,started_at,reserved_micro) VALUES('weekly:inaugural','weekly:inaugural','running',?,?,10000)").run(at,at);db.sqlite.prepare("INSERT INTO tower_weekly_jobs(id,period_key,period_start,cutoff_at,recipient_hash,inaugural,created_at,lease_until) VALUES('weekly:inaugural','inaugural',?,?,?,1,?,?)").run(new Date(Date.now()-86400000).toISOString(),at,'a'.repeat(64),at,lease);
 let calls=0;const services=createTowerWeeklyServices({db,origin,approved:true,apiKey:'synthetic',contactKey:'a'.repeat(64),TOWER_WEEKLY_ENABLED:'true',TOWER_PUBLICATION_LORD_RECIPIENT:'owner@example.test',budgetMicro:1000000,dailyBudgetMicro:1000000,monthlyBudgetMicro:1000000,fetcher:async()=>{calls++;throw Error('must not dispatch');}});const result=await services.step({id:'inaugural',kind:'inaugural'});assert.equal(result.pending,true);assert.equal(calls,0);
 }finally{db.close();}
});

test('public archive rejects ambiguous cursors and returns a bounded latest envelope',async()=>{
 const db=new LocalDatabase(':memory:');try{for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+f,'utf8'));const handler=createTowerWeeklyRoutes({origin,services:createTowerWeeklyServices({db,origin}),operator:async()=>false,scheduled:async()=>false});
 for(const query of ['before=0','before=-1','before=01','before=2&before=3','before=Infinity','before=9007199254740992'])assert.equal((await handler(new Request(origin+'/api/v1/public/tower-weekly?'+query)))?.status,400);
 const response=await handler(new Request(origin+'/api/v1/public/tower-weekly?latest=1'));assert.deepEqual(await response!.json(),{issues:[],nextBefore:null});
 }finally{db.close();}
});
