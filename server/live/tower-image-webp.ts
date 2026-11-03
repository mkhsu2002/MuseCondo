const ascii=(bytes:Uint8Array,offset:number,length:number)=>String.fromCharCode(...bytes.subarray(offset,offset+length));
/** Strip metadata, preserve alpha, reject animation and malformed WebP containers. */
export function cleanTowerWebP(input:Uint8Array<ArrayBuffer>) {
 if(input.length<30||input.length>2*1024*1024||ascii(input,0,4)!=='RIFF'||ascii(input,8,4)!=='WEBP')throw Error('image_output_invalid');
 const view=new DataView(input.buffer,input.byteOffset,input.byteLength);if(view.getUint32(4,true)!==input.length-8)throw Error('image_output_invalid');
 const chunks:Uint8Array[]=[];let offset=12,width=0,height=0,canvas:{width:number;height:number;alpha:boolean}|null=null,alpha=false,frame=false;
 while(offset<input.length){
  if(offset+8>input.length)throw Error('image_output_invalid');const kind=ascii(input,offset,4),size=view.getUint32(offset+4,true),end=offset+8+size,padded=end+size%2;
  if(padded>input.length||size<1||(size%2&&input[end]!==0))throw Error('image_output_invalid');
  const bytes=input.slice(offset,padded),data=offset+8;
  if(['EXIF','XMP ','ICCP'].includes(kind)){offset=padded;continue;}
  if(kind==='VP8X'){
   if(offset!==12||size!==10||canvas||input[data]&0xc3||input[data+1]||input[data+2]||input[data+3])throw Error('image_output_invalid');
   const u24=(at:number)=>input[at]+256*input[at+1]+65536*input[at+2];canvas={width:u24(data+4)+1,height:u24(data+7)+1,alpha:!!(input[data]&0x10)};bytes[8]&=0x10;
  }else if(kind==='ALPH'){if(!canvas||frame||alpha)throw Error('image_output_invalid');alpha=true;}
  else if(kind==='VP8 '){
   if(frame||size<10||(input[data]&1)||ascii(input,data+3,3)!=='\x9d\x01\x2a')throw Error('image_output_invalid');
   width=view.getUint16(data+6,true)&0x3fff;height=view.getUint16(data+8,true)&0x3fff;frame=true;
  }else if(kind==='VP8L'){
   if(frame||alpha||size<5||input[data]!==0x2f)throw Error('image_output_invalid');const bits=view.getUint32(data+1,true);if(bits>>>29)throw Error('image_output_invalid');width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;alpha=!!((bits>>>28)&1);frame=true;
  }else throw Error('image_output_invalid');
  chunks.push(bytes);offset=padded;
 }
 if(!frame||width<1||height<1||width>1920||height>1920||(canvas&&(canvas.width!==width||canvas.height!==height||canvas.alpha!==alpha)))throw Error('image_output_invalid');
 const output=new Uint8Array(12+chunks.reduce((n,bytes)=>n+bytes.length,0));output.set(input.subarray(0,12));new DataView(output.buffer).setUint32(4,output.length-8,true);offset=12;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
 return {bytes:output,width,height,alpha};
}
