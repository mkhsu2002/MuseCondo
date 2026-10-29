import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveApp } from '../server/live/app.ts';
import { LocalDatabase } from '../server/live/local-db.ts';
import type { HomeGenerator, GeneratedAsset } from '../server/live/generation.ts';

const origin='https://agent-onboarding.test';
const required=['home:onboard','home:read'];
const full=[...required,'home:generate','home:publish'];
interface Owner {cookie:string;csrf:string;credential:string}
interface Grant {id:string;token:string;scopes:string[];expiresAt:string}
interface Home {room:{id:string;published?:boolean}|null;job:{id:string;state:string;roomId:string}|null}
const input=(name='Sprout')=>({name,intro:'Hello neighbors',role:'Little helper',personality:'PRIVATE_OWNER_MEMORY',analyzeConsent:true,publishProfile:false});
const asset=(purpose:GeneratedAsset['purpose']):GeneratedAsset=>({purpose,mime:'image/png',bytes:Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZxkAAAAASUVORK5CYII=','base64')),provenance:{provider:'local-test',model:null,metadataSource:null,generatedAt:'2026-10-29T00:00:00.000Z',promptVersion:'simulated-test',generationId:'test-'+purpose,prompt:'PRIVATE_PROMPT'}});
async function setup(generator?:HomeGenerator){
 const dir=await mkdtemp(join(tmpdir(),'muse-agent-grants-'));const db=new LocalDatabase(join(dir,'db.sqlite'));
 const migrations=new URL('../migrations/',import.meta.url);for(const name of (await readdir(migrations)).filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(await readFile(new URL(name,migrations),'utf8'));
 let time=new Date('2026-10-29T00:00:00.000Z');const app=createLiveApp({db,origin,registrationEnabled:true,localTest:true,generator,now:()=>time});
 const req=(path:string,method='GET',body?:unknown,owner?:Owner,bearer?:string,headers:Record<string,string>={})=>app.fetch(new Request(origin+'/api/v1'+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(method==='GET'?{}:{Origin:origin}),...(owner?{Cookie:owner.cookie,'X-CSRF-Token':owner.csrf}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),'test-ip');
 const data=async<T>(response:Promise<Response>|Response,status=200):Promise<T>=>{const r=await response,raw=await r.text();assert.equal(r.status,status,raw);return JSON.parse(raw) as T;};
 async function owner(){const r=await req('/accounts','POST',{});const d=await data<{csrf:string;credential:string}>(r,201);return {...d,cookie:r.headers.get('set-cookie')!.split(';')[0]};}
 const grant=(o:Owner,scopes=required)=>data<Grant>(req('/me/onboarding-grants','POST',{analyzeConsent:true,scopes},o),201);
 return {db,req,data,owner,grant,advance(ms:number){time=new Date(time.getTime()+ms);},async close(){db.close();await rm(dir,{recursive:true,force:true});}};
}

test('pre-home grant needs owner authorization, CSRF, explicit analysis consent and valid scopes; storage is hash-only',async()=>{
 const f=await setup();try{
  const a=await f.owner();assert.equal((await f.req('/me/onboarding-grants','POST',{analyzeConsent:true,scopes:required})).status,401);
  assert.equal((await f.req('/me/onboarding-grants','POST',{analyzeConsent:true,scopes:required},a,undefined,{'X-CSRF-Token':''})).status,403);
  for(const body of [{analyzeConsent:false,scopes:required},{analyzeConsent:true,scopes:['home:read']},{analyzeConsent:true,scopes:[...required,'account:admin']}])assert.equal((await f.req('/me/onboarding-grants','POST',body,a)).status,400);
  const g=await f.grant(a);assert.match(g.id,/^[a-f0-9]{32}$/);assert.match(g.token,/^[a-f0-9]{64}$/);assert.equal(Date.parse(g.expiresAt)-Date.parse('2026-10-29T00:00:00.000Z'),86400000);
  const stored=f.db.sqlite.prepare('SELECT * FROM onboarding_grants WHERE id=?').get(g.id)!;assert.notEqual(stored.token_hash,g.token);assert.doesNotMatch(JSON.stringify(stored),new RegExp(g.token));
  const list=await f.req('/me/onboarding-grants','GET',undefined,a);assert.equal(list.status,200);assert.doesNotMatch(await list.text(),/token_hash|"token"/);
  const me=await f.data<Home>(f.req('/agent/home','GET',undefined,undefined,g.token));assert.equal(me.room,null);
 }finally{await f.close();}
});

test('agent onboarding is one fixed private home and bound to grant account regardless supplied identifiers',async()=>{
 const f=await setup();try{
  const a=await f.owner(),b=await f.owner(),ga=await f.grant(a),gb=await f.grant(b);
  const [ha,again,hb]=await Promise.all([f.data<Home>(f.req('/agent/onboarding','POST',input(),undefined,ga.token),201),f.data<Home>(f.req('/agent/onboarding','POST',input(),undefined,ga.token),201),f.data<Home>(f.req('/agent/onboarding','POST',input('Other'),undefined,gb.token),201)]);
  assert.equal(ha.room!.id,again.room!.id);assert.equal(ha.job!.id,again.job!.id);assert.notEqual(ha.room!.id,hb.room!.id);
  assert.equal((await f.req('/agent/onboarding','POST',{...input(),personality:'reroll'},undefined,ga.token)).status,409);
  assert.equal((await f.data<Home>(f.req('/me','GET',undefined,a))).room!.id,ha.room!.id);
  assert.equal((await f.data<Home>(f.req('/me','GET',undefined,b))).room!.id,hb.room!.id);
  assert.deepEqual(await f.data(f.req('/public/rooms')),{rooms:[]});
  assert.doesNotMatch(await (await f.req('/agent/home','GET',undefined,undefined,ga.token)).text(),/PRIVATE_OWNER_MEMORY|account_id|provider_key|token_hash/);
  assert.equal((await f.req('/agent/onboarding','POST',{...input(),city:'Vancouver',publishCity:true},undefined,ga.token)).status,400);
  const own=await f.req('/agent/home?accountId=other&roomId='+hb.room!.id,'GET',undefined,undefined,ga.token);assert.equal((await f.data<Home>(own)).room!.id,ha.room!.id);
 }finally{await f.close();}
});

test('grant boundaries reject cookie mixing, cross-origin, cookie-only access and scope escalation',async()=>{
 const f=await setup();try{
  const a=await f.owner(),g=await f.grant(a);
  assert.equal((await f.req('/agent/home','GET',undefined,a,g.token)).status,403);
  assert.equal((await f.req('/agent/home','GET',undefined,a)).status,403);
  assert.equal((await f.req('/agent/home','GET',undefined,undefined,g.token,{Origin:'https://evil.test'})).status,403);
  assert.equal((await f.req('/me','GET',undefined,undefined,g.token)).status,401);
  assert.equal((await f.req('/agent/generation','POST',{},undefined,g.token)).status,403);
  assert.equal((await f.req('/agent/publication','POST',{published:true},undefined,g.token)).status,403);
  await f.data<Home>(f.req('/agent/onboarding','POST',input(),undefined,g.token),201);
  const p=await f.req('/agent/preview','GET',undefined,undefined,g.token);assert.equal(p.status,200);assert.doesNotMatch(await p.text(),/PRIVATE_OWNER_MEMORY|PRIVATE_PROMPT/);
  assert.equal((await f.req('/me/onboarding-grants','POST',{analyzeConsent:true,scopes:full},undefined,g.token)).status,401);
 }finally{await f.close();}
});

test('grants expire, only their owner can revoke, and owner analysis withdrawal invalidates all previous grants',async()=>{
 const f=await setup();try{
  const a=await f.owner(),b=await f.owner(),g=await f.grant(a),g2=await f.grant(a);
  await f.req('/me/onboarding-grants/'+g.id,'DELETE',{},b);
  assert.equal((await f.req('/agent/home','GET',undefined,undefined,g.token)).status,200);
  await f.data(f.req('/me/onboarding-grants/'+g.id,'DELETE',{},a));assert.equal((await f.req('/agent/home','GET',undefined,undefined,g.token)).status,403);
  await f.data<Home>(f.req('/agent/onboarding','POST',input(),undefined,g2.token),201);
  await f.data(f.req('/me/analysis-consent','POST',{granted:false},a));
  assert.equal((await f.req('/agent/home','GET',undefined,undefined,g2.token)).status,403);
  assert.equal((await f.req('/agent/onboarding','POST',input(),undefined,g2.token)).status,403);
  assert.equal(f.db.sqlite.prepare('SELECT personality FROM private_profiles').get()!.personality,'');
  const gb=await f.grant(b);f.advance(86400001);assert.equal((await f.req('/agent/home','GET',undefined,undefined,gb.token)).status,403);
 }finally{await f.close();}
});

test('explicit generation/publish grants complete only simulated private preview and never bypass blocked provider',async()=>{
 let calls=0;const f=await setup({kind:'local-test',async generate(){calls++;return [asset('home-desktop'),asset('home-mobile')];}});try{
  const a=await f.owner(),g=await f.grant(a,full);const h=await f.data<Home>(f.req('/agent/onboarding','POST',input(),undefined,g.token),201);
  assert.equal((await f.req('/agent/publication','POST',{published:true},undefined,g.token)).status,409);
  const done=await f.data<{job:{state:string}}>(f.req('/agent/generation','POST',{},undefined,g.token));assert.equal(done.job.state,'test-complete');
  await f.data(f.req('/agent/generation','POST',{},undefined,g.token));assert.equal(calls,1);
  assert.equal((await f.req('/public/rooms/'+h.room!.id)).status,404);
  await f.data(f.req('/agent/publication','POST',{published:true},undefined,g.token));assert.equal((await f.req('/public/rooms/'+h.room!.id)).status,200);
  await f.data(f.req('/agent/publication','POST',{published:false},undefined,g.token));assert.equal((await f.req('/public/rooms/'+h.room!.id)).status,404);
 }finally{await f.close();}
 const blocked=await setup();try{const a=await blocked.owner(),g=await blocked.grant(a,full);await blocked.data(blocked.req('/agent/onboarding','POST',input(),undefined,g.token),201);const r=await blocked.data<{job:{state:string}}>(blocked.req('/agent/generation','POST',{},undefined,g.token));assert.equal(r.job.state,'blocked');assert.equal((await blocked.req('/agent/publication','POST',{published:true},undefined,g.token)).status,409);}finally{await blocked.close();}
});

test('private preview artwork requires its own home:read grant, no cross-account or revoked access',async()=>{
 const f=await setup({kind:'local-test',async generate(){return [asset('home-desktop'),asset('home-mobile')];}});try{
  const a=await f.owner(),b=await f.owner(),ga=await f.grant(a,full),gb=await f.grant(b);
  await f.data(f.req('/agent/onboarding','POST',input(),undefined,ga.token),201);
  await f.data(f.req('/agent/generation','POST',{},undefined,ga.token));
  const preview=await f.data<{assets:{url:string}[]}>(f.req('/agent/preview','GET',undefined,undefined,ga.token));assert.equal(preview.assets.length,2);
  const path=preview.assets[0].url.replace('/api/v1','');const response=await f.req(path,'GET',undefined,undefined,ga.token);assert.equal(response.status,200);assert.match(response.headers.get('content-type')!,/^image\/png/);assert.ok((await response.arrayBuffer()).byteLength>0);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await f.req(path)).status,404);assert.equal((await f.req(path,'GET',undefined,undefined,gb.token)).status,404);
  await f.data(f.req('/me/onboarding-grants/'+ga.id,'DELETE',{},a));assert.notEqual((await f.req(path,'GET',undefined,undefined,ga.token)).status,200);
  assert.equal((await f.req(path,'GET',undefined,a)).status,200);
 }finally{await f.close();}
});

test('home:generate and home:publish are independent capabilities and grants cannot disclose owner fields',async()=>{
 let calls=0;const f=await setup({kind:'local-test',async generate(){calls++;return [asset('home-desktop'),asset('home-mobile')];}});try{
  const a=await f.owner(),generate=await f.grant(a,[...required,'home:generate']),publish=await f.grant(a,[...required,'home:publish']);
  assert.equal((await f.req('/agent/onboarding','POST',{...input(),owner:{name:'Private Owner'}},undefined,generate.token)).status,400);
  assert.equal((await f.req('/agent/onboarding','POST',{...input(),ownerWebsite:'https://private.test'},undefined,generate.token)).status,400);
  await f.data(f.req('/agent/onboarding','POST',input(),undefined,generate.token),201);
  assert.equal((await f.req('/agent/generation','POST',{},undefined,publish.token)).status,403);assert.equal(calls,0);
  await f.data(f.req('/agent/generation','POST',{},undefined,generate.token));assert.equal(calls,1);
  assert.equal((await f.req('/agent/publication','POST',{published:true},undefined,generate.token)).status,403);
  await f.data(f.req('/agent/publication','POST',{published:true},undefined,publish.token));
 }finally{await f.close();}
});

test('grant revoked at onboarding transaction boundary creates no room, job or private profile',async()=>{
 const f=await setup();try{
  const a=await f.owner(),g=await f.grant(a);const batch=f.db.batch.bind(f.db);let intercepted=false;
  f.db.batch=async statements=>{
   if(!intercepted&&statements.some(s=>'sql' in s&&String(s.sql).startsWith('INSERT INTO rooms'))){intercepted=true;await f.data(f.req('/me/onboarding-grants/'+g.id,'DELETE',{},a));}
   return batch(statements);
  };
  assert.equal((await f.req('/agent/onboarding','POST',input(),undefined,g.token)).status,403);assert.equal(intercepted,true);
  for(const table of ['rooms','generation_jobs','private_profiles'])assert.equal(f.db.sqlite.prepare('SELECT count(*) total FROM '+table).get()!.total,0);
 }finally{await f.close();}
});

test('grant revoked at generation claim boundary cannot call provider or consume an attempt',async()=>{
 let calls=0;const f=await setup({kind:'local-test',async generate(){calls++;return [asset('home-desktop'),asset('home-mobile')];}});try{
  const a=await f.owner(),g=await f.grant(a,full);await f.data(f.req('/agent/onboarding','POST',input(),undefined,g.token),201);
  const batch=f.db.batch.bind(f.db);let intercepted=false;
  f.db.batch=async statements=>{
   if(!intercepted&&statements.some(s=>'sql' in s&&String(s.sql).startsWith("UPDATE generation_jobs SET state='running'"))){intercepted=true;await f.data(f.req('/me/onboarding-grants/'+g.id,'DELETE',{},a));}
   return batch(statements);
  };
  assert.equal((await f.req('/agent/generation','POST',{},undefined,g.token)).status,403);assert.equal(intercepted,true);assert.equal(calls,0);
  const job=f.db.sqlite.prepare('SELECT state,attempts FROM generation_jobs').get()!;assert.equal(job.state,'prepared');assert.equal(job.attempts,0);
 }finally{await f.close();}
});

test('owner withdrawal at delegated publication transaction boundary prevents re-publication',async()=>{
 const f=await setup({kind:'local-test',async generate(){return [asset('home-desktop'),asset('home-mobile')];}});try{
  const a=await f.owner(),g=await f.grant(a,full);const h=await f.data<Home>(f.req('/agent/onboarding','POST',input(),undefined,g.token),201);await f.data(f.req('/agent/generation','POST',{},undefined,g.token));
  const batch=f.db.batch.bind(f.db);let intercepted=false;
  f.db.batch=async statements=>{
   if(!intercepted&&statements.some(s=>'sql' in s&&String(s.sql).startsWith('UPDATE rooms SET published='))){intercepted=true;await f.data(f.req('/me/publication','POST',{published:false},a));}
   return batch(statements);
  };
  assert.equal((await f.req('/agent/publication','POST',{published:true},undefined,g.token)).status,403);assert.equal(intercepted,true);
  assert.equal(f.db.sqlite.prepare('SELECT published FROM rooms').get()!.published,0);assert.equal((await f.req('/public/rooms/'+h.room!.id)).status,404);
 }finally{await f.close();}
});

test('home:read delegated preview does not expose existing private diary or visitor inbox',async()=>{
 const f=await setup();try{
  const a=await f.owner(),g=await f.grant(a);await f.data(f.req('/agent/onboarding','POST',input(),undefined,g.token),201);
  await f.data(f.req('/me/posts','POST',{kind:'journal',title:'Private diary',body:'SECRET_OWNER_DIARY',isPublic:false,requestKey:'private-diary-123'},a),201);
  const owner=await f.req('/me/preview','GET',undefined,a);assert.match(await owner.text(),/SECRET_OWNER_DIARY/);
  const delegated=await f.data<{posts:unknown[]}>(f.req('/agent/preview','GET',undefined,undefined,g.token));assert.deepEqual(delegated.posts,[]);assert.doesNotMatch(JSON.stringify(delegated),/SECRET_OWNER_DIARY/);
  assert.equal((await f.req('/me/inbox','GET',undefined,undefined,g.token)).status,401);
 }finally{await f.close();}
});
