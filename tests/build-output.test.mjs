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
  await mkdir(join(dir,'dist'));await mkdir(join(dir,'public'));await mkdir(join(dir,'src/framework'),{recursive:true});
  for(const [file,text] of [['dist/index.html','<p>compiled fixture</p>'],['src/framework/condo.css','/* template */'],['LICENSE','license'],['NOTICE','notice'],['public/reception.html','<p>reception fixture</p>']])await writeFile(join(dir,file),text);
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/routes.mjs',import.meta.url))],{cwd:dir});
  await access(join(dir,'dist/about/index.html'));
  assert.equal(await readFile(join(dir,'dist/reception/index.html'),'utf8'),'<p>reception fixture</p>');
  await access(join(dir,'dist/condo-template.css'));
  await assert.rejects(access(join(dir,'dist/condo')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
