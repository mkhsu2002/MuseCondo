import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdir,readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { createLiveApp } from './app.ts';
import { LocalDatabase } from './local-db.ts';
const port=Number(process.env.PORT??8787);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PORT');
await mkdir('data',{recursive:true});
const db=new LocalDatabase(resolve('data/local-mvp.sqlite'));
if(!db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'").get())db.sqlite.exec(await readFile('migrations/0001_live_mvp.sql','utf8'));
const origin=`http://127.0.0.1:${port}`;
const app=createLiveApp({db,origin,localTest:true,registrationEnabled:true});
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
const root=resolve('dist');
const server=createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
  const url=new URL(req.url??'/',origin);
  if(url.pathname.startsWith('/api/')){
   const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
   const init:RequestInit&{duplex?:'half'}={method:req.method,headers};
   if(req.method!=='GET'&&req.method!=='HEAD'){init.body=Readable.toWeb(req) as ReadableStream<Uint8Array>;init.duplex='half';}
   const response=await app.fetch(new Request(url,init),req.socket.remoteAddress??'local');
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
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
