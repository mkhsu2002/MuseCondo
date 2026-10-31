import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import runtime,{type PagesBindings} from '../server/live/worker.ts';
import { onRequest } from '../functions/[[path]].ts';
import { LocalDatabase } from '../server/live/local-db.ts';
const origin='https://musecondo.pages.dev';
const request=(path='/api/v1/status',method='GET')=>new Request(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
function database(){const db=new LocalDatabase(':memory:');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));openSyntheticTower(db);return db;}
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
test('reception directory bypasses Pages clean-URL redirects and keeps its API schema gate',async()=>{
 const routes:string[]=[],methods:string[]=[];const db=database();try{
 // Model Pages asset canonicalization: HTML file requests redirect to their
 // clean URL, directory requests serve the actual generated index document.
 const env:PagesBindings={PUBLIC_ORIGIN:origin,DB:db,ASSETS:{async fetch(req){
  const path=new URL(req.url).pathname;routes.push(path);methods.push(req.method);
  if(path==='/reception.html')return new Response(null,{status:308,headers:{Location:origin+'/reception'}});
  if(path==='/reception/index.html')return new Response(null,{status:308,headers:{Location:origin+'/reception/'}});
  if(path==='/reception/')return new Response(req.method==='HEAD'?null:'<h1>新住戶接待</h1>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
  return new Response('asset not found',{status:404});
 }}};
 for(const path of ['/reception','/reception/']){
  const response=await runtime.fetch(request(path),env);assert.equal(response.status,200);assert.equal(response.headers.get('Location'),null);assert.equal(await response.text(),'<h1>新住戶接待</h1>');
 }
 assert.deepEqual(routes,['/reception/','/reception/']);
 const head=await runtime.fetch(request('/reception','HEAD'),env);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(methods.at(-1),'HEAD');
 const fileEntry=await runtime.fetch(request('/reception.html'),env);assert.equal(fileEntry.status,308);assert.equal(fileEntry.headers.get('Location'),origin+'/reception');
 const followed=await runtime.fetch(new Request(fileEntry.headers.get('Location')!),env);assert.equal(followed.status,200);assert.equal(await followed.text(),'<h1>新住戶接待</h1>');
 assert.equal((await runtime.fetch(request('/reception','POST'),env)).status,405);
 db.sqlite.exec('DROP TABLE tower_reception_requests');const unavailable=await runtime.fetch(request(),env);assert.equal(unavailable.status,503);assert.equal((await unavailable.json()).error,'database_schema_not_ready');
 }finally{db.close();}
});
test('reception readiness rejects tables without required first-placement guards',async()=>{
 const db=database();try{db.sqlite.exec('DROP TRIGGER tower_reception_first_home');const response=await runtime.fetch(request(),{PUBLIC_ORIGIN:origin,DB:db});assert.equal(response.status,503);assert.equal((await response.json()).error,'database_schema_not_ready');}finally{db.close();}
});


test('visits readiness refuses runtime until migration 0010 is applied',async()=>{
 const db=database();try{db.sqlite.exec('DROP TABLE tower_visits');const response=await runtime.fetch(request(),{PUBLIC_ORIGIN:origin,DB:db});assert.equal(response.status,503);assert.equal((await response.json()).error,'database_schema_not_ready');}finally{db.close();}
});

test('activities directory is a fixed public document and its API fails closed without migration 0011',async()=>{
 const db=database(),routes:string[]=[];try{
  const env:PagesBindings={DB:db,PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:'synthetic-operator',ASSETS:{async fetch(req){const path=new URL(req.url).pathname;routes.push(path);return path==='/activities/'?new Response(req.method==='HEAD'?null:'<h1>小活動</h1>'):new Response('not found',{status:404});}}};
  for(const path of ['/activities','/activities/']){const res=await runtime.fetch(request(path),env);assert.equal(res.status,200);assert.equal(await res.text(),'<h1>小活動</h1>');}
  assert.deepEqual(routes,['/activities/','/activities/']);assert.equal((await runtime.fetch(request('/activities','POST'),env)).status,405);
  const create=await runtime.fetch(new Request(origin+'/api/v1/operator/tower/activities',{method:'POST',headers:{'Content-Type':'application/json','X-Tower-Operator-Key':'synthetic-operator'},body:JSON.stringify({id:'synthetic-runtime',title:'Synthetic',description:'Synthetic runtime check',state:'open',requestKey:'synthetic-runtime-request'})}),env);assert.equal(create.status,201);
  assert.equal((await runtime.fetch(request('/api/v1/tower/activities'),env)).status,200);
  for(const table of ['tower_activity_participation','tower_activity_operator_requests','tower_activity_audit']){db.sqlite.exec('ALTER TABLE '+table+' RENAME TO hidden_'+table);const res=await runtime.fetch(request(),env);assert.equal(res.status,503);assert.equal((await res.json()).error,'database_schema_not_ready');db.sqlite.exec('ALTER TABLE hidden_'+table+' RENAME TO '+table);}
 }finally{db.close();}
});

test('identity endpoints require migration 0012 tables and immutable binding trigger',async()=>{
 const db=database();try{
  for(const name of ['agent_identities','identity_requests','identity_audit','identity_rate_attempts']){
   // Renames preserve foreign keys and let the same complete fixture test each required name.
   db.sqlite.exec('ALTER TABLE '+name+' RENAME TO hidden_'+name);
   const response=await runtime.fetch(request('/api/v1/agent/identity'),{PUBLIC_ORIGIN:origin,DB:db});assert.equal(response.status,503);assert.equal((await response.json()).error,'database_schema_not_ready');
   db.sqlite.exec('ALTER TABLE hidden_'+name+' RENAME TO '+name);
  }
  db.sqlite.exec('DROP TRIGGER agent_identity_immutable_binding');const response=await runtime.fetch(request('/api/v1/agent/identity'),{PUBLIC_ORIGIN:origin,DB:db});assert.equal(response.status,503);assert.equal((await response.json()).error,'database_schema_not_ready');
 }finally{db.close();}
});
test('Pages dispatches only the private identity endpoints with Tower authorization',async()=>{
 const db=database();try{for(const suffix of ['', '/record','/enroll']){const response=await runtime.fetch(new Request(origin+'/api/v1/agent/identity'+suffix,{method:suffix==='/enroll'?'POST':'GET'}),{PUBLIC_ORIGIN:origin,DB:db});assert.equal(response.status,401);assert.equal((await response.json()).error,'tower_token_required');}}finally{db.close();}
});

test('identity uses the fixed directory document for clean paths and safely follows the HTML canonical entry',async()=>{
 const paths:string[]=[],methods:string[]=[];
 const env:PagesBindings={ASSETS:{async fetch(req){const path=new URL(req.url).pathname;paths.push(path);methods.push(req.method);if(path==='/identity.html')return new Response(null,{status:308,headers:{Location:origin+'/identity'}});if(path==='/identity/index.html')return new Response(null,{status:308,headers:{Location:origin+'/identity/'}});return path==='/identity/'?new Response(req.method==='HEAD'?null:'<h1>身份守護</h1>',{headers:{'Content-Type':'text/html; charset=utf-8'}}):new Response('missing',{status:404});}}};
 for(const path of ['/identity','/identity/']){const res=await runtime.fetch(request(path),env);assert.equal(res.status,200,path);assert.equal(await res.text(),'<h1>身份守護</h1>');assert.equal(res.headers.get('Location'),null);}
 assert.deepEqual(paths,['/identity/','/identity/']);
 const head=await runtime.fetch(request('/identity','HEAD'),env);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(methods.at(-1),'HEAD');
 const file=await runtime.fetch(request('/identity.html'),env);assert.equal(file.status,308);const followed=await runtime.fetch(new Request(file.headers.get('Location')!),env);assert.equal(followed.status,200);assert.equal(await followed.text(),'<h1>身份守護</h1>');
 for(const path of ['/identity','/identity/','/identity.html'])assert.equal((await runtime.fetch(request(path,'POST'),env)).status,405,path);
 assert.equal((await runtime.fetch(request('/identity'),{})).status,503);
});

test('recovery private document uses a fixed directory without clean URL loops and refuses mutations',async()=>{
 const paths:string[]=[],methods:string[]=[];
 const env:PagesBindings={ASSETS:{async fetch(req){const path=new URL(req.url).pathname;paths.push(path);methods.push(req.method);if(path==='/identity-recovery.html')return new Response(null,{status:308,headers:{Location:origin+'/identity/recover'}});if(path==='/identity/recover/index.html')return new Response(null,{status:308,headers:{Location:origin+'/identity/recover/'}});return path==='/identity/recover/'?new Response(req.method==='HEAD'?null:'<h1>找回身份</h1>'):new Response('missing',{status:404});}}};
 for(const path of ['/identity/recover','/identity/recover/']){const res=await runtime.fetch(request(path),env);assert.equal(res.status,200,path);assert.equal(await res.text(),'<h1>找回身份</h1>');assert.equal(res.headers.get('Location'),null);for(const [header,value] of [['Cache-Control','no-store'],['X-Robots-Tag','noindex, nofollow'],['Referrer-Policy','no-referrer']])assert.equal(res.headers.get(header),value);assert.match(res.headers.get('Content-Security-Policy')!,/default-src 'none'/);}
 assert.deepEqual(paths,['/identity/recover/','/identity/recover/']);
 const head=await runtime.fetch(request('/identity/recover','HEAD'),env);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(methods.at(-1),'HEAD');
 const file=await runtime.fetch(request('/identity-recovery.html'),env);assert.equal(file.status,308);assert.equal(file.headers.get('Location'),origin+'/identity/recover');assert.equal((await runtime.fetch(new Request(file.headers.get('Location')!),env)).status,200);
 for(const path of ['/identity/recover','/identity/recover/','/identity-recovery.html'])for(const method of ['POST','PUT'])assert.equal((await runtime.fetch(request(path,method),env)).status,405,path);
 assert.equal((await runtime.fetch(request('/identity/recover'),{})).status,503);
});
