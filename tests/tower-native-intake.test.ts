import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createTowerIntake} from '../server/live/tower-intake.ts';
import {CONDO_PROFILE_FIELDS} from '../src/framework/condo.ts';
import {openSyntheticTower} from './helpers/tower-admission-fixture.ts';
const origin='https://tower.example',key='A'.repeat(43),slug='synthetic-house-abc123',asset='abc123';
const share=`https://muse.ai/s/${slug}/${key}`,host=`https://${asset}.cf.metaaiusercontent.com`;
function png(w:number,h:number){
 const chunk=(name:string,data:Uint8Array)=>{const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);let c=0xffffffff;for(const b of Buffer.concat([type,data])){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}length.writeUInt32BE(data.length);crc.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([length,type,data,crc]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('Comment\0PRIVATE_METADATA')),chunk('IDAT',deflateSync(new Uint8Array((w*4+1)*h))),chunk('IEND',new Uint8Array())]);
}
async function fixture(strict=false){
 const db=new LocalDatabase(':memory:');const migrations=readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();for(const file of migrations.filter(f=>!strict||f<'0024'))db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));if(!strict)openSyntheticTower(db);
 let now=new Date('2026-10-31T00:00:00Z'),claim:unknown=null,intro='原本介紹',hasDream=false;const calls:string[]=[];let onHTML:(()=>void)|undefined;
 for(const who of ['a','b']){const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(who.repeat(64)))).toString('hex');db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(who.repeat(16),hash,now.toISOString());db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash,who.repeat(16),'csrf-'+who,'2027-01-01T00:00:00Z');}
 const dream=()=>({id:'synthetic-dream',title:'合成夢',body:'一個合成夢境。',wish:'合成願望',occurredAt:'2026-10-31T00:00:00Z',image:{src:'./assets/dream.png',alt:'合成夢圖'}});
 if(strict)for(const file of migrations.filter(f=>f>='0024'))db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const site=()=>({templateVersion:'muse-condo-1',example:false,home:{frameworkVersion:'0.01',id:'eeeeeeeeeeeeeeee',name:'合成原生家園',intro,assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[],dreams:hasDream?[{id:dream().id,type:'dream',title:dream().title,body:dream().body,occurredAt:dream().occurredAt,image:dream().image.src}]:[]},homeAlt:'合成家園',profile:Object.fromEntries(CONDO_PROFILE_FIELDS.map(k=>[k,'合成資料'])),dream:hasDream?dream():null});
 const visible=()=>`<section id="view-home"><p class="intro">${intro}</p><figure class="home-scene"><img src="assets/home.png" alt="合成家園"></figure></section><section id="view-inside"><aside class="character-card"><h2>合成原生家園</h2><p class="character-motto">合成資料</p><dl><div><dt>喜歡的事</dt><dd>合成資料</dd></div></dl></aside>${['角色故事','天賦技能','進行中的任務','組隊偏好'].map(h=>`<section class="sheet-block"><h2>${h}</h2><p class="prose">合成資料</p></section>`).join('')}<section class="chronicle"><p class="empty-note" data-musecondo-ui="true">沒有日常</p></section></section><section id="view-dreams">${hasDream?`<figure class="dream-scene"><img src="assets/dream.png" alt="合成夢圖"><time datetime="2026-10-31T00:00:00Z">Date</time></figure><div class="dream-story"><h2>合成夢</h2><p class="prose">一個合成夢境。</p><section class="wish"><p class="prose">合成願望</p></section></div>`:`<p class="empty-note" data-musecondo-ui="true">沒有夢</p>`}</section>`;
 const space=`${host}/index.html?hatch_share=${slug}&share_key=${key}`;
 const fetcher:typeof fetch=async(input,init)=>{const url=String(input);calls.push(url);assert.equal(init?.redirect,'manual');assert.equal(new Headers(init?.headers).get('Authorization'),null);
  if(url===share||url===share.replace(key,'B'.repeat(43))){const activeKey=url.slice(url.lastIndexOf('/')+1);const row='0:'+JSON.stringify({preloadedId:slug,preloadedShareKey:activeKey,preloadedShareData:{type:'space',share_type:'cloudflare',deployment_status:'ready',asset_id:asset,space_url:space.replace(key,activeKey)}})+'\n';return new Response('<script>self.__next_f.push([1,'+JSON.stringify(row)+'])</script>',{headers:{'Content-Type':'text/html'}});}
  if(url===space||url===space.replace(key,'B'.repeat(43)))return new Response(null,{status:302,headers:{Location:'/index.html','Set-Cookie':'__Host-cf_space_read=synthetic; Secure; HttpOnly; Path=/'}});
  if(url===host+'/index.html'){onHTML?.();return new Response(visible()+'<script id="musecondo-home" type="application/json">'+JSON.stringify(site())+'</script>'+(claim?'<script id="musecondo-claim" type="application/json">'+JSON.stringify(claim)+'</script>':''),{headers:{'Content-Type':'text/html'}});}
  if(url===host+'/assets/home.png'||url===host+'/assets/dream.png')return new Response(png(16,url.endsWith('dream.png')?16:9),{headers:{'Content-Type':'image/png'}});return new Response(null,{status:404});};
 const tower=createTowerIntake({db,origin,localTest:true,sourceOrigins:strict?[]:['https://muse.ai'],now:()=>now,fetcher});
 const request=async(path:string,input?:unknown,who='a')=>{const response=(await tower.fetch(new Request(origin+(path.startsWith('/home/')?path:'/api/v1/me/tower-intake'+path),{method:input===undefined?'GET':'POST',headers:{Origin:origin,Cookie:'muse_session='+who.repeat(64),'X-CSRF-Token':'csrf-'+who,...(input===undefined?{}:{'Content-Type':'application/json'})},...(input===undefined?{}:{body:JSON.stringify(input)})})))!;const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:response.status,value};};
 if(strict){
  db.sqlite.function('strftime',(_format,input)=>input==='now'?now.toISOString():new Date(String(input)).toISOString());
  const stamp=now.toISOString(),expiry='2027-01-01T00:00:00.000Z',caseId='1'.repeat(32),account='a'.repeat(16);
  db.sqlite.prepare("INSERT INTO tower_reception_cases(id,token_hash,state,version,name,request_kind,request_text,source_url,resident_id,account_id,approval_expires_at,authorization_json,sharing_json,visit_plan_json,next_action,expires_at,created_at,updated_at) VALUES(?,?,'pending',1,'Synthetic','new','request',?,'eeeeeeeeeeeeeeee',?,?,'{}','{}','{}','active',?,?,?)").run(caseId,'native-synthetic-case',share,account,expiry,expiry,stamp,stamp);
  db.sqlite.prepare("INSERT INTO tower_admission_decisions(id,policy_version,case_id,account_id,resident_id,source_url,state,agent_origin,evidence_kind,evidence_ref,operator_class,expires_at,created_at) VALUES('native-approved',1,?,?,'eeeeeeeeeeeeeeee',?,'eligible','meta-muse','operator-review','synthetic','shared-operator',?,?)").run(caseId,account,share,expiry,stamp);
  db.sqlite.prepare("INSERT INTO tower_admission_heads VALUES(?,'native-approved',1)").run('case:'+caseId);
  db.sqlite.prepare("UPDATE tower_reception_cases SET state='active' WHERE id=?").run(caseId);
 }
 const prepare=()=>request('/prepare',{sourceURL:share,residentId:'eeeeeeeeeeeeeeee',requestKey:'native-prepare-'+crypto.randomUUID()});
 return {db,calls,request,prepare,onHTML(fn:()=>void){onHTML=fn;},setClaim(v:unknown){claim=v;},setIntro(v:string){intro=v;},setDream(){hasDream=true;},expire(){now=new Date(now.getTime()+3600001);},site};
}
test('native challenge binds exact source identity; readable HTML never grants a home',async()=>{const f=await fixture();try{
 const denied=await f.request('/import',{sourceURL:share,residentId:'eeeeeeeeeeeeeeee',requestKey:'native-unproved-import',proof:'challenge'});assert.equal(denied.status,403);
 const prepared=await f.prepare();assert.equal(prepared.status,201,JSON.stringify(prepared.value));assert.equal(prepared.value.claimURL,share);assert.deepEqual(prepared.value.claimPlacement,{kind:'html-json-script',elementId:'musecondo-claim',contentType:'application/json'});assert.equal(prepared.value.claim.sourceIdentity,'muse-space:abc123');
 f.setClaim(prepared.value.claim);assert.equal((await f.request('/claim',{claimId:prepared.value.claimId},'b')).status,403);
 for(const altered of [{challenge:'wrong'},{sourceIdentity:'muse-space:other'},{residentId:'other'}]){f.setClaim({...prepared.value.claim,...altered});assert.equal((await f.request('/claim',{claimId:prepared.value.claimId})).status,403);}
 f.setClaim(prepared.value.claim);assert.equal((await f.request('/claim',{claimId:prepared.value.claimId})).status,200);
 f.expire();assert.equal((await f.request('/import',{sourceURL:share,residentId:'eeeeeeeeeeeeeeee',requestKey:'native-expired-import',proof:'challenge'})).status,403);
 }finally{f.db.close();}});
