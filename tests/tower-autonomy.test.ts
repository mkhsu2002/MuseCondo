import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createManagerAutonomy,type AssetBucket} from '../server/live/tower-autonomy.ts';
function database(){const db=new LocalDatabase(':memory:');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));return db;}
const clock=()=>new Date('2026-10-31T19:00:00.000Z');
const bucket:AssetBucket={async put(){},async get(){return null;}};
function textResponse(value:unknown){return Response.json({id:crypto.randomUUID(),model:'muse-spark-1.3',status:'completed',usage:{input_tokens:120,output_tokens:200},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});}
test('first standing mandate wakes today; empty community still thinks, independently audits and selfreviews once',async()=>{
 const db=database();const calls:Record<string,unknown>[]=[];let wakes=0;
 const transport:typeof fetch=async(_url,init)=>{if(String(_url).endsWith('/input_tokens'))return Response.json({input_tokens:120});const payload=JSON.parse(String(init?.body));calls.push(payload);if(calls.length===1)return textResponse({kind:'noop',purpose:'今日保持一般外觀',acceptance:['確認公開投影可用'],budgetMicro:1000000,permissions:['read-public-health'],reason:'沒有適合更動的項目',dayPrompt:'',nightPrompt:''});if(calls.length===2)return textResponse({verdict:'PASS',reason:'已檢查無變更決定與實際投影'});return textResponse({memory:'今天維持安靜，已完成投影檢查',nextTasks:['明天重新判斷需要的照顧']});};
 try{const manager=createManagerAutonomy({db,now:clock,bucket,apiKey:'synthetic',transport,wake:async()=>{wakes++;},assetFetch:async()=>new Response('unused')});
 await manager.enable();assert.equal(wakes,1);for(let i=0;i<8;i++)await manager.step();
 const row=db.sqlite.prepare('SELECT * FROM tower_autonomy_cycles').get()!;assert.equal(row.state,'complete');assert.equal(calls.length,3);assert.equal(JSON.parse(String(row.audit_json)).verdict,'PASS');assert.match(String(row.review_json),/memory/);
 await manager.enable();await manager.step();assert.equal(calls.length,3);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM tower_autonomy_cycles').get()!.n,1);
 assert.throws(()=>db.sqlite.exec("UPDATE tower_autonomy_calls SET reserved_micro=0"),/immutable/);assert.throws(()=>db.sqlite.exec('DELETE FROM tower_autonomy_events'),/immutable/);
 }finally{db.close();}
});
test('unknown paid outcome keeps reservation, blocks original cycle, never blindly retries next tick',async()=>{
 const db=database();let calls=0;try{const manager=createManagerAutonomy({db,now:clock,bucket,apiKey:'synthetic',transport:async(url)=>{if(String(url).endsWith('/input_tokens'))return Response.json({input_tokens:120});calls++;throw Error('DO_NOT_LEAK');},wake:async()=>{},assetFetch:async()=>new Response('')});await manager.enable();await manager.step();await manager.step();
 assert.equal(calls,2);assert.equal(db.sqlite.prepare('SELECT state FROM tower_autonomy_cycles').get()!.state,'blocked');const call=db.sqlite.prepare('SELECT * FROM tower_autonomy_calls WHERE reserved_micro>0').get()!;assert.equal(call.state,'unknown');assert.ok(Number(call.reserved_micro)>0);assert.equal(call.actual_micro,null);assert.doesNotMatch(JSON.stringify(await manager.inspect()),/DO_NOT_LEAK|synthetic/);
 }finally{db.close();}
});
import {PNG} from 'pngjs';
import {createAutonomyRoutes} from '../server/live/tower-autonomy-routes.ts';
function image(colour:number){const png=new PNG({width:1600,height:900});for(let i=0;i<png.data.length;i+=4){png.data[i]=colour;png.data[i+1]=colour+1;png.data[i+2]=colour+2;png.data[i+3]=255;}return PNG.sync.write(png);}
function memoryBucket(){const data=new Map<string,Uint8Array>();return {data,async put(key:string,bytes:Uint8Array){data.set(key,bytes.slice());},async get(key:string){const value=data.get(key);return value?{async arrayBuffer(){return new Uint8Array(value).buffer;}}:null;}};}
const appearancePlan={kind:'appearance',purpose:'替今日單棟塔保留一盞萬聖夜暖燈',acceptance:['日夜原構圖保留','兩張圖在R2實際可讀','審核通過後啟用'],budgetMicro:3_000_000,permissions:['read-public-health','edit-exterior-images','activate-reviewed-exterior'],reason:'今日萬聖夜適合溫暖裝飾',dayPrompt:'Add restrained pumpkin lanterns, preserve the daylight tower.',nightPrompt:'Add matching warm pumpkin lanterns, preserve the night tower.'};
function syntheticProvider(options:{failAudit?:boolean;unknownImage?:boolean;clock?:()=>Date}={}){
 const requests:{url:string;payload:Record<string,unknown>}[]=[];let audits=0,images=0;
 const transport:typeof fetch=async(url,init)=>{const payload=JSON.parse(String(init?.body));requests.push({url:String(url),payload});if(String(url).endsWith('/input_tokens'))return Response.json({input_tokens:120});
  if(String(url).endsWith('/images/edits')){images++;if(options.unknownImage)throw Error('private failure');assert.equal(payload.size,'1600x900');assert.deepEqual(payload.tool_enablement,{enable_image_search:false,enable_web_search:false,enable_shell:false});assert.equal(payload.images.length,1);return Response.json({created:1793473200,output_format:'png',data:[{b64_json:image(20+images).toString('base64')}],usage:{input_tokens:100,output_tokens:100}});}
  const instructions=String(payload.instructions);
  if(instructions.includes('Think independently')){if(options.clock&&options.clock().getUTCDate()!==31){const data=JSON.parse(String(payload.input));assert.equal(data.blockedTasks.length,1);return textResponse({...appearancePlan,kind:'noop',purpose:'記住待查事件，今天只檢查公開投影',budgetMicro:1000000});}return textResponse(appearancePlan);}
  if(payload.tools){assert.equal(payload.tool_choice,'auto');assert.deepEqual(payload.include,['reasoning.encrypted_content']);return Response.json({id:crypto.randomUUID(),model:'muse-spark-1.3',status:'completed',usage:{input_tokens:120,output_tokens:200},output:[{type:'reasoning',encrypted_content:'synthetic-encrypted',summary:[]},{type:'function_call',name:'edit_tower_images',call_id:'synthetic-call',arguments:JSON.stringify({dayPrompt:appearancePlan.dayPrompt,nightPrompt:appearancePlan.nightPrompt})}]});}
  if(instructions.includes('requested tool has returned')){const items=payload.input as {type:string;call_id?:string}[];assert.equal(items.at(-1)!.type,'function_call_output');assert.equal(items.at(-1)!.call_id,'synthetic-call');assert.ok(items.some(x=>x.type==='reasoning'));return textResponse({received:true});}
  if(instructions.includes('independent TaskAudit')){audits++;const content=(payload.input as {content:{type:string}[]}[])[0]?.content;if(Array.isArray(payload.input))assert.equal(content.filter(x=>x.type==='input_image').length,4);return textResponse({verdict:options.failAudit&&audits===1?'FAIL':'PASS',reason:'已比對實際兩張圖與原圖',dayPrompt:'Repair daylight tower only',nightPrompt:'Repair night tower only'});}
  return textResponse({memory:'今日依實際結果記住已完成或待查的工作',nextTasks:['明天重新思考，不重送未知結果的圖像請求']});
 };return {transport,requests,get images(){return images;}};
}
test('real tool call, two distinct PNGs, R2 readback, independent four-image audit and atomic activation precede completion',async()=>{
 const db=database(),storage=memoryBucket(),provider=syntheticProvider();try{const manager=createManagerAutonomy({db,now:clock,bucket:storage,apiKey:'synthetic',transport:provider.transport,wake:async()=>{},assetFetch:async()=>new Response(new Uint8Array(200).fill(70))});await manager.enable();for(let i=0;i<12;i++)await manager.step();const state=await manager.publicState();assert.equal(state!.theme,'halloween');assert.ok(state!.images.day.endsWith('/day.png'));assert.equal(storage.data.size,2);assert.equal(db.sqlite.prepare('SELECT state FROM tower_autonomy_cycles').get()!.state,'complete');assert.equal(provider.images,2);assert.ok(await manager.asset(state!.generation,'day'));assert.equal(await manager.asset('manager-2026-10-30-r0','day'),null);
 const events=db.sqlite.prepare('SELECT kind FROM tower_autonomy_events ORDER BY rowid').all().map(x=>x.kind);assert.ok(events.indexOf('deterministic-verification')<events.indexOf('task-audit'));assert.ok(events.indexOf('task-audit')<events.indexOf('appearance-activated'));assert.ok(events.indexOf('appearance-activated')<events.indexOf('daily-private-memory'));
 assert.throws(()=>db.sqlite.exec("INSERT OR REPLACE INTO tower_autonomy_calls SELECT * FROM tower_autonomy_calls LIMIT 1"),/immutable/);assert.throws(()=>db.sqlite.exec("INSERT OR REPLACE INTO tower_autonomy_assets SELECT * FROM tower_autonomy_assets LIMIT 1"),/immutable|provenance/);assert.throws(()=>db.sqlite.exec("INSERT OR REPLACE INTO tower_autonomy_events SELECT * FROM tower_autonomy_events LIMIT 1"),/immutable/);
 }finally{db.close();}
});
test('FAIL repairs within original logical task, anchor and cost account; only second PASS can activate',async()=>{
 const db=database(),storage=memoryBucket(),provider=syntheticProvider({failAudit:true});try{const manager=createManagerAutonomy({db,now:clock,bucket:storage,apiKey:'synthetic',transport:provider.transport,wake:async()=>{},assetFetch:async()=>new Response(new Uint8Array(200))});await manager.enable();for(let i=0;i<20;i++)await manager.step();assert.equal((await manager.publicState())!.generation,'manager-2026-10-31-r1');assert.equal(provider.images,4);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM tower_autonomy_cycles').get()!.n,1);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM tower_autonomy_task_anchors').get()!.n,1);assert.equal(db.sqlite.prepare('SELECT budget_micro FROM tower_autonomy_cycles').get()!.budget_micro,3_000_000);assert.ok(Number(db.sqlite.prepare('SELECT sum(coalesce(actual_micro,reserved_micro)) n FROM tower_autonomy_calls').get()!.n)<3_000_000);
 }finally{db.close();}
});
test('unknown image stays on original anchor; tomorrow still thinks and selfreviews without cloning the image task',async()=>{
 const db=database(),storage=memoryBucket();let time=new Date('2026-10-31T19:00:00Z');const provider=syntheticProvider({unknownImage:true,clock:()=>time});try{const manager=createManagerAutonomy({db,now:()=>time,bucket:storage,apiKey:'synthetic',transport:provider.transport,wake:async()=>{},assetFetch:async()=>new Response(new Uint8Array(200))});await manager.enable();for(let i=0;i<8;i++)await manager.step();assert.equal(provider.images,1);assert.equal(db.sqlite.prepare('SELECT state FROM tower_autonomy_cycles').get()!.state,'blocked');time=new Date('2026-11-01T20:00:00Z');for(let i=0;i<7;i++)await manager.step();assert.equal(provider.images,1);assert.equal(db.sqlite.prepare("SELECT state FROM tower_autonomy_cycles WHERE day='2026-11-01'").get()!.state,'complete');assert.equal(db.sqlite.prepare("SELECT reserved_micro FROM tower_autonomy_calls WHERE purpose='image-day-r0'").get()!.reserved_micro,10000);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM tower_autonomy_task_anchors').get()!.n,1);
 }finally{db.close();}
});
test('corrupt artifact never reaches audit or activation; scope, disabled dev provider and public asset routes fail closed',async()=>{
 const db=database(),storage=memoryBucket(),provider=syntheticProvider();try{const manager=createManagerAutonomy({db,now:clock,bucket:storage,apiKey:'synthetic',transport:provider.transport,wake:async()=>{},assetFetch:async()=>new Response(new Uint8Array(200))});await manager.enable();for(let i=0;i<4;i++)await manager.step();storage.data.set([...storage.data.keys()][0],new Uint8Array([1,2]));await manager.step();await manager.step();assert.equal(await manager.publicState(),null);assert.equal(db.sqlite.prepare("SELECT count(*) n FROM tower_autonomy_calls WHERE purpose='independent-task-audit'").get()!.n,0);
 const routes=createAutonomyRoutes({db,origin:'https://tower.example',operator:async()=>true,scheduled:async()=>false});assert.equal((await routes.fetch(new Request('https://tower.example/api/v1/operator/manager/autonomy',{method:'POST',body:'{"action":"enable"}'})))!.status,503);assert.equal((await routes.fetch(new Request('https://tower.example/api/v1/manager/autonomy/step',{method:'POST'})))!.status,401);assert.equal((await routes.fetch(new Request('https://tower.example/api/v1/tower/appearance/assets/manager-2026-10-31-r0/day.png')))! .status,404);
 }finally{db.close();}
});
import {ManagerClock} from '../workers/tower-manager/worker.ts';
test('deployment alarm continuation is bounded, survives interruptions and stops at completion without polling',async()=>{
 const values=new Map<string,unknown>();let alarm:number|null=null,calls=0;const original=globalThis.fetch;
 const storage={async get<T>(key:string){return values.get(key) as T|undefined;},async put(key:string,value:unknown){values.set(key,value);},async setAlarm(time:number){alarm=time;},async deleteAlarm(){alarm=null;}};
 try{const clock=new ManagerClock({storage,async blockConcurrencyWhile<T>(callback:()=>Promise<T>){return callback();}},{PUBLIC_ORIGIN:'https://tower.example',MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic-scoped'});
 globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'https://tower.example/api/v1/manager/autonomy/step');assert.equal(new Headers(init?.headers).get('X-Manager-Schedule-Key'),'synthetic-scoped');assert.equal(init?.redirect,'manual');return Response.json({pending:calls<2});};
 assert.equal((await clock.fetch(new Request('https://manager.internal/wake',{method:'POST'}))).status,200);assert.ok(alarm);await clock.alarm();assert.ok(alarm);await clock.alarm();assert.equal(alarm,null);assert.equal(calls,2);
 globalThis.fetch=async()=>{throw Error('synthetic network interruption');};for(let i=0;i<3;i++)await clock.alarm();assert.equal(alarm,null);assert.equal(values.get('recoveryAttempts'),3);
 }finally{globalThis.fetch=original;}
});
