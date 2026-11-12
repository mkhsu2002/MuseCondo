// Historical pre-0035 pilot: preserve paid-dispatch/unknown-receipt safeguards. Current policy is covered by assisted-admission.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PNG} from 'pngjs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createManagerAdmission} from '../server/live/manager-admission.ts';
import {createTowerReception} from './helpers/legacy-reception.ts';
import {createTowerIntake} from '../server/live/tower-intake.ts';
import {homeSourceIdentity,readNativeHome} from '../server/live/home-source.ts';
import {towerSourceURL} from '../server/live/tower-source-url.ts';
import {CONDO_PROFILE_FIELDS} from '../src/framework/condo.ts';
const nativeShare='https://muse.ai/s/synthetic-home-abc123/'+'A'.repeat(43),nativeAlias=nativeShare.replace('A'.repeat(43),'B'.repeat(43));
const origin='https://tower.example',source='https://applicant.example/home/condo.json',resident='f'.repeat(16),secret='a'.repeat(64),towerKey='b'.repeat(64);
const home={templateVersion:'muse-condo-1',example:false,home:{frameworkVersion:'0.01',id:resident,name:'Synthetic Muse',intro:'A small public home.',assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[],dreams:[]},homeAlt:'A warm home',profile:Object.fromEntries(CONDO_PROFILE_FIELDS.map(k=>[k,'A public introduction.'])),dream:null};
function image(){const p=new PNG({width:160,height:90});p.data.fill(255);return new Uint8Array(PNG.sync.write(p));}
function fixture(mode='approve'){
 const db=new LocalDatabase(':memory:');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(v=>v.endsWith('.sql')&&(v<'0035'||v==='0037_tower_asset_storage.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 let time=new Date('2026-10-31T23:00:00.000Z'),paid=0,wakes=0,edgeSkew=0,claim:unknown;let sourceFailure=mode==='bad-home';let sourceHook:(()=>Promise<void>)|undefined,reviewHook:(()=>Promise<void>)|undefined,countHook:(()=>Promise<void>)|undefined;const provider:Record<string,unknown>[]=[],fetched:string[]=[];
 db.sqlite.function('strftime',{varargs:true},(_format,value,modifier)=>new Date((value==='now'?time.getTime():Date.parse(String(value)))+(modifier==='-15 minutes'?-900000:0)).toISOString());db.sqlite.function('julianday',{varargs:true},value=>((value==='now'?time.getTime():Date.parse(String(value)))/86400000+2440587.5));db.sqlite.exec('UPDATE tower_autonomy_mandate SET enabled=1');
 const sourceFetch:typeof fetch=async(url,init)=>{assert.equal(init?.redirect,'manual');assert.equal(new Headers(init?.headers).has('Authorization'),false);const u=String(url);fetched.push(u);await sourceHook?.();if(sourceFailure)return new Response(null,{status:503});if(mode.startsWith('native')){if(u.startsWith('https://muse.ai/s/')){const key=u.split('/').at(-1),slug='synthetic-home-abc123';const row='0:'+JSON.stringify({preloadedId:slug,preloadedShareKey:key,preloadedShareData:{type:'space',share_type:'cloudflare',deployment_status:'ready',asset_id:'abc123',space_url:`https://abc123.cf.metaaiusercontent.com/index.html?hatch_share=${slug}&share_key=${key}`}})+'\n';return new Response(`<script>self.__next_f.push([1,${JSON.stringify(row)}])</script>`,{headers:{'Content-Type':'text/html'}});}if(u.startsWith('https://abc123.cf.metaaiusercontent.com/index.html'))return new Response(`<section id="view-home"><p>${home.home.intro}</p><figure class="home-scene"><img src="assets/home.png" alt="${home.homeAlt}"></figure></section><section id="view-inside"><h2>${home.home.name}</h2><p>A public introduction.</p></section><section id="view-dreams"></section><script id="musecondo-home" type="application/json">${JSON.stringify(home)}</script>`,{headers:{'Content-Type':'text/html'}});}if(mode==='redirect-manifest'&&u.endsWith('/condo.json')||mode==='redirect-image'&&u.endsWith('.png'))return new Response(null,{status:308,headers:{Location:'/elsewhere'}});if(/\.html$/.test(u)&&mode.startsWith('page-redirect-')){const parsed=new URL(u),canonical=parsed.pathname.endsWith('/index.html')?parsed.pathname.slice(0,-10):parsed.pathname.replace(/\.html$/,'');return new Response(null,{status:308,headers:{Location:mode==='page-redirect-external'?'https://outside.example/':mode==='page-redirect-query'?canonical+'?secret=no':mode==='page-redirect-other'?'/other/':canonical}});}if(mode==='page-redirect-loop'&&!u.endsWith('/condo.json'))return new Response(null,{status:308,headers:{Location:'/again'}});if(u.endsWith('/condo.json'))return Response.json(home);if(u.endsWith('/muse-tower-claim.json'))return Response.json(claim);if(u.endsWith('.png'))return new Response(image(),{headers:{'Content-Type':'image/png'}});return new Response('<!doctype html><title>A public home</title>',{headers:{'Content-Type':'text/html'}});};
 const transport:typeof fetch=async(url,init)=>{const p=JSON.parse(String(init?.body));provider.push(p);if(String(url).endsWith('/input_tokens')){await countHook?.();return Response.json({input_tokens:120});}paid++;await reviewHook?.();if(mode==='unknown')throw Error('PRIVATE_NETWORK_ERROR');return Response.json({id:'actual-synthetic-response',model:'muse-spark-1.3',status:'completed',usage:{input_tokens:120,output_tokens:80},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({decision:mode==='needs-info'?'needs-info':mode==='reject'?'reject':'approve',reason:'PRIVATE_MODEL_REASON not public'})}]}]});};
 const manager=createManagerAdmission({db,now:()=>new Date(time.getTime()+edgeSkew),apiKey:'synthetic-not-real',transport,sourceFetch,wake:async()=>{wakes++;}});
 const reception=createTowerReception({db,origin,sourceFetch,now:()=>time,operator:async r=>r.headers.get('X-Tower-Operator-Key')==='synthetic-operator',onReview:manager.enqueue,reviewStatus:manager.status});
 const input={requestKey:'open-case-01',name:'Synthetic Muse',requestKind:'new',request:'Please review my public home.',sourceURL:source,residentId:resident,isMuseAgent:true,authorization:{contact:true,application:true,towerAccess:true},sharing:{snapshot:false,directory:false,announcement:false,dream:false},visitPlan:{mode:'manual-return'}};
 const req=(path:string,body?:unknown,method=body?'POST':'GET',key=secret,extra:Record<string,string>={})=>reception.fetch(new Request(origin+'/api/v1/reception'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,...extra},...(body?{body:JSON.stringify(body)}:{})}));
 return {db,manager,input,req,sourceFetch,provider,fetched,setSourceAvailable(value:boolean){sourceFailure=!value;},onSource(fn:()=>Promise<void>){sourceHook=fn;},onReview(fn:()=>Promise<void>){reviewHook=fn;},onCount(fn:()=>Promise<void>){countHook=fn;},skew(ms:number){edgeSkew=ms;},get paid(){return paid;},get wakes(){return wakes;},setClaim(value:unknown){claim=value;},move(date:string){time=new Date(date);}};
}
test('persisted new Muse home receives a genuine scoped Meta review then one atomic approval; source grant remains exact and client-owned challenge is mandatory',async()=>{
 const f=fixture();try{const opened=(await f.req('/cases',f.input))!;assert.equal(opened.status,201);const c=await opened.json();assert.equal(c.case.review.state,'queued');assert.equal(f.paid,0);assert.equal(f.wakes,1);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_jobs').get()!.n,1);await f.manager.step();const reply=await(await f.req('/cases/'+c.case.id))!.json();assert.equal(reply.case.state,'approved');assert.equal(reply.case.version,2);assert.equal(f.paid,1);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM accounts').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_tokens').get()!.n,0);const d=f.db.sqlite.prepare('SELECT * FROM tower_admission_eligible').get()!;assert.equal(d.agent_origin,'meta-muse');assert.equal(d.evidence_kind,'operator-review');assert.match(String(d.evidence_ref),/^manager-review:/);const ledger=f.db.sqlite.prepare("SELECT * FROM manager_admission_calls WHERE phase='review'").get()!;assert.equal(ledger.state,'received');assert.equal(ledger.provider_id,'actual-synthetic-response');assert.doesNotMatch(JSON.stringify(reply),/PRIVATE_MODEL_REASON|muse-spark|synthetic-not-real|prompt/);assert.ok(f.provider[1].input);assert.match(String(f.provider[1].input),/actualPublicHome/);assert.match(String(f.provider[1].input),/"checks":\{"hasName":true,"hasIntro":true,"profileComplete":true,"threePages":true,"dreamPresent":false,"imagesValid":true\}/);assert.match(String(f.db.sqlite.prepare('SELECT next_action FROM tower_reception_cases WHERE id=?').get(c.case.id)!.next_action),/activate it with POST \/api\/v1\/reception\/cases\/[a-f0-9-]+\/activate/);await f.manager.step();assert.equal(f.paid,1);
 const activate=await f.req('/cases/'+c.case.id+'/activate',{requestKey:'activate-case-01',expectedVersion:2},'POST',secret,{'X-Tower-Agent-Key':towerKey});assert.equal(activate!.status,201);const intake=createTowerIntake({db:f.db,origin,localTest:true,sourceOrigins:[],now:()=>new Date('2026-10-31T23:00:00.000Z'),fetcher:f.sourceFetch});const iq=(route:string,body:unknown)=>intake.fetch(new Request(origin+'/api/v1/agent/tower-intake/'+route,{method:'POST',headers:{Authorization:'Bearer '+towerKey,'Content-Type':'application/json'},body:JSON.stringify(body)}));const prepared=(await iq('prepare',{requestKey:'prepare-home-01',sourceURL:source,residentId:resident}))!;assert.equal(prepared.status,201,await prepared.clone().text());const prep=await prepared.json();f.setClaim(prep.claim);const denied=(await iq('import',{requestKey:'import-before-claim',sourceURL:source,residentId:resident,proof:'challenge'}))!;assert.equal(denied.status,403);const verified=(await iq('claim',{claimId:prep.claimId}))!;assert.equal(verified.status,200,await verified.clone().text());const wrong=(await iq('prepare',{requestKey:'wrong-source-01',sourceURL:'https://other.example/condo.json',residentId:resident}))!;assert.equal(wrong.status,400);const imported=(await iq('import',{requestKey:'import-after-claim',sourceURL:source,residentId:resident,proof:'challenge',claimId:prep.claimId}))!;assert.equal(imported.status,201,await imported.clone().text());assert.equal(f.db.sqlite.prepare('SELECT directory_consent FROM tower_residencies').get()!.directory_consent,0);
 }finally{f.db.close();}
});
test('missing/conflicting declarations never become a paid review; a legacy pending case can explicitly supplement details',async()=>{
 const f=fixture();try{assert.equal((await f.req('/cases',{...f.input,isMuseAgent:true,originClaim:'other'}))!.status,400);const no={...f.input} as Record<string,unknown>;delete no.isMuseAgent;no.originClaim='meta-muse';const c=await(await f.req('/cases',no))!.json();assert.equal(c.case.review.state,'needs-info');assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_jobs').get()!.n,0);const detail=(await f.req('/cases/'+c.case.id+'/details',{requestKey:'supplement-01',expectedVersion:1,isMuseAgent:true}))!;assert.equal(detail.status,200,await detail.clone().text());assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_jobs').get()!.n,1);await f.manager.step();assert.equal(f.paid,1);assert.equal((await(await f.req('/cases/'+c.case.id))!.json()).case.state,'approved');assert.equal(f.db.sqlite.prepare('SELECT origin_claim FROM tower_reception_origin_claims').get()!.origin_claim,'meta-muse');
 }finally{f.db.close();}
});
test('unknown Meta result blocks the whole logical case across applicant revisions, keeps reserve and never grants or retries',async()=>{
 const f=fixture('unknown');try{const c=await(await f.req('/cases',f.input))!.json();await f.manager.step();assert.equal(f.paid,1);assert.equal(f.db.sqlite.prepare("SELECT state FROM manager_admission_calls WHERE phase='review'").get()!.state,'unknown');assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM accounts').get()!.n,0);const more=(await f.req('/cases/'+c.case.id+'/details',{requestKey:'new-details-01',expectedVersion:1,sourceURL:'https://applicant.example/new/condo.json'}))!;assert.equal(more.status,200);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_jobs').get()!.n,1);await f.manager.step();assert.equal(f.paid,1);assert.equal((await f.manager.status(c.case.id))!.state,'blocked');assert.throws(()=>f.db.sqlite.exec("UPDATE manager_admission_calls SET state='dispatching'"),/immutable/);assert.throws(()=>f.db.sqlite.exec('DELETE FROM manager_admission_calls'),/permanent/);
 }finally{f.db.close();}
});
test('unreachable home, wrong image ratio and reserved hosts cannot be approved or expose a fetch proxy',async()=>{
 for(const host of ['https://localhost./condo.json','https://metadata.google.internal./condo.json','https://127.0.0.1/condo.json','https://u:p@public.example/condo.json','https://bad..example/condo.json','https://x.local/condo.json'])assert.throws(()=>towerSourceURL(host));
 const f=fixture('bad-home');try{const c=await(await f.req('/cases',f.input))!.json();await f.manager.step();assert.equal(f.paid,0);assert.equal((await f.manager.status(c.case.id))!.state,'needs-info');assert.match(String(f.db.sqlite.prepare('SELECT next_action FROM tower_reception_cases WHERE id=?').get(c.case.id)!.next_action),/could not be read/);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM accounts').get()!.n,0);}finally{f.db.close();}
});

test('an explicit non-Muse declaration is durably rejected by actual Meta without inspecting a home or granting any identity',async()=>{
 for(const legacy of [false,true]){const f=fixture('reject');try{let opened;if(legacy){const old={...f.input} as Record<string,unknown>;delete old.isMuseAgent;old.originClaim='unknown';opened=await(await f.req('/cases',old))!.json();const r=(await f.req('/cases/'+opened.case.id+'/details',{requestKey:'explicit-nonmuse-01',expectedVersion:1,isMuseAgent:false}))!;assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).case.review.state,'queued');}else{const input={...f.input,isMuseAgent:false} as Record<string,unknown>;delete input.sourceURL;delete input.residentId;opened=await(await f.req('/cases',input))!.json();assert.equal(opened.case.review.state,'queued');}await f.manager.step();const current=await(await f.req('/cases/'+opened.case.id))!.json();assert.equal(current.case.state,'rejected');assert.equal(current.case.isMuseAgent,false);assert.equal(f.paid,1);assert.equal(f.fetched.length,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM accounts').get()!.n,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_admission_decisions').get()!.n,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM agent_identities').get()!.n,0);assert.equal(f.db.sqlite.prepare('SELECT decision FROM manager_admission_results').get()!.decision,'reject');await f.manager.step();assert.equal(f.paid,1);}finally{f.db.close();}}
});
test('a model cannot approve a non-Muse, even if it ignores its narrow decision contract',async()=>{
 const f=fixture('approve');try{const c=await(await f.req('/cases',{...f.input,isMuseAgent:false}))!.json();await f.manager.step();assert.equal(f.paid,1);assert.equal(f.db.sqlite.prepare('SELECT state FROM manager_admission_jobs').get()!.state,'blocked');assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_results').get()!.n,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM accounts').get()!.n,0);await f.manager.step();assert.equal(f.paid,1);assert.equal((await f.manager.status(c.case.id))!.state,'blocked');}finally{f.db.close();}
});
test('permanent write receipts include a stable safe review snapshot, and ordinary messages/visits never invalidate or clone a material review',async()=>{
 const f=fixture();try{const opened=await(await f.req('/cases',f.input))!.json();const message={requestKey:'message-01',expectedVersion:1,message:'I will return soon.'};const first=await(await f.req('/cases/'+opened.case.id+'/messages',message))!.json();assert.equal(first.case.review.state,'queued');const visit=await f.req('/cases/'+opened.case.id+'/visit-plan',{requestKey:'visit-plan-01',expectedVersion:2,visitPlan:{mode:'manual-return'}});assert.equal(visit!.status,200);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_jobs').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT review_case_version FROM tower_reception_cases').get()!.review_case_version,1);await f.manager.step();assert.equal(f.paid,1);assert.equal((await(await f.req('/cases/'+opened.case.id))!.json()).case.state,'approved');assert.deepEqual(await(await f.req('/cases',f.input))!.json(),opened);assert.deepEqual(await(await f.req('/cases/'+opened.case.id+'/messages',message))!.json(),first);assert.equal(f.paid,1);}finally{f.db.close();}
});