test('native import, reviewed sync and publication preserve saved revisions and original share link',async()=>{const f=await fixture();try{
 const prepared=await f.prepare();assert.equal(prepared.status,201,JSON.stringify(prepared.value));f.setClaim(prepared.value.claim);assert.equal((await f.request('/claim',{claimId:prepared.value.claimId})).status,200);
 const imported=await f.request('/import',{sourceURL:share,residentId:'eeeeeeeeeeeeeeee',requestKey:'native-import-home',proof:'challenge'});assert.equal(imported.status,201,JSON.stringify(imported.value));const room=imported.value.roomId;
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_snapshots').get()!.n,1);assert.equal(f.db.sqlite.prepare('SELECT hex(data) data FROM tower_asset_chunks').get()!.data?.toString().includes(Buffer.from('PRIVATE_METADATA').toString('hex').toUpperCase()),false);
 f.setIntro('A new introduction for review');const preview=await f.request('/source-preview',{expectedRevision:1});assert.equal(preview.status,200,JSON.stringify(preview.value));
 f.setIntro('Changed after review');assert.equal((await f.request('/snapshot',{expectedRevision:1,requestKey:'native-stale-sync',reviewedSourceDigest:preview.value.sourceDigest,apply:['intro']})).status,409);
 const fresh=await f.request('/source-preview',{expectedRevision:1});const applied=await f.request('/snapshot',{expectedRevision:1,requestKey:'native-reviewed-sync',reviewedSourceDigest:fresh.value.sourceDigest,apply:['intro']});assert.equal(applied.status,201,JSON.stringify(applied.value));
 assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_snapshots').get()!.n,2);assert.equal((await f.request('/publication',{expectedRevision:2,published:true,snapshotConsent:true,directoryConsent:true,announcementConsent:false,dreamConsent:false})).status,200);
 const home=await f.request('/home/'+room);assert.equal(home.status,200);assert.ok(home.value.includes(share));assert.ok(home.value.includes('Changed after review'));
 assert.equal((await f.request('/publication',{expectedRevision:2,published:false,snapshotConsent:false,directoryConsent:false,announcementConsent:false,dreamConsent:false})).status,200);assert.equal((await f.request('/home/'+room)).status,404);
 }finally{f.db.close();}});

