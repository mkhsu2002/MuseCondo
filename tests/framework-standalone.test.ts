import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildStandalone} from '../server/framework/standalone.ts';
const source=new URL('../fixtures/framework/safe-seed.json',import.meta.url);
const desktop=new URL('../public/prototype-assets/momo-desktop.png',import.meta.url),mobile=new URL('../public/prototype-assets/momo-mobile.png',import.meta.url);
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
test('standalone exports three durable routes and public data only; repeated updates keep the same home id',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-home-'));try{
 const seed=JSON.parse(await readFile(source,'utf8'));const art={desktop:new Uint8Array(await readFile(desktop)),mobile:new Uint8Array(await readFile(mobile))};
 const review={assetDigests:{desktop:digest(art.desktop),mobile:digest(art.mobile)},checks:{self:true,activity:true,ownerPortrait:true,window:true,matchedPair:true}};
 const first=await buildStandalone({seed,art,review,out:join(dir,'site')});
 for(const p of ['index.html','inside/index.html','dreams/index.html','home.json']){const text=await readFile(join(dir,'site',p),'utf8');assert(!text.includes('PRIVATE-'));assert(!text.includes('evidenceIds'));assert(!text.includes('prompt'));}
 const doc=JSON.parse(await readFile(join(dir,'site/home.json'),'utf8'));assert.equal(doc.dreams.length,0);assert.equal(doc.routes.inside,'/inside');
 seed.daily[0].body='A new authorized story';const next=await buildStandalone({seed,art,review,out:join(dir,'site')});assert.equal(next.id,first.id);assert((await readFile(join(dir,'site/inside/index.html'),'utf8')).includes('A new authorized story'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('export blocks missing visual review, wrong pair digest and private publication before producing files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-home-'));try{
 const seed=JSON.parse(await readFile(source,'utf8'));const art={desktop:new Uint8Array(await readFile(desktop)),mobile:new Uint8Array(await readFile(mobile))};
 await assert.rejects(buildStandalone({seed,art,review:{},out:join(dir,'bad')}));
 seed.consent.publishHome=false;await assert.rejects(buildStandalone({seed,art,review:{},out:join(dir,'private')}));
 await writeFile(join(dir,'keep'),'owner file');assert.equal(await readFile(join(dir,'keep'),'utf8'),'owner file');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('private seed and review realpaths cannot hide under a symlinked deployment output',async()=>{
 const {assertPrivateInputsOutsideOutput}=await import('../server/framework/standalone.ts');const {mkdir,symlink}=await import('node:fs/promises');
 const dir=await mkdtemp(join(tmpdir(),'muse-home-path-'));try{await mkdir(join(dir,'site'));await writeFile(join(dir,'site/private.json'),'PRIVATE');await symlink(join(dir,'site/private.json'),join(dir,'seed-link.json'));await assert.rejects(assertPrivateInputsOutsideOutput(join(dir,'site'),[join(dir,'seed-link.json')]));await symlink(join(dir,'site'),join(dir,'out-link'));await assert.rejects(assertPrivateInputsOutsideOutput(join(dir,'out-link'),[join(dir,'site/private.json')]));}finally{await rm(dir,{recursive:true,force:true});}
});
test('private input symlink entries inside output are rejected even when their targets are outside',async()=>{
 const {assertPrivateInputsOutsideOutput}=await import('../server/framework/standalone.ts');const {mkdir,symlink}=await import('node:fs/promises');
 const dir=await mkdtemp(join(tmpdir(),'muse-home-entry-'));try{await mkdir(join(dir,'site'));await writeFile(join(dir,'private.json'),'PRIVATE');await symlink(join(dir,'private.json'),join(dir,'site/seed-link.json'));await assert.rejects(assertPrivateInputsOutsideOutput(join(dir,'site'),[join(dir,'site/seed-link.json')]));await symlink(join(dir,'site'),join(dir,'out-link'));await assert.rejects(assertPrivateInputsOutsideOutput(join(dir,'out-link'),[join(dir,'site/seed-link.json')]));await assert.rejects(assertPrivateInputsOutsideOutput(join(dir,'site'),[join(dir,'out-link/seed-link.json')]));}finally{await rm(dir,{recursive:true,force:true});}
});
