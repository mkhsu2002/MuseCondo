import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/tower-manager/worker.ts';

test('private diagnostic uses the same callback without claiming or calling Browser and returns only bounded metadata',async()=>{
 const oldFetch=globalThis.fetch;let calls=0,browsers=0;
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://tower.example/api/v1/manager/autonomy/theme-render-claim');assert.deepEqual(JSON.parse(String(init?.body)),{receiptId:'18510253-4252-4ea9-b3a2-82f4e388b77a',diagnostic:true});assert.equal(new Headers(init?.headers).get('X-Manager-Schedule-Key'),'synthetic');return new Response('<html>private prompt error code: 1042</html>',{status:403,headers:{'Content-Type':'text/html','CF-Ray':'safe-ray-YVR'}});};
 try{const response=await worker.fetch(new Request('https://manager.internal/theme/diagnose',{method:'POST',headers:{'X-Manager-Schedule-Key':'synthetic'},body:JSON.stringify({receiptId:'18510253-4252-4ea9-b3a2-82f4e388b77a'})}),{PUBLIC_ORIGIN:'https://tower.example',MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic',BROWSER:{async limits(){throw Error('must not call');},async quickAction(){browsers++;throw Error('must not call');}}});assert.equal(response.status,200);const value=await response.json();assert.equal(value.callbackStatus,403);assert.equal(value.callbackCode,'1042');assert.equal(value.callbackContentType,'text/html');assert.equal(value.dispatched,false);assert.doesNotMatch(JSON.stringify(value),/private prompt|<html>|synthetic/);assert.equal(calls,1);assert.equal(browsers,0);}finally{globalThis.fetch=oldFetch;}
});

test('diagnostic rejects unauthenticated, cross-site and oversized commands without callback',async()=>{
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('no callback');};const env={PUBLIC_ORIGIN:'https://tower.example',MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic'};
 try{for(const [headers,body,status] of [[{},'{}',401],[{'X-Manager-Schedule-Key':'synthetic','Cookie':'private=1'},'{}',401],[{'X-Manager-Schedule-Key':'synthetic'},JSON.stringify({receiptId:'x'.repeat(2000)}),400],[{'X-Manager-Schedule-Key':'synthetic'},JSON.stringify({receiptId:'18510253-4252-4ea9-b3a2-82f4e388b77a',html:'<b>not allowed</b>'}),400]] as const){const r=await worker.fetch(new Request('https://manager.internal/theme/diagnose',{method:'POST',headers,body}),env);assert.equal(r.status,status);}}finally{globalThis.fetch=oldFetch;}
});
