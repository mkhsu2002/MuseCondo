import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTowerLordAuth,isTowerLordPath} from '../server/live/tower-lord-auth.ts';
const issuer='https://example.cloudflareaccess.com',aud='test-console',email='steward@example.com';
const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'real-key',alg:'RS256',use:'sig'};
const now=Date.parse('2026-10-31T20:00:00Z');
async function jwt(change:Record<string,unknown>={},header:Record<string,unknown>={}){const body=enc({alg:'RS256',kid:'real-key',...header})+'.'+enc({iss:issuer,aud:[aud],sub:'person-1',email,type:'app',iat:now/1000-60,exp:now/1000+3600,...change});return body+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(body))).toString('base64url');}
function auth(){let calls=0;const check=createTowerLordAuth({issuer,audience:aud,stewards:JSON.stringify([email]),observers:'[]',now:()=>now,transport:async(input,init)=>{assert.equal(init?.redirect,'manual');assert.equal(String(input),issuer+'/cdn-cgi/access/certs');calls++;return new Response(JSON.stringify({keys:[jwk]}));}});return {check,calls:()=>calls};}
const req=(token?:string)=>new Request('https://tower.example/tower-lord',{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});
test('valid signed human assertion authorizes a scoped role and caches only public signing keys',async()=>{const a=auth();assert.deepEqual(await a.check(req(await jwt())),{role:'acting-steward',displayName:'Acting Tower Steward'});await a.check(req(await jwt()));assert.equal(a.calls(),1);});
test('missing, forged, wrong issuer/audience, expired and nonhuman assertions deny',async()=>{const a=auth();assert.equal(await a.check(req()),null);for(const c of [{iss:'https://evil.test'},{aud:['other']},{exp:now/1000-1},{email:'other@example.com'},{type:'service'},{sub:''},{nbf:now/1000+120}])assert.equal(await a.check(req(await jwt(c))),null);const valid=await jwt();assert.equal(await a.check(req(valid.slice(0,-10)+'AAAAAAAAAA')),null);assert.equal(await a.check(req(await jwt({}, {alg:'none'}))),null);});
test('configuration and key failure deny without trusting identity headers or fetching attacker URLs',async()=>{const check=createTowerLordAuth({issuer:'https://evil.test',audience:aud,stewards:JSON.stringify([email]),transport:async()=>{throw Error('must not fetch');}});assert.equal(await check(req(await jwt())),null);assert.equal(await auth().check(new Request('https://tower.example/tower-lord',{headers:{'Cf-Access-Authenticated-User-Email':email}})),null);});
test('console path matcher protects every asset/API subroute without capturing resident routes',()=>{for(const p of ['/tower-lord','/tower-lord/','/tower-lord/console.js','/api/v1/tower-lord/overview'])assert.equal(isTowerLordPath(p),true);for(const p of ['/reception','/api/v1/reception/cases','/home/123','/tower-lordly'])assert.equal(isTowerLordPath(p),false);});

test('runtime console denies aliases, methods and forged identity before touching database or assets',async()=>{
 const {default:runtime}=await import('../server/live/worker.ts');
 let touched=0;const env={PUBLIC_ORIGIN:'https://tower.example',TOWER_LORD_ISSUER:issuer,TOWER_LORD_AUDIENCE:aud,TOWER_LORD_STEWARDS:JSON.stringify([email]),ASSETS:{async fetch(){touched++;return new Response('private');}}};
 for(const path of ['/tower-lord','/tower-lord/index.html','/tower-lord/console.js','/api/v1/tower-lord/residents']){
  const r=await runtime.fetch(new Request('https://tower.example'+path,{headers:{'Cf-Access-Authenticated-User-Email':email}}),env);assert.equal(r.status,401);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.match(r.headers.get('X-Robots-Tag')??'',/noindex/);
 }
 assert.equal((await runtime.fetch(new Request('https://other.example/tower-lord'),env)).status,403);
 assert.equal((await runtime.fetch(new Request('https://tower.example/api/v1/tower-lord/overview',{method:'POST'}),env)).status,405);
 assert.equal(touched,0);
});

test('signed human reaches only read-only console routes; all views leave database and outside services untouched',async()=>{
 const {default:runtime}=await import('../server/live/worker.ts');const {LocalDatabase}=await import('../server/live/local-db.ts');const {readdirSync,readFileSync}=await import('node:fs');
 const db=new LocalDatabase(':memory:');for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const original=globalThis.fetch;let keyReads=0;globalThis.fetch=async(input)=>{assert.equal(String(input),issuer+'/cdn-cgi/access/certs');keyReads++;return new Response(JSON.stringify({keys:[jwk]}));};
 const assetPaths:string[]=[];const env={DB:db,PUBLIC_ORIGIN:'https://tower.example',TOWER_LORD_ISSUER:issuer,TOWER_LORD_AUDIENCE:aud,TOWER_LORD_STEWARDS:JSON.stringify([email]),TOWER_LORD_ENVIRONMENT:'dev',ASSETS:{async fetch(r:Request){assetPaths.push(new URL(r.url).pathname);return new Response('<html lang="en">Private console</html>');}}};
 // Use the real current time for the route's production clock.
 const time=Date.now()/1000,token=await jwt({iat:time-10,exp:time+600});const headers={'Cf-Access-Jwt-Assertion':token};const before=db.sqlite.prepare('SELECT total_changes() n').get()!.n;
 try{
  for(const path of ['/tower-lord','/tower-lord/console.js','/api/v1/tower-lord/session',...['overview','residents','applications','history','usage'].map(x=>'/api/v1/tower-lord/'+x)]){const r=await runtime.fetch(new Request('https://tower.example'+path,{headers}),env);assert.equal(r.status,200,path);assert.equal(r.headers.get('Cache-Control'),'no-store');}
  const navigation=await runtime.fetch(new Request('https://tower.example/tower-lord/',{headers:{...headers,'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate'}}),env);assert.equal(navigation.status,200,'Access login redirects must reach the signed-in document');
  assert.equal((await runtime.fetch(new Request('https://tower.example/api/v1/tower-lord/overview',{headers:{...headers,'Sec-Fetch-Site':'cross-site'}}),env)).status,403);
  assert.equal(keyReads,1);assert.deepEqual(assetPaths,['/tower-lord/','/tower-lord/console.js','/tower-lord/']);assert.equal(db.sqlite.prepare('SELECT total_changes() n').get()!.n,before);
  for(const path of ['/tower-lord/secret.json','/api/v1/tower-lord/handover'])assert.equal((await runtime.fetch(new Request('https://tower.example'+path,{headers}),env)).status,404);
  assert.equal((await runtime.fetch(new Request('https://tower.example/api/v1/tower-lord/usage?limit=1000000',{headers}),env)).status,400);
 }finally{globalThis.fetch=original;db.close();}
});

test('cold public-key redirect cannot follow to another origin or authorize an assertion',async()=>{
 const {workerdFetch}=await import('./helpers/workerd-fetch.ts');const network=workerdFetch(()=>new Response(null,{status:302,headers:{Location:'https://untrusted.test/keys'}}));
 const check=createTowerLordAuth({issuer:'https://redirect.cloudflareaccess.com',audience:aud,stewards:JSON.stringify([email]),now:()=>now,transport:network.fetcher});
 assert.equal(await check(req(await jwt({iss:'https://redirect.cloudflareaccess.com'}))),null);assert.equal(network.requests.length,1);assert.equal(network.requests[0].redirect,'manual');
});
