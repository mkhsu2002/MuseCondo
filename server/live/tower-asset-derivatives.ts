/** Optional private delivery copies. They never carry publication authority. */
export interface TowerDerivativeBucket {
    get(key:string):Promise<{size?:number;arrayBuffer():Promise<ArrayBuffer>}|null>;
}
export const TOWER_WEBP_PROFILE = 'webp-q85-m6-v1';
export function towerDerivativePrefix(room:string,sourceDigest:string) {
    return `tower-home-derivatives/v1/${room}/${sourceDigest}/${TOWER_WEBP_PROFILE}`;
}
const sha = async(bytes:Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const integer = (value:unknown,maximum:number):value is number => Number.isInteger(value) && Number(value)>0 && Number(value)<=maximum;
const ascii = (bytes:Uint8Array,start:number,length:number) => String.fromCharCode(...bytes.subarray(start,start+length));

/** This fixed profile accepts one metadata-free, nonanimated VP8 image only. */
function dimensions(bytes:Uint8Array<ArrayBuffer>) {
    if (bytes.length<30 || ascii(bytes,0,4)!=='RIFF' || ascii(bytes,8,8)!=='WEBPVP8 ') return null;
    const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=view.getUint32(16,true);
    if (view.getUint32(4,true)!==bytes.length-8 || length<10 || 20+length+(length%2)!==bytes.length || (bytes[20]&1)!==0 || ascii(bytes,23,3)!=='\x9d\x01\x2a') return null;
    if (length%2 && bytes[bytes.length-1]!==0) return null;
    return {width:view.getUint16(26,true)&0x3fff,height:view.getUint16(28,true)&0x3fff};
}

/** Require the native R2 size before allocating any untrusted body. */
async function bounded(bucket:TowerDerivativeBucket,key:string,maximum:number) {
    const object=await bucket.get(key);
    if (!object || !integer(object.size,maximum)) return null;
    const bytes=new Uint8Array(await object.arrayBuffer());
    return bytes.length===object.size ? bytes : null;
}

export function acceptsTowerWebP(accept:string|null) {
    return (accept??'').split(',').some(part=>{
        const [type,...parameters]=part.trim().toLowerCase().split(';').map(value=>value.trim());
        if (type!=='image/webp') return false;
        const quality=parameters.filter(value=>value.startsWith('q='));
        if (!quality.length) return true;
        if (quality.length!==1 || !/^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(quality[0])) return false;
        return Number(quality[0].slice(2))>0;
    });
}

/** Call only after the current public revision and purpose have been authorized. */
export async function readTowerWebP(bucket:TowerDerivativeBucket|undefined,room:string,source:{digest:string;size:number}) {
    if (!bucket || !/^[a-f0-9]{16}$/.test(room) || !/^[a-f0-9]{64}$/.test(source.digest)) return null;
    try {
        const prefix=towerDerivativePrefix(room,source.digest),raw=await bounded(bucket,prefix+'.json',4096);
        if (!raw) return null;
        const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)) as Record<string,unknown>;
        const keys=['version','profile','roomId','sourceSha256','sourceByteLength','width','height','contentType','objectKey','sha256','byteLength'];
        if (!manifest || typeof manifest!=='object' || Array.isArray(manifest) || Object.keys(manifest).length!==keys.length || !keys.every(key=>Object.hasOwn(manifest,key))) return null;
        if (manifest.version!==1 || manifest.profile!==TOWER_WEBP_PROFILE || manifest.roomId!==room || manifest.sourceSha256!==source.digest || manifest.sourceByteLength!==source.size || manifest.contentType!=='image/webp' || manifest.objectKey!==prefix+'.webp' || typeof manifest.sha256!=='string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) return null;
        if (!integer(manifest.width,8192) || !integer(manifest.height,8192) || manifest.width*manifest.height>16000000 || !integer(manifest.byteLength,2*1024*1024) || manifest.byteLength>=source.size) return null;
        const bytes=await bounded(bucket,prefix+'.webp',manifest.byteLength);
        if (!bytes || bytes.length!==manifest.byteLength || await sha(bytes)!==manifest.sha256) return null;
        const size=dimensions(bytes);
        if (!size || size.width!==manifest.width || size.height!==manifest.height) return null;
        return {bytes,digest:manifest.sha256,size:bytes.length};
    } catch {
        // Missing or damaged optional delivery copies cannot hide a valid original.
        return null;
    }
}
