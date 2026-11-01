import test from 'node:test';
import assert from 'node:assert/strict';
import {transportCheck} from '../server/live/transport-check.ts';
const origin='https://tower.example',url=origin+'/api/v1/transport-check';
const post=(body='{}',headers:Record<string,string>={})=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
test('GET and complete empty POST return diagnostic acknowledgment, never a case identity',async()=>{
 for(const request of [new Request(url),post()]){
  const response=await transportCheck(request,origin);assert.equal(response?.status,200);const value=await response!.json();
  assert.equal(value.ok,true);assert.equal(value.method,request.method);assert.match(value.checkId,/^[a-f0-9-]{36}$/);assert.deepEqual(Object.keys(value).sort(),['checkId','method','ok']);assert.equal(response!.headers.get('X-Tower-Check-Id'),value.checkId);assert.equal(response!.headers.get('Cache-Control'),'no-store');
 }
});
test('credentials, cross-origin calls, query data and nonempty bodies fail without echoing input',async()=>{
 for(const name of ['Authorization','Cookie','X-Identity-Candidate-Key','X-Tower-Agent-Key','X-Tower-Operator-Key']){
  const response=await transportCheck(post('{}',{[name]:'do-not-echo'}),origin);assert.equal(response?.status,400);assert.doesNotMatch(await response!.text(),/do-not-echo/);
 }
 assert.equal((await transportCheck(post('{}',{Origin:'https://muse.ai'}),origin))?.status,403);
 assert.equal((await transportCheck(new Request(url+'?secret=no'),origin))?.status,400);
 for(const body of ['null','[]','{"value":"do-not-echo"}','{']){const response=await transportCheck(post(body),origin);assert.equal(response?.status,400);assert.doesNotMatch(await response!.text(),/do-not-echo/);}
 assert.equal((await transportCheck(post('x'.repeat(257)),origin))?.status,413);
});
test('an incomplete POST returns bounded 408 and unrelated paths remain untouched',async()=>{
 const request=new Request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}}),duplex:'half'} as RequestInit);
 const response=await transportCheck(request,origin,10);assert.equal(response?.status,408);assert.deepEqual(await response!.json(),{error:'body_read_timeout'});
 assert.equal(await transportCheck(new Request(origin+'/other'),origin),null);
 assert.equal((await transportCheck(new Request(url,{method:'OPTIONS'}),origin))?.status,405);
});
