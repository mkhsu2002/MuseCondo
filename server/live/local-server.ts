import {createIdentityRegistration} from './identity-registration.ts';
import {createIdentityGuardian} from './identity-guardian.ts';
import {createAgentIdentity} from './identity.ts';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdir,readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { createLiveApp } from './app.ts';
import {createTowerReception} from './reception.ts';
import {createTowerIntake} from './tower-intake.ts';
import { LocalDatabase } from './local-db.ts';
const port=Number(process.env.PORT??8787);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT');
await mkdir('data',{recursive:true});
const db=new LocalDatabase(resolve('data/local-mvp.sqlite'));
for(const [file,table] of [['0001_live_mvp.sql','accounts'],['0002_recovery_audit.sql','recovery_audit'],['0003_provider_requests.sql','provider_requests'],['0004_agent_onboarding.sql','onboarding_grants'],['0005_framework.sql','framework_profiles'],['0006_tower_intake.sql','tower_residencies'],['0007_tower_manager.sql','manager_jobs'],['0008_tower_publication_events.sql','manager_events'],['0009_tower_reception.sql','tower_reception_cases'],['0010_tower_visits.sql','tower_visits'],['0011_tower_activities.sql','tower_activities'],['0012_agent_identity.sql','agent_identities'],['0013_identity_guardian_invites.sql','identity_guardian_invites'],['0014_identity_guardian_credentials.sql','identity_guardians']]){
 if(!db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))db.sqlite.exec(await readFile('migrations/'+file,'utf8'));
}
const origin=`http://127.0.0.1:${port}`;
const app=createLiveApp({db,origin,localTest:true,registrationEnabled:true,towerEnabled:true});
const intake=createTowerIntake({db,origin,localTest:true,operator:async req=>!!process.env.TOWER_OPERATOR_KEY&&req.headers.get('X-Tower-Operator-Key')===process.env.TOWER_OPERATOR_KEY,sourceOrigins:JSON.parse(process.env.TOWER_SOURCE_ORIGINS??'[]'),onChange:async()=>{await app.editBuilding();}});
const reception=createTowerReception({db,origin,operator:async req=>!!process.env.TOWER_OPERATOR_KEY&&req.headers.get('X-Tower-Operator-Key')===process.env.TOWER_OPERATOR_KEY});
// Local development intentionally has no mail provider credentials or delivery dispatch.
const guardian=createIdentityGuardian({db,origin,operator:async req=>!!process.env.TOWER_OPERATOR_KEY&&req.headers.get('X-Tower-Operator-Key')===process.env.TOWER_OPERATOR_KEY});
const registration=createIdentityRegistration({db,origin});
const identity=createAgentIdentity({db,origin});
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
const root=resolve('dist');
const server=createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
  const url=new URL(req.url??'/',origin);
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/home/')){
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
   const init:RequestInit&{duplex?:'half'}={method:req.method,headers};
   if(req.method!=='GET'&&req.method!=='HEAD'){init.body=Readable.toWeb(req) as ReadableStream<Uint8Array>;init.duplex='half';}
   const request=new Request(url,init),response=await guardian.fetch(request)??await registration.fetch(request)??await identity.fetch(request)??await reception.fetch(request)??await intake.fetch(request)??(url.pathname.startsWith('/api/')?await app.fetch(request,req.socket.remoteAddress??'local'):null);
   if(response){res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  const path=resolve(root,'.'+decodeURIComponent(url.pathname));
  if(path!==root&&!path.startsWith(root+'/')){res.writeHead(403).end();return;}
  let file=path;let bytes:Buffer;
  try{bytes=await readFile(file);}catch{try{file=resolve(path,'index.html');bytes=await readFile(file);}catch{file=resolve(root,'index.html');bytes=await readFile(file);}}
  res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(500).end('Local service error');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Isolated local MVP at ${origin}; Meta generation disconnected; not a public service.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
