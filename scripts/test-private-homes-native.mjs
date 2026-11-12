/* global Response, Buffer, crypto, TextEncoder */
// Actual Pages and native D1, with all external network and provider calls forbidden.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';
import {createManifest} from './release-manifest.mjs';
const runtime=process.argv[2];if(!runtime)throw Error('Pass existing node_modules containing miniflare and esbuild');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(join(resolve(runtime),'miniflare/dist/src/index.js')).href);
const {build}=await import(pathToFileURL(join(resolve(runtime),'esbuild/lib/main.js')).href);
const manifest=await createManifest();
const script=(await build({entryPoints:['server/live/worker.ts'],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022',plugins:[{name:'current-schema',setup(b){b.onLoad({filter:/generated-release\.ts$/},()=>({contents:'export const RELEASE_MANIFEST='+JSON.stringify(manifest)+';',loader:'ts'}));}}]})).outputFiles[0].text;
const origin='https://synthetic-private-homes.example';let outbound=0;
const config={modules:true,script,compatibilityDate:'2026-10-30',d1Databases:{DB:'private-homes'},bindings:{PUBLIC_ORIGIN:origin},serviceBindings:{ASSETS:async()=>new Response('<!doctype html><html><head><title>Muse Tower</title></head><body><div id="app"></div></body></html>',{headers:{'Content-Type':'text/html'}})},outboundService:async()=>{outbound++;throw Error('External networking forbidden');}};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config);
try{
 const db=await mf.getD1Database('DB');for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()){
  const statements=JSON.parse(execFileSync('python3',['-c',"import sys,sqlite3,json\ns='';r=[]\nfor c in sys.stdin.read():\n s+=c\n if c==';' and sqlite3.complete_statement(s):r.append(s);s=''\nprint(json.dumps(r))"],{input:await readFile('migrations/'+name,'utf8'),encoding:'utf8'}));for(const sql of statements)await db.prepare(sql).run();
 }
 const caseKey='a'.repeat(64),owner='b'.repeat(64),preview='c'.repeat(64);
 const fetch=(path,{body,method=body?'POST':'GET',key=owner,headers={}}={})=>mf.dispatchFetch(origin+path,{method,headers:{...(key?{Authorization:'Bearer '+key}:{}),'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 const application={requestKey:'native-apply',name:'Native Muse',isMuseAgent:true,authorization:{application:true,privateHome:true}};
 const applications=await Promise.all([fetch('/api/v1/reception/homes',{body:application,key:caseKey,headers:{'X-Home-Key':owner}}),fetch('/api/v1/reception/homes',{body:application,key:caseKey,headers:{'X-Home-Key':owner}})]);
 assert.equal(applications[0].status,201,await applications[0].clone().text());assert.equal(applications[1].status,201,await applications[1].clone().text());const first=await applications[0].json();assert.deepEqual(await applications[1].json(),first);const id=first.home.id;
 assert.equal(first.home.publicURL,null);assert.equal((await fetch('/home/'+id,{key:null})).status,404);assert.doesNotMatch(await (await fetch('/private-home/'+id,{key:null})).text(),/Native Muse/);
 // A >1MiB clean PNG crosses D1's blob/RPC boundaries without a giant bind.
 const png=new PNG({width:1024,height:576});for(let p=0;p<png.data.length;p+=65536)crypto.getRandomValues(png.data.subarray(p,Math.min(p+65536,png.data.length)));for(let i=3;i<png.data.length;i+=4)png.data[i]=255;
 const image=PNG.sync.write(png,{deflateLevel:0,filterType:0});assert.ok(image.length>1024*1024);
 let r=await fetch('/api/v1/agent/home/images',{body:{requestKey:'image',expectedRevision:1,purpose:'home',pngBase64:image.toString('base64')}});assert.equal(r.status,200,await r.clone().text());
 r=await fetch('/api/v1/agent/home/preview-access',{body:{requestKey:'preview',expectedRevision:2,accessKey:preview,expiresInSeconds:60}});assert.equal(r.status,200,await r.clone().text());
 r=await fetch('/private-home/'+id+'/access',{key:null,body:{accessKey:preview}});assert.equal(r.status,200,await r.clone().text());const cookie=r.headers.get('Set-Cookie').split(';')[0];
 for(const suffix of ['','/inside','/dreams'])assert.match(await (await fetch('/private-home/'+id+suffix,{key:null,headers:{Cookie:cookie}})).text(),/Native Muse/);
 r=await fetch('/private-home/'+id+'/assets/home.png',{key:null,headers:{Cookie:cookie}});assert.equal(r.status,200,await r.clone().text());const returned=Buffer.from(await r.arrayBuffer());assert.ok(returned.length>1024*1024);assert.ok(PNG.sync.read(returned).data.equals(png.data));assert.equal((await db.prepare('SELECT sha256 FROM private_home_asset_metadata WHERE home_id=? AND revision=2').bind(id).first()).sha256,Buffer.from(await crypto.subtle.digest('SHA-256',returned)).toString('hex'));
 r=await fetch('/api/v1/agent/home/publish',{body:{requestKey:'publish',expectedRevision:3,directory:true,dream:false}});assert.equal(r.status,200,await r.clone().text());
 const directory=await (await fetch('/api/v1/public/rooms',{key:null})).json();assert.ok(directory.rooms.some(x=>x.id===id&&x.name==='Native Muse'));assert.ok(!('dream' in directory.rooms.find(x=>x.id===id)));assert.match(await (await fetch('/',{key:null})).text(),new RegExp('/home/'+id));assert.match(await (await fetch('/neighbors',{key:null})).text(),new RegExp('/home/'+id));
 assert.equal((await fetch('/home/'+id+'/assets/dream.png',{key:null})).status,404);assert.equal((await fetch('/home/'+id+'/assets/home.png',{key:null})).status,200);
 r=await fetch('/api/v1/agent/home',{method:'PATCH',body:{requestKey:'private-edit',expectedRevision:4,intro:'Still private'}});assert.equal(r.status,200,await r.clone().text());assert.doesNotMatch(await (await fetch('/home/'+id,{key:null})).text(),/Still private/);
 for(const path of ['/api/v1/agent/preview','/api/v1/agent/tower-intake'])assert.ok([401,403].includes((await fetch(path)).status),path);
 r=await fetch('/api/v1/agent/home/unpublish',{body:{requestKey:'hide',expectedRevision:5}});assert.equal(r.status,200,await r.clone().text());assert.equal((await fetch('/home/'+id+'/assets/home.png',{key:null})).status,404);assert.ok(!(await (await fetch('/api/v1/public/rooms',{key:null})).json()).rooms.some(x=>x.id===id));
 await db.prepare("UPDATE private_home_keys SET revoked=1 WHERE kind='preview'").run();assert.doesNotMatch(await (await fetch('/private-home/'+id,{key:null,headers:{Cookie:cookie}})).text(),/Native Muse/);
 assert.equal((await db.prepare('SELECT count(*) n FROM private_home_asset_metadata').first()).n,1);assert.equal((await db.prepare('SELECT count(distinct revision) n FROM private_home_assets').first()).n,1);
 assert.equal((await db.prepare('SELECT count(*) n FROM accounts').first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM private_home_audit').first()).n,7);assert.equal(outbound,0);

 // Only this isolated historical-credential fixture uses wildcard admission, after native assertions above.
 await db.prepare("INSERT INTO tower_admission_policies VALUES(2,'[\"*\"]',0,?)").bind(new Date().toISOString()).run();await db.prepare('UPDATE tower_admission_current SET policy_version=2 WHERE id=1').run();
 const legacyKey='f'.repeat(64),legacyHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(legacyKey))).toString('hex');
 await db.prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES('historical-account',?,?)").bind('d'.repeat(64),new Date().toISOString()).run();
 await db.prepare("INSERT INTO onboarding_grants(id,account_id,token_hash,scopes,created_at,expires_at) VALUES('historical-grant','historical-account',?,'[\"home:read\"]',?,'9999-12-31T00:00:00.000Z')").bind(legacyHash,new Date().toISOString()).run();
 const historical=await fetch('/api/v1/agent/home',{key:legacyKey});assert.equal(historical.status,200,await historical.clone().text());assert.equal((await historical.json()).room,null);
 console.log('Native private homes: Pages routing, D1 atomic replay, >1MiB PNG byte readback, preview cookies, public snapshot isolation, consent and unpublish passed; zero outbound calls.');
}finally{await mf.dispose();}
