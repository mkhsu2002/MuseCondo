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