test('permanent manager qualification outlives the short activation lease and remains subject to explicit policy/head revocation',async()=>{
 const f=fixture();try{const c=await(await f.req('/cases',f.input))!.json();await f.manager.step();const decision=f.db.sqlite.prepare('SELECT * FROM tower_admission_decisions').get()!;assert.equal(decision.expires_at,'9999-12-31T23:59:59.999Z');const current=await(await f.req('/cases/'+c.case.id))!.json();assert.equal(current.case.approvalExpiresAt,'2026-11-30T23:00:00.000Z');assert.equal((await f.req('/cases/'+c.case.id+'/activate',{requestKey:'activate-permanent-01',expectedVersion:2},'POST',secret,{'X-Tower-Agent-Key':towerKey}))!.status,201);f.move('2028-01-01T23:00:00.000Z');assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_admission_eligible').get()!.n,1);assert.equal((await f.req('/cases/'+c.case.id+'/activate',{requestKey:'expired-new-key-01',expectedVersion:3},'POST',secret,{'X-Tower-Agent-Key':'c'.repeat(64)}))!.status,403);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_tokens').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT expires_at FROM tower_tokens').get()!.expires_at,'2026-11-30T23:00:00.000Z');
 // The eligibility layer allows a separately authorized future recovery to issue its own new scoped grant.
 assert.doesNotThrow(()=>f.db.sqlite.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES('recovery-layer-fixture',?,'new-recovery-hash','[\"tower:read\",\"tower:write\"]','2028-02-01T23:00:00.000Z','2028-01-01T23:00:00.000Z')").run(decision.account_id));
 const negative={...decision,id:'e'.repeat(32),state:'ineligible',evidence_ref:'explicit-operator-revocation',expires_at:'2029-01-01T23:00:00.000Z',created_at:'2028-01-01T23:00:00.000Z'};f.db.sqlite.prepare('INSERT INTO tower_admission_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(negative) as never[]);f.db.sqlite.prepare('UPDATE tower_admission_heads SET decision_id=?,revision=revision+1').run(negative.id);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_admission_eligible').get()!.n,0);assert.throws(()=>f.db.sqlite.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES('revoked-fixture',?,'revoked-hash','[]','2028-02-01T23:00:00.000Z','2028-01-01T23:00:00.000Z')").run(decision.account_id),/admission_required/);assert.equal(f.paid,1);
 }finally{f.db.close();}
});

