import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkBuild} from '../scripts/check-build.mjs';
test('deployment guard rejects repository-root TypeScript entry',async()=>{await assert.rejects(checkBuild('.', '/'),/Raw TypeScript/);});
test('deployment guard accepts compiled root/subpath assets and rejects wrong base or missing files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-build-'));
 try{await mkdir(join(dir,'assets'));await writeFile(join(dir,'assets/app.js'),'/* fixture */');await writeFile(join(dir,'assets/app.css'),'/* fixture */');
 for(const base of ['/','/MuseCondo/']){await writeFile(join(dir,'index.html'),`<script type="module" src="${base}assets/app.js"></script><link rel="stylesheet" href="${base}assets/app.css">`);assert.equal((await checkBuild(dir,base)).javaScript,1);}
 await assert.rejects(checkBuild(dir,'/'),/base path/);await rm(join(dir,'assets/app.js'));await assert.rejects(checkBuild(dir,'/MuseCondo/'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('route generation needs no personal residence and never publishes it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-routes-'));
 try{
  await mkdir(join(dir,'dist'));await mkdir(join(dir,'public'));await mkdir(join(dir,'LICENSES'));await mkdir(join(dir,'src/framework'),{recursive:true});
  for(const [file,text] of [['dist/index.html','<p>compiled fixture</p>'],['src/framework/condo.css','/* template */'],['LICENSE','license'],['NOTICE','notice'],['ASSET-LICENSE.md','asset notice'],['LICENSES/PolyForm-Noncommercial-1.0.0.txt','artwork license'],['public/reception.html','<p>reception fixture</p>'],['public/activities.html','<p>activities fixture</p>'],['public/identity.html','<p>identity fixture</p>'],['public/identity-recovery.html','<p>identity recovery fixture</p>'],['public/identity-verify.html','<p>identity verify fixture</p>']])await writeFile(join(dir,file),text);
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/routes.mjs',import.meta.url))],{cwd:dir});
  await access(join(dir,'dist/about/index.html'));
  assert.equal(await readFile(join(dir,'dist/reception/index.html'),'utf8'),'<p>reception fixture</p>');
  assert.equal(await readFile(join(dir,'dist/identity/index.html'),'utf8'),'<p>identity fixture</p>');
  assert.equal(await readFile(join(dir,'dist/identity/recover/index.html'),'utf8'),'<p>identity recovery fixture</p>');
  assert.equal(await readFile(join(dir,'dist/activities/index.html'),'utf8'),'<p>activities fixture</p>');
  assert.equal(await readFile(join(dir,'dist/identity/verify/index.html'),'utf8'),'<p>identity verify fixture</p>');
  await assert.rejects(access(join(dir,'dist/MuseCondoTC-Regular.ttf')));
  await access(join(dir,'dist/condo-template.css'));
  for(const [output,expected] of [['LICENSE.txt','license'],['NOTICE.txt','notice'],['ASSET-LICENSE.txt','asset notice'],['LICENSES/PolyForm-Noncommercial-1.0.0.txt','artwork license']])assert.equal(await readFile(join(dir,'dist',output),'utf8'),expected);
  await assert.rejects(access(join(dir,'dist/condo')));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('identity-card build guard requires the standalone route/resources/privacy headers and excludes Worker font',async()=>{
 const {checkIdentityCardBuild}=await import('../scripts/check-build.mjs');
 const dir=await mkdtemp(join(tmpdir(),'muse-card-build-'));
 try{
  await assert.rejects(checkIdentityCardBuild(dir));
  await mkdir(join(dir,'identity/verify'),{recursive:true});await mkdir(join(dir,'licenses'));
  for(const [source,target] of [['identity-verify.html','identity/verify/index.html'],['identity-verify.js','identity-verify.js'],['identity-verify.css','identity-verify.css'],['identity.css','identity.css'],['_headers','_headers'],['identity-onboarding.json','identity-onboarding.json'],['licenses/identity-card.txt','licenses/identity-card.txt']])await writeFile(join(dir,target),await readFile(new URL('../public/'+source,import.meta.url)));
  assert.equal((await checkIdentityCardBuild(dir)).route,'/identity/verify/:credentialId');
  const headers=await readFile(join(dir,'_headers'),'utf8');await writeFile(join(dir,'_headers'),headers.replace('/identity/verify/*','/wrong-route/*'));await assert.rejects(checkIdentityCardBuild(dir),/privacy/);await writeFile(join(dir,'_headers'),headers);
  await writeFile(join(dir,'MuseCondoTC-Regular.ttf'),'font');await assert.rejects(checkIdentityCardBuild(dir),/Worker font/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

// Render the real TypeScript module without loading CSS in Node.
test('official footer and covenant distinguish commercial software from separately licensed artwork on root and subpath',async()=>{
 const {transpileModule,ModuleKind}=await import('typescript');
 const {runInNewContext}=await import('node:vm');
 const source=await readFile(new URL('../src/live/tower-welcome.ts',import.meta.url),'utf8');
 const exports={};
 runInNewContext(transpileModule(source,{compilerOptions:{module:ModuleKind.CommonJS}}).outputText,{exports,require:()=>({})});
 for(const base of ['','/MuseCondo']){
  const footer=exports.licenseAttribution(base),covenant=exports.residentGuide(base);
  assert.match(footer,/開源 By NeoBabylon.App/);
  assert.match(footer,/Apache 2.0/);
  assert.match(footer,/商用/);
  assert.ok(footer.includes(`href="${base}/LICENSE.txt"`));
  assert.ok(footer.includes(`href="${base}/ASSET-LICENSE.txt"`));
  assert.match(footer,/圖像與品牌另依授權/);
  assert.match(covenant,/Apache 2.0，歡迎 Fork 與商用/);
  assert.doesNotMatch(footer+covenant,/禁止商用|非商業 Fork|遵守非商業授權/);
 }
});

test('distributed license originals retain their complete pinned upstream bytes',async()=>{
 const {createHash}=await import('node:crypto');
 for(const [path,expected] of [['LICENSE','cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'],['LICENSES/PolyForm-Noncommercial-1.0.0.txt','ffcca38841adb694b6f380647e15f17c446a4d1656fed51a1e2041d064c94cc8']]){
  assert.equal(createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex'),expected);
 }
});
