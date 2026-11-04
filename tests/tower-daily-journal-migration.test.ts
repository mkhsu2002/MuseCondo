import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

test('four-slot migration preserves three-item history, foreign keys, indexes and immutable audit',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')&&n<'0045').sort())db.exec(readFileSync('migrations/'+name,'utf8'));
  let clock='2026-11-03T16:00:00.000Z';db.function('strftime',{varargs:true},()=>clock);
  const old='[{"title":"First"}, {"title":"Second"}, {"title":"Third"}]';
  const job=(day:string)=>{clock=day+'T16:00:00.000Z';db.prepare('INSERT INTO tower_daily_journal_jobs VALUES(?,?,?,?,0,0)').run(day,clock,clock,'a'.repeat(64));};
  job('2026-11-03');db.prepare('INSERT INTO tower_daily_journal_editions VALUES(?,?)').run('2026-11-03',old);db.prepare("INSERT INTO tower_daily_journal_audit VALUES(?,'published',?,0)").run('2026-11-03',clock);
  const tables=['jobs','editions','audit'];const rows=()=>tables.map(name=>db.prepare('SELECT * FROM tower_daily_journal_'+name+' ORDER BY day').all());const before=rows();const indexes=()=>tables.map(name=>db.prepare('PRAGMA index_list(tower_daily_journal_'+name+')').all());const originalIndexes=indexes();
  const schema=()=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(r=>({...r,sql:r.name==='tower_daily_journal_editions'?String(r.sql).replace('<=3','<=4'):r.sql}));const originalSchema=schema();
  const migration=readdirSync('migrations').find(n=>n.startsWith('0045_'));assert.ok(migration,'an append-only migration must widen the stored edition contract');
  db.exec('BEGIN');try{db.exec(readFileSync('migrations/'+migration,'utf8'));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  assert.deepEqual(rows(),before,'history and audit are byte-for-byte retained');assert.equal(db.prepare('SELECT selection_json FROM tower_daily_journal_editions').get()!.selection_json,old);
  assert.deepEqual(indexes(),originalIndexes,'primary-key indexes survive rebuilding');
  assert.deepEqual(schema(),originalSchema,'only the edition array bound changes; original FK/trigger/index definitions remain');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_list(tower_daily_journal_editions)').all().map(r=>r.table),['tower_daily_journal_jobs']);assert.deepEqual(db.prepare('PRAGMA foreign_key_list(tower_daily_journal_audit)').all().map(r=>r.table),['tower_daily_journal_editions']);
  job('2026-11-04');db.prepare('INSERT INTO tower_daily_journal_editions VALUES(?,?)').run('2026-11-04',JSON.stringify([1,2,3,4]));db.prepare("INSERT INTO tower_daily_journal_audit VALUES(?,'published',?,0)").run('2026-11-04',clock);
  job('2026-11-05');assert.throws(()=>db.prepare('INSERT INTO tower_daily_journal_editions VALUES(?,?)').run('2026-11-05',JSON.stringify([1,2,3,4,5])),/CHECK/);
  assert.throws(()=>db.prepare("INSERT INTO tower_daily_journal_editions VALUES('2099-01-01','[]')").run(),/FOREIGN KEY/);
  assert.throws(()=>db.prepare("INSERT INTO tower_daily_journal_audit VALUES('2099-01-01','published','2099-01-01',0)").run(),/FOREIGN KEY/);
  for(const name of tables){const table='tower_daily_journal_'+name;assert.throws(()=>db.exec('UPDATE '+table+' SET day=day'),/daily_immutable/);assert.throws(()=>db.exec('DELETE FROM '+table),/daily_immutable/);assert.throws(()=>db.exec('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table));}
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
