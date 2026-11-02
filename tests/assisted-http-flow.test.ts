import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync,readdirSync} from 'node:fs';
import {PNG} from 'pngjs';
import runtime,{type PagesBindings} from '../server/live/worker.ts';
import {LocalDatabase} from '../server/live/local-db.ts';
import {renderCondo,type CondoPage} from '../src/framework/condo-render.ts';
import type {PublicCondoSite} from '../src/framework/condo.ts';
const origin='https://tower.example',source='https://source.example/condo.json',resident='a'.repeat(16),caseKey='b'.repeat(64),towerKey='c'.repeat(64),trigger='synthetic-schedule-key';

test('a new Muse completes the actual HTTP application/proof/import/publication/handoff chain without operator placement or a paid call',async()=>{
 const db=new LocalDatabase(':memory:');for(const f of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 // Admission must run independently while paid appearance autonomy remains disabled.
 const site:PublicCondoSite={templateVersion:'muse-condo-1',example:false,home:{frameworkVersion:'0.01',id:resident,name:'HTTP Synthetic Resident',intro:'An authorized synthetic home.',assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[],dreams:[]},homeAlt:'Synthetic artwork',profile:{motto:'Motto',about:'About',interests:'Interests',strengths:'Skills',currentFocus:'Focus',invitation:'Invite'},dream:null};
 const image=new Uint8Array(PNG.sync.write(new PNG({width:16,height:9})));let claim:unknown=null,wakes=0,providerCalls=0;
 const env:PagesBindings={DB:db,PUBLIC_ORIGIN:origin,TOWER_SOURCE_ORIGINS:'["https://source.example"]',MANAGER_SCHEDULE_TRIGGER_KEY:trigger,MANAGER_RUNTIME:{fetch:async()=>{wakes++;return Response.json({queued:true});}},ASSETS:{fetch:async r=>new Response('<!doctype html><html><body><div id="app"></div><script type="module" src="/assets/app.js"></script></body></html>',{headers:{'Content-Type':new URL(r.url).pathname.endsWith('.js')?'text/javascript':'text/html'}})}};
 const original=globalThis.fetch;const errors:unknown[]=[];
 const server=createServer(async(req,res)=>{try{
  const parsed=new URL(req.url??'/', 'http://localhost'),match=parsed.pathname.match(/^\/__host\/([^/]+)(\/.*)$/);if(!match)throw Error('invalid synthetic transport');
  const virtual='https://'+decodeURIComponent(match[1])+match[2]+parsed.search;let response:Response;
  if(new URL(virtual).hostname==='source.example'){
   const path=new URL(virtual).pathname;
   response=path==='/condo.json'?Response.json(site):path==='/muse-tower-claim.json'?Response.json(claim):path==='/assets/home.png'?new Response(image,{headers:{'Content-Type':'image/png'}}):['/','/index.html','/inside.html','/dreams.html'].includes(path)?new Response(renderCondo(site,(path==='/inside.html'?'inside':path==='/dreams.html'?'dreams':'home') as CondoPage),{headers:{'Content-Type':'text/html'}}):new Response(null,{status:404});
  }else{
   const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));const body=Buffer.concat(parts).toString();
   const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value!==undefined&&name!=='host')headers.set(name,Array.isArray(value)?value.join(','):value);
   response=await runtime.fetch(new Request(virtual,{method:req.method,headers,...(body?{body}:{})}),env);
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){errors.push(error);res.writeHead(500);res.end('Synthetic transport failed');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');const local='http://127.0.0.1:'+address.port;
 globalThis.fetch=async(input,init)=>{const request=new Request(input,init),u=new URL(request.url);if(!['tower.example','source.example'].includes(u.hostname)){providerCalls++;throw Error('Unexpected external service');}return original(local+'/__host/'+encodeURIComponent(u.hostname)+u.pathname+u.search,{method:request.method,headers:request.headers,redirect:'manual',...(request.method==='POST'?{body:await request.text()}:{})});};
 async function request(path:string,method='GET',body?:unknown,key=caseKey,extra:Record<string,string>={}){const r=await fetch(origin+path,{method,headers:{Accept:'application/json','User-Agent':'Synthetic-Muse/1.0',...(key?{Authorization:'Bearer '+key}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});const raw=await r.text();let data;try{data=JSON.parse(raw);}catch{data=raw;}assert.ok(r.ok,JSON.stringify({path,status:r.status,body:data}));return data;}
 async function drain(){let count=0;while(wakes){assert.ok(count++<8,'bounded committed-event continuation');wakes--;await request('/api/v1/manager/autonomy/step','POST',{},'',{'X-Manager-Schedule-Key':trigger});}}
 try{
  const preflight=await request('/api/v1/reception/preflight','POST',{homeURL:'https://source.example/'},'');assert.equal(preflight.preflight.ready,true,JSON.stringify(preflight));assert.equal(db.sqlite.prepare('SELECT count(*) n FROM tower_reception_cases').get()!.n,0);
  const application={requestKey:'http-case-0001',name:site.home.name,requestKind:'new',request:'Please connect my complete home.',homeURL:'https://source.example/',isMuseAgent:true,authorization:{contact:true,application:true,towerAccess:true},sharing:{snapshot:false,directory:false,announcement:false,dream:false},visitPlan:{mode:'manual-return'}};
  const opened=await request('/api/v1/reception/cases','POST',application);await drain();const current=await request('/api/v1/reception/cases/'+opened.case.id);assert.equal(current.case.state,'approved');
  await request('/api/v1/reception/cases/'+opened.case.id+'/activate','POST',{requestKey:'http-activate-1',expectedVersion:current.case.version},caseKey,{'X-Tower-Agent-Key':towerKey});await drain();
  const base='/api/v1/agent/tower-intake';const prepared=await request(base+'/prepare','POST',{sourceURL:source,residentId:resident,requestKey:'http-prepare-01'},towerKey);
  claim=prepared.claim;await request(base+'/claim','POST',{claimId:prepared.claimId},towerKey);await drain();
  const imported=await request(base+'/import','POST',{sourceURL:source,residentId:resident,requestKey:'http-import-001',proof:'challenge'},towerKey);await drain();const roomId=imported.roomId;
  for(const page of ['home','inside','dreams']){const response=await fetch(origin+base+'/preview/'+page,{headers:{Authorization:'Bearer '+towerKey}});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'text/html; charset=utf-8');await response.body?.cancel();}
  const before=await request(base+'/completion','GET',undefined,towerKey);assert.equal(before.completion.complete,false);
  await request(base+'/publication','POST',{expectedRevision:1,published:true,snapshotConsent:true,directoryConsent:true,announcementConsent:false,dreamConsent:false},towerKey);await drain();
  const done=await request(base+'/completion','GET',undefined,towerKey);assert.equal(done.completion.complete,true,JSON.stringify(done));assert.equal(done.completion.publicURL,origin+'/home/'+roomId);assert.equal(done.completion.handoff.guardianReceiptConfirmed,false);
  const publicRooms=await request('/api/v1/public/rooms','GET',undefined,'');assert.ok(publicRooms.rooms.some((r:{id:string})=>r.id===roomId));
  const homeHTML=await (await fetch(origin+'/')).text();assert.ok(homeHTML.includes(`href="/home/${roomId}"`));assert.equal(done.completion.checks.homepage,true);
  const pending=await request('/api/v1/reception/cases/'+opened.case.id);assert.equal(pending.case.assistance.invitation.state,'awaiting-choice');
  for(const [choice,state] of [['later','deferred'],['decline','declined'],['receive','awaiting-email']]){const selected=await request(base+'/invitation-choice','POST',{requestKey:'http-choice-'+choice,choice},towerKey);assert.equal(selected.invitation.state,state);const stillDone=await request(base+'/completion','GET',undefined,towerKey);assert.equal(stillDone.completion.publicURL,done.completion.publicURL);assert.equal(stillDone.completion.complete,true);}
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM identity_mail_events').get()!.n,0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM tower_residencies').get()!.n,1);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM agent_identities').get()!.n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM manager_admission_calls').get()!.n,0);assert.equal(providerCalls,0);
  assert.equal(errors.length,0);assert.equal(db.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{globalThis.fetch=original;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();}
});
