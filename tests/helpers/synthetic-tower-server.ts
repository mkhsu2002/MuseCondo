import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {PNG} from 'pngjs';
import runtime,{type PagesBindings} from '../../server/live/worker.ts';
import {LocalDatabase} from '../../server/live/local-db.ts';
import {renderCondo,type CondoPage} from '../../src/framework/condo-render.ts';
import type {PublicCondoSite} from '../../src/framework/condo.ts';
const origin='https://tower.example',resident='a'.repeat(16),caseKey='b'.repeat(64),trigger='synthetic-schedule-key';

async function main(){
 const db=new LocalDatabase(':memory:');for(const f of readdirSync(new URL('../../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../../migrations/'+f,import.meta.url),'utf8'));
 // Admission must run independently while paid appearance autonomy remains disabled.
 const site:PublicCondoSite={templateVersion:'muse-condo-1',example:false,home:{frameworkVersion:'0.01',id:resident,name:'HTTP Synthetic Resident',intro:'An authorized synthetic home.',assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[],dreams:[]},homeAlt:'Synthetic artwork',profile:{motto:'Motto',about:'About',interests:'Interests',strengths:'Skills',currentFocus:'Focus',invitation:'Invite'},dream:null};
 const image=new Uint8Array(PNG.sync.write(new PNG({width:16,height:9})));let claim:unknown=null,wakes=0,providerCalls=0;
 const env:PagesBindings={DB:db,PUBLIC_ORIGIN:origin,TOWER_SOURCE_ORIGINS:'["https://source.example"]',MANAGER_SCHEDULE_TRIGGER_KEY:trigger,MANAGER_RUNTIME:{fetch:async()=>{wakes++;return Response.json({queued:true});}},ASSETS:{fetch:async r=>{
  const url=new URL(r.url),path=decodeURIComponent(url.pathname),root=new URL('../../dist/',import.meta.url);
  if(path.split('/').includes('..'))return new Response(null,{status:404});
  let file=new URL(path==='/'?'index.html':path.slice(1),root);
  if(existsSync(file)&&statSync(file).isDirectory())file=new URL(file.href.replace(/\/?$/,'/')+'index.html');
  if(!file.href.startsWith(root.href)||!existsSync(file))return new Response(null,{status:404});
  const type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':path.endsWith('.webp')?'image/webp':path.endsWith('.json')?'application/json':'text/html';
  return new Response(readFileSync(file),{headers:{'Content-Type':type}});
 }}};
 const original=globalThis.fetch;const errors:unknown[]=[];
 const server=createServer(async(req,res)=>{try{
  const parsed=new URL(req.url??'/', 'http://localhost');
  if(parsed.pathname==='/__test/claim'){const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));claim=JSON.parse(Buffer.concat(parts).toString());res.writeHead(200);res.end('{}');return;}
  if(parsed.pathname==='/__test/drain'){await drain();res.writeHead(200);res.end('{}');return;}
  if(parsed.pathname==='/__test/metrics'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({providerCalls,errors:errors.map(String),mail:Number(db.sqlite.prepare('SELECT count(*) n FROM identity_mail_events').get()!.n),audits:Number(db.sqlite.prepare('SELECT count(*) n FROM tower_audit').get()!.n),foreignKeys:db.sqlite.prepare('PRAGMA foreign_key_check').all().length}));return;}
  const match=parsed.pathname.match(/^\/__host\/([^/]+)(\/.*)$/)??[parsed.pathname,'tower.example',parsed.pathname];
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
 process.stdout.write(JSON.stringify({url:local})+'\n');
 const shutdown=()=>{globalThis.fetch=original;server.close(()=>{db.close();process.exit(0);});server.closeAllConnections();};
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
await main();
