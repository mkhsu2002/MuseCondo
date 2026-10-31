import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {publicCondoProjection} from '../src/framework/condo.ts';
import {renderCondo} from '../src/framework/condo-render.ts';
import {verifyCondoURL} from '../server/framework/condo-verify.ts';
import {condoFixture} from './helpers/condo-fixture.ts';

// Script-only data, never evaluated. All resident content is synthetic.
const bootstrap=await readFile(new URL('./helpers/hosted-condo-bootstrap.txt',import.meta.url),'utf8');
const input=condoFixture();input.seed.consent.publishDreams=true;
const site=publicCondoProjection(input,'0123456789abcdef');
const pngs=await Promise.all(['home','dream'].map(kind=>readFile(new URL(`../fixtures/condo/art/${kind}.png`,import.meta.url))));
const hosted='https://synthetic-home.flypigai.chatgpt.site/';
const inject=(html:string,script=bootstrap)=>html.replace('</body>',`${script}</body>`);

function mockSite(t:TestContext,options:{html?:(html:string,file:string)=>string;manifest?:typeof site;image?:(kind:string)=>Uint8Array;redirect?:string;withdrawnStatus?:number}={}){
 const requests:string[]=[];
 t.mock.method(globalThis,'fetch',async(input:URL|string)=>{
  const url=new URL(String(input)),file=url.pathname.split('/').at(-1)!;requests.push(url.href);
  if(options.redirect&&file==='index.html')return new Response(null,{status:302,headers:{location:options.redirect}});
  if(file==='condo.json')return new Response(JSON.stringify(options.manifest??site),{headers:{'content-type':'application/json'}});
  if(file==='condo.css')return new Response('body{}',{headers:{'content-type':'text/css'}});
  if(file.endsWith('.png')){
   if(options.withdrawnStatus&&file==='dream.png')return new Response(null,{status:options.withdrawnStatus,headers:{location:'./home.png'}});
   return new Response(new Uint8Array(options.image?.(file)??pngs[file==='home.png'?0:1]),{headers:{'content-type':'image/png'}});
  }
  const kind=file==='inside.html'?'inside':file==='dreams.html'?'dreams':'home';
  const html=renderCondo(options.manifest??site,kind);
  return new Response(options.html?.(html,file)??inject(html),{headers:{'content-type':'text/html'}});
 });return requests;
}

test('known hosted bootstrap permits full three-page and PNG verification without claiming residence',async t=>{
 const requests=mockSite(t);
 const result=await verifyCondoURL(hosted,{expectedId:site.home.id});
 assert.deepEqual(result,{httpVerified:true,homeId:site.home.id,pages:['index.html','inside.html','dreams.html'].map(file=>hosted+file),images:2,homeComplete:false,next:'仍須確認真實來源、圖片內容與 Agent 再次更新及撤回結果'});
 assert.deepEqual(requests.map(url=>new URL(url).pathname),['/condo.json','/index.html','/inside.html','/dreams.html','/assets/condo.css','/assets/home.png','/assets/dream.png']);
});

test('condo:verify CLI reads the hosted synthetic three pages and full images through fetch',async()=>{
 // The preload replaces only fetch; it neither evaluates the bootstrap nor bypasses its fingerprint.
 const preload=`
 import assert from 'node:assert/strict';
 import {readFile} from 'node:fs/promises';
 import {condoFixture} from ${JSON.stringify(new URL('./helpers/condo-fixture.ts',import.meta.url).href)};
 import {publicCondoProjection} from ${JSON.stringify(new URL('../src/framework/condo.ts',import.meta.url).href)};
 import {renderCondo} from ${JSON.stringify(new URL('../src/framework/condo-render.ts',import.meta.url).href)};
 const input=condoFixture();input.seed.consent.publishDreams=true;
 const site=publicCondoProjection(input,'0123456789abcdef');
 const script=await readFile(new URL(${JSON.stringify(new URL('./helpers/hosted-condo-bootstrap.txt',import.meta.url).href)}),'utf8');
 const resources=new Map([['condo.json',[JSON.stringify(site),'application/json']],['assets/condo.css',['body{}','text/css']]]);
 for(const [file,kind] of [['index.html','home'],['inside.html','inside'],['dreams.html','dreams']])resources.set(file,[renderCondo(site,kind).replace('</body>',script+'</body>'),'text/html']);
 for(const kind of ['home','dream'])resources.set('assets/'+kind+'.png',[new Uint8Array(await readFile(new URL(${JSON.stringify(new URL('../fixtures/condo/art/',import.meta.url).href)}+kind+'.png'))),'image/png']);
 const seen=[];
 globalThis.fetch=async url=>{const parsed=new URL(String(url));assert.equal(parsed.origin,${JSON.stringify(new URL(hosted).origin)});const file=parsed.pathname.slice(1);seen.push(file);assert.ok(resources.has(file));const [body,mime]=resources.get(file);return new Response(body,{headers:{'content-type':mime}});};
 process.on('exit',()=>assert.deepEqual(seen,['condo.json','index.html','inside.html','dreams.html','assets/condo.css','assets/home.png','assets/dream.png']));
 `;
 const {stdout,stderr}=await promisify(execFile)(process.execPath,['--experimental-strip-types','--import','data:text/javascript,'+encodeURIComponent(preload),new URL('../scripts/verify-condo.ts',import.meta.url).pathname,'--url',hosted,'--expect-id',site.home.id]);
 assert.equal(stderr,'');const result=JSON.parse(stdout);assert.equal(result.httpVerified,true);assert.equal(result.homeComplete,false);assert.equal(result.images,2);assert.equal(result.pages.length,3);
});

