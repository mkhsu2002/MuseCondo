import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import runtime from '../server/live/worker.ts';
import {IdentityCardCoordinator} from '../workers/identity-card/worker.ts';
import {envelopeFixture} from './helpers/identity-mail-fixture.ts';
const base='/api/v1/agent/identity/card';
async function fixture(t:TestContext) {
 const f=await envelopeFixture(),calls:string[]=[],controls:string[]=[];
 f.db.sqlite.prepare('UPDATE identity_mail_events SET dedupe_key=? WHERE id=?').run('card:identity-card:'+f.cid,f.event);
 const jwk=await crypto.subtle.exportKey('jwk',f.pair.publicKey);
 const coordinator=new IdentityCardCoordinator({}, {DB:f.db,PUBLIC_ORIGIN:f.env.origin,IDENTITY_CONTACT_KEY:f.env.contactKey,IDENTITY_PUBLIC_KEYS:JSON.stringify({fixture:jwk}),IDENTITY_MAIL_FROM:f.env.from});
 let response=()=>new Response(JSON.stringify({revision:1,card:{credentialId:f.cid,revision:1,status:'valid'}}),{status:201,headers:{'Content-Type':'application/json'}});
 const binding={idFromName:(n:string)=>n,get:()=>({fetch:async(req:Request)=>{const path=new URL(req.url).pathname;controls.push(path);return path.startsWith('/__internal/')?coordinator.fetch(req):response();}})};
 t.mock.method(globalThis,'fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{assert(String(url).startsWith('https://api.resend.com/'));calls.push(String(url));if(String(url).includes('/suppressions/'))return new Response(null,{status:404});assert(init?.body instanceof ReadableStream);await new Response(init.body).text();return new Response(JSON.stringify({id:'synthetic-provider'}));});
 const env={DB:f.db,PUBLIC_ORIGIN:f.env.origin,IDENTITY_CARDS:binding,IDENTITY_MAIL_FROM:f.env.from,IDENTITY_CONTACT_KEY:f.env.contactKey,IDENTITY_MAIL_API_KEY:'synthetic-deployment-key',IDENTITY_MAIL_DELIVERY_ENABLED:'true'};
 const request=(path=base+'/issue',method='POST')=>new Request(f.env.origin+path,{method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({credentialId:'d'.repeat(32)})}:{})});
 return {...f,env,calls,controls,request,setResponse:(fn:typeof response)=>{response=fn;}};
}
test('Pages no-context successful card receipt immediately processes only the trusted CID event and replay cannot POST twice',async t=>{
 const f=await fixture(t);try{
 const response=await runtime.fetch(f.request(),f.env);assert.equal(response.status,201);assert.deepEqual(await response.json(),{revision:1,card:{credentialId:f.cid,revision:1,status:'valid'}});
 assert.equal(f.calls.filter(u=>u.endsWith('/emails')).length,1);assert.equal(f.count('identity_mail_dispatches'),1);assert.equal(f.count('identity_mail_finish_receipts'),1);
 assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE id=?').get('f'.repeat(32))!.state,'pending');
 await runtime.fetch(f.request(),f.env);assert.equal(f.calls.filter(u=>u.endsWith('/emails')).length,1);
 }finally{f.close();}
});
test('Pages context schedules exact pending event; concurrent receipts share permanent lease',async t=>{
 const f=await fixture(t);try{
 const work:Promise<unknown>[]=[];await Promise.all([runtime.fetch(f.request(),f.env,{waitUntil:p=>{work.push(p);}}),runtime.fetch(f.request(),f.env,{waitUntil:p=>{work.push(p);}})]);
 assert.equal(work.length,2);await Promise.all(work);assert.equal(f.calls.filter(u=>u.endsWith('/emails')).length,1);assert.equal(f.count('identity_mail_dispatches'),1);
 }finally{f.close();}
});
test('card revoke receipt uses its security-notice dedupe; omitted notification never creates an event',async t=>{
 const f=await fixture(t);try{
 await f.security('identity-card-revoked-v1');f.db.sqlite.prepare('UPDATE identity_mail_events SET dedupe_key=? WHERE id=?').run('card:security-notice:'+f.cid,f.event);
 f.setResponse(()=>new Response(JSON.stringify({revision:2,card:null,revokedCredentialId:f.cid}),{headers:{'Content-Type':'application/json'}}));
 await runtime.fetch(f.request(base+'/revoke'),f.env);assert.equal(f.calls.filter(u=>u.endsWith('/emails')).length,1);
 f.setResponse(()=>new Response(JSON.stringify({revision:2,card:null,revokedCredentialId:'d'.repeat(32)}),{headers:{'Content-Type':'application/json'}}));
 const before=f.count('identity_mail_events');await runtime.fetch(f.request(base+'/revoke'),f.env);assert.equal(f.count('identity_mail_events'),before);assert.equal(f.calls.filter(u=>u.endsWith('/emails')).length,1);
 }finally{f.close();}
});
test('card reads, rejected writes, oversized or malformed core responses and default gate never dispatch or expose private controls',async t=>{
 const f=await fixture(t);try{
 for(const path of [base,base+'/'+f.cid+'/json',base+'/'+f.cid+'/pdf','/api/v1/identity/verify/'+f.cid])await runtime.fetch(f.request(path,'GET'),f.env);
 for(const make of [()=>new Response('{}',{status:403}),()=>new Response('not-json',{headers:{'Content-Type':'application/json'}}),()=>new Response('x'.repeat(5000),{headers:{'Content-Type':'application/json'}}),()=>new Response(JSON.stringify({revision:1,card:{credentialId:'invalid'}}),{headers:{'Content-Type':'application/json'}})]){f.setResponse(make);const result=await runtime.fetch(f.request(),f.env);assert(!result.headers.has('X-Identity-Mail-Lease'));}
 assert.equal(f.calls.length,0);assert.equal(f.count('identity_mail_dispatches'),0);
 f.setResponse(()=>new Response(JSON.stringify({revision:1,card:{credentialId:f.cid}}),{headers:{'Content-Type':'application/json'}}));
 const result=await runtime.fetch(f.request(),{...f.env,IDENTITY_MAIL_DELIVERY_ENABLED:undefined});assert.equal(result.status,200);assert.equal(f.calls.length,0);assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_events WHERE id=?').get(f.event)!.state,'pending');
 }finally{f.close();}
});
