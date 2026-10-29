import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import runtime,{type PagesBindings} from '../server/live/worker.ts';
import { onRequest } from '../functions/[[path]].ts';
import { LocalDatabase } from '../server/live/local-db.ts';
const origin='https://musecondo.pages.dev';
const request=(path='/api/v1/status',method='GET')=>new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
function database(){const db=new LocalDatabase(':memory:');for(const file of ['0001_live_mvp.sql','0002_recovery_audit.sql','0003_provider_requests.sql','0004_agent_onboarding.sql','0005_framework.sql'])db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));return db;}
test('Pages API fails closed on missing origin, DB binding, migration and database failure',async()=>{
 let response=await runtime.fetch(request(),{});assert.equal(response.status,503);assert.match(response.headers.get('content-type')!,/application\/json/);assert.equal((await response.json()).error,'public_origin_not_configured');
 response=await runtime.fetch(request(),{PUBLIC_ORIGIN:origin});assert.equal(response.status,503);assert.equal((await response.json()).error,'database_not_bound');
 const db=new LocalDatabase(':memory:');try{response=await runtime.fetch(request(),{PUBLIC_ORIGIN:origin,DB:db});assert.equal(response.status,503);assert.equal((await response.json()).error,'database_schema_not_ready');}finally{db.close();}
 response=await runtime.fetch(request(),{PUBLIC_ORIGIN:origin,DB:{prepare(){throw Error('PRIVATE_SQL_CONNECTION_DETAIL');},async batch(){throw Error('unused');}}});assert.equal(response.status,503);const body=await response.text();assert(!body.includes('PRIVATE'));assert.match(body,/database_unavailable/);
});
test('Pages runtime defaults registration and paid calls off; status exposes secret presence only',async()=>{
 const db=database();try{const env:PagesBindings={PUBLIC_ORIGIN:origin,DB:db,meta_muse_api:'TEST_ONLY_SECRET_VALUE'};
 const response=await onRequest({request:request(),env});assert.equal(response.status,200);const body=await response.text();assert(!body.includes('TEST_ONLY_SECRET_VALUE'));const status=JSON.parse(body);assert.equal(status.available,true);assert.equal(status.generation,'disconnected');assert.equal(status.runtime.metaSecretConfigured,true);assert.equal(status.runtime.paidCallsApproved,false);assert.equal(status.runtime.databaseReady,true);assert.equal(status.registrationEnabled,false);
 const signup=await runtime.fetch(request('/api/v1/accounts','POST'),env);assert.equal(signup.status,403);assert.equal((await signup.json()).error,'registration_closed');
 for(const value of ['TRUE','1','yes']){const r=await runtime.fetch(request(),{...env,META_PAID_CALLS_APPROVED:value,REGISTRATION_ENABLED:value});const s=await r.json();assert.equal(s.generation,'disconnected');assert.equal(s.registrationEnabled,false);}
 }finally{db.close();}
});
test('explicit configuration enables factory but status makes no Meta request and never asserts health',async()=>{
 const db=database();const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('forbidden network');};try{
 for(const secret of [undefined,'','   ']){const r=await runtime.fetch(request(),{PUBLIC_ORIGIN:origin,DB:db,meta_muse_api:secret,META_PAID_CALLS_APPROVED:'true'});assert.equal((await r.json()).generation,'disconnected');}
 const r=await runtime.fetch(request(),{PUBLIC_ORIGIN:origin,DB:db,meta_muse_api:'TEST_ONLY',META_PAID_CALLS_APPROVED:'true'});assert.equal(r.status,200);const s=await r.json();assert.equal(s.generation,'configured-not-health-verified');assert.equal(s.runtime.metaConfiguredNotHealthVerified,true);assert.equal(calls,0);
 const signup=await runtime.fetch(request('/api/v1/accounts','POST'),{PUBLIC_ORIGIN:origin,DB:db,REGISTRATION_ENABLED:'true'});assert.equal(signup.status,201);assert.match(signup.headers.get('set-cookie')!,/Secure/);assert.equal(calls,0);
 }finally{globalThis.fetch=original;db.close();}
});
test('same-origin guard rejects foreign or insecure API before DB; public static routes use Pages ASSETS',async()=>{
 const routes:string[]=[];const env:PagesBindings={PUBLIC_ORIGIN:origin,ASSETS:{async fetch(req){routes.push(new URL(req.url).pathname);if(new URL(req.url).pathname==='/index.html')return Response.redirect(origin+'/',301);return new Response('compiled asset',{headers:{'Content-Type':'text/html'}});}}};
 assert.equal((await runtime.fetch(new Request('https://preview.pages.dev/api/v1/status'),env)).status,403);
 assert.equal((await runtime.fetch(request(),{...env,PUBLIC_ORIGIN:'http://musecondo.pages.dev'})).status,503);
 assert.equal((await runtime.fetch(request(),{...env,PUBLIC_ORIGIN:origin+'/'})).status,503);
 for(const path of ['/move-in','/neighbors','/home/1234567890abcdef','/home/1234567890abcdef/inside'])assert.equal((await runtime.fetch(request(path),env)).status,200);
 assert.deepEqual(routes,['/','/','/','/']);
 assert.equal((await runtime.fetch(request('/move-in','POST'),env)).status,405);
 await runtime.fetch(request('/assets/app.js'),env);assert.equal(routes.at(-1),'/assets/app.js');
 const missing=await runtime.fetch(request('/move-in'),{});assert.equal(missing.status,503);assert.equal((await missing.json()).error,'assets_not_bound');
});
