/** Bounded PNG validation: chunk CRCs/order plus zlib scanline decoding. No canvas/native dependency. */
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export async function validatePNG(bytes:Uint8Array){
 if(bytes.length<57||bytes.length>8*1024*1024||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))throw new Error('invalid PNG signature');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8,width=0,height=0,depth=0,color=0,ended=false,seenData=false,dataEnded=false,palette=false;
 const compressed:Uint8Array[]=[];
 while(offset<bytes.length){
  if(offset+12>bytes.length)throw new Error('truncated PNG chunk');const length=view.getUint32(offset);if(length>bytes.length-offset-12)throw new Error('truncated PNG data');
  const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8)),data=bytes.subarray(offset+8,offset+8+length);
  if(!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type))throw new Error('invalid PNG chunk type');
  if(crc(bytes.subarray(offset+4,offset+8+length))!==view.getUint32(offset+8+length))throw new Error('invalid PNG CRC');
  if(offset===8&&type!=='IHDR')throw new Error('missing IHDR');
  if(type==='IHDR'){
   if(offset!==8||length!==13)throw new Error('invalid IHDR');width=view.getUint32(offset+8);height=view.getUint32(offset+12);depth=data[8];color=data[9];
   const depths:Record<number,number[]>={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
   if(!width||!height||width>8192||height>8192||!depths[color]?.includes(depth)||data[10]!==0||data[11]!==0||data[12]!==0)throw new Error('unsupported PNG format');
  }else if(type==='IDAT'){if(dataEnded)throw new Error('noncontiguous PNG data');seenData=true;compressed.push(data);}
  else if(type==='IEND'){if(length!==0||!seenData||offset+12!==bytes.length)throw new Error('invalid IEND');ended=true;}
  else{if(seenData)dataEnded=true;if(type==='PLTE'){if(palette||seenData||color===0||color===4||!length||length%3||length>768||(color===3&&length/3>2**depth))throw new Error('invalid palette');palette=true;}else if(type.charCodeAt(0)>=65&&type.charCodeAt(0)<=90)throw new Error('unsupported PNG critical chunk');}
  offset+=length+12;
 }
 if(!ended||(color===3&&!palette))throw new Error('incomplete PNG');
 const channels=({0:1,2:3,3:1,4:2,6:4} as Record<number,number>)[color],stride=1+Math.ceil(width*channels*depth/8),expected=stride*height;
 if(expected>64*1024*1024)throw new Error('PNG decoded size limit');
 const total=compressed.reduce((n,b)=>n+b.length,0),joined=new Uint8Array(total);let start=0;for(const b of compressed){joined.set(b,start);start+=b.length;}
 const stream=new Blob([joined]).stream().pipeThrough(new DecompressionStream('deflate'));const reader=stream.getReader();let count=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if(count+value.length>expected)throw new Error('PNG decoded length mismatch');for(let p=(stride-count%stride)%stride;p<value.length;p+=stride)if(value[p]>4)throw new Error('invalid PNG filter');count+=value.length;}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 if(count!==expected)throw new Error('PNG decoded length mismatch');return {width,height};
}
