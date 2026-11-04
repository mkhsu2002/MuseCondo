import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalDatabase} from '../server/live/local-db.ts';
test('local D1 batch returns SELECT rows and rolls back mutation when a following authorization guard fails',async()=>{
 const db=new LocalDatabase(':memory:');
 try{
  db.sqlite.exec('CREATE TABLE documents(id TEXT PRIMARY KEY,value TEXT)');
  const rows=await db.batch([db.prepare('INSERT INTO documents VALUES(?,?)').bind('one','private'),db.prepare('SELECT value FROM documents WHERE id=?').bind('one')]);assert.equal(rows[1].results.length,1);assert.equal(rows[1].results[0].value,'private');assert.equal(rows[0].meta.changes,1);
  await assert.rejects(db.batch([db.prepare('UPDATE documents SET value=?').bind('changed'),db.prepare("SELECT json('auth-revoked')")]));assert.equal((await db.prepare('SELECT value FROM documents').first<{value:string}>())?.value,'private');
 }finally{db.close();}
});