test('hosted bootstrap accepts only its validated dynamic ray and canonical numeric Unix timestamp',async t=>{
 for(const [ray,time] of [['fedcba9876543210','1800000000'],['0000000000000000','1']])await t.test(`${ray}/${time}`,async t=>{
  const script=bootstrap.replaceAll('0123456789abcdef',ray).replace('MTcwMDAwMDAwMA==',Buffer.from(time).toString('base64'));
  mockSite(t,{html:html=>inject(html,script)});assert.equal((await verifyCondoURL(hosted)).httpVerified,true);
 });
 await t.test('each page has independent valid dynamic fields',async t=>{
  mockSite(t,{html:(html,file)=>inject(html,bootstrap.replaceAll('0123456789abcdef',file==='inside.html'?'1111111111111111':file==='dreams.html'?'2222222222222222':'3333333333333333').replace('MTcwMDAwMDAwMA==',Buffer.from(file==='inside.html'?'1800000001':file==='dreams.html'?'1800000002':'1800000003').toString('base64')))});
  assert.equal((await verifyCondoURL(hosted)).httpVerified,true);
 });
});

test('modified, unknown, repeated, attributed or relocated scripts fail closed',async t=>{
 const variants:Record<string,(html:string)=>string>={
  'one fixed byte':html=>inject(html,bootstrap.replace('a.height=1','a.height=2')),
  'loader':html=>inject(html,bootstrap.replace('a.src=o?',"a.src='https://evil.example/';a.src=o?")),
  'path':html=>inject(html,bootstrap.replace('/cdn-cgi/challenge-platform/','/other/')),
  'window code':html=>inject(html,bootstrap.replace('window.parent.location','window.location')),
  'ray mismatch':html=>inject(html,bootstrap.replace('?ray=0123456789abcdef','?ray=fedcba9876543210')),
  'uppercase ray':html=>inject(html,bootstrap.replaceAll('0123456789abcdef','0123456789ABCDEF')),
  'short ray':html=>inject(html,bootstrap.replaceAll('0123456789abcdef','0123456789abcde')),
  'invalid base64':html=>inject(html,bootstrap.replace('MTcwMDAwMDAwMA==','!!!')),
  'noncanonical base64':html=>inject(html,bootstrap.replace('MTcwMDAwMDAwMA==','MTcwMDAwMDAwMB==')),
  'unpadded base64':html=>inject(html,bootstrap.replace('MTcwMDAwMDAwMA==','MTcwMDAwMDAwMA')),
  'nondigit time':html=>inject(html,bootstrap.replace('MTcwMDAwMDAwMA==',Buffer.from('170000000x').toString('base64'))),
  'high-bit time':html=>inject(html,bootstrap.replace('MTcwMDAwMDAwMA==',Buffer.from([0xb1,0xb7,0xb0]).toString('base64'))),
  'unsafe integer time':html=>inject(html,bootstrap.replace('MTcwMDAwMDAwMA==',Buffer.from('9007199254740992').toString('base64'))),
  'leading zero time':html=>inject(html,bootstrap.replace('MTcwMDAwMDAwMA==',Buffer.from('01700000000').toString('base64'))),
  'script attribute':html=>inject(html,bootstrap.replace('<script>','<script nonce="test">')),
  'external script':html=>inject(html,'<script src="https://evil.example/js"></script>'),
  'extra statement':html=>inject(html,bootstrap.replace('</script>','alert(1);</script>')),
  'two known scripts':html=>inject(html,bootstrap+bootstrap),
  'another script':html=>inject(html,bootstrap+'<script>alert(1)</script>'),
  'wrong position':html=>html.replace('</head>',`${bootstrap}</head>`),
  'whitespace before body end':html=>inject(html,bootstrap+'\n'),
  'extra markup':html=>inject(html,bootstrap).replace('</body>','<p>extra</p></body>'),
  'base':html=>inject(html).replace('</head>','<base href="/elsewhere"></head>'),
  'refresh':html=>inject(html).replace('</head>','<meta http-equiv="refresh" content="0"></head>'),
  'HTML manifest mismatch':html=>inject(html).replace(site.home.name,'other resident'),
 };
 for(const [name,html] of Object.entries(variants))await t.test(name,async t=>{mockSite(t,{html});await assert.rejects(verifyCondoURL(hosted));});
});