test('native source key rotation keeps the existing door and all saved content; dream import never grants publication consent',async()=>{const f=await fixture();try{
 const prepared=await f.prepare();f.setClaim(prepared.value.claim);assert.equal((await f.request('/claim',{claimId:prepared.value.claimId})).status,200);
 const imported=await f.request('/import',{sourceURL:share,residentId:'eeeeeeeeeeeeeeee',requestKey:'native-rotate-import',proof:'challenge'});assert.equal(imported.status,201,JSON.stringify(imported.value));
 const rotated=share.replace(key,'B'.repeat(43));const next=await f.request('/prepare',{sourceURL:rotated,residentId:'eeeeeeeeeeeeeeee',requestKey:'native-rotated-prepare'});assert.equal(next.status,201);f.setClaim(next.value.claim);assert.equal((await f.request('/claim',{claimId:next.value.claimId})).status,200);
 f.setIntro('來源更新但尚未同步');const moved=await f.request('/source',{sourceURL:rotated,claimId:next.value.claimId,expectedRevision:1,requestKey:'native-rotated-source'});assert.equal(moved.status,200,JSON.stringify(moved.value));assert.equal(moved.value.intake.roomId,imported.value.roomId);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_snapshots').get()!.n,1);assert.ok(String(f.db.sqlite.prepare('SELECT public_json FROM tower_snapshots').get()!.public_json).includes('原本介紹'));
 f.setDream();const preview=await f.request('/source-preview',{expectedRevision:1});assert.equal(preview.status,200,JSON.stringify(preview.value));const applied=await f.request('/snapshot',{expectedRevision:1,requestKey:'native-dream-reviewed',reviewedSourceDigest:preview.value.sourceDigest,apply:['dream']});assert.equal(applied.status,201,JSON.stringify(applied.value));
 const residency=f.db.sqlite.prepare('SELECT * FROM tower_residencies').get()!;assert.equal(residency.dream_consent,0);assert.equal(residency.public_revision,null);
 assert.equal((await f.request('/publication',{expectedRevision:2,published:true,snapshotConsent:true,directoryConsent:false,announcementConsent:false,dreamConsent:false})).status,200);
 const dreams=await f.request('/home/'+imported.value.roomId+'/dreams');assert.equal(dreams.status,200);assert.equal(dreams.value.includes('一個合成夢境。'),false);
 }finally{f.db.close();}});

