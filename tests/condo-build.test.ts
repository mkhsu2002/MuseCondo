import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {condoFixture} from './helpers/condo-fixture.ts';
const path='../server/framework/condo-build.ts';const builder=await import(path).catch(()=>undefined);
const crc=(data:Uint8Array)=>{let n=0xffffffff;for(const b of data){n^=b;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return (n^0xffffffff)>>>0;};
const pngChunk=(type:string,data:Buffer)=>{const name=Buffer.from(type),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([length,name,data,sum]);};
function png(width:number,height:number,color=6){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=color;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(Buffer.alloc((width*(color===2?3:4)+1)*height))),pngChunk('IEND',Buffer.alloc(0))]);
}
async function fixture(){const dir=await realpath(await mkdtemp(join(tmpdir(),'condo-build-')));await mkdir(join(dir,'art'));const input=condoFixture();for(const key of ['home','dream'] as const){const bytes=png(key==='home'?16:1,key==='home'?9:1);await writeFile(join(dir,`art/${key}.png`),bytes);input.review.digests[key]=createHash('sha256').update(bytes).digest('hex');}const file=join(dir,'input.json');await writeFile(file,JSON.stringify(input));return {dir,input,file,out:join(dir,'site')};}
async function build(input:string,out:string){assert.equal(typeof builder?.buildCondo,'function','Condo exporter must exist');return builder!.buildCondo({input,out});}
test('exports three file URLs and an allowlisted manifest, preserves identity, and removes a withdrawn dream image',async()=>{
 const f=await fixture();try{
  f.input.seed.consent.publishDreams=true;await writeFile(f.file,JSON.stringify(f.input));const first=await build(f.file,f.out);const manifest=JSON.parse(await readFile(join(f.out,'condo.json'),'utf8'));assert.match(first.id,/^[a-f0-9]{16}$/);assert.equal(manifest.home.id,first.id);
  for(const page of ['index.html','inside.html','dreams.html'])assert.match(await readFile(join(f.out,page),'utf8'),/<!doctype html>/i);
  assert.deepEqual((await readdir(join(f.out,'assets'))).sort(),['condo.css','dream.png','home.png']);
  const json=JSON.stringify(manifest);for(const token of ['PRIVATE-SOURCE','evidenceIds','checks','digests','PRIVATE-DREAM-MARKER'])assert.equal(json.includes(token),false);
  f.input.seed.consent.publishDreams=false;await writeFile(f.file,JSON.stringify(f.input));assert.equal((await build(f.file,f.out)).id,first.id);assert.deepEqual((await readdir(join(f.out,'assets'))).sort(),['condo.css','home.png']);assert.equal((await readFile(join(f.out,'condo.json'),'utf8')).includes('PRIVATE-WISH'),false);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('invalid bytes, review, ratio and private publication fail before replacing an old export',async()=>{
 const f=await fixture();try{
  await build(f.file,f.out);const before=await readFile(join(f.out,'condo.json'),'utf8');
  for(const bytes of [Buffer.from('not PNG'),png(1,1)]){await writeFile(join(f.dir,'art/home.png'),bytes);f.input.review.digests.home=createHash('sha256').update(bytes).digest('hex');await writeFile(f.file,JSON.stringify(f.input));await assert.rejects(build(f.file,f.out));assert.equal(await readFile(join(f.out,'condo.json'),'utf8'),before);}
  f.input.seed.consent.publishHome=false;await writeFile(f.file,JSON.stringify(f.input));await assert.rejects(build(f.file,f.out));
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('refuses unrelated output files, symlink output ancestors, escaped artwork and private inputs inside output',async()=>{
 const f=await fixture();try{
  await mkdir(f.out);await writeFile(join(f.out,'precious.txt'),'KEEP');await assert.rejects(build(f.file,f.out),/本站輸出/);assert.equal(await readFile(join(f.out,'precious.txt'),'utf8'),'KEEP');
  await symlink(f.dir,join(f.dir,'alias'));await assert.rejects(build(f.file,join(f.dir,'alias','new-site')),/符號連結/);
  await assert.rejects(build(f.file,f.dir),/Private inputs/);
  await rm(join(f.dir,'art/home.png'));const external=await mkdtemp(join(tmpdir(),'condo-external-'));try{await writeFile(join(external,'home.png'),png(16,9));await symlink(join(external,'home.png'),join(f.dir,'art/home.png'));await assert.rejects(build(f.file,join(f.dir,'safe-site')),/逃離/);}finally{await rm(external,{recursive:true,force:true});}
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('requires exact digest receipts and rejects unknown or repeated CLI arguments',async()=>{
 const f=await fixture();try{
  f.input.review.digests.home='0'.repeat(64);await writeFile(f.file,JSON.stringify(f.input));await assert.rejects(build(f.file,f.out),/收據/);
  assert.deepEqual(builder!.parseCondoBuildArgs(['--input','a.json','--out','site']),{input:'a.json',out:'site'});
  for(const args of [['--input','a','--out','b','--input','c'],['--input','a','--extra','b'],['--input','a'],['--input','--out','b'],['--input','a','--out','b','dangling']])assert.throws(()=>builder!.parseCondoBuildArgs(args));
 }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('dream artwork must be exactly square and protected source directories cannot be output',async()=>{
 const f=await fixture();try{
  const bytes=png(201,200);await writeFile(join(f.dir,'art/dream.png'),bytes);f.input.review.digests.dream=createHash('sha256').update(bytes).digest('hex');await writeFile(f.file,JSON.stringify(f.input));await assert.rejects(build(f.file,f.out),/比例/);
  const protectedOutput=new URL('../src/unsafe-condo-output',import.meta.url).pathname;await assert.rejects(build(f.file,protectedOutput),/專用/);
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('oversized or CRC-damaged PNG cannot create an output directory',async()=>{
 const f=await fixture();try{
  const damaged=png(16,9);damaged[damaged.length-1]^=1;
  for(const bytes of [Buffer.alloc(8*1024*1024+1),damaged]){await writeFile(join(f.dir,'art/home.png'),bytes);f.input.review.digests.home=createHash('sha256').update(bytes).digest('hex');await writeFile(f.file,JSON.stringify(f.input));await assert.rejects(build(f.file,f.out),/8 MiB|PNG CRC/);await assert.rejects(readdir(f.out),{code:'ENOENT'});}
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('public PNG strips private source metadata after checking the original review digest',async()=>{
 const f=await fixture();try{
  f.input.seed.consent.publishDreams=true;
  for(const key of ['home','dream'] as const){const bytes=await readFile(join(f.dir,`art/${key}.png`));const tagged=Buffer.concat([bytes.subarray(0,-12),pngChunk('tEXt',Buffer.from('prompt\0PRIVATE-SOURCE')),bytes.subarray(-12)]);await writeFile(join(f.dir,`art/${key}.png`),tagged);f.input.review.digests[key]=createHash('sha256').update(tagged).digest('hex');}
  await writeFile(f.file,JSON.stringify(f.input));await build(f.file,f.out);
  for(const key of ['home','dream'] as const){const published=await readFile(join(f.out,`assets/${key}.png`));assert.equal(published.includes(Buffer.from('PRIVATE-SOURCE')),false);assert.equal(published.includes(Buffer.from('tEXt')),false);assert.deepEqual(published,png(key==='home'?16:1,key==='home'?9:1));assert.notEqual(createHash('sha256').update(published).digest('hex'),f.input.review.digests[key]);}
 }finally{await rm(f.dir,{recursive:true,force:true});}
});

test('sanitizer preserves IDAT and valid transparency but removes every nonessential ancillary chunk',async()=>{
 const modulePath='../server/framework/png-public.ts';const helper=await import(modulePath).catch(()=>undefined);assert.equal(typeof helper?.sanitizePublicPNG,'function','Public PNG sanitizer must exist');
 const original=png(16,9,2),headerEnd=33;const transparent=Buffer.concat([original.subarray(0,headerEnd),pngChunk('tRNS',Buffer.alloc(6)),original.subarray(headerEnd)]);
 assert.deepEqual(await helper!.sanitizePublicPNG(transparent),new Uint8Array(transparent));
 const extra=['tEXt','zTXt','iTXt','eXIf','iCCP','gAMA','cHRM','sRGB','prIV'].map(type=>pngChunk(type,Buffer.from('PRIVATE-SOURCE')));
 const tagged=Buffer.concat([transparent.subarray(0,-12),...extra,transparent.subarray(-12)]);assert.deepEqual(await helper!.sanitizePublicPNG(tagged),new Uint8Array(transparent));
 const invalid=Buffer.concat([original.subarray(0,headerEnd),pngChunk('tRNS',Buffer.from('PRIVATE-SOURCE')),original.subarray(headerEnd)]);await assert.rejects(helper!.sanitizePublicPNG(invalid),/tRNS/);
});
