import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';import {LocalDatabase} from '../server/live/local-db.ts';
import runtime from '../server/live/worker.ts';import {createManagerRoutes} from '../server/live/tower-manager-routes.ts';import {HALLOWEEN_2026} from '../server/live/tower-appearance.ts';
const origin='https://tower.example';
function database(){const db=new LocalDatabase(':memory:');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));return db;}
test('Pages dispatch protects appearance and schedule independently, public projection exposes only safe fields',async()=>{
 const db=database();const env={DB:db,PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:'synthetic-operator',MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic-schedule'};
 const post=(path:string,key:string,body:unknown,header='X-Tower-Operator-Key')=>new Request(origin+path,{method:'POST',headers:{[header]:key,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
 assert.equal((await runtime.fetch(post('/api/v1/operator/manager/appearance','wrong',{}),env)).status,401);
 assert.equal((await runtime.fetch(post('/api/v1/manager/run-due','synthetic-operator',{}),env)).status,401);
 db.sqlite.function('strftime',{varargs:true},()=>'2026-10-31T20:00:00.000Z');const auth=async()=>true,routes=createManagerRoutes({db,origin,operator:auth,scheduleAuthorized:async()=>false,now:()=>new Date('2026-10-31T20:00:00Z')});
 const command={action:'preview',requestKey:'preview-halloween-01',theme:'halloween',...HALLOWEEN_2026};
 let response=await routes.fetch(post('/api/v1/operator/manager/appearance','',command));assert.equal(response!.status,201);
 response=await routes.fetch(post('/api/v1/operator/manager/appearance','',{action:'activate',requestKey:'activate-halloween-01',previewKey:command.requestKey,expectedRevision:0}));assert.equal(response!.status,201);
 response=await routes.fetch(new Request(origin+'/api/v1/tower/appearance'));assert.deepEqual(Object.keys(await response!.json()).sort(),['endsAt','revision','theme']);
 for(const headers of [{Cookie:'session=x'},{Origin:'https://evil.example'},{'Sec-Fetch-Site':'cross-site'}] as Record<string,string>[])assert.equal((await routes.fetch(new Request(origin+'/api/v1/operator/manager/appearance',{headers})))!.status,403);
 assert.equal((await routes.fetch(post('/api/v1/operator/manager/appearance','',{...command,html:'<script>'})))!.status,400);
 assert.equal((await routes.fetch(post('/api/v1/operator/manager/appearance','',{x:'a'.repeat(3000)})))!.status,413);
 const scheduled=await runtime.fetch(post('/api/v1/manager/run-due','synthetic-schedule',{scheduledTime:new Date().toISOString()},'X-Manager-Schedule-Key'),env);assert.equal(scheduled.status,200);
 assert.equal((await runtime.fetch(new Request(origin+'/api/v1/operator/manager/schedule'),env)).status,401);
 db.sqlite.exec('DROP TRIGGER tower_appearance_audit_immutable_update');assert.equal((await routes.fetch(new Request(origin+'/api/v1/tower/appearance')))!.status,503);
 }finally{db.close();}
});
