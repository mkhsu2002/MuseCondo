import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LocalDatabase} from '../server/live/local-db.ts';
import {createTowerAppearance, HALLOWEEN_2026} from '../server/live/tower-appearance.ts';
const preview={action:'preview',requestKey:'preview-key-001',theme:'halloween',...HALLOWEEN_2026};
function fixture(){const db=new LocalDatabase(':memory:');db.sqlite.exec(readFileSync(new URL('../migrations/0023_tower_manager_operations.sql',import.meta.url),'utf8'));let time='2026-10-31T20:00:00.000Z';return {db,core:createTowerAppearance(db,()=>new Date(time)),at(t:string){time=t;}};}
test('preview is private, safe-token only; activate references immutable preview and retries keep original receipt',async()=>{
 const f=fixture();try{assert.equal((await f.core.publicState()).theme,'standard');const p=await f.core.command(preview,'operator');assert.equal(p.action,'preview');assert.equal((await f.core.publicState()).theme,'standard');
 const input={action:'activate',requestKey:'activate-key-001',previewKey:preview.requestKey,expectedRevision:0};const a=await f.core.command(input,'operator');assert.equal(a.revision,1);assert.equal((await f.core.publicState()).theme,'halloween');assert.deepEqual(await f.core.command(input,'operator'),a);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM tower_appearance_audit').get()!.n,2);
 await assert.rejects(f.core.command({...input,expectedRevision:1},'operator'),/request_key_conflict/);await assert.rejects(f.core.command({...preview,requestKey:'unsafe-preview-01',css:'body{display:none}'},'operator'),/invalid_command/);
 for(const theme of ['url(https://x)','<script>','christmas'])await assert.rejects(f.core.command({...preview,requestKey:'unsafe-preview-02',theme},'operator'),/invalid_theme/);
 assert.throws(()=>f.db.sqlite.exec("UPDATE tower_appearance_audit SET actor='other'"),/immutable/);assert.throws(()=>f.db.sqlite.exec('DELETE FROM tower_appearance_audit'),/immutable/);
 }finally{f.db.close();}
});
test('CAS has one winner, stale attempts never write receipt; rollback and expiry preserve audit history',async()=>{
 const f=fixture();try{await f.core.command(preview,'operator');const results=await Promise.allSettled(['activate-key-001','activate-key-002'].map(requestKey=>f.core.command({action:'activate',requestKey,previewKey:preview.requestKey,expectedRevision:0},'operator')));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await f.core.publicState()).revision,1);
 const standard=await f.core.command({action:'preview',requestKey:'standard-preview-1',theme:'standard'},'operator');assert.equal(standard.theme,'standard');await f.core.command({action:'activate',requestKey:'standard-activate-1',previewKey:'standard-preview-1',expectedRevision:1},'operator');
 await f.core.command({action:'rollback',requestKey:'rollback-key-001',targetRevision:1,expectedRevision:2},'operator');assert.equal((await f.core.publicState()).theme,'halloween');f.at('2026-11-01T07:00:00.000Z');assert.equal((await f.core.publicState()).theme,'standard');assert.equal(await f.core.expire(),true);assert.equal(await f.core.expire(),false);assert.equal((await f.core.publicState()).revision,4);
 await assert.rejects(f.core.command({action:'rollback',requestKey:'rollback-key-002',targetRevision:1,expectedRevision:4},'operator'),/expired_theme/);
 }finally{f.db.close();}
});
test('window is half-open and validates calendar timezone, durations and forged fields',async()=>{
 const f=fixture();try{await assert.rejects(f.core.command({...preview,requestKey:'bad-timezone-001',timezone:'UTC'},'operator'),/invalid_window/);await assert.rejects(f.core.command({...preview,requestKey:'bad-window-001',endsAt:'2027-01-01T00:00:00.000Z'},'operator'),/invalid_window/);await f.core.command(preview,'operator');await f.core.command({action:'activate',requestKey:'activate-key-001',previewKey:preview.requestKey,expectedRevision:0},'operator');f.at('2026-10-31T06:59:59.999Z');assert.equal((await f.core.publicState()).theme,'standard');f.at('2026-10-31T07:00:00.000Z');assert.equal((await f.core.publicState()).theme,'halloween');
 }finally{f.db.close();}
});
