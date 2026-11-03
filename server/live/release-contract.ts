import type {Database} from './db.ts';
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
export interface ReleaseManifest {version:1;sourceSHA:string;sourceTreeHash:string;schemaHash:string;schemaObjects:number;migrations:{name:string;sha256:string}[];migrationHash:string;rendererHash:string;frontendAssets:{path:string;sha256:string}[];frontendHash:string;buildComplete:boolean;buildHash:string}
export async function releaseReadiness(db:Database|undefined,manifest:ReleaseManifest){
 let schemaHash:string|null=null,schemaReady=false,migrationsReady=false;
 if(db)try{
  const rows=(await db.prepare(SCHEMA_QUERY).all<SchemaObject>()).results;
  schemaHash=await hashContract(canonicalSchema(rows));schemaReady=schemaHash===manifest.schemaHash;
  const applied=(await db.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{name:string}>()).results.map(r=>r.name).sort();
  migrationsReady=JSON.stringify(applied)===JSON.stringify(manifest.migrations.map(m=>m.name));
 }catch{/* Bound diagnostics never include database errors or resident records. */}
 return {version:manifest.version,sourceSHA:manifest.sourceSHA,sourceTreeHash:manifest.sourceTreeHash,buildHash:manifest.buildHash,rendererHash:manifest.rendererHash,frontendHash:manifest.frontendHash,migrationHash:manifest.migrationHash,expectedSchemaHash:manifest.schemaHash,schemaHash,schemaReady,migrationsReady,buildComplete:manifest.buildComplete,ready:manifest.buildComplete&&schemaReady&&migrationsReady};
}
