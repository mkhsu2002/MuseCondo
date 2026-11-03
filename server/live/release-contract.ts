import type {Database} from './db.ts';
import {isTowerLordPath} from './tower-lord-auth.ts';
export interface SchemaObject {type:string;name:string;tbl_name:string;sql:string|null}
export const SCHEMA_QUERY="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','view','trigger')";
/** Tokenize SQL: preserve quoted values/identifiers and all DDL, ignore only comments and spacing. */
export function normalizeSQL(sql:string){
 const tokens=sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9$]*|\d+(?:\.\d+)?|[^\s]/g)??[];
 return tokens.filter(t=>!t.startsWith('--')&&!t.startsWith('/*')).map(t=>/^[A-Za-z_]/.test(t)?t.toLowerCase():t).join(' ');
}
export function canonicalSchema(rows:SchemaObject[]){
 return rows.filter(r=>r.sql&&!r.name.startsWith('sqlite_')&&r.name!=='_cf_KV'&&r.name!=='d1_migrations'&&r.tbl_name!=='_cf_KV'&&r.tbl_name!=='d1_migrations').map(r=>({type:r.type,name:r.name,table:r.tbl_name,sql:normalizeSQL(r.sql!)})).sort((a,b)=>{const x=a.type+'\0'+a.name,y=b.type+'\0'+b.name;return x<y?-1:x>y?1:0;});
}
export async function hashContract(value:unknown){const bytes=new TextEncoder().encode(JSON.stringify(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export interface ReleaseManifest {version:1;sourceSHA:string;sourceTreeHash:string;schemaHash:string;schemaObjects:number;schemaDefinitions:ReturnType<typeof canonicalSchema>;migrations:{name:string;sha256:string}[];migrationHash:string;rendererHash:string;frontendAssets:{path:string;sha256:string;access:'public'|'protected'}[];frontendHash:string;buildComplete:boolean;buildHash:string}
export const releaseAssetAccess=(path:string)=>isTowerLordPath('/'+path)?'protected' as const:'public' as const;
// Bound both work and memory even when a binding ignores AbortSignal or length headers.
const PROTECTED_ASSET_MAX_BYTES=2*1024*1024,PROTECTED_ASSET_TIMEOUT_MS=5000;
async function protectedAssetBytes(assets:{fetch(request:Request):Promise<Response>},url:URL){
 const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(Error('asset_timeout'));},PROTECTED_ASSET_TIMEOUT_MS);});
 const read=async()=>{
  const response=await assets.fetch(new Request(url,{redirect:'manual',signal:controller.signal}));
  if(controller.signal.aborted||response.status!==200||response.redirected||!response.body){void response.body?.cancel().catch(()=>{});throw Error('asset_unavailable');}
  reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{
   while(true){
    const chunk=await reader.read();if(controller.signal.aborted)throw Error('asset_timeout');if(chunk.done)break;
    size+=chunk.value.byteLength;if(size>PROTECTED_ASSET_MAX_BYTES)throw Error('asset_too_large');chunks.push(chunk.value);
   }
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
  }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 };
 try{return await Promise.race([read(),deadline]);}
 catch(error){controller.abort();void reader?.cancel().catch(()=>{});throw error;}
 finally{clearTimeout(timer!);}
}
export async function protectedAssetReadiness(manifest:ReleaseManifest,assets?:{fetch(request:Request):Promise<Response>},origin?:string){
 const expected=manifest.frontendAssets.filter(a=>releaseAssetAccess(a.path)==='protected');
 let protectedAssetsReady=false;
 try{
  if(manifest.frontendAssets.some(a=>a.access!==releaseAssetAccess(a.path)))throw Error('invalid_classification');
  if(expected.length&&(!assets||!origin||new URL(origin).origin!==origin||!origin.startsWith('https://')))throw Error('missing_binding');
  for(const asset of expected){
   // Fixed build-owned static files only. No caller paths, credentials or content are returned.
   if(!['tower-lord/console.js','tower-lord/console.css'].includes(asset.path))throw Error('unexpected_protected_asset');
   const bytes=await protectedAssetBytes(assets!,new URL('/'+asset.path,origin));
   const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   if(actual!==asset.sha256)throw Error('asset_mismatch');
  }
  protectedAssetsReady=true;
 }catch{/* Fail closed without exposing protected content or binding errors. */}
 return {protectedAssetsReady,protectedAssetsHash:protectedAssetsReady?await hashContract(expected):null};
}
export async function releaseReadiness(db:Database|undefined,manifest:ReleaseManifest,assets?:{fetch(request:Request):Promise<Response>},origin?:string){
 let schemaHash:string|null=null,schemaReady=false,migrationsReady=false;
 if(db)try{
  const rows=(await db.prepare(SCHEMA_QUERY).all<SchemaObject>()).results;
  schemaHash=await hashContract(canonicalSchema(rows));schemaReady=schemaHash===manifest.schemaHash;
  const applied=(await db.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{name:string}>()).results.map(r=>r.name).sort();
  migrationsReady=JSON.stringify(applied)===JSON.stringify(manifest.migrations.map(m=>m.name));
 }catch{/* Bound diagnostics never include database errors or resident records. */}
 const protectedAssets=await protectedAssetReadiness(manifest,assets,origin);
 return {...protectedAssets,version:manifest.version,sourceSHA:manifest.sourceSHA,sourceTreeHash:manifest.sourceTreeHash,buildHash:manifest.buildHash,rendererHash:manifest.rendererHash,frontendHash:manifest.frontendHash,migrationHash:manifest.migrationHash,expectedSchemaHash:manifest.schemaHash,schemaHash,schemaReady,migrationsReady,buildComplete:manifest.buildComplete,ready:manifest.buildComplete&&schemaReady&&migrationsReady&&protectedAssets.protectedAssetsReady};
}
