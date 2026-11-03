import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/tower-manager/worker.ts';
test('private Worker queues publication tasks on a separate object only after schedule authorization',async()=>{
 let calls=0,name='';const env={PUBLIC_ORIGIN:'https://tower.example',MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic-trigger',MANAGER_CLOCK:{idFromName(id:string){name=id;return id;},get(){return {async fetch(request:Request){calls++;assert.equal(new URL(request.url).pathname,'/publications/queue');return Response.json({queued:true});}};}}};
 const url='https://manager.internal/publications/wake',body=JSON.stringify({tasks:[{id:'inaugural',kind:'inaugural'}]});
 assert.equal((await worker.fetch(new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body}),env)).status,401);assert.equal(calls,0);
 assert.equal((await worker.fetch(new Request(url,{method:'POST',headers:{'Content-Type':'application/json','X-Manager-Schedule-Key':'synthetic-trigger'},body}),env)).status,200);assert.equal(calls,1);assert.equal(name,'tower-publications');
});
test('scene generation and public publications use independent native queues',async()=>{
 const names:string[]=[],groups:{kind:string}[][]=[];const env={PUBLIC_ORIGIN:'https://tower.example',MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic-trigger',MANAGER_CLOCK:{idFromName(name:string){names.push(name);return name;},get(){return {async fetch(request:Request){groups.push((await request.json() as {tasks:{kind:string}[]}).tasks);return Response.json({queued:true});}};}}};
 const response=await worker.fetch(new Request('https://manager.internal/publications/wake',{method:'POST',headers:{'Content-Type':'application/json','X-Manager-Schedule-Key':'synthetic-trigger'},body:JSON.stringify({tasks:[{id:'inaugural',kind:'inaugural'},{id:'seed-v1-03',kind:'scene',sceneKey:'reading-lounge',batchId:'initial-v1-1'}]})}),env);assert.equal(response.status,200);assert.deepEqual(new Set(names),new Set(['tower-scenes','tower-publications']));assert.equal(groups.length,2);assert.ok(groups.every(g=>g.every(t=>['scene','repair'].includes(t.kind))||g.every(t=>!['scene','repair'].includes(t.kind))));
});
