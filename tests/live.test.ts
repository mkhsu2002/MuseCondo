import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveApp } from '../server/live/app.ts';
import { LocalDatabase } from '../server/live/local-db.ts';
import type { HomeGenerator, GeneratedAsset } from '../server/live/generation.ts';

const origin = 'https://muse.test';
interface Identity { credential:string; csrf:string; cookie:string }
interface Job { id:string; roomId:string; state:string; attempts:number }
interface Home { room:{id:string; published?:boolean}; job:Job }
const profile = (name='Cloud') => ({name,intro:'A public hello',role:'Little helper',personality:'PRIVATE_PERSONALITY_DO_NOT_PUBLISH',analyzeConsent:true,publishProfile:false});
const fakeAsset = (purpose:GeneratedAsset['purpose']):GeneratedAsset => ({purpose,mime:'image/png',bytes:Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZxkAAAAASUVORK5CYII=','base64')),provenance:{provider:'local-test',model:null,metadataSource:null,generatedAt:'2026-10-29T00:00:00.000Z',promptVersion:'test-only',generationId:'fake-'+purpose,prompt:'PRIVATE_PROMPT'}});
function testGenerator(onCall=()=>{}):HomeGenerator{return {kind:'local-test',async generate(){onCall();return [fakeAsset('home-desktop'),fakeAsset('home-mobile')];}};}
async function fixture(generator?:HomeGenerator, localTest=true) {
 const dir=await mkdtemp(join(tmpdir(),'muse-live-test-')),file=join(dir,'db.sqlite');
 let db=new LocalDatabase(file);for(const file of ['0001_live_mvp.sql','0002_recovery_audit.sql','0003_provider_requests.sql','0004_agent_onboarding.sql','0005_framework.sql'])db.sqlite.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 let time=new Date('2026-10-29T00:00:00.000Z');
 let app=createLiveApp({db,origin,localTest,registrationEnabled:true,generator,now:()=>time});
 const req=(path:string,method='GET',body?:unknown,identity?:Identity,headers:Record<string,string>={})=>app.fetch(new Request(origin+'/api/v1'+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(method==='GET'?{}:{Origin:origin}),...(identity?{Cookie:identity.cookie,'X-CSRF-Token':identity.csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),'test-ip');
 const data=async<T>(response:Promise<Response>|Response,status=200):Promise<T>=>{const r=await response;const body=await r.text();assert.equal(r.status,status,body);return JSON.parse(body) as T;};
 async function account(){const r=await req('/accounts','POST',{});const d=await data<{credential:string;csrf:string}>(r,201);const cookie=r.headers.get('set-cookie')!;assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(d.credential,/^[a-f0-9]{64}$/);return {...d,cookie:cookie.split(';')[0]};}
 async function onboard(i:Identity,name='Cloud'){return data<Home>(req('/me/onboarding','POST',profile(name),i),201);}
 async function generate(i:Identity){return data<{job:Job}>(req('/me/generation','POST',{},i));}
 async function publish(i:Identity){return data(req('/me/publication','POST',{published:true},i));}
 return {req,data,account,onboard,generate,publish,get db(){return db;},advance(ms:number){time=new Date(time.getTime()+ms);},restart(){db.close();db=new LocalDatabase(file);app=createLiveApp({db,origin,localTest,registrationEnabled:true,generator,now:()=>time});},async close(){db.close();await rm(dir,{recursive:true,force:true});}};
}

test('real SQLite auth: secure sessions, separate login, logout and expiry, CSRF/origin denied',async()=>{
 const f=await fixture();try{
  const a=await f.account();assert.equal((await f.req('/me')).status,401);
  assert.equal((await f.req('/me/onboarding','POST',profile(),a,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await f.req('/accounts','POST',{},undefined,{Origin:'https://evil.test'})).status,403);
  assert.equal((await f.req('/me/onboarding','POST',profile(),a,{Origin:'https://evil.test'})).status,403);
  assert.equal((await f.req('/session','POST',{credential:'0'.repeat(64)})).status,401);
  const login=await f.req('/session','POST',{credential:a.credential});const l=await f.data<{csrf:string}>(login);const second={...a,csrf:l.csrf,cookie:login.headers.get('set-cookie')!.split(';')[0]};
  await f.onboard(a);assert.ok((await f.data<Home>(f.req('/me','GET',undefined,second))).room.id);
  await f.data(f.req('/session','DELETE',{},a));assert.equal((await f.req('/me','GET',undefined,a)).status,401);
  assert.equal((await f.req('/me','GET',undefined,second)).status,200);f.advance(86400001);assert.equal((await f.req('/me','GET',undefined,second)).status,401);
 }finally{await f.close();}
});

test('parallel onboarding fixes one room/job per owner and keeps distinct owners isolated',async()=>{
 const f=await fixture();try{
  const a=await f.account(),b=await f.account();
  assert.equal((await f.req('/me/onboarding','POST',{...profile(),analyzeConsent:false},a)).status,400);
  assert.equal((await f.req('/me/onboarding','POST',{...profile(),publishProfile:true},a)).status,400);
  const homes=await Promise.all([f.onboard(a),f.onboard(a),f.onboard(b,'Other')]);assert.equal(homes[0].room.id,homes[1].room.id);assert.equal(homes[0].job.id,homes[1].job.id);assert.notEqual(homes[0].room.id,homes[2].room.id);
  assert.equal((await f.req('/me/onboarding','POST',{...profile(),personality:'reroll me'},a)).status,409);
  const counts=f.db.sqlite.prepare('SELECT (SELECT COUNT(*) FROM rooms) rooms,(SELECT COUNT(*) FROM generation_jobs) jobs').get();assert.equal(counts!.rooms,2);assert.equal(counts!.jobs,2);
  assert.deepEqual(await f.data(f.req('/public/rooms')),{rooms:[]});assert.equal((await f.req('/public/rooms/'+homes[0].room.id)).status,404);
  const own=await f.req('/me','GET',undefined,a);assert.doesNotMatch(await own.text(),/PRIVATE_PERSONALITY|login_hash|account_id|provider_key/);
  f.restart();assert.equal((await f.onboard(a)).room.id,homes[0].room.id);
 }finally{await f.close();}
});

test('simulated generation persists paired bytes once, private owner preview, separate publication and complete withdrawal',async()=>{
 let calls=0;const f=await fixture(testGenerator(()=>calls++));try{
  const a=await f.account(),b=await f.account(),h=await f.onboard(a);
  await Promise.all([f.generate(a),f.generate(a)]);assert.equal(calls,1);assert.equal((await f.generate(a)).job.state,'test-complete');assert.equal(calls,1);
  const assets=await f.data<{assets:{id:string;url:string}[]}>(f.req('/me/preview','GET',undefined,a));assert.equal(assets.assets.length,2);
  const path=assets.assets[0].url.replace('/api/v1','');
  assert.equal((await f.req(path)).status,404);assert.equal((await f.req(path,'GET',undefined,b)).status,404);
  const image=await f.req(path,'GET',undefined,a);assert.equal(image.status,200);assert.ok((await image.arrayBuffer()).byteLength>0);
  await f.publish(a);assert.equal((await f.req(path)).status,200);const pub=await f.req('/public/rooms/'+h.room.id);assert.equal(pub.status,200);assert.doesNotMatch(await pub.text(),/PRIVATE_PERSONALITY|PRIVATE_PROMPT|credential|account_id/);
  const p=await f.data<{id:string}>(f.req('/me/posts','POST',{kind:'journal',title:'Today',body:'PUBLIC_DIARY',isPublic:true,requestKey:'public-post-1'},a),201);
  assert.match(await (await f.req('/public/community')).text(),/PUBLIC_DIARY/);
  await f.data(f.req('/me/posts/'+p.id,'PATCH',{isPublic:false},a));assert.doesNotMatch(await (await f.req('/public/community')).text(),/PUBLIC_DIARY/);
  await f.data(f.req('/me/publication','POST',{published:false},a));assert.equal((await f.req('/public/rooms/'+h.room.id)).status,404);assert.equal((await f.req(path)).status,404);assert.doesNotMatch(await (await f.req('/public/community')).text(),new RegExp(h.room.id));
  f.restart();assert.equal((await f.generate(a)).job.state,'test-complete');assert.equal(calls,1);assert.equal((await f.req(path,'GET',undefined,a)).status,200);
 }finally{await f.close();}
});

test('disconnected and uncertain providers cannot be mistaken for completed generation or silently retry',async()=>{
 const blocked=await fixture();try{const a=await blocked.account();await blocked.onboard(a);assert.equal((await blocked.generate(a)).job.state,'blocked');assert.equal((await blocked.req('/me/publication','POST',{published:true},a)).status,409);}finally{await blocked.close();}
 let calls=0;const f=await fixture({kind:'local-test',async generate(){calls++;throw new Error('connection lost after provider accepted');}});try{const a=await f.account();await f.onboard(a);assert.equal((await f.generate(a)).job.state,'recovery');f.restart();assert.equal((await f.generate(a)).job.state,'recovery');assert.equal(calls,1);}finally{await f.close();}
});

test('production cannot execute a local-test provider',async()=>{
 let calls=0;const f=await fixture(testGenerator(()=>calls++),false);try{const a=await f.account();await f.onboard(a);const r=await f.req('/me/generation','POST',{},a);assert.equal(r.status,503);assert.equal(calls,0);}finally{await f.close();}
});

test('scoped Agent tokens deny other homes, cookie mixing, unknown scope, revocation and private fields',async()=>{
 const f=await fixture(testGenerator());try{
  const a=await f.account(),b=await f.account(),ha=await f.onboard(a),hb=await f.onboard(b,'Other');
  const token=await f.data<{id:string;token:string}>(f.req('/me/tokens','POST',{scopes:['posts:write']},a),201);
  const post={kind:'journal',title:'Agent diary',body:'Public diary, not a private memory',isPublic:true,requestKey:'agent-post-1'};
  const headers={Authorization:'Bearer '+token.token};
  assert.equal((await f.req('/agent/rooms/'+hb.room.id+'/posts','POST',post,undefined,headers)).status,403);
  assert.equal((await f.req('/agent/rooms/'+ha.room.id+'/posts','POST',post,a,headers)).status,403);
  assert.equal((await f.req('/agent/rooms/'+ha.room.id+'/inbox','GET',undefined,undefined,headers)).status,403);
  const first=await f.data<{id:string}>(f.req('/agent/rooms/'+ha.room.id+'/posts','POST',post,undefined,headers),201);
  const duplicate=await f.data<{id:string;duplicate:boolean}>(f.req('/agent/rooms/'+ha.room.id+'/posts','POST',post,undefined,headers),201);assert.equal(duplicate.id,first.id);assert.equal(duplicate.duplicate,true);
  assert.equal((await f.req('/agent/rooms/'+ha.room.id+'/posts','POST',{...post,body:'changed'},undefined,headers)).status,409);
  assert.equal((await f.req('/me/posts/'+first.id,'PATCH',{isPublic:false},b)).status,404);
  await f.data(f.req('/me/tokens/'+token.id,'DELETE',{},a));assert.equal((await f.req('/agent/rooms/'+ha.room.id+'/posts','POST',{...post,requestKey:'agent-post-2'},undefined,headers)).status,403);
  assert.equal((await f.req('/me/tokens','POST',{scopes:['account:admin']},a)).status,400);
 }finally{await f.close();}
});

test('shared comments survive restart, pending invitations remain private, request-key conflicts and input limits enforced',async()=>{
 const f=await fixture(testGenerator());try{
  const a=await f.account(),b=await f.account(),h=await f.onboard(a);await f.generate(a);await f.publish(a);
  const path='/rooms/'+h.room.id+'/interactions',comment={kind:'message',nickname:'Visitor',body:'<img src=x onerror=alert(1)> Literal only',requestKey:'message-0001'};
  assert.equal((await f.req(path,'POST',comment)).status,401);
  const first=await f.data<{id:string}>(f.req(path,'POST',comment,b),201);const dupe=await f.data<{id:string;duplicate:boolean}>(f.req(path,'POST',comment,b));assert.equal(dupe.id,first.id);assert.equal(dupe.duplicate,true);
  assert.equal((await f.req(path,'POST',{...comment,body:'different'},b)).status,409);
  assert.equal((await f.req(path,'POST',{...comment,body:'https://evil.test',requestKey:'message-0002'},b)).status,400);
  assert.equal((await f.req(path,'POST',{...comment,body:'x'.repeat(281),requestKey:'message-0003'},b)).status,400);
  await f.data(f.req(path,'POST',{...comment,kind:'invitation',body:'PRIVATE_PENDING_INVITATION',requestKey:'invite-0001'},b),201);
  f.restart();const publicText=await (await f.req('/public/rooms/'+h.room.id)).text();assert.match(publicText,/Literal only/);assert.doesNotMatch(publicText,/PRIVATE_PENDING_INVITATION|sender_id|login_hash/);
  assert.match(await (await f.req('/me/inbox','GET',undefined,a)).text(),/PRIVATE_PENDING_INVITATION/);
  assert.doesNotMatch(await (await f.req('/public/community')).text(),/Literal only|PRIVATE_PENDING_INVITATION/);
 }finally{await f.close();}
});

test('provider success followed by asset-persistence failure is recovery, not a second paid-style request',async()=>{
 let calls=0;const f=await fixture(testGenerator(()=>calls++));try{
  const a=await f.account();await f.onboard(a);
  const original=f.db.batch.bind(f.db);let failed=false;
  f.db.batch=async statements=>{if(!failed&&statements.some(s=>'sql' in s && String(s.sql).startsWith('INSERT INTO assets'))){failed=true;throw new Error('injected database failure after generation');}return original(statements);};
  assert.equal((await f.generate(a)).job.state,'recovery');assert.equal(calls,1);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) total FROM assets').get()!.total,0);
  f.restart();assert.equal((await f.generate(a)).job.state,'recovery');assert.equal(calls,1);
  assert.equal((await f.req('/me/publication','POST',{published:true},a)).status,409);
 }finally{await f.close();}
});

test('body caps, explicit consent, SQL-shaped text, origin and session authority stay at the server boundary',async()=>{
 const f=await fixture();try{
  const a=await f.account(),b=await f.account();
  assert.equal((await f.req('/me/onboarding','POST',{...profile(),personality:'x'.repeat(25000)},a)).status,413);
  assert.equal((await f.req('/me/onboarding','POST',{...profile(),city:'Vancouver'},a)).status,400);
  const h=await f.onboard(a,"Robert'); DROP TABLE accounts;--");
  assert.equal(f.db.sqlite.prepare('SELECT count(*) total FROM accounts').get()!.total,2);
  const forged=await f.data<Home>(f.req('/me/onboarding','POST',{...profile('Other'),accountId:'forged',roomId:h.room.id},b),201);assert.notEqual(forged.room.id,h.room.id);
  assert.equal((await f.req('/me/posts','POST',{kind:'journal',title:'x',body:'x',isPublic:'yes',requestKey:'bad-choice-1'},a)).status,400);
  assert.equal((await f.req('/me/posts','POST',{kind:'journal',title:'x',body:'x',isPublic:false,requestKey:'short'},a)).status,400);
  assert.equal((await f.req('/me/posts','POST',{kind:'journal',title:'x',body:'x',isPublic:false,requestKey:'csrf-test-1'},a,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await f.req('/me','GET',undefined,undefined,{Cookie:'muse_session='+a.credential})).status,401);
 }finally{await f.close();}
});

test('analysis consent revocation clears raw personality and prevents new generation',async()=>{
 let calls=0;const f=await fixture(testGenerator(()=>calls++));try{
  const a=await f.account();await f.onboard(a);
  assert.equal((await f.req('/me/analysis-consent','POST',{granted:false},a,{'X-CSRF-Token':'invalid'})).status,403);
  await f.data(f.req('/me/analysis-consent','POST',{granted:false},a));
  const row=f.db.sqlite.prepare('SELECT personality,analysis_consent FROM private_profiles').get()!;assert.equal(row.personality,'');assert.equal(row.analysis_consent,0);
  assert.equal((await f.generate(a)).job.state,'blocked');assert.equal(calls,0);assert.equal(f.db.sqlite.prepare('SELECT count(*) total FROM assets').get()!.total,0);
 }finally{await f.close();}
});

test('consent withdrawn while provider is running discards returned artwork and requires recovery',async()=>{
 let started!:()=>void,finish!:(assets:GeneratedAsset[])=>void,calls=0;
 const begun=new Promise<void>(resolve=>{started=resolve;});
 const held=new Promise<GeneratedAsset[]>(resolve=>{finish=resolve;});
 const f=await fixture({kind:'local-test',async generate(){calls++;started();return held;}});try{
  const a=await f.account();await f.onboard(a);const running=f.generate(a);await begun;
  await f.data(f.req('/me/analysis-consent','POST',{granted:false},a));finish([fakeAsset('home-desktop'),fakeAsset('home-mobile')]);
  assert.equal((await running).job.state,'recovery');assert.equal(f.db.sqlite.prepare('SELECT count(*) total FROM assets').get()!.total,0);
  assert.equal((await f.generate(a)).job.state,'recovery');assert.equal(calls,1);
 }finally{await f.close();}
});

test('consent withdrawn immediately before asset transaction cannot persist assets or complete job',async()=>{
 const f=await fixture(testGenerator());try{
  const a=await f.account();await f.onboard(a);const original=f.db.batch.bind(f.db);let withdrawn=false;
  f.db.batch=async statements=>{
   if(!withdrawn&&statements.some(s=>'sql' in s&&String(s.sql).startsWith('INSERT INTO assets'))){withdrawn=true;await f.data(f.req('/me/analysis-consent','POST',{granted:false},a));}
   return original(statements);
  };
  assert.equal((await f.generate(a)).job.state,'recovery');assert.equal(withdrawn,true);assert.equal(f.db.sqlite.prepare('SELECT count(*) total FROM assets').get()!.total,0);
  assert.equal(f.db.sqlite.prepare('SELECT count(*) total FROM asset_chunks').get()!.total,0);
 }finally{await f.close();}
});

test('failure before provider call cannot strand running and stale running is flagged for reconciliation without new calls',async()=>{
 let calls=0;const f=await fixture(testGenerator(()=>calls++));try{
  const a=await f.account();await f.onboard(a);const prepare=f.db.prepare.bind(f.db);let injected=false;
  f.db.prepare=sql=>{const s=prepare(sql);if(sql==="UPDATE rooms SET generation_state='running' WHERE id=?"){
   const bind=s.bind.bind(s);s.bind=(...values:unknown[])=>{const bound=bind(...values),run=bound.run.bind(bound);bound.run=async()=>{if(!injected){injected=true;throw new Error('pre-provider room update failed');}return run();};return bound;};
  }return s;};
  const first=await f.generate(a);assert.equal(first.job.state,'recovery');assert.equal(calls,0);
  const row=f.db.sqlite.prepare('SELECT state FROM generation_jobs').get()!;assert.equal(row.state,'recovery');
  f.db.sqlite.exec("UPDATE generation_jobs SET state='running',updated_at='2026-10-28T23:40:00.000Z'; UPDATE rooms SET generation_state='running';");
  const own=await f.data<Home>(f.req('/me','GET',undefined,a));assert.equal(own.job.state,'recovery');assert.equal((await f.generate(a)).job.state,'recovery');assert.equal(calls,0);
 }finally{await f.close();}
});

test('production session cookies use Secure and no authenticated mutations accept missing CSRF',async()=>{
 const f=await fixture(undefined,false);try{
  const response=await f.req('/accounts','POST',{});assert.equal(response.status,201);const result=await response.json() as {csrf:string;credential:string};const cookie=response.headers.get('set-cookie')!;assert.match(cookie,/; Secure(?:;|$)/);assert.match(cookie,/; HttpOnly(?:;|$)/);
  const a={...result,cookie:cookie.split(';')[0]};assert.equal((await f.req('/me/onboarding','POST',profile(),a,{'X-CSRF-Token':''})).status,403);
 }finally{await f.close();}
});
