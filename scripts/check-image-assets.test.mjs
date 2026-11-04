import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {imageInfo,checkImageAssets} from './check-image-assets.mjs';
import {Buffer} from 'node:buffer';

test('actual supplied formats and dimensions are inspected, including lossless WebP',async()=>{
 for(const name of ['muse','grok','gemini','chatgpt','claude']){
  const cover=await readFile(new URL('../public/media/perspective-'+name+'-home-20261103.webp',import.meta.url));
  const social=await readFile(new URL('../public/og/perspective-'+name+'-home-20261103.jpg',import.meta.url));
  const webp=imageInfo(cover),jpeg=imageInfo(social);assert.equal(webp.format,'webp');assert.equal(jpeg.format,'jpeg');assert.equal(webp.width,jpeg.width);assert.equal(webp.height,jpeg.height);
 }
});
test('JPEG bytes renamed WebP, truncation and oversized display files block the build',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-images-'));
 try{
  await mkdir(join(root,'media'));const jpeg=await readFile(new URL('../public/og/perspective-muse-home-20261103.jpg',import.meta.url));
  await writeFile(join(root,'media','mislabeled.webp'),jpeg);await assert.rejects(checkImageAssets(root),/extension/);
  await rm(join(root,'media','mislabeled.webp'));const webp=await readFile(new URL('../public/media/perspective-muse-home-20261103.webp',import.meta.url));
  assert.throws(()=>imageInfo(webp.subarray(0,webp.length-5)),/length/);
  const giant=Buffer.alloc(6*1024*1024);jpeg.copy(giant);giant[giant.length-2]=255;giant[giant.length-1]=217;await writeFile(join(root,'media','huge.jpg'),giant);await assert.rejects(checkImageAssets(root),/bounds/);
 }finally{await rm(root,{recursive:true,force:true});}
});
