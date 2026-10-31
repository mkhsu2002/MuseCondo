/* global Request */
import {Buffer} from 'node:buffer';
// Loopback-only synthetic visual fixture; never proxies production or accepts mutations.
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createLiveApp} from '../server/live/app.ts';
const port=Number(process.env.TOWER_PREVIEW_PORT??8884),seconds=Number(process.env.TOWER_PREVIEW_EXPIRY_SECONDS??3600);
if(!Number.isInteger(port)||port<1024||port>65535||!Number.isInteger(seconds)||seconds<1||seconds>86400)throw Error('Invalid fixture settings');
const origin=`http://127.0.0.1:${port}`,root=resolve('dist'),db=new LocalDatabase(':memory:');
for(const file of (await readdir('migrations')).filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(await readFile('migrations/'+file,'utf8'));
const app=createLiveApp({db,origin,localTest:true,registrationEnabled:false,towerEnabled:true}),endsAt=new Date(Date.now()+seconds*1000).toISOString();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403).end();return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const url=new URL(req.url??'/',origin);
  if(url.pathname==='/api/v1/tower/appearance'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({theme:Date.now()<Date.parse(endsAt)?'halloween':'standard',revision:1,endsAt,generation:'manager-2026-10-31-r0',images:{day:'/api/v1/tower/appearance/assets/manager-2026-10-31-r0/day.png',night:'/api/v1/tower/appearance/assets/manager-2026-10-31-r0/night.png'}}));return;
  }
  const scene=url.pathname.match(/^\/api\/v1\/tower\/appearance\/assets\/manager-2026-10-31-r0\/(day|night)\.png$/);
  if(scene){const bytes=await readFile(resolve(root,`tower/muse-tower-${scene[1]}-v2.webp`));res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(req.method==='HEAD'?undefined:bytes);return;}
  if(url.pathname.startsWith('/api/')){const response=await app.fetch(new Request(url,{method:req.method}),'synthetic-visual-fixture');res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;}
  let file=resolve(root,'.'+decodeURIComponent(url.pathname));if(file!==root&&!file.startsWith(root+'/')){res.writeHead(403).end();return;}
  let bytes;try{bytes=await readFile(file);}catch{try{file=resolve(file,'index.html');bytes=await readFile(file);}catch{file=resolve(root,'index.html');bytes=await readFile(file);}}
  res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(500).end('Synthetic fixture unavailable');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic runtime-URL wiring preview (original artwork only, not Meta output): ${origin}; expires ${endsAt}; no external API or paid calls.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
