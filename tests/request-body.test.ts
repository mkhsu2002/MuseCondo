import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {readRequestBody,RequestBodyError} from '../server/live/request-body.ts';
import {createTowerReception} from '../server/live/reception.ts';
import {createIdentityRecovery} from '../server/live/identity-recovery.ts';
import {LocalDatabase} from '../server/live/local-db.ts';

const origin='https://body.example';
const streamRequest=(stream:ReadableStream<Uint8Array>,headers:Record<string,string>={},path='/')=>new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:stream,duplex:'half'} as RequestInit);
const error=(status:number,code:string)=>(e:unknown)=>e instanceof RequestBodyError&&e.status===status&&e.code===code;

test('body deadline returns even when source cancellation never settles',{timeout:1000},async()=>{
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;return new Promise(()=>{});}});
 await assert.rejects(readRequestBody(streamRequest(stream),8192,10),error(408,'body_read_timeout'));
 assert.equal(cancelled,true);
});

test('body deadline spans all chunks instead of restarting after each chunk',{timeout:1000},async()=>{
 let controller!:ReadableStreamDefaultController<Uint8Array>;
 const stream=new ReadableStream<Uint8Array>({start(c){controller=c;},cancel(){clearInterval(interval);}});
 const interval=setInterval(()=>controller.enqueue(new Uint8Array([1])),5);
 try{await assert.rejects(readRequestBody(streamRequest(stream),8192,25),error(408,'body_read_timeout'));}finally{clearInterval(interval);}
});

test('body reader preserves bytes at the limit and rejects overflow without waiting for cancellation',{timeout:1000},async()=>{
 const expected=new Uint8Array([0,128,255]);
 assert.deepEqual(await readRequestBody(new Request(origin,{method:'POST',body:expected}),3,10),expected);
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(4));},cancel(){cancelled=true;return new Promise(()=>{});}});
 await assert.rejects(readRequestBody(streamRequest(stream),3,100),error(413,'body_too_large'));
 assert.equal(cancelled,true);
 await assert.rejects(readRequestBody(new Request(origin,{method:'POST'}),3,10),error(400,'invalid_json'));
});

for(const kind of ['reception','recovery'] as const)test(kind+' returns 408 before any case, recovery, receipt, audit or provider work',{timeout:1000},async()=>{
 const db=new LocalDatabase(':memory:');
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 let callbacks=0;
 const route=kind==='reception'?createTowerReception({db,origin,operator:async()=>false,bodyReadTimeoutMs:10,onReview:async()=>{callbacks++;},sourceFetch:async()=>{callbacks++;throw Error('No external traffic permitted');}}):createIdentityRecovery({db,origin,contactKey:'c'.repeat(64),bodyReadTimeoutMs:10,onMailEvent:async()=>{callbacks++;}});
 const tables=['tower_reception_cases','tower_reception_requests','tower_reception_events','identity_recovery_requests','identity_recovery_receipts','identity_audit','identity_mail_events','manager_admission_jobs','manager_admission_calls','provider_requests'];
 const counts=()=>tables.map(t=>db.sqlite.prepare('SELECT count(*) n FROM '+t).get()!.n);
 const before=counts();
 try{
  const request=streamRequest(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}),kind==='reception'?{Authorization:'Bearer '+'a'.repeat(64)}:{'X-Identity-Candidate-Key':'b'.repeat(64)},kind==='reception'?'/api/v1/reception/cases':'/api/v1/identity/recovery/requests');
  const response=(await route.fetch(request))!;
  assert.equal(response.status,408);
  assert.deepEqual(await response.json(),{error:'body_read_timeout'});
  assert.deepEqual(counts(),before);
  assert.equal(callbacks,0);
 }finally{db.close();}
});
