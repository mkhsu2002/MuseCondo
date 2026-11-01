import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {LocalDatabase} from '../server/live/local-db.ts';
import {MANAGER_ADMISSION_SCHEMA,managerAdmissionReady} from '../server/live/manager-admission.ts';

test('complete native admission schema compiles with the official D1 five-term compound SELECT limit',async()=>{
 const files=readdirSync(new URL('../migrations/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort();
 const migrations=files.map(file=>({file,sql:readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8')}));
 const result=spawnSync('python3',['-c',String.raw`
import json,sqlite3,sys
migrations=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)
assert db.getlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT)==5
for migration in migrations:
 try: db.executescript(migration['sql'])
 except Exception as error: raise RuntimeError(migration['file']) from error
# Force the same full-schema reparse used by independent D1-limit SQL checks.
restored=sqlite3.connect(':memory:')
restored.deserialize(db.serialize())
restored.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)
restored.execute('EXPLAIN SELECT name FROM sqlite_master').fetchall()
for view in ['tower_source_identities','tower_admission_native_alias','tower_admission_eligible']:
 restored.execute('EXPLAIN SELECT * FROM '+view).fetchall()
restored.execute('EXPLAIN INSERT INTO tower_reception_sources VALUES(?,?,?,?,?,?)',['synthetic','https://muse.ai/s/home-abc123/'+'A'*43,'muse-space:abc123','unavailable','synthetic','2026-11-01T00:00:00.000Z']).fetchall()
print(len(migrations))
`],{input:JSON.stringify(migrations),encoding:'utf8',maxBuffer:1000000});
 assert.equal(result.status,0,result.stderr);assert.equal(Number(result.stdout),migrations.length);
 const db=new LocalDatabase(':memory:');try{
  for(const migration of migrations)db.sqlite.exec(migration.sql);
  assert.equal(await managerAdmissionReady(db),true);
  const names=new Set(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view','trigger')").all().map(row=>String(row.name)));
  for(const name of MANAGER_ADMISSION_SCHEMA)assert(names.has(name),name);
 }finally{db.close();}
});
