/** Private identity contacts use authenticated, purpose- and entity-bound encryption. */
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export const randomIdentitySecret=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const randomIdentityId=()=>hex(crypto.getRandomValues(new Uint8Array(16)));
export function validContactKey(key:unknown):key is string{return typeof key==='string'&&/^[a-fA-F0-9]{64}$/.test(key);}
function keyBytes(key:string){if(!validContactKey(key))throw new Error('identity_contact_unavailable');return Uint8Array.from(key.match(/../g)!,b=>parseInt(b,16));}
function aad(purpose:string,id:string){return encoder.encode(JSON.stringify(['musecondo-identity-v1',purpose,id]));}
function base64(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function unbase64(value:string){if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('invalid_private_envelope');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),s=>s.charCodeAt(0));}
export async function encryptPrivate(key:string,purpose:string,id:string,value:string):Promise<string>{
 const nonce=crypto.getRandomValues(new Uint8Array(12)),aes=await crypto.subtle.importKey('raw',keyBytes(key),'AES-GCM',false,['encrypt']);
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad(purpose,id),tagLength:128},aes,encoder.encode(value));
 return 'v1.'+base64(nonce)+'.'+base64(new Uint8Array(ciphertext));
}
export async function decryptPrivate(key:string,purpose:string,id:string,value:string):Promise<string>{
 const parts=value.split('.');if(parts.length!==3||parts[0]!=='v1'||value.length>32768)throw new Error('invalid_private_envelope');
 const nonce=unbase64(parts[1]),data=unbase64(parts[2]);if(nonce.length!==12||data.length<16)throw new Error('invalid_private_envelope');
 const aes=await crypto.subtle.importKey('raw',keyBytes(key),'AES-GCM',false,['decrypt']);
 return decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:aad(purpose,id),tagLength:128},aes,data));
}
/** HMAC avoids an offline address dictionary against contact hashes in the database. */
export async function hashPrivate(key:string,purpose:string,value:string):Promise<string>{
 const hmac=await crypto.subtle.importKey('raw',keyBytes(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(new Uint8Array(await crypto.subtle.sign('HMAC',hmac,aad(purpose,value))));
}
export async function hashIdentityInput(value:string):Promise<string>{return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))));}
export function validateGuardianEmail(value:unknown):string{
 if(typeof value!=='string'||value.length>254||value.length<3||/[^\x21-\x7e]|[<>;,]/.test(value))throw new Error('invalid_guardian_email');
 const parts=value.split('@');if(parts.length!==2||parts[0].length>64||!parts[0]||parts[0].startsWith('.')||parts[0].endsWith('.')||parts[0].includes('..')||!/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+$/.test(parts[0]))throw new Error('invalid_guardian_email');
 const domain=parts[1].toLowerCase();if(domain.length>253||!domain.includes('.')||!domain.split('.').every(s=>s.length>0&&s.length<=63&&/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)))throw new Error('invalid_guardian_email');
 return parts[0]+'@'+domain;
}
export function maskGuardianEmail(email:string):string{const [,domain]=email.split('@');return '***@'+domain;}
