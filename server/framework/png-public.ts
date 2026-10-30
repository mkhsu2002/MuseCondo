import {validatePNG} from '../live/png.ts';
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function chunk(type:string,data:Uint8Array){const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);let crc=0xffffffff;for(const b of out.subarray(4,out.length-4))crc=crcTable[(crc^b)&255]^(crc>>>8);view.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;}
/** Strip metadata and normalize compressed scanlines, preserving pixels and legal transparency. */
export async function sanitizePublicPNG(bytes:Uint8Array):Promise<Uint8Array>{
 await validatePNG(bytes);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),before:Uint8Array[]=[bytes.subarray(0,8)],data:Uint8Array[]=[];
 for(let offset=8;offset<bytes.length;){const length=view.getUint32(offset),end=offset+length+12,type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
  if(['IHDR','PLTE','tRNS'].includes(type))before.push(bytes.subarray(offset,end));
  if(type==='IDAT')data.push(bytes.subarray(offset+8,offset+8+length));offset=end;
 }
 const joined=new Uint8Array(data.reduce((n,b)=>n+b.length,0));let start=0;for(const b of data){joined.set(b,start);start+=b.length;}
 // Node's decompressor may ignore trailing bytes after the zlib stream. Re-encoding
 // scanlines removes such bytes rather than copying them into a public IDAT chunk.
 const stream=new Blob([joined]).stream().pipeThrough(new DecompressionStream('deflate')).pipeThrough(new CompressionStream('deflate'));
 const normalized=new Uint8Array(await new Response(stream).arrayBuffer());
 const chunks=[...before,chunk('IDAT',normalized),bytes.subarray(bytes.length-12)];
 const length=chunks.reduce((n,b)=>n+b.length,0);if(length>8*1024*1024)throw Error('normalized PNG size limit');
 const result=new Uint8Array(length);start=0;for(const c of chunks){result.set(c,start);start+=c.length;}return result;
}
