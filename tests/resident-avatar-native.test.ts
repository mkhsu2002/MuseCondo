import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PNG} from 'pngjs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createPrivateHomeRoutes} from '../server/live/private-home-routes.ts';
import {withResidentAvatars} from '../server/live/resident-avatars.ts';
const origin='https://portrait.example',key='b'.repeat(64),caseKey='a'.repeat(64);
function setup(){const db=new LocalDatabase(':memory:');for(const n of readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+n,'utf8'));return {db,route:createPrivateHomeRoutes({db,origin})};}
function request(path:string,body?:unknown,method='POST'){return new Request(origin+path,{method:body?method:'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(path.includes('/reception/')?caseKey:key),'X-Home-Key':key},...(body?{body:JSON.stringify(body)}:{})});}
test('only current published portrait enters the directory; private edits, replacement and withdrawal remain isolated',async()=>{const s=setup();try{
 const app=await s.route(request('/api/v1/reception/homes',{requestKey:'apply',name:'Home',isMuseAgent:true,authorization:{application:true,privateHome:true}}));assert.equal(app!.status,201);const id=(await app!.json() as {home:{id:string}}).home.id;
 const png=new PNG({width:16,height:9});png.data.fill(255);const image=PNG.sync.write(png).toString('base64'),crop='10,20,20,35.5555555556';
 const mutate=async(path:string,body:unknown,method='POST')=>{const r=await s.route(request(path,body,method));assert.equal(r!.status,200,await r!.clone().text());return r!;};
 await mutate('/api/v1/agent/home/images',{requestKey:'image1',expectedRevision:1,purpose:'home',pngBase64:image,characterPortraitCrop:crop});
 assert.equal((await withResidentAvatars(s.db,[{id,name:'Home'}]))[0].avatar,undefined);
 await mutate('/api/v1/agent/home/publish',{requestKey:'publish1',expectedRevision:2,directory:true,dream:false});
 const published=(await withResidentAvatars(s.db,[{id,name:'Home'}]))[0].avatar!;assert.equal(published.crop,crop);assert.equal(published.url,`/home/${id}/assets/home.png?revision=3`);
 await mutate('/api/v1/agent/home',{requestKey:'draftcrop',expectedRevision:3,characterPortraitCrop:'1,2,10,20'},'PATCH');assert.deepEqual((await withResidentAvatars(s.db,[{id,name:'Home'}]))[0].avatar,published);
 await mutate('/api/v1/agent/home/images',{requestKey:'image2',expectedRevision:4,purpose:'home',pngBase64:image});
 const state=await (await s.route(request('/api/v1/agent/home')))!.json() as {home:{content:{characterPortraitCrop?:string}}};assert.equal(state.home.content.characterPortraitCrop,undefined);
 assert.deepEqual((await withResidentAvatars(s.db,[{id,name:'Home'}]))[0].avatar,published);
 await mutate('/api/v1/agent/home/publish',{requestKey:'publish2',expectedRevision:5,directory:true,dream:false});assert.equal((await withResidentAvatars(s.db,[{id,name:'Home'}]))[0].avatar,undefined);
 assert.equal((await s.route(request(published.url)))!.status,404);assert.equal((await s.route(request(`/home/${id}/assets/home.png?revision=6`)))!.status,200);
 await mutate('/api/v1/agent/home/unpublish',{requestKey:'close',expectedRevision:6});assert.equal((await withResidentAvatars(s.db,[{id,name:'Home'}]))[0].avatar,undefined);assert.equal((await s.route(request(`/home/${id}/assets/home.png?revision=6`)))!.status,404);
 assert.equal(s.db.sqlite.prepare("SELECT count(*) n FROM private_home_audit WHERE action='images'").get()!.n,2);
}finally{s.db.close();}});
test('SQL guard rejects malformed, out of range and extra-member crops without touching old snapshots',async()=>{const s=setup();try{
 const app=await s.route(request('/api/v1/reception/homes',{requestKey:'apply',name:'A',isMuseAgent:true,authorization:{application:true,privateHome:true}}));const id=(await app!.json() as {home:{id:string}}).home.id;
 let rev=2;for(const characterPortraitCrop of ['0,0,200,20','0,0,1,1,2','bad','0,0,0,1','-1,0,1,1','0,0,20,20;background:red'])assert.throws(()=>s.db.sqlite.prepare('INSERT INTO private_home_snapshots VALUES(?,?,?,?)').run(id,rev++,JSON.stringify({name:'A',intro:'',profile:'',journal:'',dream:'',characterPortraitCrop}),'2026-11-12'),/native_content_shape/);
 assert.equal(s.db.sqlite.prepare('SELECT count(*) n FROM private_home_snapshots').get()!.n,1);
}finally{s.db.close();}});