test('a rotated key cannot create a second household for the same native source',async()=>{const f=await fixture();try{
 const a=await f.prepare();f.setClaim(a.value.claim);assert.equal((await f.request('/claim',{claimId:a.value.claimId})).status,200);assert.equal((await f.request('/import',{sourceURL:share,residentId:'eeeeeeeeeeeeeeee',requestKey:'native-first-household',proof:'challenge'})).status,201);
 const sourceURL=share.replace(key,'B'.repeat(43));const b=await f.request('/prepare',{sourceURL,residentId:'synthetic-other',requestKey:'native-other-prepare'},'b');assert.equal(b.status,201,JSON.stringify(b.value));f.setClaim(b.value.claim);assert.equal((await f.request('/claim',{claimId:b.value.claimId},'b')).status,200);
 const denied=await f.request('/import',{sourceURL,residentId:'synthetic-other',requestKey:'native-other-import',proof:'challenge'},'b');assert.equal(denied.status,409,JSON.stringify(denied.value));assert.equal(denied.value.error,'resident_already_claimed');assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_residencies').get()!.n,1);
 }finally{f.db.close();}});

test('strict admission authorizes the exact native source and only its existing household may rotate the key',async()=>{const f=await fixture(true);try{
 const prepared=await f.prepare();assert.equal(prepared.status,201,JSON.stringify(prepared.value));f.setClaim(prepared.value.claim);assert.equal((await f.request('/claim',{claimId:prepared.value.claimId})).status,200);
 assert.equal((await f.request('/prepare',{sourceURL:share.replace(key,'B'.repeat(43)),residentId:'eeeeeeeeeeeeeeee',requestKey:'strict-before-household'})).status,400);
 const imported=await f.request('/import',{sourceURL:share,residentId:'eeeeeeeeeeeeeeee',requestKey:'strict-native-import',proof:'challenge'});assert.equal(imported.status,201,JSON.stringify(imported.value));
 const sourceURL=share.replace(key,'B'.repeat(43));const input={sourceURL,residentId:'eeeeeeeeeeeeeeee',requestKey:'strict-native-rotation'};
 assert.equal((await f.request('/prepare',input,'b')).status,400);
 assert.equal((await f.request('/prepare',{...input,sourceURL:sourceURL.replace('abc123','def456'),requestKey:'strict-unapproved-asset'})).status,400);
 const rotated=await f.request('/prepare',input);assert.equal(rotated.status,201,JSON.stringify(rotated.value));f.setClaim(rotated.value.claim);assert.equal((await f.request('/claim',{claimId:rotated.value.claimId})).status,200);
 const moved=await f.request('/source',{expectedRevision:1,requestKey:'strict-native-source-move',sourceURL,claimId:rotated.value.claimId});assert.equal(moved.status,200,JSON.stringify(moved.value));assert.equal(moved.value.intake.roomId,imported.value.roomId);
 assert.equal((await f.request('/source-preview',{expectedRevision:1})).status,200);
 f.db.sqlite.prepare("INSERT INTO tower_admission_policies VALUES(2,'[\"meta-muse\"]',1,'2026-10-31T00:00:00.000Z')").run();f.db.sqlite.prepare("UPDATE tower_admission_current SET policy_version=2").run();
 assert.equal((await f.request('/prepare',{sourceURL:share,residentId:'eeeeeeeeeeeeeeee',requestKey:'strict-stale-eligibility'})).status,400);
 }finally{f.db.close();}});

