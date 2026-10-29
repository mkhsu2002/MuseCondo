import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectMuseSources} from '../scripts/muse-sources.mjs';
test('source inventory records availability without reading or returning raw private content',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-source-'));
 try{await writeFile(join(dir,'SOUL.md'),'PRIVATE_SECRET');const r=await inspectMuseSources(dir);assert.equal(r.sources.find(x=>x.source==='SOUL').status,'available');assert.equal(r.sources.find(x=>x.source==='IDENTITY').status,'not-provided');assert(!JSON.stringify(r).includes('PRIVATE_SECRET'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('a symlink escaping the granted Muse home cannot count as an authorized source',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'muse-source-'));try{await mkdir(join(dir,'home'));await writeFile(join(dir,'secret'),'PRIVATE');await symlink(join(dir,'secret'),join(dir,'home','USER.md'));const r=await inspectMuseSources(join(dir,'home'));assert.equal(r.sources.find(x=>x.source==='USER').status,'outside-grant');}finally{await rm(dir,{recursive:true,force:true});}
});
