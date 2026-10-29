import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
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