test('native claim expiry during the fresh HTML read cannot verify the challenge',async()=>{const f=await fixture();try{
 const prepared=await f.prepare();assert.equal(prepared.status,201);f.setClaim(prepared.value.claim);f.onHTML(()=>f.expire());
 const denied=await f.request('/claim',{claimId:prepared.value.claimId});assert.equal(denied.status,403,JSON.stringify(denied.value));assert.equal(f.db.sqlite.prepare('SELECT verified FROM tower_claims WHERE id=?').get(prepared.value.claimId)!.verified,0);
 }finally{f.db.close();}});

test('expired reception authority requires the existing permanent continuity for native key rotation',async()=>{
 for(const enrolled of [false,true]){const f=await fixture(true);try{
  const prepared=await f.prepare();f.setClaim(prepared.value.claim);assert.equal((await f.request('/claim',{claimId:prepared.value.claimId})).status,200);
  const imported=await f.request('/import',{sourceURL:share,residentId:'eeeeeeeeeeeeeeee',requestKey:'native-expiry-authority-import',proof:'challenge'});assert.equal(imported.status,201);
  if(enrolled)f.db.sqlite.prepare('INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').run('mcid:'+'d'.repeat(64),'a'.repeat(16),imported.value.roomId,'eeeeeeeeeeeeeeee','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
  f.db.sqlite.prepare("UPDATE tower_reception_cases SET expires_at='2026-10-30T00:00:00.000Z'").run();
  const sourceURL=share.replace(key,'B'.repeat(43));const rotated=await f.request('/prepare',{sourceURL,residentId:'eeeeeeeeeeeeeeee',requestKey:'native-expiry-authority-rotation'});assert.equal(rotated.status,enrolled?201:400,JSON.stringify(rotated.value));
  if(enrolled){f.setClaim(rotated.value.claim);assert.equal((await f.request('/claim',{claimId:rotated.value.claimId})).status,200);const moved=await f.request('/source',{sourceURL,claimId:rotated.value.claimId,expectedRevision:1,requestKey:'native-expiry-continuity-move'});assert.equal(moved.status,200,JSON.stringify(moved.value));}
 }finally{f.db.close();}}
});

test('first native import rechecks case and qualification authority after HTML download and rolls back every residence artifact',async()=>{
 for(const mode of ['case-expired','approval-expired','case-revoked','policy-changed']){const f=await fixture(true);try{
  const prepared=await f.prepare();assert.equal(prepared.status,201);f.setClaim(prepared.value.claim);assert.equal((await f.request('/claim',{claimId:prepared.value.claimId})).status,200);
  const beforeAudit=f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_audit').get()!.n;
  let changed=false;f.onHTML(()=>{if(changed)return;changed=true;
   if(mode==='case-expired')f.db.sqlite.prepare("UPDATE tower_reception_cases SET expires_at='2026-10-30T00:00:00.000Z'").run();
   if(mode==='approval-expired')f.db.sqlite.prepare("UPDATE tower_reception_cases SET approval_expires_at='2026-10-30T00:00:00.000Z'").run();
   if(mode==='case-revoked')f.db.sqlite.prepare("UPDATE tower_reception_cases SET state='revoked'").run();
   if(mode==='policy-changed'){f.db.sqlite.prepare("INSERT INTO tower_admission_policies VALUES(2,'[\"meta-muse\"]',1,'2026-10-31T00:00:00.000Z')").run();f.db.sqlite.prepare('UPDATE tower_admission_current SET policy_version=2').run();}
  });
  const denied=await f.request('/import',{sourceURL:share,residentId:'eeeeeeeeeeeeeeee',requestKey:'native-import-stale-authority',proof:'challenge'});assert.equal(denied.status,403,mode+': '+JSON.stringify(denied.value));assert.equal(denied.value.error,'source_authorization_required');assert.equal(changed,true);
  for(const table of ['rooms','tower_residencies','tower_snapshots','tower_asset_chunks','tower_admission_memberships'])assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get()!.n,0,mode+': '+table);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_audit').get()!.n,beforeAudit);assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) n FROM tower_requests WHERE operation='import'").get()!.n,0);
 }finally{f.db.close();}}
});