for(const skew of [1,50])test('manager approval uses authoritative D1 completion time with Edge clock ahead '+skew+'ms',async()=>{
 const f=fixture();try{const c=await(await f.req('/cases',f.input))!.json();f.skew(skew);await f.manager.step();assert.equal(f.paid,1);assert.equal((await f.manager.status(c.case.id))!.state,'approved');const d=f.db.sqlite.prepare('SELECT * FROM tower_admission_eligible').get()!;assert(d);assert.equal(d.created_at,'2026-10-31T23:00:00.000Z');assert.equal(f.db.sqlite.prepare('SELECT created_at FROM manager_admission_results').get()!.created_at,d.created_at);assert.equal(f.db.sqlite.prepare('SELECT approval_expires_at FROM tower_reception_cases').get()!.approval_expires_at,'2026-11-30T23:00:00.000Z');assert.equal(f.db.sqlite.prepare("SELECT created_at FROM manager_admission_audit WHERE kind='review-completed'").get()!.created_at,d.created_at);await f.manager.step();assert.equal(f.paid,1);
 }finally{f.db.close();}
});

function connect(f:ReturnType<typeof fixture>,sourceURL=source,residentId=resident){
 const at='2026-10-31T23:00:00.000Z',account=crypto.randomUUID(),decision=crypto.randomUUID(),room=crypto.randomUUID().replaceAll('-','').slice(0,16);
 f.db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,account,at);
 const nativeCase=sourceURL.startsWith('https://muse.ai/s/')&&!sourceURL.endsWith('/condo.json')?crypto.randomUUID().replaceAll('-',''):null;
 if(nativeCase)f.db.sqlite.prepare("INSERT INTO tower_reception_cases(id,token_hash,state,version,name,request_kind,request_text,authorization_json,sharing_json,visit_plan_json,next_action,expires_at,created_at,updated_at) VALUES(?,?,'pending',1,'Seed','new','Seed','{}','{}','{}','Seed','9999-12-31T23:59:59.999Z',?,?)").run(nativeCase,'seed-'+account,at,at);
 f.db.sqlite.prepare("INSERT INTO tower_admission_decisions(id,policy_version,case_id,account_id,resident_id,source_url,state,agent_origin,evidence_kind,evidence_ref,operator_class,expires_at,created_at) VALUES(?,1,?,?,?,?,'eligible','meta-muse','operator-review','synthetic-existing','shared-operator','9999-12-31T23:59:59.999Z',?)").run(decision,nativeCase,account,residentId,sourceURL,at);
 f.db.sqlite.prepare('INSERT INTO tower_admission_heads VALUES(?,?,1)').run(nativeCase?'case:'+nativeCase:'account:'+account,decision);
 if(nativeCase)f.db.sqlite.prepare("UPDATE tower_reception_cases SET state='active',version=2,review_case_version=2,account_id=?,resident_id=?,source_url=?,approval_expires_at='9999-12-31T23:59:59.999Z' WHERE id=?").run(account,residentId,sourceURL,nativeCase);
 f.db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Existing','Existing','resident','external-ready',?)").run(room,account,at);
 f.db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'owner-attested',?,?)").run(room,account,residentId,sourceURL,at,at);
}
test('connected exact source OR resident is a zero-download zero-transport precheck with no cross-case disclosure',async()=>{
 for(const match of ['source','resident']){const f=fixture();try{connect(f,match==='source'?source:'https://existing.example/condo.json',match==='resident'?resident:'e'.repeat(16));const original=f.db.sqlite.prepare('SELECT * FROM tower_residencies').get();const opened=await(await f.req('/cases',f.input))!.json();await f.manager.step();assert.equal(f.paid,0);assert.equal(f.provider.length,0);assert.equal(f.fetched.length,0);assert.equal((await f.manager.status(opened.case.id))!.state,'needs-info');const output=await(await f.req('/cases/'+opened.case.id))!.text();assert.doesNotMatch(output,/synthetic-existing|existing.example|Existing/);assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM tower_residencies').get(),original);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_calls').get()!.n,0);}finally{f.db.close();}}
});
test('pending duplicate work is serialized and approved but unimported applications grant only a bounded non-renewing review cooldown',async()=>{
 const f=fixture();try{const a=await(await f.req('/cases',f.input))!.json();let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>{started=r;}),hold=new Promise<void>(r=>{release=r;});let once=false;f.onSource(async()=>{if(!once){once=true;started();await hold;}});const running=f.manager.step();await waiting;
 const b=await(await f.req('/cases',{...f.input,requestKey:'other-applicant-01'},'POST','c'.repeat(64)))!.json();await f.manager.step();assert.equal(f.paid,0);assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM manager_admission_jobs WHERE state='running'").get()!.n,1);release();await running;assert.equal(f.paid,1);assert.equal((await f.manager.status(a.case.id))!.state,'approved');const downloads=f.fetched.length;await f.manager.step();assert.equal((await f.manager.status(b.case.id))!.state,'needs-info');assert.equal(f.paid,1);assert.equal(f.fetched.length,downloads);
 assert.equal(await f.manager.pending(),false);assert.ok([900,901].includes((await f.manager.status(b.case.id))!.retryAfterSeconds!));const wakes=f.wakes;await f.manager.enqueue(b.case.id);assert.equal(f.wakes,wakes);for(let i=0;i<3;i++)await f.manager.step();assert.equal(f.paid,1);f.move('2026-10-31T23:14:59.750Z');assert.equal((await f.manager.status(b.case.id))!.retryAfterSeconds,1);assert.equal(await f.manager.pending(),false);f.move('2026-10-31T23:16:00.000Z');assert.equal((await f.manager.status(b.case.id))!.state,'queued');await f.manager.step();assert.equal(f.paid,2);assert.equal((await f.manager.status(b.case.id))!.state,'approved');assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_jobs WHERE case_id=?').get(b.case.id)!.n,1);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_results').get()!.n,2);
 }finally{f.db.close();}
});
test('unreviewed queued sources cannot indefinitely reserve a public source and unrelated Fang-style sources can review during cooldown',async()=>{
 const f=fixture();try{await f.req('/cases',f.input);await f.manager.step();const next=await(await f.req('/cases',{...f.input,requestKey:'fang-home-01',sourceURL:'https://fang.example/condo.json',residentId:'e'.repeat(16)},'POST','c'.repeat(64)))!.json();
 // The source fixture must return the matching resident manifest.
 const alternate=createManagerAdmission({db:f.db,now:()=>new Date('2026-10-31T23:00:00.000Z'),apiKey:'synthetic',sourceFetch:async(url,init)=>String(url).endsWith('/condo.json')?Response.json({...home,home:{...home.home,id:'e'.repeat(16)}}):f.sourceFetch(url,init),transport:async(url)=>String(url).endsWith('/input_tokens')?Response.json({input_tokens:10}):Response.json({id:'fang-review',model:'muse-spark-1.3',status:'completed',usage:{input_tokens:10,output_tokens:10},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({decision:'approve',reason:'Ready'})}]}]})});await alternate.step();assert.equal((await f.manager.status(next.case.id))!.state,'approved');assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM manager_admission_calls WHERE phase='review'").get()!.n,2);
 }finally{f.db.close();}
});
test('a residence connecting during downloads prevents all paid dispatch and one connecting during review prevents approval atomically',async()=>{
 for(const phase of ['source','review']){const f=fixture();try{const c=await(await f.req('/cases',f.input))!.json();let once=false;const hook=async()=>{if(!once){once=true;connect(f);}};if(phase==='source')f.onSource(hook);else f.onReview(hook);await f.manager.step();assert.equal(f.paid,phase==='source'?0:1);assert.equal((await f.manager.status(c.case.id))!.state,phase==='source'?'needs-info':'blocked');assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_results').get()!.n,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_residencies').get()!.n,1);assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM tower_admission_decisions WHERE evidence_ref LIKE 'manager-review:%'").get()!.n,0);}finally{f.db.close();}}
});

