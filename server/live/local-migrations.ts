/** Local-only migration adoption. Never resets, drops, or connects to hosted data. */
import {DatabaseSync} from 'node:sqlite';
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
export interface LocalMigration {name:string;sql:string;hash:string}
export async function readLocalMigrations(directory=resolve('migrations')):Promise<LocalMigration[]>{
 const names=(await readdir(directory)).filter(name=>/^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
 if(!names.length||new Set(names.map(name=>name.slice(0,4))).size!==names.length)throw Error('local_migration_order_invalid');
 return Promise.all(names.map(async name=>{const sql=await readFile(resolve(directory,name),'utf8');return {name,sql,hash:createHash('sha256').update(sql).digest('hex')};}));
}
function schema(db:DatabaseSync){
 return JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name<>'local_migrations' ORDER BY type,name").all());
}
export function applyLocalMigrations(db:DatabaseSync,migrations:LocalMigration[]){
 if(migrations.some((m,i)=>i>0&&m.name<=migrations[i-1].name))throw Error('local_migration_order_invalid');
 const replay=new DatabaseSync(':memory:');const schemas:string[]=[];
 try{schemas.push(schema(replay));for(const migration of migrations){replay.exec(migration.sql);schemas.push(schema(replay));}}finally{replay.close();}
 db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
 try{
  const hasLedger=!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='local_migrations'").get();
  let prefix=0,adopted=0;
  if(hasLedger){
   const rows=db.prepare('SELECT name,sha256 FROM local_migrations ORDER BY name').all();
   if(rows.length>migrations.length||rows.some((row,i)=>row.name!==migrations[i].name||row.sha256!==migrations[i].hash))throw Error('local_migration_hash_mismatch');
   prefix=rows.length;if(schema(db)!==schemas[prefix])throw Error('local_migration_schema_drift');
  }else{
   const actual=schema(db),matches=schemas.flatMap((value,i)=>value===actual?[i]:[]);
   if(matches.length!==1)throw Error(matches.length?'local_migration_schema_ambiguous':'local_migration_schema_unknown');
   prefix=matches[0];adopted=prefix;
   db.exec('CREATE TABLE local_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)');
   const insert=db.prepare('INSERT INTO local_migrations VALUES(?,?,?)');
   for(const migration of migrations.slice(0,prefix))insert.run(migration.name,migration.hash,new Date().toISOString());
  }
  const insert=db.prepare('INSERT INTO local_migrations VALUES(?,?,?)');
  for(const migration of migrations.slice(prefix)){db.exec(migration.sql);insert.run(migration.name,migration.hash,new Date().toISOString());}
  if(schema(db)!==schemas[migrations.length])throw Error('local_migration_schema_drift');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('local_migration_foreign_key_violation');
  db.exec('COMMIT');return {adopted,applied:migrations.length-prefix,total:migrations.length};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
