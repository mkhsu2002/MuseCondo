import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readLocalMigrations,applyLocalMigrations} from '../server/live/local-migrations.ts';
test('fresh local database applies every ordered migration and hash ledger idempotently',async()=>{
 const migrations=await readLocalMigrations();const db=new DatabaseSync(':memory:');
 try{assert.equal(migrations.length,40);assert.equal(applyLocalMigrations(db,migrations).applied,40);assert.equal(applyLocalMigrations(db,migrations).applied,0);assert.equal(db.prepare('SELECT count(*) AS n FROM local_migrations').get()!.n,40);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
});
test('legacy exact prefix is adopted without losing existing data; drift and ambiguous schemas fail closed',async()=>{
 const migrations=await readLocalMigrations();const db=new DatabaseSync(':memory:');
 try{for(const migration of migrations.slice(0,33))db.exec(migration.sql);db.exec("INSERT INTO accounts(id,login_hash,created_at) VALUES('synthetic-local-account','synthetic-hash','2026-11-03T00:00:00.000Z'); CREATE TABLE unrecognized(data TEXT)");assert.throws(()=>applyLocalMigrations(db,migrations),/schema/);assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='local_migrations'").get()!.n,0);db.exec('DROP TABLE unrecognized');const result=applyLocalMigrations(db,migrations);assert.equal(result.adopted,33);assert.equal(result.applied,7);assert.equal(db.prepare("SELECT login_hash FROM accounts WHERE id='synthetic-local-account'").get()!.login_hash,'synthetic-hash');const changed=migrations.map((m,i)=>i===0?{...m,hash:'f'.repeat(64)}:m);assert.throws(()=>applyLocalMigrations(db,changed),/hash/);}finally{db.close();}
 const duplicate=new DatabaseSync(':memory:');try{assert.throws(()=>applyLocalMigrations(duplicate,[{name:'0001.sql',sql:'SELECT 1;',hash:'a'}]),/ambiguous/);}finally{duplicate.close();}
});
test('failed migration rolls back both schema changes and ledger rows',async()=>{
 const db=new DatabaseSync(':memory:');try{assert.throws(()=>applyLocalMigrations(db,[{name:'0001.sql',sql:'CREATE TABLE sample(id INTEGER);',hash:'a'},{name:'0002.sql',sql:'CREATE TABLE broken(',hash:'b'}]));assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name IN ('sample','local_migrations')").get()!.n,0);}finally{db.close();}
});

test('a migration failing on retained data rolls back schema and ledger adoption together',()=>{
 const db=new DatabaseSync(':memory:');
 const migrations=[{name:'0001.sql',sql:'CREATE TABLE sample(value TEXT UNIQUE);',hash:'a'},{name:'0002.sql',sql:"CREATE TABLE next_step(id INTEGER); INSERT INTO sample VALUES('retained');",hash:'b'}];
 try{db.exec(migrations[0].sql);db.exec("INSERT INTO sample VALUES('retained')");assert.throws(()=>applyLocalMigrations(db,migrations),/UNIQUE/);assert.equal(db.prepare('SELECT value FROM sample').get()!.value,'retained');assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name IN ('next_step','local_migrations')").get()!.n,0);}finally{db.close();}
});
