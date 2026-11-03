import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanTowerWebP} from '../server/live/tower-image-webp.ts';
const original=new Uint8Array(Buffer.from('UklGRjQAAABXRUJQVlA4ICgAAACwAQCdASoBAAEAAQAcJYgCdLoABiIAAP7Iv/+A3XxbTL9H5lyc5wAA','base64'));
function chunk(kind:string,bytes:Uint8Array){const out=new Uint8Array(8+bytes.length+bytes.length%2);out.set(new TextEncoder().encode(kind));new DataView(out.buffer).setUint32(4,bytes.length,true);out.set(bytes,8);return out;}
function container(chunks:Uint8Array[]){const output=new Uint8Array(12+chunks.reduce((sum,value)=>sum+value.length,0));output.set(new TextEncoder().encode('RIFF'));new DataView(output.buffer).setUint32(4,output.length-8,true);output.set(new TextEncoder().encode('WEBP'),8);let offset=12;for(const value of chunks){output.set(value,offset);offset+=value.length;}return output;}
function extended(flags:number){const bytes=new Uint8Array(10);bytes[0]=flags;return chunk('VP8X',bytes);}
test('display WebP strips location/other metadata and its flags, retaining the exact compressed image',()=>{
 const encoded=container([extended(0x2c),chunk('ICCP',new TextEncoder().encode('PRIVATE_PROFILE')),original.slice(12),chunk('EXIF',new TextEncoder().encode('PRIVATE_GPS_LOCATION')),chunk('XMP ',new TextEncoder().encode('PRIVATE_AUTHOR_METADATA'))]);
 const result=cleanTowerWebP(encoded);assert.equal(result.width,1);assert.equal(result.height,1);assert.equal(result.bytes[20],0);assert.doesNotMatch(Buffer.from(result.bytes).toString(),/PRIVATE|EXIF|ICCP|XMP/);assert.deepEqual(result.bytes.slice(30),original.slice(12));
});
test('a transparent still image preserves alpha bytes while metadata is removed',()=>{
 const alpha=chunk('ALPH',new Uint8Array([0,128]));const result=cleanTowerWebP(container([extended(0x18),alpha,original.slice(12),chunk('EXIF',new TextEncoder().encode('PRIVATE_LOCATION'))]));
 assert.equal(result.bytes[20],0x10);assert.ok(Buffer.from(result.bytes).includes(Buffer.from(alpha)));assert.doesNotMatch(Buffer.from(result.bytes).toString(),/PRIVATE_LOCATION/);
});
test('animation, unknown chunks, mismatching canvas dimensions and oversized output are never served',()=>{
 const wrong=extended(0);wrong[12]=1;
 for(const bytes of [container([extended(2),original.slice(12)]),container([original.slice(12),chunk('JUNK',new Uint8Array([1]))]),container([wrong,original.slice(12)]),new Uint8Array(2*1024*1024+1)])assert.throws(()=>cleanTowerWebP(bytes),/image_output_invalid/);
 const broken=new Uint8Array(original);broken[4]^=1;assert.throws(()=>cleanTowerWebP(broken),/image_output_invalid/);
});
