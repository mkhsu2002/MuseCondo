import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createTowerWeeklyServices,createTowerWeeklyRoutes} from '../server/live/tower-weekly-routes.ts';
const origin='https://tower.example';
function database(){const db=new LocalDatabase(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+f,'utf8'));return db;}
test('daily publication runs independently when weekly and all providers are disabled',async()=>{
 const db=database(),at='2026-11-03T21:00:00.000Z';try{db.sqlite.function('strftime',(format,source)=>{assert.equal(format,'%Y-%m-%dT%H:%M:%fZ');assert.equal(source,'now');return at;});let calls=0;const services=createTowerWeeklyServices({db,origin,now:()=>new Date(at),TOWER_DAILY_JOURNALS_ENABLED:'true',fetcher:async()=>{calls++;throw Error('provider forbidden');}});const result=await services.runDue(new Date(at));assert.equal(result.daily.state,'published');assert.equal(result.weekly,'disabled');assert.equal(calls,0);assert.deepEqual((await services.daily.getLatest())?.items,[]);assert.equal((await services.runDue(new Date(at))).daily.state,'already_complete');}finally{db.close();}
});
test('journal public endpoint serves an empty edition envelope without private authorization',async()=>{
 const db=database();try{const services=createTowerWeeklyServices({db,origin,TOWER_DAILY_JOURNALS_ENABLED:'true'}),handler=createTowerWeeklyRoutes({origin,services,operator:async()=>false,scheduled:async()=>false});const response=await handler(new Request(origin+'/api/v1/public/tower-journals'));assert.equal(response?.status,200);assert.deepEqual(await response!.json(),{edition:null});assert.equal(response!.headers.get('Cache-Control'),'no-store');assert.equal((await handler(new Request(origin+'/api/v1/public/tower-journals',{method:'POST'})))?.status,405);}finally{db.close();}
});
test('an inaugural issue can use an approved cover before the ten-image wall is complete',async()=>{
 const db=database();try{let coverChecks=0;const services=createTowerWeeklyServices({db,origin,TOWER_WEEKLY_ENABLED:'true',approved:true,apiKey:'synthetic',budgetMicro:1000000,dailyBudgetMicro:1000000,monthlyBudgetMicro:1000000,contactKey:'a'.repeat(64),TOWER_PUBLICATION_LORD_RECIPIENT:'owner@example.com'});services.scenes.canonicalPublished=async()=>3;services.scenes.ensureWeekly=async()=>{coverChecks++;return null;};assert.equal(await services.inaugural(),null);assert.equal(coverChecks,1);}finally{db.close();}
});
