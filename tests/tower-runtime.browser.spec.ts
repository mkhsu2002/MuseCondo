import {assertFreshLobbyStyles,assertStyledSSRBeforeLive} from './helpers/lobby-css-assertion.ts';
import {test,expect} from './helpers/canonical-browser.ts';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';

const resident='a'.repeat(16),caseKey='b'.repeat(64),towerKey='c'.repeat(64),base='/api/v1/agent/tower-intake';

test('actual Tower runtime: application, ownership proof, publication, revision replay and withdrawal',async({page},info)=>{
 test.setTimeout(120_000);
 const child=spawn(process.execPath,['--experimental-strip-types','tests/helpers/synthetic-tower-server.ts'],{stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=String(b));
 const lines=createInterface({input:child.stdout});
 try{
 const ready=await Promise.race([
  once(lines,'line').then(([line])=>JSON.parse(line).url as string),
  once(child,'exit').then(()=>{throw Error('Synthetic runtime exited: '+stderr);}),
  new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('Synthetic runtime startup timed out: '+stderr)),20_000);timer.unref();}),
 ]);
 async function raw(path:string,method='GET',body?:unknown,key='',extra:Record<string,string>={}){
  return fetch(ready+path,{signal:AbortSignal.timeout(15_000),method,headers:{Accept:'application/json','User-Agent':'Synthetic-Muse/1.0',...(key?{Authorization:'Bearer '+key}:{}),...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
 }
 async function request(path:string,method='GET',body?:unknown,key='',extra:Record<string,string>={}){
  const response=await raw(path,method,body,key,extra);const text=await response.text();expect(response.ok,`${path}: ${response.status} ${text}`).toBe(true);return JSON.parse(text);
 }
 const drain=()=>request('/__test/drain','POST',{});
  const pre=await request('/api/v1/reception/preflight','POST',{homeURL:'https://source.example/'});expect(pre.preflight.ready).toBe(true);
  const opened=await request('/api/v1/reception/cases','POST',{requestKey:'browser-case-001',name:'HTTP Synthetic Resident',requestKind:'new',request:'Please connect my complete home.',homeURL:'https://source.example/',isMuseAgent:true,authorization:{contact:true,application:true,towerAccess:true},sharing:{snapshot:false,directory:false,announcement:false,dream:false},visitPlan:{mode:'manual-return'}},caseKey);
  await drain();const current=await request('/api/v1/reception/cases/'+opened.case.id,'GET',undefined,caseKey);expect(current.case.state).toBe('approved');
  await request('/api/v1/reception/cases/'+opened.case.id+'/activate','POST',{requestKey:'browser-activate-1',expectedVersion:current.case.version},caseKey,{'X-Tower-Agent-Key':towerKey});await drain();
  const prepared=await request(base+'/prepare','POST',{sourceURL:'https://source.example/condo.json',residentId:resident,requestKey:'browser-prepare-01'},towerKey);
  await request('/__test/claim','POST',prepared.claim);await request(base+'/claim','POST',{claimId:prepared.claimId},towerKey);await drain();
  const imported=await request(base+'/import','POST',{sourceURL:'https://source.example/condo.json',residentId:resident,requestKey:'browser-import-001',proof:'challenge'},towerKey);await drain();
  const room=imported.roomId;
  const publication=(revision:number,published:boolean)=>request(base+'/publication','POST',{expectedRevision:revision,published,snapshotConsent:published,directoryConsent:published,announcementConsent:false,dreamConsent:false},towerKey);
  await publication(1,true);await drain();
  const errors:string[]=[],scripts:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.resourceType()==='script')scripts.push(new URL(r.url()).pathname);});
  await assertStyledSSRBeforeLive(page,ready+'/');
  await expect(page.locator(`a[href="/home/${room}"]`).first()).toBeVisible();
  await expect(page.locator('iframe[src*="youtube"]')).toHaveCount(0);
  await assertFreshLobbyStyles(page);
  expect(scripts.some(s=>/\/demo-[\w-]+\.js/.test(s))).toBe(false);
  const landscape=page.locator('#tower-landscape');
  for(const scene of ['night','day']){
   await page.locator(`[data-tower-scene="${scene}"]`).click();await expect(page.locator('[data-scene]')).toHaveAttribute('data-scene',scene);
   await landscape.evaluate(async(el:HTMLImageElement)=>{await el.decode();if(!el.naturalWidth)throw Error('Scene image failed');});
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/${info.project.name}-runtime-tower.png`,fullPage:true});
  await page.goto(ready+'/home/'+room);await expect(page.locator('body')).toContainText('An authorized synthetic home.');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content',/HTTP Synthetic Resident/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://tower.example/home/'+room);
  const edit={expectedRevision:1,requestKey:'browser-content-001',content:{intro:'PRIVATE_NEXT_REVISION'}};
  expect((await request(base+'/content','POST',edit,towerKey)).revision).toBe(2);
  const beforeReplay=await request('/__test/metrics');
  expect((await request(base+'/content','POST',edit,towerKey)).revision).toBe(2);
  expect((await request('/__test/metrics')).audits).toBe(beforeReplay.audits);
  const stale=await raw(base+'/content','POST',{...edit,requestKey:'browser-stale-001'},towerKey);expect(stale.status).toBe(409);
  const preview=await raw(base+'/preview/home','GET',undefined,towerKey);expect(preview.headers.get('x-robots-tag')).toContain('noindex');const privateHTML=await preview.text();expect(privateHTML).toContain('PRIVATE_NEXT_REVISION');expect(privateHTML).not.toContain('property="og:');
  await page.reload();await expect(page.locator('body')).not.toContainText('PRIVATE_NEXT_REVISION');
  await publication(2,true);await drain();await page.reload();await expect(page.locator('body')).toContainText('PRIVATE_NEXT_REVISION');
  await page.goto(ready+'/m7k2px');await expect(page.locator('body')).toContainText('MOMO');expect(scripts.some(s=>/\/demo-[\w-]+\.js/.test(s))).toBe(true);
  await publication(2,false);await drain();
  expect((await raw('/home/'+room)).status).toBe(404);
  expect((await request('/api/v1/public/rooms')).rooms.some((r:{id:string})=>r.id===room)).toBe(false);
  const metrics=await request('/__test/metrics');expect(metrics.providerCalls).toBe(0);expect(metrics.mail).toBe(0);expect(metrics.foreignKeys).toBe(0);expect(metrics.errors).toEqual([]);expect(errors).toEqual([]);
 }finally{
  try{
   if(child.exitCode===null&&child.signalCode===null){
    const exit=once(child,'exit');
    const fallback=setTimeout(()=>child.kill('SIGKILL'),5000);fallback.unref();
    try{child.kill('SIGTERM');await exit;}finally{clearTimeout(fallback);}
   }
  }finally{lines.close();}
 }
});
