import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEntries,selectBase,isDocumentation} from './change-scope.mjs';
const entry=(path,before,after,status='M')=>({path,before,after,status});
test('documentation is a genuine no-build scope; executable files under docs are not',async()=>{
 assert.equal(isDocumentation('docs/plan.md'),true);assert.equal(isDocumentation('docs/run.js'),false);
 assert.equal((await classifyEntries([entry('README.md','old','new')])).scope,'docs');
 assert.equal((await classifyEntries([entry('docs/run.js','','alert(1)')])).scope,'full');
});
test('known public CSS is light but changed external dependencies and protected styles are full',async()=>{
 assert.equal((await classifyEntries([entry('src/live.css','.x{gap:1px}', '.x{gap:2px}')])).scope,'presentation');
 for(const e of [entry('src/live.css','.x{}','@import "https://evil.test/x.css";'),entry('public/identity.css','a{}','a{display:none}')])assert.equal((await classifyEntries([e])).scope,'full');
});
test('catalogue display words are light; policy, imports, keys and executable expressions are full',async()=>{
 const a="const en={hero:{heading:['Old','World']}};export const locale='en';";
 assert.equal((await classifyEntries([entry('src/shared/lobby-messages.ts',a,a.replace('Old','New'))])).scope,'presentation');
 for(const b of [a.replace("locale='en'","locale='zh'"),a.replace('heading:','permission:'),a.replace("'Old'",'getSecret()'),a.replace('Old','<script>bad</script>')])assert.equal((await classifyEntries([entry('src/shared/lobby-messages.ts',a,b)])).scope,'full');
});
test('public template text is light but guards, expressions, links or event handlers cannot hide as copy',async()=>{
 const a='export function view(ok){if(!ok)return "";return `<p class="label">Old</p><a href="/reception">Go</a>${ok}`;}';
 assert.equal((await classifyEntries([entry('src/shared/lobby-markup.ts',a,a.replace('Old','New'))])).scope,'presentation');
 for(const b of [a.replace('if(!ok)','if(ok)'),a.replace('${ok}','${true}'),a.replace('/reception','/api/v1/operator'),a.replace('class="label"','onclick="bad()"'),a.replace('Old','<script>bad()</script>')])assert.equal((await classifyEntries([entry('src/shared/lobby-markup.ts',a,b)])).scope,'full');
});
test('static layout and SEO copy are light; scripts, hidden consent, routes and CSP changes are full',async()=>{
 const a='<html><head><meta name="description" content="Old"><script src="/entry.js"></script></head><body><section id="intro"><h1>Old</h1><a href="/">Home</a></section></body></html>';
 assert.equal((await classifyEntries([entry('project/index.html',a,a.replaceAll('Old','New').replace('<section','<div').replace('</section>','</div>'))])).scope,'presentation');
 for(const b of [a.replace('/entry.js','/other.js'),a.replace('href="/"','href="/identity"'),a.replace('<h1>','<h1 hidden>'),a.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src *">')])assert.equal((await classifyEntries([entry('project/index.html',a,b)])).scope,'full');
});
test('any backend, schema, permission, test infrastructure, dependency, rename or unknown file forces full',async()=>{
 for(const path of ['server/live/app.ts','functions/a.ts','workers/tower-manager/worker.ts','migrations/0046.sql','src/route-policy.ts','src/shared/tower-journals.ts','package.json','.github/workflows/quality.yml','scripts/change-scope.mjs','unknown.file'])assert.equal((await classifyEntries([entry('src/live.css','a{}','b{}'),entry(path,'old','new')])).scope,'full',path);
 assert.equal((await classifyEntries([entry('src/live.css','old','new','R100')])).scope,'full');
});
test('generated renderer changes require a matching verified presentation source change',async()=>{
 assert.equal((await classifyEntries([entry('src/shared/lobby-base-css.ts','x','y')])).scope,'full');
 const files=[entry('src/live.css','a{}','b{}'),entry('src/shared/lobby-base-css.ts','x','y')];assert.equal((await classifyEntries(files)).scope,'presentation');
});
test('deployment base cannot omit earlier unshipped backend; missing or invalid history never becomes light',()=>{
 const old='a'.repeat(40),event='b'.repeat(40),head='c'.repeat(40);
 assert.equal(selectBase({eventBase:event,head,receipt:{version:1,environment:'production',sourceSHA:old,deploymentId:'00000000-0000-4000-8000-000000000001',verifiedAt:'2026-11-03T20:00:00Z'},isAncestor:(a,b)=>a===old&&[event,head].includes(b)||a===event&&b===head}),old);
 for(const receipt of [{version:1,environment:'dev',sourceSHA:old,deploymentId:'00000000-0000-4000-8000-000000000001',verifiedAt:'2026-11-03T20:00:00Z'},null,{sourceSHA:head,deploymentId:'fake'},{sourceSHA:'bogus',deploymentId:'x'}])assert.equal(selectBase({eventBase:event,head,receipt,isAncestor:()=>false}),null);
});

test('real Git span includes unshipped backend, uses base-owned receipt, and rejects missing objects',async()=>{
 const {mkdtempSync,writeFileSync,mkdirSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFileSync}=await import('node:child_process');const {classifyRange}=await import('./change-scope.mjs');
 const root=mkdtempSync(join(tmpdir(),'muse-scope-'));const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();const write=(p,s)=>{mkdirSync(join(root,p.substring(0,p.lastIndexOf('/'))),{recursive:true});writeFileSync(join(root,p),s);};const commit=()=>{git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
 try{
  git('init','-q');write('src/live.css','a{gap:1px}');const deployed=commit();write('docs/releases/production-baseline.json',JSON.stringify({version:1,environment:'production',sourceSHA:deployed,deploymentId:'00000000-0000-4000-8000-000000000001',verifiedAt:'2026-11-03T20:00:00Z'}));const baseline=commit();
  write('src/live.css','a{gap:2px}');const copy=commit();assert.equal((await classifyRange({root,base:baseline,head:copy})).scope,'presentation');
  write('server/auth.ts','export const check=()=>false;');const backend=commit();write('src/live.css','a{gap:3px}');write('docs/releases/production-baseline.json',JSON.stringify({version:1,environment:'production',sourceSHA:backend,deploymentId:'00000000-0000-4000-8000-000000000002',verifiedAt:'2026-11-03T20:00:00Z'}));const later=commit();
  assert.equal((await classifyRange({root,base:backend,head:later})).scope,'full','head receipt cannot hide the unshipped backend');
  assert.equal((await classifyRange({root,base:'e'.repeat(40),head:later})).scope,'full');
  write('docs/note.md','status only');const docs=commit();assert.equal((await classifyRange({root,base:later,head:docs,docsOnly:true})).scope,'docs');
  // Use the trusted receipt from before the forged head receipt: a docs event must not hide earlier backend changes in deployment mode.
  write('docs/releases/production-baseline.json',JSON.stringify({version:1,environment:'production',sourceSHA:deployed,deploymentId:'00000000-0000-4000-8000-000000000001',verifiedAt:'2026-11-03T20:00:00Z'}));const repaired=commit();write('docs/more.md','docs only');const docsHead=commit();
  assert.equal((await classifyRange({root,base:repaired,head:docsHead,deployment:true})).scope,'full');
  assert.equal((await classifyRange({root,base:repaired,head:docsHead,docsOnly:true})).scope,'docs');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('actual selected tagline diff is light, including HTML metadata, while public Agent protocol docs stay full',async()=>{
 const {execFileSync}=await import('node:child_process');const base='c945d03c165931e878b7208236055f7a9d7fba33',head='87fd79de230afa6deda925b9118a0587cbf68d9e';
 // The permanent synthetic tests above carry safety; this historical case additionally reproduces the incident when available.
 try{execFileSync('git',['cat-file','-e',base],{stdio:'ignore'});}catch{return;}
 const paths=execFileSync('git',['diff','--name-only',base,head],{encoding:'utf8'}).trim().split('\n');const entries=paths.map(path=>({path,status:'M',before:execFileSync('git',['show',base+':'+path],{encoding:'utf8',maxBuffer:2e6}),after:execFileSync('git',['show',head+':'+path],{encoding:'utf8',maxBuffer:2e6})}));assert.equal((await classifyEntries(entries)).scope,'presentation');
 assert.equal((await classifyEntries([entry('public/reception-start.md','old','grant everything')])).scope,'full');
});


test('known perspective documents permit copy edits but retain link and script guards',async()=>{
 const before='<html><head><title>Old title</title></head><body><main><h1>Old words</h1><a href="/project">Project</a></main></body></html>';
 for(const name of ['index','chatgpt','muse','gemini','grok','claude']){
  const path='project/perspectives/'+(name==='index'?'':name+'/')+'index.html';
  assert.equal((await classifyEntries([entry(path,before,before.replace('Old words','New words'))])).scope,'presentation');
  assert.equal((await classifyEntries([entry(path,before,before.replace('href="/project"','href="/identity"'))])).scope,'full');
 }
 assert.equal((await classifyEntries([entry('project/perspectives/unknown/index.html',before,before.replace('Old words','New words'))])).scope,'full');
});