test('atomic pre-dispatch receipt guard stops paid review if a residence connects after token count',async()=>{
 const f=fixture();try{const c=await(await f.req('/cases',f.input))!.json();f.onCount(async()=>connect(f));await f.manager.step();assert.equal(f.provider.length,1);assert.equal(f.paid,0);assert.equal((await f.manager.status(c.case.id))!.state,'blocked');assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM manager_admission_calls WHERE phase='review'").get()!.n,0);assert.equal(f.db.sqlite.prepare("SELECT state FROM manager_admission_calls WHERE phase='count'").get()!.state,'received');await f.manager.step();assert.equal(f.paid,0);}finally{f.db.close();}
});

test('non-Muse supplied connected source still receives real reject review without fetching the home',async()=>{
 const f=fixture('reject');try{connect(f);const opened=await(await f.req('/cases',{...f.input,isMuseAgent:false}))!.json();await f.manager.step();assert.equal(f.paid,1);assert.equal(f.fetched.length,0);assert.equal((await f.manager.status(opened.case.id))!.state,'rejected');assert.equal(f.db.sqlite.prepare('SELECT decision FROM manager_admission_results').get()!.decision,'reject');}finally{f.db.close();}
});

test('unknown paid source OR resident survives cooldown and rotated case keys without another download or provider call',async()=>{
 for(const match of ['source','resident','non-muse']){const f=fixture('unknown');try{await f.req('/cases',f.input);await f.manager.step();const receipt=f.db.sqlite.prepare("SELECT * FROM manager_admission_calls WHERE phase='review'").get();assert.equal(receipt!.state,'unknown');const downloads=f.fetched.length,providers=f.provider.length;f.move('2026-10-31T23:16:00.000Z');const opened=await(await f.req('/cases',{...f.input,requestKey:'rotated-key-unknown-01',sourceURL:match==='resident'?'https://other.example/condo.json':source,residentId:match==='source'?'e'.repeat(16):resident,isMuseAgent:match!=='non-muse'},'POST','c'.repeat(64)))!.json();await f.manager.step();assert.equal((await f.manager.status(opened.case.id))!.state,'blocked');assert.equal(f.db.sqlite.prepare('SELECT error_code FROM manager_admission_jobs WHERE case_id=?').get(opened.case.id)!.error_code,'review_source_result_unknown');assert.equal(f.fetched.length,downloads);assert.equal(f.provider.length,providers);assert.equal(f.paid,1);assert.deepEqual(f.db.sqlite.prepare("SELECT * FROM manager_admission_calls WHERE phase='review'").get(),receipt);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_calls WHERE case_id=?').get(opened.case.id)!.n,0);assert.equal(f.db.sqlite.prepare('SELECT state FROM tower_reception_cases WHERE id=?').get(opened.case.id)!.state,'pending');assert.throws(()=>f.db.sqlite.exec("UPDATE manager_admission_calls SET state='dispatching' WHERE phase='review'"),/immutable/);
 // Unrelated supplied identities are still eligible for actual review.
 const other=await(await f.req('/cases',{...f.input,requestKey:'unrelated-after-unknown-01',sourceURL:'https://unrelated.example/condo.json',residentId:'d'.repeat(16),isMuseAgent:false},'POST','d'.repeat(64)))!.json();let calls=0;const manager=createManagerAdmission({db:f.db,now:()=>new Date('2026-10-31T23:16:00.000Z'),apiKey:'synthetic',transport:async(url)=>{calls++;return String(url).endsWith('/input_tokens')?Response.json({input_tokens:10}):Response.json({id:'unrelated-reject',model:'muse-spark-1.3',status:'completed',usage:{input_tokens:10,output_tokens:10},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({decision:'reject',reason:'Not Muse'})}]}]});}});await manager.step();assert.equal(calls,2);assert.equal((await manager.status(other.case.id))!.state,'rejected');
 }finally{f.db.close();}}
});
test('native receipt insertion independently blocks cross-case unknown source after cooldown without modifying the original reserve',async()=>{
 const f=fixture('unknown');try{await f.req('/cases',f.input);await f.manager.step();f.move('2026-10-31T23:16:00.000Z');const original=f.db.sqlite.prepare("SELECT * FROM manager_admission_calls WHERE phase='review'").get();const opened=await(await f.req('/cases',{...f.input,requestKey:'atomic-unknown-guard-01'},'POST','c'.repeat(64)))!.json();const job=f.db.sqlite.prepare('SELECT id FROM manager_admission_jobs WHERE case_id=?').get(opened.case.id)!.id;f.db.sqlite.prepare("UPDATE manager_admission_jobs SET state='running',lease_until='2026-10-31T23:21:00.000Z' WHERE id=?").run(job);assert.throws(()=>f.db.sqlite.prepare("INSERT INTO manager_admission_calls(id,job_id,case_id,phase,billing_day,state,reserved_micro,created_at) VALUES('cross-case-unknown',?,?,'count','2026-10-31','dispatching',0,'2026-10-31T23:16:00.000Z')").run(job,opened.case.id),/review_source_result_unknown/);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_calls WHERE job_id=?').get(job)!.n,0);assert.deepEqual(f.db.sqlite.prepare("SELECT * FROM manager_admission_calls WHERE phase='review'").get(),original);assert.equal(original!.reserved_micro,30000);}finally{f.db.close();}
});
test('an unresolved dispatching review also blocks a rotated case before any download',async()=>{
 const f=fixture();try{const first=await(await f.req('/cases',f.input))!.json();const job=f.db.sqlite.prepare('SELECT id FROM manager_admission_jobs WHERE case_id=?').get(first.case.id)!.id;f.db.sqlite.prepare("UPDATE manager_admission_jobs SET state='running',lease_until='2026-10-31T23:05:00.000Z' WHERE id=?").run(job);f.db.sqlite.prepare("INSERT INTO manager_admission_calls(id,job_id,case_id,phase,billing_day,state,reserved_micro,created_at) VALUES('synthetic-unsettled-review',?,?,'review','2026-10-31','dispatching',30000,'2026-10-31T23:00:00.000Z')").run(job,first.case.id);f.db.sqlite.prepare("UPDATE manager_admission_jobs SET state='blocked',lease_until=NULL WHERE id=?").run(job);f.move('2026-10-31T23:16:00.000Z');const next=await(await f.req('/cases',{...f.input,requestKey:'unsettled-new-case-01'},'POST','c'.repeat(64)))!.json();await f.manager.step();assert.equal((await f.manager.status(next.case.id))!.state,'blocked');assert.equal(f.db.sqlite.prepare('SELECT error_code FROM manager_admission_jobs WHERE case_id=?').get(next.case.id)!.error_code,'review_source_result_unknown');assert.equal(f.fetched.length,0);assert.equal(f.provider.length,0);assert.equal(f.db.sqlite.prepare("SELECT state FROM manager_admission_calls WHERE id='synthetic-unsettled-review'").get()!.state,'dispatching');}finally{f.db.close();}
});


test('normal same-home clean-page redirects reach review; all other redirects stop before any provider call',async()=>{
 for(const mode of ['page-redirect-clean','page-redirect-external','page-redirect-query','page-redirect-other','page-redirect-loop','redirect-manifest','redirect-image']){
  const f=fixture(mode);try{
   const opened=await(await f.req('/cases',f.input))!.json();await f.manager.step();
   assert.equal((await f.manager.status(opened.case.id))!.state,mode==='page-redirect-clean'?'approved':'needs-info');
   assert.equal(f.paid,mode==='page-redirect-clean'?1:0);
   if(mode==='page-redirect-clean')for(const path of ['https://applicant.example/home/','https://applicant.example/home/inside','https://applicant.example/home/dreams'])assert.ok(f.fetched.includes(path),path);
   else {assert.equal(f.provider.length,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM accounts').get()!.n,0);assert(!f.fetched.some(u=>u.startsWith('https://outside.example/')));}
  }finally{f.db.close();}
 }
});


test('repairing the same home URL requeues only a known zero-call technical failure and exact replay cannot repeat review',async()=>{
 const f=fixture('bad-home');try{
  const opened=await(await f.req('/cases',f.input))!.json();await f.manager.step();assert.equal(f.paid,0);assert.equal(f.provider.length,0);
  const current=await(await f.req('/cases/'+opened.case.id))!.json();assert.equal(current.case.review.state,'needs-info');f.setSourceAvailable(true);
  const body={requestKey:'retry-repaired-home',expectedVersion:current.case.version,homeURL:'https://applicant.example/home/'};
  const receipt=await(await f.req('/cases/'+opened.case.id+'/details',body))!.json();assert.equal(receipt.case.id,opened.case.id);await f.manager.step();assert.equal(f.paid,1);assert.equal((await f.manager.status(opened.case.id))!.state,'approved');
  assert.deepEqual(await(await f.req('/cases/'+opened.case.id+'/details',body))!.json(),receipt);await f.manager.step();assert.equal(f.paid,1);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_reception_cases').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_jobs').get()!.n,2);
 }finally{f.db.close();}
});
for(const mode of ['unknown','needs-info'])test('same URL cannot requeue a '+mode+' provider result',async()=>{
 const f=fixture(mode);try{
  const opened=await(await f.req('/cases',f.input))!.json();await f.manager.step();const current=await(await f.req('/cases/'+opened.case.id))!.json();assert.equal(f.paid,1);
  const response=(await f.req('/cases/'+opened.case.id+'/details',{requestKey:'never-repeat-provider',expectedVersion:current.case.version,homeURL:'https://applicant.example/home/'}))!;assert.equal(response.status,200);await f.manager.step();assert.equal(f.paid,1);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_jobs').get()!.n,1);assert.equal((await f.manager.status(opened.case.id))!.state,mode==='unknown'?'blocked':'needs-info');
 }finally{f.db.close();}
});
test('free same-source retries retain the existing three-job cap and durable audit',async()=>{
 const f=fixture('bad-home');try{
  const opened=await(await f.req('/cases',f.input))!.json();await f.manager.step();
  for(let n=0;n<3;n++){const current=await(await f.req('/cases/'+opened.case.id))!.json();const r=(await f.req('/cases/'+opened.case.id+'/details',{requestKey:'bounded-free-retry-'+n,expectedVersion:current.case.version,sourceURL:source,residentId:resident}))!;assert.equal(r.status,200);await f.manager.step();}
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM manager_admission_jobs').get()!.n,3);assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM manager_admission_audit WHERE kind='free-precheck-retry'").get()!.n,2);assert.equal(f.provider.length,0);assert.equal(f.paid,0);
 }finally{f.db.close();}
});


test('native address persists when unreadable, same case recovers, real normalized home reaches review and receipt replay is permanent',async()=>{
 const f=fixture('native');try{
  f.setSourceAvailable(false);const input={...f.input,sourceURL:undefined,residentId:undefined,homeURL:nativeShare};
  const openResponse=(await f.req('/cases',input))!;assert.equal(openResponse.status,201,await openResponse.clone().text());const opened=await openResponse.json();
  assert.equal(opened.case.homeURL,nativeShare);assert.equal(opened.case.sourceResolution.state,'needs-info');assert.equal(opened.case.review.state,'needs-info');assert.equal(opened.case.sourceURL,null);
  assert.match(opened.case.nextAction,/same case/);assert.equal((await(await f.req('/cases/'+opened.case.id))!.json()).case.homeURL,nativeShare);
  await f.manager.step();assert.equal(f.provider.length,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_reception_sources').get()!.n,1);
  f.setSourceAvailable(true);await readNativeHome(nativeShare,f.sourceFetch);const details={requestKey:'native-home-repaired',expectedVersion:(await(await f.req('/cases/'+opened.case.id))!.json()).case.version,homeURL:nativeShare};const repaired=(await f.req('/cases/'+opened.case.id+'/details',details))!;assert.equal(repaired.status,200,await repaired.clone().text());const receipt=await repaired.json();assert.equal(receipt.case.sourceURL,nativeShare);assert.equal(receipt.case.sourceResolution.sourceIdentity,'muse-space:abc123');
  await f.manager.step();assert.equal(f.paid,1);assert.equal((await f.manager.status(opened.case.id))!.state,'approved');assert.match(String(f.provider.at(-1)!.input),/A small public home/);assert(!String(f.provider.at(-1)!.input).includes('share_key'));
  assert.deepEqual(await(await f.req('/cases/'+opened.case.id+'/details',details))!.json(),receipt);assert.deepEqual(await(await f.req('/cases',input))!.json(),opened);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_reception_cases').get()!.n,1);
 }finally{f.db.close();}
});

test('native stable asset alias blocks unknown work before download and in SQL even with a changed resident ID',async()=>{
 const f=fixture('native');try{
  const first=await(await f.req('/cases',{...f.input,sourceURL:undefined,residentId:undefined,homeURL:nativeShare}))!.json();
  // Reserve an actual unresolved paid receipt using the same SQL guards as dispatch.
  const old=f.db.sqlite.prepare('SELECT * FROM manager_admission_jobs WHERE case_id=?').get(first.case.id)!;
  f.db.sqlite.prepare("UPDATE manager_admission_jobs SET state='running',lease_until='2027-01-01T00:00:00.000Z' WHERE id=?").run(old.id);
  f.db.sqlite.prepare("INSERT INTO manager_admission_calls(id,job_id,case_id,phase,billing_day,state,reserved_micro,created_at) VALUES('native-unknown',?,?,'review','2026-10-31','dispatching',30000,'2026-10-31T23:00:00.000Z')").run(old.id,first.case.id);
  f.db.sqlite.prepare("UPDATE manager_admission_calls SET state='unknown',completed_at='2026-10-31T23:00:00.000Z' WHERE id='native-unknown'").run();
  f.db.sqlite.prepare("UPDATE manager_admission_jobs SET state='blocked',lease_until=NULL WHERE id=?").run(old.id);
  f.move('2026-11-01T23:00:00.000Z');
  // Legacy sourceURL submissions still pass through the new native reader.
  const second=await(await f.req('/cases',{...f.input,sourceURL:nativeAlias,residentId:undefined},'POST','c'.repeat(64)))!.json();
  assert.equal(second.case.sourceResolution.state,'ready',JSON.stringify(second));const before=f.fetched.length;await f.manager.step();assert.equal(f.fetched.length,before);assert.equal(f.provider.length,0);assert.equal((await f.manager.status(second.case.id))!.state,'blocked');
  assert.equal(f.db.sqlite.prepare('SELECT source_identity FROM tower_source_identities WHERE source_url=?').get(nativeAlias)!.source_identity,'muse-space:abc123');
  // Change only applicant home identity via a new material revision, retaining asset identity.
  f.db.sqlite.prepare("UPDATE tower_reception_cases SET resident_id=?,version=version+1,review_case_version=version+1 WHERE id=?").run('e'.repeat(16),second.case.id);
  const fresh=f.db.sqlite.prepare('SELECT * FROM manager_admission_jobs WHERE case_id=? ORDER BY case_version DESC LIMIT 1').get(second.case.id)!;
  f.db.sqlite.prepare("UPDATE manager_admission_jobs SET state='running',lease_until='2027-01-01T00:00:00.000Z' WHERE id=?").run(fresh.id);
  assert.throws(()=>f.db.sqlite.prepare("INSERT INTO manager_admission_calls(id,job_id,case_id,phase,billing_day,state,reserved_micro,created_at) VALUES('alias-retry',?,?,'count','2026-11-01','dispatching',0,'2026-11-01T23:00:00.000Z')").run(fresh.id,second.case.id),/native_duplicate/);
  assert.throws(()=>f.db.sqlite.prepare("UPDATE tower_reception_sources SET source_identity='muse-space:forged' WHERE case_id=?").run(first.case.id),/native_source_identity_mismatch/);
 }finally{f.db.close();}
});

test('native rotated aliases stop existing residency preflight and count-to-review races without mutating the resident',async()=>{
 for(const race of [false,true]){const f=fixture('native');try{
  if(!race)connect(f,nativeAlias,'e'.repeat(16));
  const opened=await(await f.req('/cases',{...f.input,sourceURL:undefined,residentId:undefined,homeURL:nativeShare}))!.json();
  const preflightDownloads=f.fetched.length;if(race)f.onCount(async()=>connect(f,nativeAlias,'e'.repeat(16)));
  await f.manager.step();assert.equal(f.paid,0);assert.equal(f.provider.length,race?1:0);if(!race)assert.equal(f.fetched.length,preflightDownloads);
  const residentRow=f.db.sqlite.prepare('SELECT * FROM tower_residencies').get()!;assert.equal(residentRow.source_url,nativeAlias);assert.equal(residentRow.resident_id,'e'.repeat(16));
  assert.equal((await f.manager.status(opened.case.id))!.state,race?'blocked':'needs-info');assert.equal(f.db.sqlite.prepare("SELECT count(*) n FROM manager_admission_calls WHERE phase='review'").get()!.n,0);
  // Direct SQL cannot create a second residence with a rotated key or move a
  // different residence onto this source, even when the home ID is unrelated.
  const at='2026-10-31T23:00:00.000Z';
  assert.throws(()=>f.db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'owner-attested',?,?)").run(residentRow.room_id,residentRow.account_id,'d'.repeat(16),nativeShare,at,at),/native_(?:residency_duplicate|first_import_grant_required)/);
  assert.deepEqual(f.db.sqlite.prepare('SELECT * FROM tower_residencies').get(),residentRow);
 }finally{f.db.close();}}
});

test('replacing a resolved source with an unreadable home clears stale bindings and cannot review the prior home',async()=>{
 const f=fixture('native');try{
  const opened=await(await f.req('/cases',f.input))!.json();f.setSourceAvailable(false);
  const response=(await f.req('/cases/'+opened.case.id+'/details',{requestKey:'replace-with-unreadable',expectedVersion:1,homeURL:nativeShare}))!;assert.equal(response.status,200);const updated=await response.json();
  assert.equal(updated.case.sourceURL,null);assert.equal(updated.case.residentId,null);assert.equal(updated.case.homeURL,nativeShare);assert.equal(updated.case.sourceResolution.state,'needs-info');
  const old=f.db.sqlite.prepare('SELECT * FROM manager_admission_jobs WHERE case_id=? AND case_version=1').get(opened.case.id)!;
  f.db.sqlite.prepare("UPDATE manager_admission_jobs SET state='running',lease_until='2027-01-01T00:00:00.000Z' WHERE id=?").run(old.id);
  assert.throws(()=>f.db.sqlite.prepare("INSERT INTO manager_admission_calls(id,job_id,case_id,phase,billing_day,state,reserved_micro,created_at) VALUES('stale-home',?,?,'count','2026-10-31','dispatching',0,'2026-10-31T23:00:00.000Z')").run(old.id,opened.case.id),/manager_admission/);
  f.db.sqlite.prepare("UPDATE manager_admission_jobs SET state='blocked',lease_until=NULL WHERE id=?").run(old.id);
  const fresh=f.db.sqlite.prepare('SELECT * FROM manager_admission_jobs WHERE case_id=? ORDER BY case_version DESC LIMIT 1').get(opened.case.id)!;
  f.db.sqlite.prepare("UPDATE manager_admission_jobs SET state='running',lease_until='2027-01-01T00:00:00.000Z' WHERE id=?").run(fresh.id);
  assert.throws(()=>f.db.sqlite.prepare("INSERT INTO manager_admission_calls(id,job_id,case_id,phase,billing_day,state,reserved_micro,created_at) VALUES('unresolved-home',?,?,'count','2026-10-31','dispatching',0,'2026-10-31T23:00:00.000Z')").run(fresh.id,opened.case.id),/manager_admission_native_duplicate/);
  f.db.sqlite.prepare("UPDATE manager_admission_jobs SET state='queued',lease_until=NULL WHERE id=?").run(fresh.id);
  await f.manager.step();await f.manager.step();assert.equal(f.provider.length,0);assert.equal(f.paid,0);assert.equal((await f.manager.status(opened.case.id))!.state,'needs-info');
  assert.equal(f.db.sqlite.prepare('SELECT source_url FROM tower_reception_cases WHERE id=?').get(opened.case.id)!.source_url,null);
 }finally{f.db.close();}
});

test('native alias cooldown follows the immutable paid source even if an applicant changes its resident ID',async()=>{
 const f=fixture('native');try{
  await f.req('/cases',{...f.input,sourceURL:undefined,residentId:undefined,homeURL:nativeShare});await f.manager.step();assert.equal(f.paid,1);
  const next=await(await f.req('/cases',{...f.input,requestKey:'alias-cooldown-case',sourceURL:undefined,residentId:undefined,homeURL:nativeAlias},'POST','c'.repeat(64)))!.json();
  f.db.sqlite.prepare("UPDATE tower_reception_cases SET resident_id=?,version=version+1,review_case_version=version+1 WHERE id=?").run('e'.repeat(16),next.case.id);
  const downloads=f.fetched.length,calls=f.provider.length;await f.manager.step();await f.manager.step();assert.equal(f.fetched.length,downloads);assert.equal(f.provider.length,calls);assert.equal(f.paid,1);
  const status=await f.manager.status(next.case.id);assert.equal(status!.state,'needs-info');assert.ok([900,901].includes(status!.retryAfterSeconds!));assert.equal(await f.manager.pending(),false);
  f.move('2026-10-31T23:16:00.000Z');assert.equal((await f.manager.status(next.case.id))!.state,'queued');
 }finally{f.db.close();}
});


test('recovering an unreadable native submission with a direct static source updates metadata, GET and permanent replay',async()=>{
 const f=fixture('bad-home');try{
  const input={...f.input,sourceURL:undefined,residentId:undefined,homeURL:nativeShare};const opened=await(await f.req('/cases',input))!.json();assert.equal(opened.case.sourceResolution.state,'needs-info');
  const details={requestKey:'recover-with-static-source',expectedVersion:1,sourceURL:source,residentId:resident};
  const response=(await f.req('/cases/'+opened.case.id+'/details',details))!;assert.equal(response.status,200);const receipt=await response.json();
  assert.equal(receipt.case.sourceURL,source);assert.equal(receipt.case.homeURL,source);assert.deepEqual(receipt.case.sourceResolution,{state:'ready',errorCode:null,sourceIdentity:source});assert.equal(receipt.case.review.state,'queued');
  const current=await(await f.req('/cases/'+opened.case.id))!.json();assert.equal(current.case.homeURL,source);assert.deepEqual(current.case.sourceResolution,receipt.case.sourceResolution);
  const row=f.db.sqlite.prepare('SELECT * FROM tower_reception_sources WHERE case_id=?').get(opened.case.id)!;assert.equal(row.home_url,source);assert.equal(row.source_identity,source);assert.equal(row.error_code,null);assert.equal(row.resolution,'resolved');
  assert.deepEqual(await(await f.req('/cases/'+opened.case.id+'/details',details))!.json(),receipt);assert.deepEqual(await(await f.req('/cases',input))!.json(),opened);
 }finally{f.db.close();}
});

test('SQL stable source identities match the strict TypeScript native parser and preserve native-looking static paths',async()=>{
 const f=fixture();try{
  const opened=await(await f.req('/cases',f.input))!.json();
  const values=[nativeShare,nativeAlias,nativeShare.replace('synthetic-home','Upper_Case-home'),
   'https://muse.ai/s/house-abc123/condo.json',nativeShare+'/condo.json',
   nativeShare.slice(0,-1),nativeShare+'A',nativeShare+'/',nativeShare+'/extra',nativeShare+'?x=1',nativeShare+'#x',
   nativeShare.replace('/s/','/s//'),nativeShare.replace('muse.ai','MUSE.AI'),nativeShare.replace('https:','http:'),nativeShare.replace('muse.ai','user@muse.ai'),
   nativeShare.replace('abc123','ABC123'),nativeShare.replace('abc123','ab'),nativeShare.replace('abc123','a'.repeat(27)),
   nativeShare.replace('synthetic-home-','synthetic%2Dhome-'),nativeShare.replace('synthetic-home-','-synthetic-home-')];
  for(const value of values){
   let expected:string;try{expected=homeSourceIdentity(value);}catch{expected=value;}
   f.db.sqlite.prepare("INSERT INTO tower_reception_sources VALUES(?,?,NULL,'unavailable','synthetic',?) ON CONFLICT(case_id) DO UPDATE SET home_url=excluded.home_url,source_identity=NULL").run(opened.case.id,value,'2026-10-31T23:00:00.000Z');
   const actual=f.db.sqlite.prepare('SELECT source_identity FROM tower_source_identities WHERE source_url=?').get(value)!.source_identity;
   assert.equal(actual,expected,value);
  }
 }finally{f.db.close();}
});

test('native first-residence SQL insertion requires the exact active case and both unexpired leases at commit',async()=>{
 for(const fault of ['case-expired','activation-expired','revoked','policy-changed']){const f=fixture('native');try{
  const opened=await(await f.req('/cases',{...f.input,sourceURL:undefined,residentId:undefined,homeURL:nativeShare}))!.json();await f.manager.step();
  const activated=(await f.req('/cases/'+opened.case.id+'/activate',{requestKey:'native-sql-activate',expectedVersion:2},'POST',secret,{'X-Tower-Agent-Key':towerKey}))!;assert.equal(activated.status,201,await activated.clone().text());
  const c=f.db.sqlite.prepare('SELECT * FROM tower_reception_cases WHERE id=?').get(opened.case.id)!;const room='1234567890abcdef',at='2026-10-31T23:00:00.000Z';
  f.db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'Synthetic','Synthetic','resident','external-ready',?)").run(room,c.account_id,at);
  if(fault==='case-expired')f.db.sqlite.prepare("UPDATE tower_reception_cases SET expires_at='2026-10-31T22:59:59.000Z' WHERE id=?").run(c.id);
  if(fault==='activation-expired')f.db.sqlite.prepare("UPDATE tower_reception_cases SET approval_expires_at='2026-10-31T22:59:59.000Z' WHERE id=?").run(c.id);
  if(fault==='revoked')f.db.sqlite.prepare("UPDATE tower_reception_cases SET state='revoked' WHERE id=?").run(c.id);
  if(fault==='policy-changed'){f.db.sqlite.prepare("INSERT INTO tower_admission_policies VALUES(2,'[\"meta-muse\"]',1,?)").run(at);f.db.sqlite.exec('UPDATE tower_admission_current SET policy_version=2 WHERE id=1');}
  assert.throws(()=>f.db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)").run(room,c.account_id,resident,nativeShare,at,at),/native_first_import_grant_required/,fault);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_residencies').get()!.n,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM tower_admission_memberships').get()!.n,0);
 }finally{f.db.close();}}
});
