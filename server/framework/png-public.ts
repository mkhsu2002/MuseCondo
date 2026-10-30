import {validatePNG} from '../live/png.ts';

/** Strip nonessential PNG chunks without decoding/re-encoding or changing compressed pixels. */
export async function sanitizePublicPNG(bytes:Uint8Array):Promise<Uint8Array>{
 // Validate the original CRCs, order, bounded inflation and complete scanlines before copying chunks.
 await validatePNG(bytes);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),depth=bytes[24],color=bytes[25];
 const keep=new Set(['IHDR','PLTE','IDAT','IEND','tRNS']),chunks:Uint8Array[]=[bytes.subarray(0,8)];
 let offset=8,paletteEntries=0,seenData=false,seenTransparency=false;
 while(offset<bytes.length){
  const length=view.getUint32(offset),end=offset+length+12,type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
  if(type==='PLTE')paletteEntries=length/3;
  if(type==='IDAT')seenData=true;
  if(type==='tRNS'){
   // tRNS contains pixel alpha, not free text. Reject malformed payloads rather than publishing them.
   if(seenTransparency||seenData||![0,2,3].includes(color))throw Error('invalid PNG tRNS');
   if(color===3){if(!length||length>paletteEntries)throw Error('invalid PNG tRNS palette');}
   else{
    const channels=color===0?1:3,max=2**depth-1;
    if(length!==channels*2)throw Error('invalid PNG tRNS length');
    for(let channel=0;channel<channels;channel++)if(view.getUint16(offset+8+channel*2)>max)throw Error('invalid PNG tRNS sample');
   }
   seenTransparency=true;
  }
  if(keep.has(type))chunks.push(bytes.subarray(offset,end));
  offset=end;
 }
 const result=new Uint8Array(chunks.reduce((total,chunk)=>total+chunk.length,0));let position=0;
 for(const chunk of chunks){result.set(chunk,position);position+=chunk.length;}
 return result;
}
