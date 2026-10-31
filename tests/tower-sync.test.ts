import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { createTowerIntake } from "../server/live/tower-intake.ts";
import { LocalDatabase } from "../server/live/local-db.ts";
import {
  CONDO_PROFILE_FIELDS,
  type PublicCondoSite,
} from "../src/framework/condo.ts";
const origin = "https://tower.example",
  base = "/api/v1/me/tower-intake",
  account = "a".repeat(16),
  token = "a".repeat(64);
function chunk(type: string, data: Uint8Array) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  let c = 0xffffffff;
  for (const b of Buffer.concat([name, data])) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, crc]);
}
function png(w = 16, h = 16, pixel = 0) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 6;
  const pixels = Buffer.alloc((w * 4 + 1) * h, pixel);
  for (let y = 0; y < h; y++) pixels[y * (w * 4 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("tEXt", Buffer.from("Comment\0PRIVATE_IMAGE_METADATA")),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sourceURL="https://source.example/test/condo.json";
async function fixture() {
 const db=new LocalDatabase(":memory:");
 for(const file of ["0001_live_mvp.sql","0002_recovery_audit.sql","0003_provider_requests.sql","0004_agent_onboarding.sql","0005_framework.sql","0006_tower_intake.sql","0007_tower_manager.sql","0008_tower_publication_events.sql"])
  db.sqlite.exec(await readFile(new URL("../migrations/"+file,import.meta.url),"utf8"));
 const digest=Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))).toString("hex");
 db.sqlite.prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)").run(account,digest,"2026-10-30T00:00:00Z");
 db.sqlite.prepare("INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES(?,?,?,?)").run(digest,account,"csrf","2027-01-01T00:00:00Z");
 let site:PublicCondoSite={templateVersion:"muse-condo-1",example:false,home:{frameworkVersion:"0.01",id:"sync-resident",name:"原名字",intro:"原介紹",assets:{desktop:"./assets/home.png"},routes:{home:"./index.html",inside:"./inside.html",dreams:"./dreams.html"},daily:[],dreams:[]},homeAlt:"原住所",profile:Object.fromEntries(CONDO_PROFILE_FIELDS.map(k=>[k,"原角色"])) as PublicCondoSite["profile"],dream:null};
 let fetches=0,homeImage:Uint8Array=png(16,9),dreamImage:Uint8Array=png(),beforeFetch:(()=>void)|undefined;
 const tower=createTowerIntake({db,origin,localTest:true,sourceOrigins:["https://source.example"],now:()=>new Date("2026-10-30T00:00:00Z"),ownerAttestation:async()=>true,fetcher:async input=>{
  fetches++;beforeFetch?.();return String(input).endsWith("condo.json")?Response.json(site):new Response(new Uint8Array(String(input).endsWith("dream.png")?dreamImage:homeImage),{headers:{"Content-Type":"image/png"}});
 }});
 const req=(path:string,value?:unknown,bearer?:string)=>tower.fetch(new Request(origin+(bearer?"/api/v1/agent/tower-intake":base)+path,{method:value===undefined?"GET":"POST",headers:{Origin:origin,"Content-Type":"application/json",...(bearer?{Authorization:"Bearer "+bearer}:{Cookie:"muse_session="+token,"X-CSRF-Token":"csrf"})},...(value===undefined?{}:{body:JSON.stringify(value)})}));
 const data=async(response:Promise<Response|null>,status=200)=>{const r=(await response)!,text=await r.text();assert.equal(r.status,status,text);return JSON.parse(text);};
 const imported=await data(req("/import",{sourceURL,residentId:site.home.id,requestKey:"import-sync-1",proof:"owner-attested"}),201);
 const count=(table:string)=>Number(db.sqlite.prepare("SELECT COUNT(*) n FROM "+table).get()!.n);
 const stored=(rev:number)=>JSON.parse(db.sqlite.prepare("SELECT public_json FROM tower_snapshots WHERE revision=?").get(rev)!.public_json as string) as PublicCondoSite;
 const chunks=(rev:number,purpose:string)=>db.sqlite.prepare("SELECT hex(data) data,digest FROM tower_asset_chunks WHERE revision=? AND purpose=? ORDER BY sequence").all(rev,purpose);
 const preview=(rev=1,bearer?:string)=>data(req("/source-preview",{expectedRevision:rev},bearer));
 const apply=(review:{baseRevision:number;sourceDigest:string},fields:string[],key="sync-reviewed-1",bearer?:string)=>req("/snapshot",{expectedRevision:review.baseRevision,requestKey:key,reviewedSourceDigest:review.sourceDigest,apply:fields},bearer);
 const addDream=()=>{site.dream={id:"sync-dream",title:"原夢",body:"原夢內容",wish:"原願望",occurredAt:"2026-10-30T00:00:00Z",image:{src:"./assets/dream.png",alt:"原夢圖"}};site.home.dreams=[{id:site.dream.id,type:"dream",title:site.dream.title,body:site.dream.body,occurredAt:site.dream.occurredAt,image:site.dream.image.src}];};
 return {db,req,data,imported,count,stored,chunks,preview,apply,addDream,get site(){return site;},set site(value:PublicCondoSite){site=value;},get fetches(){return fetches;},set homeImage(value:Uint8Array){homeImage=value;},set dreamImage(value:Uint8Array){dreamImage=value;},set beforeFetch(fn:(()=>void)|undefined){beforeFetch=fn;},close:()=>db.close()};
}
test("source preview compares the current private authority without persistence or publication",async()=>{
 const f=await fixture();try{
  await f.data(f.req("/publication",{expectedRevision:1,published:true,snapshotConsent:true,directoryConsent:true,announcementConsent:true,dreamConsent:false}));
  await f.data(f.req("/content",{expectedRevision:1,requestKey:"local-content-1",content:{intro:"Tower 本地新介紹"}}),201);
  f.site.home.intro="原站新介紹";f.site.home.name="原站新名字";f.site.homeAlt="原站新圖說";f.homeImage=png(16,9,90);
  const counts=[f.count("tower_snapshots"),f.count("tower_requests"),f.count("tower_audit"),f.count("tower_asset_chunks")];
  const review=await f.preview(2);
  assert.equal(review.baseRevision,2);assert.match(review.sourceDigest,/^[a-f0-9]{64}$/);
  assert.deepEqual(review.groups.find((g:{field:string})=>g.field==="intro").before,{name:"原名字",intro:"Tower 本地新介紹"});
  assert.equal(review.groups.find((g:{field:string})=>g.field==="home").changed,true);
  assert.deepEqual([f.count("tower_snapshots"),f.count("tower_requests"),f.count("tower_audit"),f.count("tower_asset_chunks")],counts);
  assert.equal(f.db.sqlite.prepare("SELECT public_revision FROM tower_residencies").get()!.public_revision,1);
 }finally{f.close();}
});
test("unreviewed snapshots and invalid selections cannot silently overwrite local data",async()=>{
 const f=await fixture();try{
  await f.data(f.req("/snapshot",{expectedRevision:1,requestKey:"old-snapshot-1"}),409).then(v=>assert.equal(v.error,"source_review_required"));
  const review=await f.preview();for(const fields of [[],["intro","intro"],["identity"],["sourceURL"]])await f.data(f.apply(review,fields),400);
  assert.equal(f.count("tower_snapshots"),1);
 }finally{f.close();}
});
test("explicit groups update only chosen JSON and preserve every unselected asset chunk",async()=>{
 const f=await fixture();try{
  await f.data(f.req("/content",{expectedRevision:1,requestKey:"local-intro-1",content:{intro:"保留本地介紹"}}),201);
  f.site.home.intro="來源介紹";f.site.home.name="來源名字";f.site.homeAlt="來源家圖說";f.homeImage=png(16,9,80);f.addDream();
  const review=await f.preview(2),before=f.stored(2),oldChunks=f.chunks(2,"home");
  const result=await f.data(f.apply(review,["profile","daily"]),201);
  assert.deepEqual(result.apply,["profile","daily"]);assert.equal(result.reviewedSourceDigest,review.sourceDigest);
  assert.deepEqual(f.stored(3),before);assert.deepEqual(f.chunks(3,"home"),oldChunks);assert.equal(f.stored(3).dream,null);
  assert.equal(f.db.sqlite.prepare("SELECT dream_consent,public_revision,source_url FROM tower_residencies").get()!.source_url,sourceURL);
  const next=await f.preview(3);await f.data(f.apply(next,["intro","home"],"sync-intro-home"),201);
  assert.equal(f.stored(4).home.intro,"來源介紹");assert.equal(f.stored(4).home.name,"來源名字");assert.equal(f.stored(4).home.id,before.home.id);assert.deepEqual(f.stored(4).home.routes,before.home.routes);
  assert.equal(f.stored(4).homeAlt,"來源家圖說");assert.notDeepEqual(f.chunks(4,"home"),oldChunks);assert.equal(f.stored(4).dream,null);
 }finally{f.close();}
});
test("dream is a single opt-in import group and never grants publication consent",async()=>{
 const f=await fixture();try{
  f.addDream();const review=await f.preview();await f.data(f.apply(review,["dream"]),201);
  assert.deepEqual(f.stored(2).dream,f.site.dream);assert.deepEqual(f.stored(2).home.dreams,f.site.home.dreams);assert.equal(f.chunks(2,"dream").length,1);
  assert.equal(f.db.sqlite.prepare("SELECT dream_consent FROM tower_residencies").get()!.dream_consent,0);
  assert.doesNotMatch(Buffer.from(f.chunks(2,"dream")[0].data as string,"hex").toString("latin1"),/PRIVATE_IMAGE_METADATA/);
  f.site.dream=null;f.site.home.dreams=[];await f.data(f.apply(await f.preview(2),["dream"],"remove-source-dream"),201);
  assert.equal(f.stored(3).dream,null);assert.deepEqual(f.stored(3).home.dreams,[]);assert.equal(f.chunks(3,"dream").length,0);assert.equal(f.chunks(2,"dream").length,1);
 }finally{f.close();}
});
test("changed remote text or image requires a fresh review even for unselected groups",async()=>{
 const f=await fixture();try{
  const review=await f.preview();f.site.home.intro="來源又變了";assert.equal((await f.data(f.apply(review,["daily"]),409)).error,"source_review_changed");
  const next=await f.preview();f.homeImage=png(16,9,30);assert.equal((await f.data(f.apply(next,["intro"]),409)).error,"source_review_changed");assert.equal(f.count("tower_snapshots"),1);
  f.site.home.id="different-identity";await f.data(f.req("/source-preview",{expectedRevision:1}),409).then(v=>assert.equal(v.error,"source_identity_changed"));
 }finally{f.close();}
});
test("base revision changes invalidate reviews and successful permanent replay never fetches",async()=>{
 const f=await fixture();try{
  const review=await f.preview();await f.data(f.apply(review,["intro"]),201);const fetched=f.fetches;
  f.site.home.intro="遠端後續內容";assert.equal((await f.data(f.apply(review,["intro"]),201)).revision,2);assert.equal(f.fetches,fetched);
  await f.data(f.apply(review,["profile"]),409).then(v=>assert.equal(v.error,"idempotency_conflict"));assert.equal(f.fetches,fetched);
  await f.data(f.apply(review,["intro"],"different-sync-key"),409).then(v=>assert.equal(v.error,"revision_conflict"));
  const later=await f.preview(2);await f.data(f.req("/content",{expectedRevision:2,requestKey:"local-during-review",content:{intro:"最新本地"}}),201);
  await f.data(f.apply(later,["intro"],"stale-local-review"),409);assert.equal(f.stored(3).home.intro,"最新本地");
 }finally{f.close();}
});
test("read-only and write-only household grants may preview, only write grants may apply",async()=>{
 const f=await fixture();try{
  const grant=await f.data(f.req("/tokens",{}),201);f.db.sqlite.prepare("UPDATE tower_tokens SET scopes=? WHERE id=?").run('["tower:read"]',grant.id);
  const review=await f.preview(1,grant.token);await f.data(f.apply(review,["intro"],"read-denied-sync",grant.token),403);
  f.db.sqlite.prepare("UPDATE tower_tokens SET scopes=? WHERE id=?").run('["tower:write"]',grant.id);await f.preview(1,grant.token);await f.data(f.apply(review,["intro"],"write-allowed-sync",grant.token),201);
 }finally{f.close();}
});
test("revocation during remote fetch blocks both preview disclosure and snapshot writes",async()=>{
 const f=await fixture();try{
  const grant=await f.data(f.req("/tokens",{}),201),review=await f.preview();
  f.beforeFetch=()=>{f.db.sqlite.prepare("UPDATE tower_tokens SET revoked=1 WHERE id=?").run(grant.id);};
  await f.data(f.req("/source-preview",{expectedRevision:1},grant.token),403);f.db.sqlite.prepare("UPDATE tower_tokens SET revoked=0 WHERE id=?").run(grant.id);
  await f.data(f.apply(review,["intro"],"revoked-during-sync",grant.token),403);assert.equal(f.count("tower_snapshots"),1);
 }finally{f.close();}
});
test("ABA source generations invalidate old reviews and source movement during fetch rolls back",async()=>{
 const f=await fixture();try{
  const review=await f.preview();
  // Permanent source receipts are the existing monotonic generation, even if
  // source URLs and timestamps return to their previous values.
  f.db.sqlite.prepare("INSERT INTO tower_requests(account_id,request_key,operation,input_hash,response_json,created_at) VALUES(?,?,'source','test','{}','2026-10-30T00:00:00Z')").run(account,"source-aba-out");
  f.db.sqlite.prepare("INSERT INTO tower_requests(account_id,request_key,operation,input_hash,response_json,created_at) VALUES(?,?,'source','test','{}','2026-10-30T00:00:00Z')").run(account,"source-aba-back");
  await f.data(f.apply(review,["intro"]),409).then(v=>assert.equal(v.error,"source_review_changed"));
  const next=await f.preview();let once=false;f.beforeFetch=()=>{if(once)return;once=true;f.db.sqlite.prepare("UPDATE tower_residencies SET source_url=?").run("https://source.example/moved/condo.json");};
  await f.data(f.apply(next,["intro"],"source-moved-sync"),409);assert.equal(f.count("tower_snapshots"),1);
 }finally{f.close();}
});
test("concurrent sync writes have one winner and failed audit atomically rolls back JSON, images and receipt",async()=>{
 const f=await fixture();try{
  f.homeImage=png(16,9,75);const review=await f.preview();
  f.db.sqlite.exec("CREATE TRIGGER fail_sync BEFORE INSERT ON tower_audit WHEN NEW.action='snapshot-imported' BEGIN SELECT RAISE(ABORT,'PRIVATE_SYNC_STORAGE'); END");
  await f.data(f.apply(review,["home"]),503).then(v=>assert.equal(v.error,"tower_storage_unavailable"));assert.equal(f.count("tower_snapshots"),1);assert.equal(f.count("tower_requests"),1);assert.equal(f.count("tower_asset_chunks"),1);
  f.db.sqlite.exec("DROP TRIGGER fail_sync");
  const results=await Promise.all([f.apply(review,["home"],"concurrent-sync-a"),f.apply(review,["home"],"concurrent-sync-b")]);assert.deepEqual(results.map(r=>r!.status).sort(),[201,409]);assert.equal(f.count("tower_snapshots"),2);
 }finally{f.close();}
});
test("source digest is canonical and ignores removed PNG metadata",async()=>{
 const f=await fixture();try{
  const review=await f.preview();
  const reorder=(value:unknown):unknown=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)])):value;
  f.site=reorder(f.site) as PublicCondoSite;
  assert.equal((await f.preview()).sourceDigest,review.sourceDigest);
  // The imported PNG contains tEXt; use its stripped equivalent as the source.
  const hex=f.chunks(1,"home")[0].data as string;f.homeImage=new Uint8Array(Buffer.from(hex,"hex"));
  assert.equal((await f.preview()).sourceDigest,review.sourceDigest);
 }finally{f.close();}
});
test("unselected local dream and its chunks survive a source sync while the existing public edition stays fixed",async()=>{
 const f=await fixture();try{
  f.addDream();await f.data(f.apply(await f.preview(),["dream"]),201);
  await f.data(f.req("/publication",{expectedRevision:2,published:true,snapshotConsent:true,directoryConsent:false,announcementConsent:false,dreamConsent:true}));
  const localDream=f.stored(2).dream,localChunks=f.chunks(2,"dream");
  f.site.dream!.title="來源改了夢";f.site.home.dreams[0].title=f.site.dream!.title;f.dreamImage=png(16,16,55);f.site.home.intro="新介紹";
  await f.data(f.apply(await f.preview(2),["intro"],"retain-local-dream"),201);
  assert.deepEqual(f.stored(3).dream,localDream);assert.deepEqual(f.chunks(3,"dream"),localChunks);
  const state=f.db.sqlite.prepare("SELECT public_revision,dream_consent FROM tower_residencies").get()!;assert.equal(state.public_revision,2);assert.equal(state.dream_consent,1);
  assert.equal(f.count("manager_events"),1);
 }finally{f.close();}
});
test("a source preview cannot disclose the original household after its token is reassigned mid-read",async()=>{
 const f=await fixture();try{
  const grant=await f.data(f.req("/tokens",{}),201);
  f.db.sqlite.prepare("INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)").run("b".repeat(16),"other","2026-10-30T00:00:00Z");
  f.beforeFetch=()=>{f.db.sqlite.prepare("UPDATE tower_tokens SET account_id=? WHERE id=?").run("b".repeat(16),grant.id);};
  assert.equal((await f.data(f.req("/source-preview",{expectedRevision:1},grant.token),403)).error,"authorization_changed");
 }finally{f.close();}
});
test("mixed preserved and imported images are bounded by the 12MiB final snapshot limit",async()=>{
 const f=await fixture();try{
  // A prior valid large home is preserved without decoding or rewriting it.
  f.db.sqlite.prepare("UPDATE tower_asset_chunks SET data=zeroblob(?) WHERE purpose='home'").run(7*1024*1024);
  f.addDream();
  const width=1280,height=1280,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const pixels=Buffer.alloc((width*4+1)*height);let state=0x12345678;
  for(let y=0;y<height;y++)for(let x=1;x<=width*4;x++){state^=state<<13;state^=state>>>17;state^=state<<5;pixels[y*(width*4+1)+x]=state&255;}
  f.dreamImage=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
  const review=await f.preview();assert.equal((await f.data(f.apply(review,["dream"]),413)).error,"source_images_too_large");assert.equal(f.count("tower_snapshots"),1);assert.equal(f.count("tower_requests"),1);
 }finally{f.close();}
});
