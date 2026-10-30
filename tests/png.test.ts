import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {validatePNG} from '../server/live/png.ts';
const checksum=(b:Uint8Array)=>{let c=0xffffffff;for(const value of b){c^=value;for(let n=0;n<8;n++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;};
function chunk(name:string,data:Uint8Array){const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(checksum(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc]);}
function png(raw=Uint8Array.from([0,12,34,56,255]),compressed=deflateSync(raw)){const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',compressed),chunk('IEND',new Uint8Array())]);}
test('valid complete PNG decodes; header-only, truncated and bad CRC are rejected',async()=>{
 assert.deepEqual(await validatePNG(png()),{width:1,height:1});const bytes=png();await assert.rejects(validatePNG(bytes.subarray(0,24)));await assert.rejects(validatePNG(bytes.subarray(0,bytes.length-1)));bytes[40]^=255;await assert.rejects(validatePNG(bytes));
});
test('CRC-valid but corrupt zlib payload is not a valid image',async()=>{await assert.rejects(validatePNG(png(undefined,Buffer.from('not-zlib'))));});
test('decoded scanline length and filter are validated, including oversized inflation',async()=>{
 await assert.rejects(validatePNG(png(Uint8Array.from([0,1]))));await assert.rejects(validatePNG(png(new Uint8Array(10000))));await assert.rejects(validatePNG(png(Uint8Array.from([5,12,34,56,255]))));
});
test('transparency rejects hidden payloads, alpha color types, duplicate chunks and invalid ordering',async()=>{
 const original=png();const insert=(data:Uint8Array)=>Buffer.concat([original.subarray(0,33),chunk('tRNS',data),original.subarray(33)]);
 await assert.rejects(validatePNG(insert(Buffer.from('PRIVATE_METADATA_IN_TRNS'))));
 await assert.rejects(validatePNG(insert(Uint8Array.of(0,0,0,0,0,0))));
});
function transparencyPNG(color:number,transparency:Uint8Array,options:{duplicate?:boolean;afterData?:boolean;beforePalette?:boolean}={}){
 const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=color;
 const alpha=chunk('tRNS',transparency),palette=color===3?[chunk('PLTE',Uint8Array.of(0,0,0))]:[],data=chunk('IDAT',deflateSync(new Uint8Array(1+({0:1,2:3,3:1,4:2,6:4}[color]??4))));
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(options.beforePalette?[alpha,...palette]:[...palette,...(options.afterData?[]:[alpha])]),...(options.duplicate?[alpha]:[]),data,...(options.afterData?[alpha]:[]),chunk('IEND',new Uint8Array())]);
}
test('legal grayscale, RGB and indexed transparency preserve valid image semantics',async()=>{
 for(const [color,bytes]of [[0,Uint8Array.of(0,0)],[2,new Uint8Array(6)],[3,Uint8Array.of(128)]] as const)assert.deepEqual(await validatePNG(transparencyPNG(color,bytes)),{width:1,height:1});
});
test('transparency lengths, sample ranges, uniqueness and palette/data ordering are enforced',async()=>{
 for(const [color,bytes]of [[0,new Uint8Array(3)],[0,Uint8Array.of(1,0)],[2,new Uint8Array(7)],[2,Uint8Array.of(1,0,0,0,0,0)],[3,new Uint8Array(2)],[3,new Uint8Array(0)],[4,new Uint8Array(2)],[6,new Uint8Array(6)]] as const)await assert.rejects(validatePNG(transparencyPNG(color,bytes)));
 await assert.rejects(validatePNG(transparencyPNG(0,new Uint8Array(2),{duplicate:true})));
 await assert.rejects(validatePNG(transparencyPNG(0,new Uint8Array(2),{afterData:true})));
 await assert.rejects(validatePNG(transparencyPNG(3,Uint8Array.of(0),{beforePalette:true})));
});
