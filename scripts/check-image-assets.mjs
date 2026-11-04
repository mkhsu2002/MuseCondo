import {readFile,readdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';
import {Buffer} from 'node:buffer';

/** Check actual encoded bytes; a filename is not format evidence. No network or model calls. */
export function imageInfo(input){
 const b=Buffer.from(input);
 if(b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){const {width,height}=PNG.sync.read(b);return {format:'png',width,height};}
 if(b.length>=30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){
  if(b.readUInt32LE(4)!==b.length-8)throw Error('Invalid WebP container length');
  let width,height,frames=0;
  for(let at=12;at<b.length;){
   if(at+8>b.length)throw Error('Truncated WebP chunk');
   const kind=b.toString('ascii',at,at+4),size=b.readUInt32LE(at+4),p=at+8;
   if(p+size>b.length)throw Error('Truncated WebP payload');
   if(kind==='VP8 '){if(size<10||!b.subarray(p+3,p+6).equals(Buffer.from([157,1,42])))throw Error('Invalid WebP frame');width=b.readUInt16LE(p+6)&16383;height=b.readUInt16LE(p+8)&16383;frames++;}
   if(kind==='VP8L'){if(size<5||b[p]!==47)throw Error('Invalid lossless WebP frame');const bits=b.readUInt32LE(p+1);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;frames++;}
   at=p+size+(size%2);
  }
  if(frames!==1||!width||!height)throw Error('Expected one static WebP frame');
  return {format:'webp',width,height};
 }
 if(b.length>4&&b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217){
  for(let at=2;at+4<b.length;){
   if(b[at++]!==255)throw Error('Invalid JPEG marker');while(b[at]===255)at++;
   const marker=b[at++];if(marker===218)break;
   if(marker===1||(marker>=208&&marker<=215))continue;
   const size=b.readUInt16BE(at);if(size<2||at+size>b.length)throw Error('Truncated JPEG segment');
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
    if(size<8)throw Error('Truncated JPEG dimensions');return {format:'jpeg',width:b.readUInt16BE(at+5),height:b.readUInt16BE(at+3)};
   }
   at+=size;
  }
 }
 throw Error('Unsupported or invalid raster image');
}
export async function checkImageAssets(directory='dist'){
 const records=[];
 for(const folder of ['media','og','prototype-assets']){
  async function visit(path){
   let entries;try{entries=await readdir(path,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
   for(const entry of entries){
    const file=resolve(path,entry.name);if(entry.isDirectory()){await visit(file);continue;}
    const extension=extname(entry.name).toLowerCase();if(!['.png','.webp','.jpg','.jpeg','.avif'].includes(extension))continue;
    const bytes=await readFile(file),info=imageInfo(bytes),expected=['.jpg','.jpeg'].includes(extension)?'jpeg':extension.slice(1);
    if(info.format!==expected)throw Error('Image bytes do not match extension: '+file);
    if(bytes.length>5*1024*1024||info.width<1||info.height<1||info.width>8192||info.height>8192)throw Error('Image exceeds display bounds: '+file);
    records.push({file,...info,bytes:bytes.length});
   }
  }
  await visit(resolve(directory,folder));
 }
 return records;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const records=await checkImageAssets(process.argv[2]||'dist');console.log('PASS raster asset format/dimension/size checks:',records.length);}
