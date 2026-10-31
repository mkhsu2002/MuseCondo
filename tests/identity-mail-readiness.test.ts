import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import type {Database} from '../server/live/db.ts';
import runtime from '../server/live/worker.ts';

const origin='https://identity.example',path='/api/v1/operator/identity/mail-readiness';
const sender='合成寄件人 <sender@mail.example>',key='synthetic-provider-credential';
const target={id:'target-id',name:'mail.example',status:'verified',capabilities:{sending:'enabled',receiving:'disabled'}};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const page=(data:unknown[]= [target],has_more=false)=>reply({object:'list',has_more,data});
type Options={from?:string;apiKey?:string;origin?:string;fetcher?:typeof fetch;db?:(db:LocalDatabase)=>Database;before?: (db:LocalDatabase)=>void;oldSchema?:boolean};
async function fixture(t:test.TestContext,options:Options={}){
 assert(existsSync(new URL('../server/live/identity-mail-readiness.ts',import.meta.url)),'sender readiness implementation must exist');
 const {createIdentityMailReadiness}=await import('../server/live/identity-mail-readiness.ts');
 const db=new LocalDatabase(':memory:');t.after(()=>db.close());
 for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')&&(!options.oldSchema||!f.startsWith('0019'))).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 options.before?.(db);let calls=0;const urls:string[]=[],signals:AbortSignal[]=[];
 const fetcher:typeof fetch=async(input,init)=>{calls++;const url=String(input);urls.push(url);assert.equal(init?.method,'GET');assert.equal(init?.redirect,'error');assert.equal(new URL(url).origin,'https://api.resend.com');assert.match(new URL(url).pathname,/^\/domains(?:\/[A-Za-z0-9_-]+)?$/);assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+(options.apiKey??key));assert(init?.signal);signals.push(init.signal);return options.fetcher?options.fetcher(input,init):url.includes('/domains/')?reply({object:'domain',...target}):page();};
 const env={db:options.db?.(db)??db,origin:options.origin??origin,from:Object.hasOwn(options,'from')?options.from:sender,apiKey:Object.hasOwn(options,'apiKey')?options.apiKey:key,fetcher,now:()=>new Date('2026-11-01T00:00:00.000Z'),operator:async(request:Request)=>request.headers.get('X-Tower-Operator-Key')==='synthetic-operator'};
 const make=()=>createIdentityMailReadiness(env);
 const send=(requestKey='readiness-key',extra:RequestInit={},url=origin+path)=>make().fetch(new Request(url,{method:'POST',headers:{'Content-Type':'application/json','X-Tower-Operator-Key':'synthetic-operator',...extra.headers},body:JSON.stringify({requestKey}),...extra}));
 const count=(table:string)=>Number(db.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get()!.n);
 return {db,env,send,make,count,urls,signals,get calls(){return calls;}};
}

