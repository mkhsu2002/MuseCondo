import type {Database,Statement} from './db.ts';
import {VaultError,VAULT_LIMITS,type VaultAccess} from './vault-contract.ts';
import {assertVaultKey,decryptVault,encryptVault,vaultContentBytes,vaultInputHmac} from './vault-crypto.ts';
interface DocumentRow {path:string;revision:number;state:'live'|'deleted';ciphertext:string|null;plaintext_bytes:number;updated_at:string}
interface ReceiptRow {operation:string;path:string;input_hmac:string;revision:number;state:'live'|'deleted';plaintext_bytes:number;created_at:string}
export interface VaultMutationInput {path:string;expectedRevision:number;requestKey:string}
export interface VaultPutInput extends VaultMutationInput {content:string}
export interface VaultDocumentMetadata {path:string;revision:number;state:'live'|'deleted';bytes:number;updatedAt:string}
const metadata=(row:DocumentRow):VaultDocumentMetadata=>({path:row.path,revision:row.revision,state:row.state,bytes:row.plaintext_bytes,updatedAt:row.updated_at});
function validPath(path:unknown):asserts path is string {
 if(typeof path!=='string'||(!['SOUL.md','MEMORY.md','SKILLS.md'].includes(path)&&!/^skills\/(?=.{1,64}\/SKILL\.md$)[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(path)))throw new VaultError(400,'vault_invalid_path');
}
function mutationInput(input:VaultMutationInput){
 validPath(input.path);if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=Number.MAX_SAFE_INTEGER)throw new VaultError(400,'vault_invalid_revision');
 if(typeof input.requestKey!=='string'||!(/^[A-Za-z0-9_-]{8,96}$/).test(input.requestKey))throw new VaultError(400,'vault_invalid_request_key');
}
function storageError(error:unknown):never {
 if(error instanceof VaultError)throw error;
 const message=error instanceof Error?error.message:'';
 for(const [code,status] of [['vault_skill_limit',409],['vault_total_limit',413],['vault_daily_limit',429]] as const)if(message.includes(code))throw new VaultError(status,code);
 throw new VaultError(503,'vault_storage_unavailable');
}
/** All SQL reads and writes include the current grant's transaction-time authorization guard. */
export function createPrivateVaultStore({db,key,now=()=>new Date()}:{db:Database;key:string;now?:()=>Date}){
 const stamp=()=>{const value=now();if(!(value instanceof Date)||!Number.isFinite(value.getTime()))throw new VaultError(503,'vault_clock_unavailable');return value.toISOString();};
 async function batch(access:VaultAccess,statements:Statement[]){assertVaultKey(key);try{return await db.batch([await access.guard(),...statements]);}catch(error){if(error instanceof VaultError)throw error;try{await access.guard();}catch(authError){storageError(authError);}return storageError(error);}}
 async function rows<T>(access:VaultAccess,statement:Statement){return (await batch(access,[statement]))[1].results as T[];}
 async function documents(access:VaultAccess){return rows<DocumentRow>(access,db.prepare('SELECT path,revision,state,ciphertext,plaintext_bytes,updated_at FROM agent_private_vault_documents WHERE account_id=? ORDER BY path').bind(access.accountId));}
 async function document(access:VaultAccess,path:string){return (await rows<DocumentRow>(access,db.prepare('SELECT path,revision,state,ciphertext,plaintext_bytes,updated_at FROM agent_private_vault_documents WHERE account_id=? AND path=?').bind(access.accountId,path)))[0];}
 async function prior(access:VaultAccess,requestKey:string,operation:string,inputHmac:string){
 const row=(await rows<ReceiptRow>(access,db.prepare('SELECT operation,path,input_hmac,revision,state,plaintext_bytes,created_at FROM agent_private_vault_requests WHERE account_id=? AND request_key=?').bind(access.accountId,requestKey)))[0];
 if(!row)return null;if(row.operation!==operation||row.input_hmac!==inputHmac)throw new VaultError(409,'vault_request_conflict');
 return {path:row.path,revision:row.revision,state:row.state,bytes:row.plaintext_bytes,updatedAt:row.created_at,replayed:true};
 }
 async function mutate(access:VaultAccess,input:VaultPutInput|VaultMutationInput,operation:'put'|'delete'){
 mutationInput(input);const content=operation==='put'?(input as VaultPutInput).content:null;
 const bytes=operation==='put'?vaultContentBytes(content).length:0;
 const inputHmac=await vaultInputHmac(key,access.accountId,[operation,input.path,input.expectedRevision,content]);
 const replay=await prior(access,input.requestKey,operation,inputHmac);if(replay)return replay;
 const previous=await document(access,input.path);
 if((previous?.revision??0)!==input.expectedRevision)throw new VaultError(409,'vault_revision_conflict',{revision:previous?.revision??0});
 if(operation==='delete'&&(!previous||previous.state==='deleted'))throw new VaultError(404,'vault_file_not_found',{revision:previous?.revision??0});
 const revision=input.expectedRevision+1,state=operation==='put'?'live' as const:'deleted' as const,updatedAt=stamp();
 const ciphertext=operation==='put'?await encryptVault(key,access.accountId,input.path,revision,content!):null;
 const mutation=previous
 ?db.prepare('UPDATE agent_private_vault_documents SET revision=?,state=?,ciphertext=?,plaintext_bytes=?,updated_at=? WHERE account_id=? AND path=? AND revision=?').bind(revision,state,ciphertext,bytes,updatedAt,access.accountId,input.path,input.expectedRevision)
 :db.prepare('INSERT INTO agent_private_vault_documents(account_id,path,revision,state,ciphertext,plaintext_bytes,updated_at) VALUES(?,?,?,?,?,?,?)').bind(access.accountId,input.path,revision,state,ciphertext,bytes,updatedAt);
 try{
 await batch(access,[
 db.prepare("SELECT CASE WHEN coalesce((SELECT revision FROM agent_private_vault_documents WHERE account_id=? AND path=?),0)=? THEN 1 ELSE json('vault-revision-conflict') END").bind(access.accountId,input.path,input.expectedRevision),
 mutation,
 db.prepare('INSERT INTO agent_private_vault_requests(account_id,request_key,operation,path,input_hmac,revision,state,plaintext_bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(access.accountId,input.requestKey,operation,input.path,inputHmac,revision,state,bytes,updatedAt),
 db.prepare("INSERT INTO agent_private_vault_audit(id,account_id,operation,path,revision,plaintext_bytes,result,created_at) VALUES(?,?,?,?,?,?,'success',?)").bind(crypto.randomUUID(),access.accountId,operation,input.path,revision,bytes,updatedAt)
 ]);
 }catch(error){
 // A concurrently committed identical request must replay, never repeat a mutation.
 const saved=await prior(access,input.requestKey,operation,inputHmac);if(saved)return saved;
 const current=await document(access,input.path);if((current?.revision??0)!==input.expectedRevision)throw new VaultError(409,'vault_revision_conflict',{revision:current?.revision??0});
 throw error;
 }
 return {path:input.path,revision,state,bytes,updatedAt,replayed:false};
 }
 return {
 async list(access:VaultAccess){return {documents:(await documents(access)).map(metadata),limits:VAULT_LIMITS};},
 async get(access:VaultAccess,path:string){validPath(path);const row=await document(access,path);if(!row||row.state!=='live')throw new VaultError(404,'vault_file_not_found',{revision:row?.revision??0});return {...metadata(row),content:await decryptVault(key,access.accountId,path,row.revision,row.ciphertext!,row.plaintext_bytes)};},
 put:(access:VaultAccess,input:VaultPutInput)=>mutate(access,input,'put'),
 remove:(access:VaultAccess,input:VaultMutationInput)=>mutate(access,input,'delete'),
 async export(access:VaultAccess){const selected=(await documents(access)).filter(row=>row.state==='live'),exportedAt=stamp();const current=[];for(const row of selected)current.push({...metadata(row),content:await decryptVault(key,access.accountId,row.path,row.revision,row.ciphertext!,row.plaintext_bytes)});return {format:'musecondo-private-vault-v1',exportedAt,documents:current};}
 };
}
