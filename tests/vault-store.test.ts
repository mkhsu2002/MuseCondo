import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {VaultError,type VaultAccess} from '../server/live/vault-contract.ts';
import {createPrivateVaultStore} from '../server/live/vault-store.ts';
function fixture(){
 const db=new LocalDatabase(':memory:'),sqlite=db.sqlite;sqlite.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('a'),('b');CREATE TABLE authorization(active INTEGER CHECK(active=1));INSERT INTO authorization VALUES(1);");
 sqlite.exec(readFileSync(new URL('../migrations/0046_agent_private_vault.sql',import.meta.url),'utf8'));
 let at='2026-11-03T20:00:00.000Z',guards=0;
 const access:VaultAccess={accountId:'a',roomId:'r',residentId:'resident',agentId:'agent',grantId:'grant',guard:async()=>{guards++;return db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM authorization WHERE active=1) THEN 1 ELSE json('vault_access_revoked') END");}};
 const store=createPrivateVaultStore({db,key:'ab'.repeat(32),now:()=>new Date(at)});
 return {sqlite,db,access,store,at:(v:string)=>{at=v;},guards:()=>guards};
}
const input=(requestKey='request-0001',expectedRevision=0,content='private memory',path='MEMORY.md')=>({path,content,expectedRevision,requestKey});
test('vault encrypted current CRUD, tombstone/replay and export preserve exact bytes',async()=>{
 const f=fixture();try{
 const first=await f.store.put(f.access,input());assert.equal(first.revision,1);
 const raw=f.sqlite.prepare('SELECT * FROM agent_private_vault_documents').get()!;assert.ok(!JSON.stringify(raw).includes('private memory'));
 assert.equal((await f.store.get(f.access,'MEMORY.md')).content,'private memory');
 await f.store.remove(f.access,{path:'MEMORY.md',expectedRevision:1,requestKey:'request-delete'});
 assert.equal(f.sqlite.prepare('SELECT ciphertext FROM agent_private_vault_documents').get()!.ciphertext,null);
 assert.equal((await f.store.put(f.access,input())).replayed,true);
 await assert.rejects(f.store.get(f.access,'MEMORY.md'),{code:'vault_file_not_found'});
 assert.equal((await f.store.list(f.access)).documents[0].revision,2);
 await assert.rejects(f.store.put(f.access,input('request-stale',1)),{code:'vault_revision_conflict'});
 await f.store.put(f.access,input('request-recreate',2,'\uFEFF你好\r\n'));
 assert.equal((await f.store.export(f.access)).documents[0].content,'\uFEFF你好\r\n');
 await assert.rejects(f.store.put(f.access,input('request-0001',0,'different')),{code:'vault_request_conflict'});
 }finally{f.sqlite.close();}
});
test('vault strict paths/UTF8/64KiB and ten live skill quota, deletion frees slot',async()=>{
 const f=fixture();try{
 for(const path of ['../MEMORY.md','skills/A/SKILL.md','skills/a--b/SKILL.md','skills/a/b/SKILL.md','SOUL.md\0'])await assert.rejects(f.store.put(f.access,input('request-invalid',0,'x',path)),{code:'vault_invalid_path'});
 await assert.rejects(f.store.put(f.access,input('request-surrogate',0,'\ud800')),{code:'vault_invalid_content'});
 await f.store.put(f.access,input('request-maxbytes',0,'😀'.repeat(16384)));
 await assert.rejects(f.store.put(f.access,input('request-toobig',1,'😀'.repeat(16385))),{code:'vault_file_too_large'});
 for(let n=0;n<10;n++)await f.store.put(f.access,input(`request-skill-${n}`,0,'skill',`skills/s${n}/SKILL.md`));
 await assert.rejects(f.store.put(f.access,input('request-eleventh',0,'skill','skills/last/SKILL.md')),{code:'vault_skill_limit'});
 await f.store.remove(f.access,{path:'skills/s0/SKILL.md',expectedRevision:1,requestKey:'request-remove-skill'});
 await f.store.put(f.access,input('request-eleventh',0,'skill','skills/last/SKILL.md'));
 }finally{f.sqlite.close();}
});
test('vault guard protects read/write/replay/export and different account isolation',async()=>{
 const f=fixture();try{
 await f.store.put(f.access,input());assert.equal((await f.store.list({...f.access,accountId:'b'})).documents.length,0);
 await assert.rejects(f.store.get({...f.access,accountId:'b'},'MEMORY.md'),{code:'vault_file_not_found'});
 f.sqlite.exec('DELETE FROM authorization');
 for(const action of [()=>f.store.list(f.access),()=>f.store.get(f.access,'MEMORY.md'),()=>f.store.put(f.access,input()),()=>f.store.remove(f.access,{path:'MEMORY.md',expectedRevision:1,requestKey:'request-delete'}),()=>f.store.export(f.access)])await assert.rejects(action());
 assert.equal(f.sqlite.prepare('SELECT revision FROM agent_private_vault_documents').get()!.revision,1);assert.ok(f.guards()>=8);
 }finally{f.sqlite.close();}
});
test('vault 100 unique mutations/day, replay free, next UTC day resets',async()=>{
 const f=fixture();try{
 for(let n=0;n<100;n++)await f.store.put(f.access,input(`daily-request-${n}`,n,String(n)));
 assert.equal((await f.store.put(f.access,input('daily-request-99',99,'99'))).replayed,true);
 await assert.rejects(f.store.put(f.access,input('daily-request-100',100)),{code:'vault_daily_limit'});
 f.at('2026-11-04T00:00:00.000Z');await f.store.put(f.access,input('daily-request-100',100));
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM agent_private_vault_requests').get()!.n,101);
 }finally{f.sqlite.close();}
});
test('vault ciphertext authenticates account/path/revision and export fails as whole',async()=>{
 const f=fixture();try{
 await f.store.put(f.access,input());await f.store.put(f.access,input('request-soul',0,'soul','SOUL.md'));
 const other=createPrivateVaultStore({db:f.db,key:'cd'.repeat(32)});await assert.rejects(other.export(f.access),{code:'vault_decryption_failed'});
 // A valid envelope cannot be copied into another revision, even by storage corruption.
 const ciphertext=f.sqlite.prepare("SELECT ciphertext FROM agent_private_vault_documents WHERE path='MEMORY.md'").get()!.ciphertext;
 await f.db.batch([f.db.prepare("UPDATE agent_private_vault_documents SET revision=revision+1,ciphertext=? WHERE path='SOUL.md'").bind(ciphertext)]);
 await assert.rejects(f.store.export(f.access),{code:'vault_decryption_failed'});
 }finally{f.sqlite.close();}
});
test('vault concurrent CAS/idempotency creates exactly one mutation/receipt/audit',async()=>{
 const f=fixture();try{
 const results=await Promise.allSettled([f.store.put(f.access,input('request-race-a')),f.store.put(f.access,input('request-race-b'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const failed=results.find(r=>r.status==='rejected');assert.equal(failed?.status==='rejected'&&(failed.reason as {code:string}).code,'vault_revision_conflict');
 const same=await Promise.all([f.store.put(f.access,input('request-same',1,'second')),f.store.put(f.access,input('request-same',1,'second'))]);
 assert.equal(same.filter(r=>!r.replayed).length,1);assert.equal(same.filter(r=>r.replayed).length,1);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM agent_private_vault_requests').get()!.n,2);
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM agent_private_vault_audit').get()!.n,2);
 }finally{f.sqlite.close();}
});
test('vault transaction-time revocation after preflight prevents every persisted side effect',async()=>{
 const f=fixture();try{
 let calls=0;const access={...f.access,guard:async()=>{calls++;if(calls===3)f.sqlite.exec('DELETE FROM authorization');return f.access.guard();}};
 await assert.rejects(f.store.put(access,input()));
 for(const table of ['agent_private_vault_documents','agent_private_vault_requests','agent_private_vault_audit'])assert.equal(f.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,0);
 }finally{f.sqlite.close();}
});
test('vault SQL limits and permanent metadata resist replacement or deletion',async()=>{
 const f=fixture();try{
 await f.store.put(f.access,input());
 for(const table of ['agent_private_vault_documents','agent_private_vault_requests','agent_private_vault_audit']){
 assert.throws(()=>f.sqlite.exec(`DELETE FROM ${table}`));
 assert.throws(()=>f.sqlite.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`));
 }
 assert.throws(()=>f.sqlite.exec("UPDATE agent_private_vault_documents SET revision=revision"));
 assert.throws(()=>f.sqlite.exec("UPDATE agent_private_vault_requests SET input_hmac='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"));
 assert.throws(()=>f.sqlite.exec("UPDATE agent_private_vault_audit SET plaintext_bytes=0"));
 assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM agent_private_vault_audit').get()!.n,1);
 }finally{f.sqlite.close();}
});

test('vault failed native guard revalidates authority and preserves safe authorization errors',async()=>{
 const f=fixture();try{
 let calls=0;const access={...f.access,guard:async()=>{if(++calls>1)throw new VaultError(403,'vault_access_revoked');return f.db.prepare("SELECT json('sensitive-native-error')");}};
 await assert.rejects(f.store.list(access),{status:403,code:'vault_access_revoked',message:'vault_access_revoked'});
 assert.equal(calls,2);
 }finally{f.sqlite.close();}
});