test('unauthorized requests never write or contact the provider',async t=>{
 const f=await fixture(t);for(const token of ['', 'wrong']){const before=f.db.sqlite.prepare('SELECT total_changes() n').get()!.n;const r=await f.send('readiness-key',{headers:{'Content-Type':'application/json','X-Tower-Operator-Key':token}});assert.equal(r?.status,401);assert.equal(f.db.sqlite.prepare('SELECT total_changes() n').get()!.n,before);}assert.equal(f.calls,0);
});
test('exact transport rejects methods, query, foreign host/origin, Cookie and cross-site before writes',async t=>{
 const f=await fixture(t);const cases:[RequestInit,string,number][]=[
  [{method:'GET',body:undefined},origin+path,405],[{},origin+path+'?extra=1',400],[{},origin+path+'?',400],[{},'https://wrong.example'+path,403],
  [{headers:{Origin:'https://wrong.example'}},origin+path,403],[{headers:{Cookie:''}},origin+path,403],[{headers:{'Sec-Fetch-Site':'cross-site'}},origin+path,403],
 ];for(const [init,url,status] of cases)assert.equal((await f.send('readiness-key',init,url))?.status,status);
 assert.equal(await f.make().fetch(new Request(origin+path+'/')),null);assert.equal(f.calls,0);assert.equal(f.count('identity_mail_provider_checks'),0);assert.equal(f.count('identity_mail_provider_audit'),0);
});
test('only one printable ASCII requestKey is accepted as strict bounded JSON',async t=>{
 const f=await fixture(t);const bodies=[{},[],null,{requestKey:'short'},{requestKey:'x'.repeat(97)},{requestKey:'nonascii界'},{requestKey:'tab\t-key'},...['from','domain','recipient','key','url','__proto__'].map(k=>JSON.parse('{"requestKey":"readiness-key","'+k+'":"untrusted"}'))];
 for(const body of bodies)assert.equal((await f.send('unused',{body:JSON.stringify(body)}))?.status,400);
 for(const raw of ['{"requestKey":"readiness-key","requestKey":"readiness-key"}','{"requestKey":"readiness-key",}','{"requestKey":"readiness-key"} trailing','{"requestKey":"readiness-key", "\\u0072equestKey":"readiness-key"}'])assert.equal((await f.send('unused',{body:raw}))?.status,400);
 assert.equal((await f.send('unused',{body:' '.repeat(1025)}))?.status,413);
 assert.equal((await f.send('unused',{headers:{'Content-Type':'text/plain','X-Tower-Operator-Key':'synthetic-operator'}}))?.status,415);
 assert.equal(f.calls,0);assert.equal(f.count('identity_mail_provider_checks'),0);
});
for(const value of [undefined,'','sender@mail.example>','Name <sender@mail.example','a@mail.example,b@mail.example','Name <a@mail.example>\r\nBcc: private@example.com','a@localhost','a@-bad.example','a@bad..example','a@例子.example','Name <a@mail.example> junk','a b@mail.example','a@127.0.0.1','a@x.example/path','Name, Second <sender@mail.example>','first@other.example, Name <sender@mail.example>','Name: Bcc <sender@mail.example>','Name (comment) <sender@mail.example>'])test('invalid FROM is unknown with no provider access: '+JSON.stringify(value),async t=>{
 const f=await fixture(t,{from:value});const r=await f.send();assert.equal(r?.status,503);const v=await r!.json();assert.equal(v.state,'unknown');assert.equal(v.reason,'sender_not_configured');assert.equal(v.senderReady,null);assert.equal(v.deliveryVerified,false);assert.equal(f.calls,0);assert.equal(f.count('identity_mail_provider_audit'),2);
});
test('missing provider secret stays unknown and never accesses the network',async t=>{
 const f=await fixture(t,{apiKey:undefined});const r=await f.send();assert.equal(r?.status,503);assert.equal((await r!.json()).reason,'provider_not_configured');assert.equal(f.calls,0);
});
test('verified sending-enabled domain is sender-ready only, intent precedes GET and result is private and permanent',async t=>{
 const f:Awaited<ReturnType<typeof fixture>>=await fixture(t,{fetcher:async input=>{assert.equal(f.count('identity_mail_provider_checks'),1);assert.equal(f.count('identity_mail_provider_audit'),1);return String(input).includes('/domains/')?reply({object:'domain',...target,records:[{value:'private-dns-value'}]}):page([{id:'other-id',name:'other-private.example'},target]);}});
 const r=await f.send(),v=await r!.json();assert.equal(r?.status,200);assert.equal(v.state,'ready');assert.equal(v.domain,'mail.example');assert.equal(v.domainVerified,true);assert.equal(v.sendingEnabled,true);assert.equal(v.senderReady,true);assert.equal(v.deliveryVerified,false);assert.equal(f.calls,2);assert.equal(f.urls[0],'https://api.resend.com/domains?limit=100');assert.equal(f.signals[0],f.signals[1]);assert.equal(f.count('identity_mail_provider_audit'),2);
 const dump=JSON.stringify({v,checks:f.db.sqlite.prepare('SELECT * FROM identity_mail_provider_checks').all(),audit:f.db.sqlite.prepare('SELECT * FROM identity_mail_provider_audit').all()});for(const privateText of [sender,'sender@',key,'other-private.example','other-id','private-dns-value','target-id'])assert(!dump.includes(privateText));
 const replay=await f.send();assert.deepEqual(await replay!.json(),v);assert.equal(f.calls,2);assert.equal(f.db.sqlite.prepare("SELECT count FROM rate_limits WHERE key='identity-mail-provider:global'").get()!.count,1);assert.throws(()=>f.db.sqlite.exec('DELETE FROM identity_mail_provider_checks'));assert.throws(()=>f.db.sqlite.exec('DELETE FROM identity_mail_provider_audit'));
});
for(const [status,sending,ready] of [['verified','disabled',false],['pending','enabled',false],['failed','enabled',false],['partially_verified','enabled',false],['temporary_failure','enabled',false]] as const)test('verification and sending capability are independent: '+status+'/'+sending,async t=>{
 const f=await fixture(t,{fetcher:async input=>String(input).includes('/domains/')?reply({object:'domain',...target,status,capabilities:{sending}}):page()});const v=await (await f.send())!.json();assert.equal(v.state,'not_ready');assert.equal(v.senderReady,ready);assert.equal(v.domainVerified,status==='verified');assert.equal(v.sendingEnabled,sending==='enabled');assert.equal(v.deliveryVerified,false);
});
test('pagination uses last ID and exact domain; complete legal traversal alone can prove missing',async t=>{
 const f=await fixture(t,{fetcher:async input=>{const u=new URL(String(input));if(u.pathname==='/domains/target-id')return reply({object:'domain',...target});return u.searchParams.has('after')?page():page([{id:'first-id',name:'parent.example'}],true);}});assert.equal((await (await f.send())!.json()).senderReady,true);assert.equal(f.urls[1],'https://api.resend.com/domains?limit=100&after=first-id');
 const missing=await fixture(t,{fetcher:async()=>page([{id:'parent-id',name:'example.com'},{id:'child-id',name:'nested.mail.example'}])});const v=await (await missing.send())!.json();assert.equal(v.state,'not_ready');assert.equal(v.reason,'domain_missing');assert.equal(v.senderReady,false);assert.equal(missing.calls,1);
});
for(const mode of ['empty-more','loop','malformed','missing-more','bad-id','too-many','page-bound','second-page-error','oversize','bad-utf8','bad-target','bad-capability','unknown-status','bad-json'] as const)test('partial or malformed provider evidence stays unknown: '+mode,async t=>{
 let n=0;const f=await fixture(t,{fetcher:async input=>{n++;if(mode==='empty-more')return page([],true);if(mode==='loop')return page([{id:'same-id',name:'other.example'}],true);if(mode==='malformed')return reply({object:'list',has_more:false,data:[{id:'bad-id'}]});if(mode==='missing-more')return reply({object:'list',data:[]});if(mode==='bad-id')return page([{id:'../emails',name:'other.example'}]);if(mode==='too-many')return page(Array.from({length:101},(_,i)=>({id:'id-'+i,name:'other.example'})));if(mode==='page-bound')return page([{id:'id-'+n,name:'other.example'}],true);if(mode==='second-page-error')return n===1?page([{id:'id-1',name:'other.example'}],true):reply({name:'service_unavailable',message:key},503);if(mode==='oversize')return new Response('x'.repeat(131073));if(mode==='bad-utf8')return new Response(new Uint8Array([0xff]));if(mode==='bad-json')return new Response('{');if(!String(input).includes('/domains/'))return page();return reply({object:'domain',...target,...(mode==='bad-target'?{name:'other.example'}:mode==='bad-capability'?{capabilities:{sending:true}}:{status:key})});}});
 const r=await f.send(),v=await r!.json();assert.equal(r?.status,502);assert.equal(v.state,'unknown');assert.equal(v.senderReady,null);assert.equal(v.deliveryVerified,false);assert(!JSON.stringify(v).includes(key));if(mode==='page-bound')assert.equal(f.calls,10);const replay=await f.send();assert.deepEqual(await replay!.json(),v);assert.equal(f.calls,n);
});
test('restricted metadata permission preserves HTTP and allowlisted name without blaming key or leaking raw body',async t=>{
 const f=await fixture(t,{fetcher:async()=>reply({name:'restricted_api_key',message:key+' '+sender,otherDomain:'private.example'},401)});const r=await f.send(),v=await r!.json();assert.equal(v.state,'unknown');assert.equal(v.providerHttpStatus,401);assert.equal(v.providerErrorName,'restricted_api_key');assert.equal(v.reason,'provider_rejected');const dump=JSON.stringify([v,...f.db.sqlite.prepare('SELECT * FROM identity_mail_provider_audit').all()]);for(const value of [key,sender,'private.example'])assert(!dump.includes(value));
 const unexpected=await fixture(t,{fetcher:async()=>reply({name:key},403)});assert.equal((await (await unexpected.send())!.json()).providerErrorName,null);
});
test('network failure is persisted as unknown and replay does not retry',async t=>{
 const f=await fixture(t,{fetcher:async()=>{throw new Error(key);}});const r=await f.send(),v=await r!.json();assert.equal(v.state,'unknown');assert.equal(v.reason,'provider_unavailable');assert.equal(v.senderReady,null);assert.deepEqual(await (await f.send())!.json(),v);assert.equal(f.calls,1);
});
test('one overall 15-second deadline includes a stalled provider response body',async t=>{
 const f=await fixture(t,{fetcher:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));}}))});const stalled=await fixture(t,{fetcher:async()=>new Promise<Response>(()=>{})});const started=Date.now();const responses=await Promise.all([f.send(),stalled.send()]);for(const response of responses){const v=await response!.json();assert.equal(v.state,'unknown');assert.equal(v.reason,'provider_timeout');}assert(Date.now()-started>=14500&&Date.now()-started<17500);assert.equal(f.calls,1);assert.equal(stalled.calls,1);assert.equal(stalled.signals[0].aborted,true);
});
test('two concurrent instances reserve one logical check and same-key polling does not retry checking',async t=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let entered!:()=>void;const began=new Promise<void>(r=>{entered=r;});const f=await fixture(t,{fetcher:async()=>{entered();await gate;return page([],false);}});const first=f.send();await began;const second=await f.send(),v=await second!.json();assert.equal(second?.status,202);assert.equal(v.state,'checking');assert.equal(v.senderReady,null);assert.equal(f.calls,1);assert.equal(f.count('identity_mail_provider_checks'),1);release();await first;assert.equal((await f.send())?.status,200);assert.equal(f.calls,1);
});
test('global quota counts ten distinct checks hourly; replay is free and quota rolls over',async t=>{
 const f=await fixture(t,{fetcher:async()=>page([],false)});for(let i=0;i<10;i++)assert.equal((await f.send('request-key-'+i))?.status,200);assert.equal((await f.send('request-key-10'))?.status,429);assert.equal(f.calls,10);assert.equal(f.count('identity_mail_provider_checks'),10);assert.equal((await f.send('request-key-0'))?.status,200);assert.equal(f.calls,10);f.env.now=()=>new Date('2026-11-01T01:00:00.001Z');assert.equal((await f.send('request-key-10'))?.status,200);assert.equal(f.calls,11);
});
test('same requestKey rejects any original FROM or origin change including equivalent domain',async t=>{
 const f=await fixture(t);await f.send();for(const from of ['Changed <sender@mail.example>','sender@mail.example','合成寄件人 <sender@MAIL.example>']){f.env.from=from;assert.equal((await f.send())?.status,409);}f.env.from=sender;f.env.origin='https://changed.example';assert.equal((await f.send('readiness-key',{},f.env.origin+path))?.status,409);assert.equal(f.calls,2);
});
test('intent/audit transaction failure prevents provider access and quota writes',async t=>{
 const f=await fixture(t,{before:db=>db.sqlite.exec("CREATE TRIGGER reject_mail_check_intent BEFORE INSERT ON identity_mail_provider_audit BEGIN SELECT RAISE(ABORT,'synthetic-audit-failure'); END;")});assert.equal((await f.send())?.status,503);assert.equal(f.calls,0);assert.equal(f.count('identity_mail_provider_checks'),0);assert.equal(f.count('rate_limits'),0);
});
test('completion audit failure preserves checking and cannot cause a repeat provider operation',async t=>{
 const f=await fixture(t,{before:db=>db.sqlite.exec("CREATE TRIGGER reject_mail_check_result BEFORE INSERT ON identity_mail_provider_audit WHEN NEW.action='completed' BEGIN SELECT RAISE(ABORT,'synthetic-audit-failure'); END;")});const r=await f.send();assert.equal(r?.status,503);assert.equal((await r!.json()).senderReady,null);assert.equal(f.calls,2);assert.equal(f.db.sqlite.prepare('SELECT state FROM identity_mail_provider_checks').get()!.state,'checking');assert.equal((await f.send())?.status,202);assert.equal(f.calls,2);
});
test('missing diagnostic schema fails only the new endpoint closed without network access',async t=>{
 const f=await fixture(t,{oldSchema:true});assert.equal((await f.send())?.status,503);assert.equal(f.calls,0);const env={DB:f.db,PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:'synthetic-operator'};const r=await runtime.fetch(new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-Tower-Operator-Key':'synthetic-operator'},body:JSON.stringify({requestKey:'readiness-key'})}),env);assert.equal(r.status,503);assert.equal((await r.json()).error,'mail_readiness_unavailable');const status=await runtime.fetch(new Request(origin+'/api/v1/status'),env);assert.equal(status.status,200);
});
test('Pages exact route wires same-environment operator auth and diagnostic only',async t=>{
 const f=await fixture(t,{apiKey:undefined});const env={DB:f.db,PUBLIC_ORIGIN:origin,TOWER_OPERATOR_KEY:'synthetic-operator',IDENTITY_MAIL_FROM:sender};const request=(token:string)=>new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/json','X-Tower-Operator-Key':token},body:JSON.stringify({requestKey:'pages-readiness-key'})});assert.equal((await runtime.fetch(request('wrong'),env)).status,401);assert.equal(f.count('identity_mail_provider_checks'),0);const r=await runtime.fetch(request('synthetic-operator'),env);assert.equal(r.status,503);assert.equal((await r.json()).reason,'provider_not_configured');assert.equal(f.count('identity_mail_events'),0);
});
test('a partial diagnostic migration must fail closed even for a prior successful receipt',async t=>{
 const f=await fixture(t);await f.send();f.db.sqlite.exec('DROP TABLE identity_mail_provider_audit');const r=await f.send();assert.equal(r?.status,503);assert.equal(f.calls,2);
});
test('concurrent distinct requestKeys cannot exceed the global hourly quota',async t=>{
 const f=await fixture(t,{fetcher:async()=>page([],false)});const results=await Promise.all(Array.from({length:12},(_,i)=>f.send('parallel-key-'+i)));assert.equal(results.filter(r=>r?.status===200).length,10);assert.equal(results.filter(r=>r?.status===429).length,2);assert.equal(f.calls,10);assert.equal(f.count('identity_mail_provider_checks'),10);assert.equal(f.count('identity_mail_provider_audit'),20);
});
test('lost reservation acknowledgement never starts provider access or deducts quota twice',async t=>{
 let once=true;const f=await fixture(t,{db:db=>({prepare:sql=>db.prepare(sql),async batch(statements){const result=await db.batch(statements);if(once){once=false;throw new Error('lost-reservation-ack');}return result;}})});assert.equal((await f.send())?.status,202);assert.equal((await f.send())?.status,202);assert.equal(f.calls,0);assert.equal(f.count('identity_mail_provider_checks'),1);assert.equal(f.db.sqlite.prepare("SELECT count FROM rate_limits WHERE key='identity-mail-provider:global'").get()!.count,1);
});
test('duplicate provider JSON fields cannot manufacture a complete missing-domain traversal',async t=>{
 const f=await fixture(t,{fetcher:async()=>new Response('{"object":"list","has_more":true,"has_more":false,"data":[]}')});const r=await f.send();assert.equal(r?.status,502);assert.equal((await r!.json()).state,'unknown');assert.equal(f.calls,1);
});
test('missing body and malformed UTF-8 are invalid JSON, while declared or streamed oversized input is rejected',async t=>{
 const f=await fixture(t);for(const body of [null,new Uint8Array([0xff])])assert.equal((await f.send('unused',{body}))?.status,400);assert.equal((await f.send('unused',{headers:{'Content-Type':'application/json','X-Tower-Operator-Key':'synthetic-operator','Content-Length':'1025'}}))?.status,413);assert.equal(f.calls,0);assert.equal(f.count('identity_mail_provider_checks'),0);
});
test('the exact printable ASCII bounds and escaped JSON strings are accepted and deduplicated',async t=>{
 const f=await fixture(t,{fetcher:async()=>page([],false)});for(const requestKey of [' '.repeat(8),'x'.repeat(96),'quoted"\\key']){assert.equal((await f.send(requestKey))?.status,200);assert.equal((await f.send(requestKey))?.status,200);}assert.equal((await f.send('ignored',{body:'{"\\u0072equestKey":"abcdefgh"}'}))?.status,200);assert.equal(f.calls,4);
});