test('bootstrap exception is restricted to uncredentialed HTTPS single-tenant host without a port',async t=>{
 for(const url of ['https://example.com/','https://flypigai.chatgpt.site/','https://home.flypigai.chatgpt.site.evil/','https://home.evil-flypigai.chatgpt.site/','https://a.b.flypigai.chatgpt.site/','https://-home.flypigai.chatgpt.site/','https://home-.flypigai.chatgpt.site/','https://'+'x'.repeat(64)+'.flypigai.chatgpt.site/','https://home.flypigai.chatgpt.site:443/','https://home.flypigai.chatgpt.site:8443/','https://user:pass@home.flypigai.chatgpt.site/','http://home.flypigai.chatgpt.site/','http://localhost/'])await t.test(url,async t=>{mockSite(t);await assert.rejects(verifyCondoURL(url));});
});

test('ordinary canonical independent HTTPS sites still verify without any script',async t=>{
 mockSite(t,{html:html=>html});assert.equal((await verifyCondoURL('https://independent.example/nested/')).httpVerified,true);
});

test('inside and dreams pages are independently checked for additional script content',async t=>{
 for(const page of ['inside.html','dreams.html'])await t.test(page,async t=>{mockSite(t,{html:(html,file)=>inject(html,file===page?bootstrap.replace('</script>','alert(1);</script>'):bootstrap)});await assert.rejects(verifyCondoURL(hosted),/非模板執行內容/);});
});

test('hosted compatibility retains bounded source, image CRC and aspect ratio, and redirect scope checks',async t=>{
 await t.test('200 KB source limit',async t=>{mockSite(t,{html:html=>inject(html)+' '.repeat(200000)});await assert.rejects(verifyCondoURL(hosted),/上限/);});
 await t.test('PNG CRC',async t=>{mockSite(t,{image:()=>{const png=new Uint8Array(pngs[0]);png[29]^=1;return png;}});await assert.rejects(verifyCondoURL(hosted),/CRC/);});
 await t.test('PNG aspect ratio',async t=>{mockSite(t,{image:()=>pngs[1]});await assert.rejects(verifyCondoURL(hosted),/比例/);});
 await t.test('off-origin redirect',async t=>{mockSite(t,{redirect:'https://outside.example/index.html'});await assert.rejects(verifyCondoURL(hosted),/範圍/);});
 await t.test('out-of-root redirect',async t=>{mockSite(t,{redirect:'/other/index.html'});await assert.rejects(verifyCondoURL(hosted+'nested/'),/範圍/);});
});

test('hosted verification keeps withdrawn dream manifest, HTML and asset checks',async t=>{
 const withdrawn=structuredClone(site);withdrawn.dream=null;withdrawn.home.dreams=[];
 await t.test('withdrawn private dream',async t=>{const requests=mockSite(t,{manifest:withdrawn,withdrawnStatus:404});const result=await verifyCondoURL(hosted);assert.equal(result.images,1);assert.equal(result.homeComplete,false);assert.ok(requests.includes(hosted+'assets/dream.png'));});
 await t.test('stale HTML',async t=>{mockSite(t,{manifest:withdrawn,withdrawnStatus:404,html:(_html,file)=>inject(renderCondo(site,file==='inside.html'?'inside':file==='dreams.html'?'dreams':'home'))});await assert.rejects(verifyCondoURL(hosted),/不一致/);});
 await t.test('still public dream image',async t=>{mockSite(t,{manifest:withdrawn});await assert.rejects(verifyCondoURL(hosted),/夢圖仍/);});
 await t.test('redirected withdrawn image',async t=>{mockSite(t,{manifest:withdrawn,withdrawnStatus:302});await assert.rejects(verifyCondoURL(hosted),/夢圖仍/);});
});
