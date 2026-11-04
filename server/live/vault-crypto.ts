import {VaultError,VAULT_LIMITS} from './vault-contract.ts';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const MAX_ENVELOPE=90112;
function keyBytes(key:unknown){if(typeof key!=='string'||!(/^[a-f0-9]{64}$/i).test(key))throw new VaultError(503,'vault_key_unavailable');return Uint8Array.from(key.match(/../g)!,part=>parseInt(part,16));}
function base64(bytes:Uint8Array){let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function unbase64(value:string){if(!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('invalid');const bytes=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));if(base64(bytes)!==value)throw new Error('invalid');return bytes;}
const aad=(accountId:string,path:string,revision:number)=>encoder.encode(JSON.stringify(['musecondo-private-vault-v1',accountId,path,revision]));
export function vaultContentBytes(content:unknown):Uint8Array<ArrayBuffer>{
 if(typeof content!=='string')throw new VaultError(400,'vault_invalid_content');
 const bytes=encoder.encode(content);if(decoder.decode(bytes)!==content)throw new VaultError(400,'vault_invalid_content');
 if(bytes.length>VAULT_LIMITS.fileBytes)throw new VaultError(413,'vault_file_too_large');return bytes;
}
export async function encryptVault(key:string,accountId:string,path:string,revision:number,content:string){
 const bytes=vaultContentBytes(content),nonce=crypto.getRandomValues(new Uint8Array(12));
 const aes=await crypto.subtle.importKey('raw',keyBytes(key),'AES-GCM',false,['encrypt']);
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad(accountId,path,revision),tagLength:128},aes,bytes);
 const envelope='v1.'+base64(nonce)+'.'+base64(new Uint8Array(encrypted));if(envelope.length>MAX_ENVELOPE)throw new VaultError(413,'vault_file_too_large');return envelope;
}
export async function decryptVault(key:string,accountId:string,path:string,revision:number,envelope:string,expectedBytes:number){
 const rawKey=keyBytes(key);
 try{
 if(typeof envelope!=='string'||envelope.length>MAX_ENVELOPE)throw new Error('invalid');
 const parts=envelope.split('.');if(parts.length!==3||parts[0]!=='v1')throw new Error('invalid');
 const nonce=unbase64(parts[1]),data=unbase64(parts[2]);if(nonce.length!==12||data.length<16||data.length>VAULT_LIMITS.fileBytes+16)throw new Error('invalid');
 const aes=await crypto.subtle.importKey('raw',rawKey,'AES-GCM',false,['decrypt']);
 const plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:aad(accountId,path,revision),tagLength:128},aes,data));
 if(plaintext.length!==expectedBytes||plaintext.length>VAULT_LIMITS.fileBytes)throw new Error('invalid');return decoder.decode(plaintext);
 }catch{throw new VaultError(503,'vault_decryption_failed');}
}
export async function vaultInputHmac(key:string,accountId:string,value:unknown){
 const hmac=await crypto.subtle.importKey('raw',keyBytes(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const result=await crypto.subtle.sign('HMAC',hmac,encoder.encode(JSON.stringify(['musecondo-vault-request-v1',accountId,value])));
 return Array.from(new Uint8Array(result),b=>b.toString(16).padStart(2,'0')).join('');
}
export function assertVaultKey(key:unknown){keyBytes(key);}
