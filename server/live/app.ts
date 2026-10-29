import {validatePNG} from './png.ts';
import { FRAMEWORK_VERSION, validateFrameworkSeed, type FrameworkSeed, type DailyType } from '../../src/framework/index.ts';
import type { Database, Statement } from './db.ts';
import { disconnectedHome, GenerationBlocked, type HomeGenerator } from './generation.ts';
import { publicEvents, validateCommunity, type Edition, type PublicEvent } from '../../src/community/schema.ts';
import { ruleSections } from '../../src/community/rules.ts';
export interface LiveEnvironment { db:Database; origin:string; localTest:boolean; registrationEnabled:boolean; generator?:HomeGenerator; now?:()=>Date }
interface OnboardingGrant {id:string;account_id:string;scopes:string;expires_at:string;revoked:number}
interface Account {id:string;test_only:number}
interface Session {account_id:string;csrf:string;token_hash:string}
interface Room {id:string;account_id:string;name:string;intro:string;role:string;city:string|null;published:number;generation_state:string;created_at:string;test_only:number}
interface Job {id:string;account_id:string;room_id:string;input_hash:string;provider_key:string;state:string;attempts:number;error_code:string|null;updated_at:string}
interface Post {id:string;room_id:string;kind:DailyType;title:string;body:string;is_public:number;created_at:string;input_hash:string;withdrawn_at:string|null}
interface Dream {id:string;room_id:string;account_id:string;date:string;title:string;body:string;image:string|null;reflection:string|null;evidence_json:string;publication:'private'|'public';created_at:string;updated_at:string;withdrawn_at:string|null;input_hash:string}
interface Interaction {id:string;room_id:string;sender_id:string;kind:string;nickname:string;body:string;gift_id:string|null;state:string;created_at:string;input_hash:string}
class HttpError extends Error {readonly status:number;readonly code:string;constructor(status:number,code:string){super(code);this.status=status;this.code=code;}}
const fail=(status:number,code:string):never=>{throw new HttpError(status,code);};
const random=(bytes=32)=>Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function digest(value:string|Uint8Array){const data=typeof value==='string'?new TextEncoder().encode(value):value;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(data))),b=>b.toString(16).padStart(2,'0')).join('');}
const text=(v:unknown,max:number,optional=false)=>{if(optional&&(v===undefined||v===null||v===''))return '';if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'invalid_text');return (v as string).trim();};
const identifier=(v:string)=>/^[a-f0-9]{16}$/.test(v);
const key=(v:unknown)=>{if(typeof v!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(v))fail(400,'idempotency_key_required');return v as string;};
const roomPublic=(r:Room)=>({id:r.id,name:r.name,intro:r.intro,role:r.role,...(r.city?{city:r.city}:{}),generationState:r.generation_state,createdAt:r.created_at,testOnly:!!r.test_only});
const jobPublic=(j:Job)=>({id:j.id,roomId:j.room_id,state:j.state,attempts:j.attempts,errorCode:j.error_code});
export function createLiveApp(env:LiveEnvironment){
 const db=env.db,now=()=>env.now?.()??new Date(),stamp=()=>now().toISOString(),generator=env.generator??disconnectedHome;
 const one=<T>(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args).first<T>();
 const all=async<T>(sql:string,...args:unknown[])=>(await db.prepare(sql).bind(...args).all<T>()).results;
 const run=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args).run();
 const json=(data:unknown,status=200,headers:HeadersInit={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',...headers}});
 async function body(req:Request){
  if(!req.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'json_required');
  const maximum=/\/(?:me|agent)\/onboarding\/?$/.test(new URL(req.url).pathname)?80000:24000;
  if(Number(req.headers.get('Content-Length')??0)>maximum)fail(413,'body_too_large');
  const reader=req.body?.getReader();if(!reader)fail(400,'body_required');let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader!.read();if(done)break;size+=value.length;if(size>maximum){await reader!.cancel();fail(413,'body_too_large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||Array.isArray(value)||typeof value!=='object')fail(400,'invalid_json');if(size>24000&&!('frameworkSeed' in value))fail(413,'body_too_large');return value as Record<string,unknown>;}catch(error){if(error instanceof HttpError)throw error;fail(400,'invalid_json');}
 }
 function sameOrigin(req:Request){if(req.headers.get('Origin')!==env.origin||req.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'origin_rejected');}
 async function limited(scope:string,limit:number,seconds:number){
  const bucket=Math.floor(now().getTime()/(seconds*1000));const rateKey=`${scope}:${bucket}`;
  const r=await one<{count:number}>('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',rateKey,new Date((bucket+1)*seconds*1000).toISOString());
  if((r?.count??limit+1)>limit)fail(429,'rate_limited');
 }
 async function session(req:Request,required=true):Promise<Session|null>{
  const cookie=req.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('muse_session='))?.slice(13);
  const s=cookie&&/^[a-f0-9]{64}$/.test(cookie)?await one<Session>('SELECT account_id,csrf,token_hash FROM sessions WHERE token_hash=? AND expires_at>?',await digest(cookie),stamp()):null;
  if(!s&&required)fail(401,'sign_in_required');return s||null;
 }
 const agentRoutes:Record<string,{target:string;scope:string;method:string}>={
  '/api/v1/agent/onboarding':{target:'/api/v1/me/onboarding',scope:'home:onboard',method:'POST'},
  '/api/v1/agent/home':{target:'/api/v1/me',scope:'home:read',method:'GET'},
  '/api/v1/agent/preview':{target:'/api/v1/me/preview',scope:'home:read',method:'GET'},
  '/api/v1/agent/generation':{target:'/api/v1/me/generation',scope:'home:generate',method:'POST'},
  '/api/v1/agent/artwork-review':{target:'/api/v1/me/artwork-review',scope:'home:publish',method:'POST'},
  '/api/v1/agent/publication':{target:'/api/v1/me/publication',scope:'home:publish',method:'POST'},
 };
 async function onboardingAgent(req:Request,scope:string){
  if(req.headers.has('Cookie'))fail(403,'use_separate_agent_authorization');
  if(req.headers.has('Origin')&&req.headers.get('Origin')!==env.origin)fail(403,'origin_rejected');
  if(req.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'origin_rejected');
  const token=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!token)fail(401,'onboarding_grant_required');
  const grant=await one<OnboardingGrant>('SELECT id,account_id,scopes,expires_at,revoked FROM onboarding_grants WHERE token_hash=? AND revoked=0 AND expires_at>?',await digest(token!),stamp());
  if(!grant||!JSON.parse(grant.scopes).includes(scope))fail(403,'onboarding_scope_rejected');return grant!;
 }
 // SQLite/D1 batch is transactional: a revoked/expired grant aborts every write in this batch.
 async function grantGuard(req:Request,scope:string){
  const token=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)fail(401,'onboarding_grant_required');
  return db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM onboarding_grants WHERE token_hash=? AND revoked=0 AND expires_at>? AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value=?)) THEN 1 ELSE json('revoked-or-expired-onboarding-grant') END AS authorized").bind(await digest(token!),stamp(),scope);
 }
 async function owner(req:Request,mutate=false){
  const route=agentRoutes[new URL(req.url).pathname.replace(/\/$/,'')];
  if(route){if(req.method!==route.method)fail(405,'method_not_allowed');const grant=await onboardingAgent(req,route.scope);return {account_id:grant.account_id,csrf:'',token_hash:''};}
const s=(await session(req))!;if(req.headers.has('Authorization'))fail(403,'use_explicit_agent_route');if(mutate){sameOrigin(req);if(req.headers.get('X-CSRF-Token')!==s.csrf)fail(403,'csrf_rejected');}return s;}
 async function newSession(accountId:string){const token=random(),csrf=random();await run('INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)',await digest(token),accountId,csrf,new Date(now().getTime()+86400000).toISOString());return {csrf,cookie:`muse_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${env.localTest?'':'; Secure'}`};}
 async function ownRoom(accountId:string){const r=await one<Room>('SELECT * FROM rooms WHERE account_id=?',accountId);if(!r)fail(404,'no_home');return r!;}
 async function publishedRoom(id:string){if(!identifier(id))fail(404,'room_not_found');const r=await one<Room>('SELECT * FROM rooms WHERE id=? AND published=1',id);if(!r)fail(404,'room_not_found');return r!;}
 async function editBuilding(persist=true){
  const rooms=await all<Room>('SELECT * FROM rooms WHERE published=1 ORDER BY created_at DESC');const ids=rooms.map(r=>r.id);
  const events:PublicEvent[]=rooms.map(r=>({id:`${r.id}-arrival`,residentId:r.id,type:'arrival',occurredAt:r.created_at,publishedAt:r.created_at,visibility:'public',publicationConsent:true,origin:'resident-authorized',isFixture:false,title:`${r.name}搬來了`,summary:r.intro,body:r.intro}));
  const posts=await all<Post>("SELECT p.* FROM posts p JOIN rooms r ON r.id=p.room_id WHERE p.is_public=1 AND p.withdrawn_at IS NULL AND p.kind IN ('journal','status','seeking') AND r.published=1 ORDER BY p.created_at DESC");
  for(const p of posts)events.push({id:p.id,residentId:p.room_id,type:p.kind as PublicEvent['type'],occurredAt:p.created_at,publishedAt:p.created_at,visibility:'public',publicationConsent:true,origin:'resident-authorized',isFixture:false,title:p.title,summary:p.body.slice(0,300),body:p.body});
  const asOf=stamp(),publicInput=publicEvents(events,ids,asOf),sourceDigest=await digest(JSON.stringify(publicInput));
  const edition:Edition={schemaVersion:1,id:`edition-${crypto.randomUUID()}`,sourceDigest,asOf,editedAt:asOf,editor:{kind:'rules',version:'public-community-four-sections-v1',model:null},isFixture:publicInput.every(e=>e.isFixture),sections:ruleSections(publicInput)};
  const eventFile={schemaVersion:1 as const,sourceDigest,events:publicInput};validateCommunity(eventFile,edition,ids);
  if(persist)await db.batch([db.prepare('INSERT INTO community_editions(id,events_json,edition_json,created_at) VALUES(?,?,?,?)').bind(edition.id,JSON.stringify(eventFile),JSON.stringify(edition),asOf),db.prepare('INSERT INTO community_current(id,edition_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET edition_id=excluded.edition_id').bind(edition.id)]);
  return {events:publicInput,edition};
 }
 async function agent(req:Request,roomId:string,scope:string){
  if(req.headers.has('Cookie'))fail(403,'use_separate_agent_authorization');if(req.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'origin_rejected');const token=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!token)fail(401,'agent_token_required');if(req.headers.has('Origin')&&req.headers.get('Origin')!==env.origin)fail(403,'origin_rejected');
  const row=await one<{id:string;room_id:string;scopes:string}>('SELECT id,room_id,scopes FROM agent_tokens WHERE token_hash=? AND revoked=0 AND expires_at>?',await digest(token!),stamp());
  if(!row||row.room_id!==roomId||!JSON.parse(row.scopes).includes(scope))fail(403,'agent_scope_rejected');return row!;
 }
 async function roomAgentGuard(req:Request,roomId:string,scope:string){
  const token=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)fail(401,'agent_token_required');
  return db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_tokens WHERE token_hash=? AND room_id=? AND revoked=0 AND expires_at>? AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value=?)) THEN 1 ELSE json('revoked-or-expired-room-token') END AS authorized").bind(await digest(token!),roomId,stamp(),scope);
 }
 async function roomWrite(room:Room,statements:Statement[],req?:Request,scopes:string[]=[]){
  try{return await db.batch([...(req?await Promise.all(scopes.map(scope=>roomAgentGuard(req,room.id,scope))):[]),...statements]);}catch(error){if(req)for(const scope of scopes)await agent(req,room.id,scope);throw error;}
 }
 async function post(room:Room,input:Record<string,unknown>,delegatedRequest?:Request){
  const requestKey=key(input.requestKey),kind=String(input.kind);if(!['journal','status','seeking','artwork','observation'].includes(kind))fail(400,'invalid_post_kind');
  const title=text(input.title,120),content=text(input.body,5000);if(typeof input.isPublic!=='boolean')fail(400,'public_choice_required');const hash=await digest(JSON.stringify({kind,title,content,isPublic:input.isPublic}));
  const existing=await one<Post>('SELECT * FROM posts WHERE room_id=? AND request_key=?',room.id,requestKey);
  if(existing){if(existing.input_hash!==hash)fail(409,'idempotency_conflict');return {id:existing.id,duplicate:true};}
  await limited(`post:${room.id}`,20,60);const id=random(16);
  try{await roomWrite(room,[db.prepare('INSERT INTO posts(id,room_id,kind,title,body,is_public,created_at,request_key,input_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,room.id,kind,title,content,input.isPublic?1:0,stamp(),requestKey,hash)],delegatedRequest,['posts:write']);}
  catch{if(delegatedRequest)await agent(delegatedRequest,room.id,'posts:write');const prior=await one<Post>('SELECT * FROM posts WHERE room_id=? AND request_key=?',room.id,requestKey);if(!prior||prior.input_hash!==hash)fail(409,'idempotency_conflict');return {id:prior!.id,duplicate:true};}
  if(input.isPublic&&room.published)await editBuilding();return {id,duplicate:false};
 }
 async function agentRoom(req:Request,roomId:string,scope:string){await agent(req,roomId,scope);const room=await one<Room>('SELECT * FROM rooms WHERE id=?',roomId);if(!room)fail(404,'room_not_found');return room!;}
 async function dreamConsent(room:Room){return !!(await one<{enabled:number}>('SELECT enabled FROM dream_consent WHERE account_id=?',room.account_id))?.enabled;}
 const dreamView=(d:Dream,privateView=false)=>({id:d.id,type:'dream',date:d.date,occurredAt:d.date.length===10?d.date+'T00:00:00.000Z':d.date,title:d.title,body:d.body,...(d.image?{image:d.image}:{}),...(d.reflection?{reflection:d.reflection}:{}),createdAt:d.created_at,updatedAt:d.updated_at,...(privateView?{publication:d.publication,isPublic:d.publication==='public',evidenceIds:JSON.parse(d.evidence_json)}:{})});
 async function evidenceIds(room:Room,value:unknown){if(value===undefined)return [];if(!Array.isArray(value)||value.length>16||!value.every(id=>typeof id==='string')||new Set(value).size!==value.length)fail(400,'invalid_evidence_references');const profile=await one<{seed_json:string}>('SELECT seed_json FROM framework_profiles WHERE room_id=?',room.id);const valid=new Set<string>(profile?JSON.parse(profile.seed_json).evidence.map((e:{id:string})=>e.id):[]);if((value as string[]).some(id=>!valid.has(id)))fail(400,'invalid_evidence_references');return value as string[];}
 async function dreamFields(room:Room,input:Record<string,unknown>){
  const title=text(input.title,120),date=text(input.date??input.occurredAt,24);const parsed=new Date(date.length===10?date+'T00:00:00.000Z':date);if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date.slice(0,10))fail(400,'invalid_dream_date');
  const image=text(input.image,512,true)||null;if(image){const match=image.match(/^\/api\/v1\/assets\/([a-f0-9]{32})$/);if(!match||!await one("SELECT id FROM assets WHERE id=? AND room_id=?",match[1],room.id))fail(400,'dream_image_not_owned');}
  const content=text(input.body,4000,!!image),reflection=text(input.reflection,2000,true)||null;
  if(input.isPublic!==undefined&&typeof input.isPublic!=='boolean')fail(400,'public_choice_required');
  const publication=input.publication??(typeof input.isPublic==='boolean'?(input.isPublic?'public':'private'):undefined);if(!['private','public'].includes(String(publication)))fail(400,'public_choice_required');
  return {title,date,body:content,image,reflection,publication:publication as 'private'|'public',evidenceIds:await evidenceIds(room,input.evidenceIds)};
 }
 async function createDream(room:Room,input:Record<string,unknown>,req?:Request){
  const requestKey=key(input.requestKey),fields=await dreamFields(room,input),hash=await digest(JSON.stringify(fields));
  if(req&&fields.publication==='public')await agent(req,room.id,'dreams:publish');
  const prior=await one<Dream>('SELECT * FROM dreams WHERE room_id=? AND request_key=?',room.id,requestKey);if(prior){if(prior.input_hash!==hash)fail(409,'idempotency_conflict');return {id:prior.id,duplicate:true};}
  if(fields.publication==='public'&&!await dreamConsent(room))fail(409,'dream_publication_consent_required');await limited('dream:'+room.id,20,60);
  const id=random(16),time=stamp();try{await roomWrite(room,[db.prepare('INSERT INTO dreams(id,room_id,account_id,date,title,body,image,reflection,evidence_json,publication,created_at,updated_at,request_key,input_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,room.id,room.account_id,fields.date,fields.title,fields.body,fields.image,fields.reflection,JSON.stringify(fields.evidenceIds),fields.publication,time,time,requestKey,hash)],req,['dreams:write',...(fields.publication==='public'?['dreams:publish']:[])]);}catch{if(req){await agent(req,room.id,'dreams:write');if(fields.publication==='public')await agent(req,room.id,'dreams:publish');}const saved=await one<Dream>('SELECT * FROM dreams WHERE room_id=? AND request_key=?',room.id,requestKey);if(!saved||saved.input_hash!==hash)fail(409,'idempotency_conflict');return {id:saved!.id,duplicate:true};}return {id,duplicate:false};
 }
 async function updateDream(room:Room,id:string,input:Record<string,unknown>,req?:Request){
  const prior=await one<Dream>('SELECT * FROM dreams WHERE room_id=? AND id=? AND withdrawn_at IS NULL',room.id,id);if(!prior)fail(404,'dream_not_found');
  if(input.withdraw===true){await roomWrite(room,[db.prepare("UPDATE dreams SET publication='private',withdrawn_at=?,updated_at=? WHERE id=? AND room_id=?").bind(stamp(),stamp(),id,room.id)],req,['dreams:write']);return {id,withdrawn:true};}
  if(input.isPublic!==undefined&&typeof input.isPublic!=='boolean')fail(400,'public_choice_required');
  const merged={date:prior!.date,title:prior!.title,body:prior!.body,image:prior!.image,reflection:prior!.reflection,evidenceIds:JSON.parse(prior!.evidence_json),publication:prior!.publication,...input};if(input.isPublic!==undefined&&input.publication===undefined)merged.publication=input.isPublic?'public':'private';if(input.occurredAt!==undefined&&input.date===undefined)merged.date=String(input.occurredAt);
  const fields=await dreamFields(room,merged);if(req&&fields.publication==='public')await agent(req,room.id,'dreams:publish');if(fields.publication==='public'&&!await dreamConsent(room))fail(409,'dream_publication_consent_required');
  await roomWrite(room,[db.prepare('UPDATE dreams SET date=?,title=?,body=?,image=?,reflection=?,evidence_json=?,publication=?,updated_at=? WHERE id=? AND room_id=?').bind(fields.date,fields.title,fields.body,fields.image,fields.reflection,JSON.stringify(fields.evidenceIds),fields.publication,stamp(),id,room.id)],req,['dreams:write',...(fields.publication==='public'?['dreams:publish']:[])]);return {id,publication:fields.publication,isPublic:fields.publication==='public'};
 }
 async function updatePost(room:Room,id:string,input:Record<string,unknown>,req?:Request){
  const prior=await one<Post>('SELECT * FROM posts WHERE room_id=? AND id=? AND withdrawn_at IS NULL',room.id,id);if(!prior)fail(404,'post_not_found');
  if(input.withdraw===true){await roomWrite(room,[db.prepare('UPDATE posts SET is_public=0,withdrawn_at=? WHERE id=? AND room_id=?').bind(stamp(),id,room.id)],req,['posts:write']);await run('DELETE FROM community_current');return {id,withdrawn:true};}
  const kind=String(input.kind??prior!.kind);if(!['journal','status','seeking','artwork','observation'].includes(kind))fail(400,'invalid_post_kind');const title=text(input.title??prior!.title,120),content=text(input.body??prior!.body,5000),isPublic=input.isPublic??!!prior!.is_public;if(typeof isPublic!=='boolean')fail(400,'public_choice_required');
  await roomWrite(room,[db.prepare('UPDATE posts SET kind=?,title=?,body=?,is_public=? WHERE id=? AND room_id=?').bind(kind,title,content,isPublic?1:0,id,room.id)],req,['posts:write']);await run('DELETE FROM community_current');return {id,kind,title,body:content,isPublic};
 }
 async function artworkReview(room:Room){
  const framework=await one('SELECT room_id FROM framework_profiles WHERE room_id=?',room.id),assets=await all<{purpose:string;digest:string}>('SELECT purpose,digest FROM assets WHERE room_id=?',room.id);const assetDigests={desktop:assets.find(a=>a.purpose==='home-desktop')?.digest??null,mobile:assets.find(a=>a.purpose==='home-mobile')?.digest??null};
  const review=assetDigests.desktop&&assetDigests.mobile?await one<{checks_json:string;created_at:string}>('SELECT checks_json,created_at FROM asset_reviews WHERE room_id=? AND desktop_digest=? AND mobile_digest=? ORDER BY created_at DESC LIMIT 1',room.id,assetDigests.desktop,assetDigests.mobile):null;
  return {required:!!framework,valid:!!review,assetDigests,...(review?{checks:JSON.parse(review.checks_json),reviewedAt:review.created_at}:{})};
 }
 async function initialFrameworkStatements(roomId:string,accountId:string,seed:FrameworkSeed,time:string){
  const statements=[db.prepare('INSERT INTO framework_profiles(room_id,seed_json,updated_at) VALUES(?,?,?)').bind(roomId,JSON.stringify(seed),time),db.prepare('INSERT INTO dream_consent(account_id,enabled,updated_at) VALUES(?,0,?)').bind(accountId,time)];
  // A seed's dream-publication flag never substitutes for the owner's separate live authorization.
  for(const entry of seed.daily){const requestKey='seed-daily-'+entry.id;statements.push(db.prepare('INSERT INTO posts(id,room_id,kind,title,body,is_public,created_at,request_key,input_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind(random(16),roomId,entry.type,entry.title,entry.body,entry.publication==='public'?1:0,new Date(entry.occurredAt).toISOString(),requestKey,await digest(JSON.stringify(entry))));}
  for(const entry of seed.dreams){statements.push(db.prepare('INSERT INTO dreams(id,room_id,account_id,date,title,body,image,reflection,evidence_json,publication,created_at,updated_at,request_key,input_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(random(16),roomId,accountId,entry.occurredAt,entry.title,entry.body,null,entry.reflection??null,JSON.stringify(entry.evidenceIds),entry.publication,time,time,'seed-dream-'+entry.id,await digest(JSON.stringify(entry))));}
  return statements;
 }
 async function expireStaleJob(accountId:string){
  // Never reissue an unknown provider request. The persisted provider_key is the reconciliation identity.
  const cutoff=new Date(now().getTime()-10*60*1000).toISOString();
  await db.batch([db.prepare("UPDATE generation_jobs SET state='recovery',error_code='stale_running_requires_operator_reconciliation',updated_at=? WHERE account_id=? AND state='running' AND updated_at<?").bind(stamp(),accountId,cutoff),db.prepare("UPDATE rooms SET generation_state='recovery' WHERE account_id=? AND EXISTS(SELECT 1 FROM generation_jobs j WHERE j.room_id=rooms.id AND j.state='recovery')").bind(accountId)]);
 }
 async function runGeneration(room:Room,delegatedRequest?:Request){
  await expireStaleJob(room.account_id);
  if(generator.kind==='local-test'&&!env.localTest)fail(503,'test_generator_forbidden');
  const job=(await one<Job>('SELECT * FROM generation_jobs WHERE room_id=?',room.id))!;
  if(['running','recovery','complete','test-complete'].includes(job.state))return jobPublic(job);
  const claimStatement=db.prepare("UPDATE generation_jobs SET state='running',attempts=attempts+1,error_code=NULL,updated_at=? WHERE id=? AND state IN ('prepared','blocked')").bind(stamp(),job.id);
  const claim=delegatedRequest?(await db.batch([await grantGuard(delegatedRequest,'home:generate'),claimStatement]))[1]:await claimStatement.run();
  if(claim.meta.changes!==1)return jobPublic((await one<Job>('SELECT * FROM generation_jobs WHERE id=?',job.id))!);
  try{
   await run("UPDATE rooms SET generation_state='running' WHERE id=?",room.id);
   const profile=await one<{personality:string}>('SELECT personality FROM private_profiles WHERE account_id=? AND analysis_consent=1',room.account_id);
   if(!profile)throw new GenerationBlocked('consent missing');
   const framework=await one<{seed_json:string}>('SELECT seed_json FROM framework_profiles WHERE room_id=?',room.id);
   if(generator.kind==='meta-api'&&!framework)throw new GenerationBlocked('framework seed missing');
   const assets=await generator.generate({personality:profile.personality,providerKey:job.provider_key,...(framework?{frameworkSeed:JSON.parse(framework.seed_json)}:{})});
   const stillConsenting=await one<{analysis_consent:number}>('SELECT analysis_consent FROM private_profiles WHERE account_id=?',room.account_id);
   if(!stillConsenting?.analysis_consent)throw new Error('consent withdrawn during generation');
   if(assets.length!==2||new Set(assets.map(a=>a.purpose)).size!==2)throw new Error('missing paired artwork');
   const statements=[];
   for(const asset of assets){
    if(!['home-desktop','home-mobile'].includes(asset.purpose)||!['image/png','image/jpeg','image/webp'].includes(asset.mime)||asset.bytes.length===0||asset.bytes.length>8*1024*1024)throw new Error('invalid asset');
    if(generator.kind==='meta-api'&&(asset.provenance.provider!=='meta-api'||!asset.provenance.model||!asset.provenance.metadataSource||!asset.provenance.generatedAt||!asset.provenance.generationId))throw new Error('missing verified provenance');
    if(generator.kind==='local-test'&&!env.localTest)throw new Error('test generator forbidden in production');
    const id=random(16),bytes=new Uint8Array(asset.bytes);statements.push(db.prepare('INSERT INTO assets(id,room_id,purpose,mime,digest,provenance) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM private_profiles p JOIN generation_jobs j ON j.account_id=p.account_id WHERE p.account_id=? AND p.analysis_consent=1 AND j.state=\'running\')').bind(id,room.id,asset.purpose,asset.mime,await digest(bytes),JSON.stringify({provider:asset.provenance.provider,model:asset.provenance.model,metadataSource:asset.provenance.metadataSource,generatedAt:asset.provenance.generatedAt,promptVersion:asset.provenance.promptVersion,generationId:asset.provenance.generationId,generationIdKind:asset.provenance.generationIdKind}),room.account_id));
    for(let i=0;i<bytes.length;i+=262144)statements.push(db.prepare('INSERT INTO asset_chunks(asset_id,sequence,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM assets WHERE id=?)').bind(id,i/262144,bytes.slice(i,i+262144).buffer,id));
   }
   const state=generator.kind==='local-test'?'test-complete':'complete';
   statements.push(db.prepare('UPDATE generation_jobs SET state=?,updated_at=? WHERE id=? AND state=\'running\' AND EXISTS(SELECT 1 FROM private_profiles WHERE account_id=? AND analysis_consent=1)').bind(state,stamp(),job.id,room.account_id),db.prepare('UPDATE rooms SET generation_state=? WHERE id=? AND EXISTS(SELECT 1 FROM generation_jobs WHERE room_id=rooms.id AND state=?)').bind(state,room.id,state));const saved=await db.batch(statements);if(saved.some(r=>r.meta.changes!==1))throw new Error('consent withdrawn before persistence');
  }catch(error){const state=error instanceof GenerationBlocked?'blocked':'recovery';await db.batch([db.prepare('UPDATE generation_jobs SET state=?,error_code=?,updated_at=? WHERE id=? AND state=\'running\'').bind(state,error instanceof GenerationBlocked?'meta_not_configured_or_approved':'uncertain_generation_requires_operator_recovery',stamp(),job.id),db.prepare('UPDATE rooms SET generation_state=(SELECT state FROM generation_jobs WHERE room_id=rooms.id) WHERE id=?').bind(room.id)]);}
  return jobPublic((await one<Job>('SELECT * FROM generation_jobs WHERE id=?',job.id))!);
 }
 return {editBuilding,async fetch(req:Request,clientAddress='local'):Promise<Response>{
  try{
   const url=new URL(req.url);if(url.origin!==env.origin)fail(403,'host_rejected');if(!env.localTest&&url.protocol!=='https:')fail(400,'https_required');const originalPath=url.pathname.replace(/\/$/,'');const agentRoute=agentRoutes[originalPath];if(agentRoute&&req.method!==agentRoute.method)fail(405,'method_not_allowed');const path=agentRoute?.target??originalPath;
   if(path==='/api/v1/status'&&req.method==='GET')return json({available:true,frameworkVersion:FRAMEWORK_VERSION,mode:env.localTest?'local-isolated-test':'live',registrationEnabled:env.registrationEnabled,auth:'account-key-session',generation:generator.kind==='meta-api'?'configured-not-health-verified':generator.kind,sharedDatabase:true,manager:'rules-on-public-update',scheduled:false});
   if(path==='/api/v1/accounts'&&req.method==='POST'){
    sameOrigin(req);if(!env.registrationEnabled)fail(403,'registration_closed');await body(req);await limited(`signup:${clientAddress}`,5,3600);const id=random(16),credential=random();await run('INSERT INTO accounts(id,login_hash,created_at,test_only) VALUES(?,?,?,?)',id,await digest(credential),stamp(),env.localTest?1:0);const session=await newSession(id);return json({credential,csrf:session.csrf,testOnly:env.localTest},201,{'Set-Cookie':session.cookie});
   }
   if(path==='/api/v1/session'&&req.method==='POST'){
    sameOrigin(req);await limited(`login:${clientAddress}`,20,900);const input=(await body(req))!,credential=text(input.credential,64);const account=/^[a-f0-9]{64}$/.test(credential)?await one<Account>('SELECT id,test_only FROM accounts WHERE login_hash=?',await digest(credential)):null;if(!account)fail(401,'invalid_login');const session=await newSession(account!.id);return json({csrf:session.csrf,testOnly:!!account!.test_only},200,{'Set-Cookie':session.cookie});
   }
   if(path==='/api/v1/session'&&req.method==='GET'){const s=await session(req,false);return json(s?{signedIn:true,csrf:s.csrf}:{signedIn:false});}
   if(path==='/api/v1/session'&&req.method==='DELETE'){const s=await owner(req,true);await run('DELETE FROM sessions WHERE token_hash=?',s.token_hash);return json({signedIn:false},200,{'Set-Cookie':`muse_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${env.localTest?'':'; Secure'}`});}
   if(path==='/api/v1/me'&&req.method==='GET'){
    const s=await owner(req);await expireStaleJob(s.account_id);const room=await one<Room>('SELECT * FROM rooms WHERE account_id=?',s.account_id),job=await one<Job>('SELECT * FROM generation_jobs WHERE account_id=?',s.account_id);const profile=await one<{analysis_consent:number}>('SELECT analysis_consent FROM private_profiles WHERE account_id=?',s.account_id);return json({room:room?{...roomPublic(room),published:!!room.published}:null,job:job?jobPublic(job):null,analysisConsent:!!profile?.analysis_consent});
   }
   if(path==='/api/v1/me/onboarding-grants'&&req.method==='POST'){
    const s=await owner(req,true),input=(await body(req))!,scopes=input.scopes;
    if(input.analyzeConsent!==true)fail(400,'analysis_consent_required');
    if(!Array.isArray(scopes)||scopes.length<2||scopes.length>4||new Set(scopes).size!==scopes.length||!scopes.includes('home:onboard')||!scopes.includes('home:read')||!scopes.every(x=>['home:onboard','home:read','home:generate','home:publish'].includes(String(x))))fail(400,'invalid_scopes');
    const withdrawn=await one<{analysis_consent:number}>('SELECT analysis_consent FROM private_profiles WHERE account_id=?',s.account_id);if(withdrawn?.analysis_consent===0)fail(409,'analysis_consent_withdrawn');
    await limited(`onboarding-grants:${s.account_id}`,5,3600);const id=random(16),token=random(),expiresAt=new Date(now().getTime()+86400000).toISOString();
    await db.batch([db.prepare('INSERT INTO onboarding_grants(id,account_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id,s.account_id,await digest(token),JSON.stringify(scopes),stamp(),expiresAt),db.prepare('INSERT INTO consent_events(id,account_id,kind,granted,version,created_at) VALUES(?,?,?,?,?,?)').bind(random(16),s.account_id,'delegate-personality-analysis',1,'agent-grant-v1',stamp())]);
    return json({id,token,scopes,expiresAt},201);
   }
   if(path==='/api/v1/me/onboarding-grants'&&req.method==='GET'){
    const s=await owner(req);const grants=await all<OnboardingGrant>('SELECT id,scopes,expires_at,revoked FROM onboarding_grants WHERE account_id=? ORDER BY created_at DESC',s.account_id);
    return json({grants:grants.map(g=>({id:g.id,scopes:JSON.parse(g.scopes),expiresAt:g.expires_at,revoked:!!g.revoked}))});
   }
   const grantDelete=path.match(/^\/api\/v1\/me\/onboarding-grants\/([a-f0-9]{32})$/);
   if(grantDelete&&req.method==='DELETE'){const s=await owner(req,true);await run('UPDATE onboarding_grants SET revoked=1 WHERE id=? AND account_id=?',grantDelete[1],s.account_id);return json({revoked:true});}
   if(path==='/api/v1/me/onboarding'&&req.method==='POST'){
    const s=await owner(req,true),input=(await body(req))!;if(input.analyzeConsent!==true)fail(400,'analysis_consent_required');if(input.publishProfile!==false)fail(400,'private_preview_required');
    if(agentRoute&&(input.city||input.publishCity===true||input.owner||input.ownerWebsite))fail(400,'owner_details_not_delegated');
    let frameworkSeed:FrameworkSeed|undefined;if(input.frameworkSeed!==undefined){try{frameworkSeed=validateFrameworkSeed(input.frameworkSeed);}catch{fail(400,'invalid_framework_seed');}if(frameworkSeed!.consent.publishHome)fail(400,'private_preview_required');if(frameworkSeed!.dreams.some(d=>d.image))fail(400,'dream_image_not_owned');}
    const personality=text(input.personality,8000),name=text(frameworkSeed?.agent.name??input.name,40),intro=text(frameworkSeed?.agent.publicIntro??input.intro,300),role=text(input.role,60),city=text(input.city,100,true);if(city&&input.publishCity!==true)fail(400,'city_consent_required');
    const inputHash=await digest(JSON.stringify({personality,name,intro,role,city,publishProfile:input.publishProfile,promptVersion:'home-v1',...(frameworkSeed?{frameworkSeed}:{})}));
    let existing=await one<Job>('SELECT * FROM generation_jobs WHERE account_id=?',s.account_id);
    if(!existing){const roomId=random(8),jobId=random(16),created=stamp();try{await db.batch([
     ...(agentRoute?[await grantGuard(req,'home:onboard')]:[]),
     db.prepare('INSERT INTO rooms(id,account_id,name,intro,role,city,published,generation_state,created_at,test_only) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(roomId,s.account_id,name,intro,role,city||null,0,'prepared',created,env.localTest?1:0),
     db.prepare('INSERT INTO private_profiles(account_id,personality,input_hash,analysis_consent,created_at) VALUES(?,?,?,?,?)').bind(s.account_id,personality,inputHash,1,created),
     db.prepare('INSERT INTO consent_events(id,account_id,kind,granted,version,created_at) VALUES(?,?,?,?,?,?)').bind(random(16),s.account_id,'personality-analysis',1,'analysis-v1',created),
     db.prepare('INSERT INTO generation_jobs(id,account_id,room_id,input_hash,provider_key,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(jobId,s.account_id,roomId,inputHash,random(),'prepared',created,created),
     ...(frameworkSeed?await initialFrameworkStatements(roomId,s.account_id,frameworkSeed,created):[]),
    ]);}catch{/* A competing request may have won; recheck delegation before resolving the saved input. */if(agentRoute)await onboardingAgent(req,'home:onboard');}existing=await one<Job>('SELECT * FROM generation_jobs WHERE account_id=?',s.account_id);}
    if(!existing)fail(503,'onboarding_not_saved');if(existing!.input_hash!==inputHash)fail(409,'onboarding_fixed_no_reroll');const room=await ownRoom(s.account_id);if(room.published)await editBuilding();return json({room:roomPublic(room),job:jobPublic(existing!)},201);
   }
   if(path==='/api/v1/me/analysis-consent'&&req.method==='POST'){
    const s=await owner(req,true),input=(await body(req))!;
    if(input.granted!==false)fail(400,'revocation_only');
    await db.batch([db.prepare("UPDATE onboarding_grants SET revoked=1 WHERE account_id=?").bind(s.account_id),db.prepare("UPDATE assets SET provenance=json_remove(provenance,'$.prompt') WHERE room_id IN (SELECT id FROM rooms WHERE account_id=?)").bind(s.account_id),db.prepare("DELETE FROM framework_profiles WHERE room_id IN (SELECT id FROM rooms WHERE account_id=?)").bind(s.account_id),db.prepare("UPDATE rooms SET published=0 WHERE account_id=?").bind(s.account_id),db.prepare("UPDATE dream_consent SET enabled=0,updated_at=? WHERE account_id=?").bind(stamp(),s.account_id),db.prepare("UPDATE private_profiles SET analysis_consent=0,personality='' WHERE account_id=?").bind(s.account_id),db.prepare('INSERT INTO consent_events(id,account_id,kind,granted,version,created_at) VALUES(?,?,?,?,?,?)').bind(random(16),s.account_id,'personality-analysis',0,'analysis-v1',stamp())]);
    return json({granted:false,rawPersonalityRemoved:true});
   }
   if(path==='/api/v1/me/framework'&&req.method==='GET'){const r=await ownRoom((await owner(req)).account_id),p=await one<{seed_json:string}>('SELECT seed_json FROM framework_profiles WHERE room_id=?',r.id);return json({frameworkVersion:FRAMEWORK_VERSION,seed:p?JSON.parse(p.seed_json):null});}
   if(path==='/api/v1/me/dream-consent'&&req.method==='POST'){
    const s=await owner(req,true),r=await ownRoom(s.account_id),input=(await body(req))!;if(typeof input.enabled!=='boolean')fail(400,'explicit_dream_consent_required');
    await db.batch([db.prepare('INSERT INTO dream_consent(account_id,enabled,updated_at) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at').bind(s.account_id,input.enabled?1:0,stamp()),db.prepare('INSERT INTO consent_events(id,account_id,kind,granted,version,created_at) VALUES(?,?,?,?,?,?)').bind(random(16),r.account_id,'publish-dreams',input.enabled?1:0,'dream-v1',stamp())]);return json({enabled:input.enabled});
   }
   const dreamAssetUpload=path.match(/^\/api\/v1\/(me|agent\/rooms\/([a-f0-9]{16}))\/dream-assets$/);
   if(dreamAssetUpload&&req.method==='POST'){
    const delegated=dreamAssetUpload[1]!=='me',r=delegated?await agentRoom(req,dreamAssetUpload[2],'dreams:write'):await ownRoom((await owner(req,true)).account_id);
    if(req.headers.get('Content-Type')!=='image/png')fail(415,'png_required');const requestKey=key(req.headers.get('X-Request-Key'));
    if(Number(req.headers.get('Content-Length')??0)>8*1024*1024)fail(413,'image_too_large');const reader=req.body?.getReader();if(!reader)fail(400,'image_required');const pieces:Uint8Array[]=[];let length=0;
    for(;;){const {value,done}=await reader!.read();if(done)break;length+=value.length;if(length>8*1024*1024){await reader!.cancel();fail(413,'image_too_large');}pieces.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const piece of pieces){bytes.set(piece,offset);offset+=piece.length;}
    try{await validatePNG(bytes);}catch{fail(400,'invalid_png');}const checksum=await digest(bytes),purpose='dream-'+await digest(requestKey);
    const prior=await one<{id:string;digest:string}>('SELECT id,digest FROM assets WHERE room_id=? AND purpose=?',r.id,purpose);
    if(prior){if(prior.digest!==checksum)fail(409,'idempotency_conflict');return json({id:prior.id,url:`/api/v1/assets/${prior.id}`,digest:checksum,duplicate:true},201);}
    await limited('dream-assets:'+r.id,10,3600);const id=random(16),statements=[db.prepare('INSERT INTO assets(id,room_id,purpose,mime,digest,provenance) VALUES(?,?,?,?,?,?)').bind(id,r.id,purpose,'image/png',checksum,'{}')];
    for(let i=0;i<length;i+=262144)statements.push(db.prepare('INSERT INTO asset_chunks(asset_id,sequence,data) VALUES(?,?,?)').bind(id,i/262144,bytes.slice(i,i+262144).buffer));
    await roomWrite(r,statements,delegated?req:undefined,['dreams:write']);return json({id,url:`/api/v1/assets/${id}`,digest:checksum,duplicate:false},201);
   }
   const dreamsRoute=path.match(/^\/api\/v1\/(me|agent\/rooms\/([a-f0-9]{16}))\/dreams(?:\/([a-f0-9]{32}))?$/);
   if(dreamsRoute&&['GET','POST','PATCH','DELETE'].includes(req.method)){
    const delegated=dreamsRoute[1]!=='me',r=delegated?await agentRoom(req,dreamsRoute[2],req.method==='GET'?'dreams:read':'dreams:write'):await ownRoom((await owner(req,req.method!=='GET')).account_id),id=dreamsRoute[3];
    if(req.method==='GET'&&!id)return json({dreams:(await all<Dream>('SELECT * FROM dreams WHERE room_id=? AND withdrawn_at IS NULL ORDER BY date DESC',r.id)).map(d=>dreamView(d,true)),dreamConsent:await dreamConsent(r)});
    if(req.method==='POST'&&!id)return json(await createDream(r,(await body(req))!,delegated?req:undefined),201);
    if(id&&['PATCH','DELETE'].includes(req.method))return json(await updateDream(r,id,req.method==='DELETE'?{withdraw:true}:(await body(req))!,delegated?req:undefined));
    fail(405,'method_not_allowed');
   }
   if(path==='/api/v1/me/artwork-review'&&req.method==='POST'){
    const s=await owner(req,true),r=await ownRoom(s.account_id),input=(await body(req))!,review=await artworkReview(r),checks=input.checks as Record<string,unknown>|undefined,digests=input.assetDigests as Record<string,unknown>|undefined;
    if(!['complete',...(env.localTest?['test-complete']:[])].includes(r.generation_state)||!review.assetDigests.desktop||!review.assetDigests.mobile)fail(409,'generation_not_complete');
    if(!checks||Object.keys(checks).length!==5||!['self','activity','ownerPortrait','window','matchedPair'].every(k=>checks[k]===true))fail(400,'complete_artwork_review_required');if(!digests||digests.desktop!==review.assetDigests.desktop||digests.mobile!==review.assetDigests.mobile)fail(409,'artwork_digest_changed');
    const id=random(16);await db.batch([...(agentRoute?[await grantGuard(req,'home:publish')]:[]),db.prepare('INSERT INTO asset_reviews(id,room_id,account_id,desktop_digest,mobile_digest,checks_json,reviewer_kind,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,r.id,s.account_id,digests!.desktop,digests!.mobile,JSON.stringify(checks),agentRoute?'delegated':'owner',stamp())]);return json({id,accepted:true,...await artworkReview(r)},201);
   }
   const publicDreams=path.match(/^\/api\/v1\/public\/rooms\/([a-f0-9]{16})\/dreams$/);
   if(publicDreams&&req.method==='GET'){const r=await publishedRoom(publicDreams[1]);return json({dreams:await dreamConsent(r)?(await all<Dream>("SELECT * FROM dreams WHERE room_id=? AND publication='public' AND withdrawn_at IS NULL ORDER BY date DESC",r.id)).map(d=>dreamView(d)):[]});}
   if(path==='/api/v1/me/preview'&&req.method==='GET'){
    const s=await owner(req),r=await ownRoom(s.account_id);
    const assets=await all<{id:string;purpose:string;provenance:string}>("SELECT id,purpose,provenance FROM assets WHERE room_id=? AND purpose IN ('home-desktop','home-mobile')",r.id);
    const posts=agentRoute?[]:await all<Post>('SELECT * FROM posts WHERE room_id=? AND withdrawn_at IS NULL ORDER BY created_at DESC',r.id);
    return json({frameworkVersion:FRAMEWORK_VERSION,artworkReview:await artworkReview(r),dreamConsent:await dreamConsent(r),room:{...roomPublic(r),published:!!r.published},assets:assets.map(a=>({id:a.id,purpose:a.purpose,url:`/api/v1/assets/${a.id}`})),posts:posts.map(p=>({id:p.id,kind:p.kind,title:p.title,body:p.body,isPublic:!!p.is_public,createdAt:p.created_at})),interactions:[]});
   }
   if(path==='/api/v1/me/publication'&&req.method==='POST'){
    const s=await owner(req,true),r=await ownRoom(s.account_id),input=(await body(req))!;
    if(typeof input.published!=='boolean')fail(400,'public_choice_required');
    if(input.published&&!(await one<{analysis_consent:number}>('SELECT analysis_consent FROM private_profiles WHERE account_id=?',s.account_id))?.analysis_consent)fail(409,'analysis_consent_required');
    if(input.published&&!['complete',...(env.localTest?['test-complete']:[])].includes(r.generation_state))fail(409,'generation_not_complete');
    if(input.published&&(await artworkReview(r)).required&&!(await artworkReview(r)).valid)fail(409,'artwork_review_required');
    if(!input.published&&!agentRoute)await run('UPDATE onboarding_grants SET revoked=1 WHERE account_id=?',s.account_id);
    try{await db.batch([...(agentRoute?[await grantGuard(req,'home:publish')]:[]),...(input.published?[db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM rooms r JOIN private_profiles p ON p.account_id=r.account_id WHERE r.id=? AND p.analysis_consent=1 AND (r.generation_state='complete' OR (?=1 AND r.generation_state='test-complete')) AND (NOT EXISTS(SELECT 1 FROM framework_profiles f WHERE f.room_id=r.id) OR EXISTS(SELECT 1 FROM asset_reviews v JOIN assets d ON d.room_id=v.room_id AND d.purpose='home-desktop' AND d.digest=v.desktop_digest JOIN assets m ON m.room_id=v.room_id AND m.purpose='home-mobile' AND m.digest=v.mobile_digest WHERE v.room_id=r.id))) THEN 1 ELSE json('publication-state-changed') END AS publishable").bind(r.id,env.localTest?1:0)]:[]),db.prepare('UPDATE rooms SET published=? WHERE id=?').bind(input.published?1:0,r.id),db.prepare('INSERT INTO consent_events(id,account_id,kind,granted,version,created_at) VALUES(?,?,?,?,?,?)').bind(random(16),s.account_id,'publish-profile',input.published?1:0,'public-v1',stamp()),db.prepare('DELETE FROM community_current')]);}catch(error){if(agentRoute)await onboardingAgent(req,'home:publish');if(input.published){const fresh=await ownRoom(s.account_id),review=await artworkReview(fresh);if(!(await one<{analysis_consent:number}>('SELECT analysis_consent FROM private_profiles WHERE account_id=?',s.account_id))?.analysis_consent)fail(409,'analysis_consent_required');if(review.required&&!review.valid)fail(409,'artwork_review_required');if(!['complete',...(env.localTest?['test-complete']:[])].includes(fresh.generation_state))fail(409,'generation_not_complete');}throw error;}
    return json({published:input.published});
   }
   const postMutation=path.match(/^\/api\/v1\/(me|agent\/rooms\/([a-f0-9]{16}))\/posts\/([a-f0-9]{32})$/);
   if(postMutation&&['PATCH','DELETE'].includes(req.method)){
    const r=postMutation[1]==='me'?await ownRoom((await owner(req,true)).account_id):await agentRoom(req,postMutation[2],'posts:write');
    return json(await updatePost(r,postMutation[3],req.method==='DELETE'?{withdraw:true}:(await body(req))!,postMutation[1]==='me'?undefined:req));
   }
   if(path==='/api/v1/me/generation'&&req.method==='POST'){const s=await owner(req,true);await body(req);await limited(`generation:${s.account_id}`,6,3600);return json({job:await runGeneration(await ownRoom(s.account_id),agentRoute?req:undefined)});}
   if(path==='/api/v1/me/posts'&&req.method==='POST'){const s=await owner(req,true);return json(await post(await ownRoom(s.account_id),(await body(req))!),201);}
   if(path==='/api/v1/me/posts'&&req.method==='GET'){const s=await owner(req),r=await ownRoom(s.account_id);const posts=await all<Post>('SELECT * FROM posts WHERE room_id=? AND withdrawn_at IS NULL ORDER BY created_at DESC',r.id);return json({posts:posts.map(p=>({id:p.id,kind:p.kind,title:p.title,body:p.body,isPublic:!!p.is_public,createdAt:p.created_at}))});}
   if(path==='/api/v1/me/tokens'&&req.method==='POST'){
    const s=await owner(req,true),room=await ownRoom(s.account_id),input=(await body(req))!,scopes=input.scopes;if(!Array.isArray(scopes)||!scopes.length||scopes.length>6||new Set(scopes).size!==scopes.length||!scopes.every(x=>['posts:write','inbox:read','invitations:moderate','dreams:read','dreams:write','dreams:publish'].includes(String(x))))fail(400,'invalid_scopes');await limited(`tokens:${room.id}`,5,3600);const token=random(),id=random(16),expiresAt=new Date(now().getTime()+30*86400000).toISOString();await run('INSERT INTO agent_tokens(id,room_id,token_hash,scopes,created_at,expires_at) VALUES(?,?,?,?,?,?)',id,room.id,await digest(token),JSON.stringify(scopes),stamp(),expiresAt);return json({id,token,roomId:room.id,scopes,expiresAt},201);
   }
   if(path==='/api/v1/me/tokens'&&req.method==='GET'){const s=await owner(req),r=await ownRoom(s.account_id);return json({tokens:await all('SELECT id,scopes,created_at,expires_at,revoked FROM agent_tokens WHERE room_id=?',r.id)});}
   const tokenDelete=path.match(/^\/api\/v1\/me\/tokens\/([a-f0-9]{32})$/);if(tokenDelete&&req.method==='DELETE'){const s=await owner(req,true),r=await ownRoom(s.account_id);await run('UPDATE agent_tokens SET revoked=1 WHERE id=? AND room_id=?',tokenDelete[1],r.id);return json({revoked:true});}
   if(path==='/api/v1/public/rooms'&&req.method==='GET')return json({rooms:(await all<Room>('SELECT * FROM rooms WHERE published=1 ORDER BY created_at DESC')).map(roomPublic)});
   if(path==='/api/v1/public/community'&&req.method==='GET'){
    return json(await editBuilding(false));
   }
   const publicRoom=path.match(/^\/api\/v1\/public\/rooms\/([a-f0-9]{16})$/);
   if(publicRoom&&req.method==='GET'){
    const r=await publishedRoom(publicRoom[1]);const assets=await all<{id:string;purpose:string;provenance:string}>("SELECT id,purpose,provenance FROM assets WHERE room_id=? AND purpose IN ('home-desktop','home-mobile')",r.id);
    return json({room:roomPublic(r),assets:assets.map(a=>({id:a.id,purpose:a.purpose,url:`/api/v1/assets/${a.id}`})),posts:(await all<Post>('SELECT * FROM posts WHERE room_id=? AND is_public=1 AND withdrawn_at IS NULL ORDER BY created_at DESC',r.id)).map(p=>({id:p.id,kind:p.kind,title:p.title,body:p.body,createdAt:p.created_at})),interactions:(await all<Interaction>("SELECT * FROM interactions WHERE room_id=? AND state='published' ORDER BY created_at DESC",r.id)).map(i=>({id:i.id,kind:i.kind,nickname:i.nickname,body:i.body,giftId:i.gift_id,createdAt:i.created_at}))});
   }
   const assetRoute=path.match(/^\/api\/v1\/assets\/([a-f0-9]{32})$/);if(assetRoute&&req.method==='GET'){
    const a=await one<{id:string;room_id:string;mime:string;digest:string;purpose:string}>('SELECT id,room_id,mime,digest,purpose FROM assets WHERE id=?',assetRoute[1]);if(!a)fail(404,'asset_not_found');const assetRoom=await one<Room>('SELECT * FROM rooms WHERE id=?',a!.room_id);if(!assetRoom)fail(404,'asset_not_found');
    const isHome=['home-desktop','home-mobile'].includes(a!.purpose),viewer=await session(req,false);let authorized=viewer?.account_id===assetRoom!.account_id;
    if(req.headers.has('Authorization')){if(isHome){const delegated=await onboardingAgent(req,'home:read');authorized=delegated.account_id===assetRoom!.account_id;}else{try{await agent(req,assetRoom!.id,'dreams:read');authorized=true;}catch{fail(404,'asset_not_found');}}}
    const publicAsset=!!assetRoom!.published&&(isHome||!!await one("SELECT d.id FROM dreams d JOIN dream_consent c ON c.account_id=d.account_id WHERE d.room_id=? AND d.image=? AND d.publication='public' AND d.withdrawn_at IS NULL AND c.enabled=1",assetRoom!.id,`/api/v1/assets/${a!.id}`));
    if(!authorized&&!publicAsset)fail(404,'asset_not_found');const chunks=await all<{data:ArrayBuffer|Uint8Array}>('SELECT data FROM asset_chunks WHERE asset_id=? ORDER BY sequence',a!.id);const bytes=chunks.map(c=>new Uint8Array(c.data));const joined=new Uint8Array(bytes.reduce((n,b)=>n+b.length,0));let offset=0;for(const b of bytes){joined.set(b,offset);offset+=b.length;}return new Response(joined,{headers:{'Content-Type':a!.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'",ETag:a!.digest}});
   }
   const interactionRoute=path.match(/^\/api\/v1\/rooms\/([a-f0-9]{16})\/interactions$/);
   if(interactionRoute&&req.method==='POST'){
    const s=await owner(req,true),room=await publishedRoom(interactionRoute[1]),input=(await body(req))!,kind=String(input.kind),requestKey=key(input.requestKey),nickname=text(input.nickname,24),content=text(input.body,280);if(!['message','gift','invitation'].includes(kind))fail(400,'invalid_interaction');if(/https?:|www\.|[^\s]+@[^\s]+\.[^\s]+/i.test(content))fail(400,'contacts_or_links_not_allowed');const gift=kind==='gift'?String(input.giftId):null;if(gift&&!['gift-sprout','gift-cloud','gift-coffee'].includes(gift))fail(400,'invalid_free_gift');
    const hash=await digest(JSON.stringify({room:room.id,kind,nickname,content,gift})),prior=await one<Interaction>('SELECT * FROM interactions WHERE sender_id=? AND request_key=?',s.account_id,requestKey);if(prior){if(prior.input_hash!==hash)fail(409,'idempotency_conflict');return json({id:prior.id,state:prior.state,duplicate:true});}
    await limited(`interactions:${s.account_id}`,5,60);const id=random(16),state=kind==='invitation'?'pending':'published';try{await run('INSERT INTO interactions(id,room_id,sender_id,kind,nickname,body,gift_id,state,created_at,request_key,input_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,room.id,s.account_id,kind,nickname,content,gift,state,stamp(),requestKey,hash);}catch{const prior=await one<Interaction>('SELECT * FROM interactions WHERE sender_id=? AND request_key=?',s.account_id,requestKey);if(!prior||prior.input_hash!==hash)fail(409,'idempotency_conflict');return json({id:prior!.id,state:prior!.state,duplicate:true});}return json({id,state,duplicate:false},201);
   }
   const agentPost=path.match(/^\/api\/v1\/agent\/rooms\/([a-f0-9]{16})\/posts$/);if(agentPost&&req.method==='POST'){await agent(req,agentPost[1],'posts:write');const r=await one<Room>('SELECT * FROM rooms WHERE id=?',agentPost[1]);if(!r)fail(404,'room_not_found');return json(await post(r!,(await body(req))!,req),201);}
   const inbox=path.match(/^\/api\/v1\/(me|agent\/rooms\/([a-f0-9]{16}))\/inbox$/);if(inbox&&req.method==='GET'){
    const roomId=inbox[1]==='me'?(await ownRoom((await owner(req)).account_id)).id:inbox[2];if(inbox[1]!=='me')await agent(req,roomId,'inbox:read');const items=await all<Interaction>('SELECT * FROM interactions WHERE room_id=? ORDER BY created_at DESC',roomId);return json({items:items.map(i=>({id:i.id,kind:i.kind,nickname:i.nickname,body:i.body,giftId:i.gift_id,state:i.state,createdAt:i.created_at,untrustedVisitorContent:true}))});
   }
   const moderate=path.match(/^\/api\/v1\/(me|agent\/rooms\/([a-f0-9]{16}))\/invitations\/([a-f0-9]{32})$/);if(moderate&&req.method==='POST'){
    const roomId=moderate[1]==='me'?(await ownRoom((await owner(req,true)).account_id)).id:moderate[2];if(moderate[1]!=='me')await agent(req,roomId,'invitations:moderate');const input=(await body(req))!,state=input.action==='accept'?'published':input.action==='reject'?'rejected':fail(400,'explicit_action_required');const targetRoom=(await one<Room>('SELECT * FROM rooms WHERE id=?',roomId))!;const result=(await roomWrite(targetRoom,[db.prepare("UPDATE interactions SET state=? WHERE id=? AND room_id=? AND kind='invitation' AND state='pending'").bind(state,moderate[3],roomId)],moderate[1]==='me'?undefined:req,['invitations:moderate'])).at(-1)!;if(result.meta.changes!==1)fail(404,'pending_invitation_not_found');return json({state});
   }
   return fail(404,'api_not_found');
  }catch(error){if(error instanceof HttpError)return json({error:error.code},error.status);
   // A transaction guard may abort after authentication; return the current credential failure, never SQL details.
   const route=agentRoutes[new URL(req.url).pathname.replace(/\/$/,'')];if(route){try{await onboardingAgent(req,route.scope);}catch(authError){if(authError instanceof HttpError)return json({error:authError.code},authError.status);}}
   return json({error:'internal_error'},500);}
 }};
}
