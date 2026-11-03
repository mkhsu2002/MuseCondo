import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hashContract} from '../server/live/release-contract.ts';
import * as generator from './release-manifest.mjs';
test('ensure restores a missing generated module while preserving the matching complete manifest',async()=>{
 const root=mkdtempSync(join(tmpdir(),'release-module-'));
 try{
  const manifest={version:1,sourceSHA:'a'.repeat(40),sourceTreeHash:'b'.repeat(64),buildComplete:true};manifest.buildHash=await hashContract(manifest);
  mkdirSync(join(root,'.release'));mkdirSync(join(root,'server/live'),{recursive:true});writeFileSync(join(root,'.release/manifest.json'),JSON.stringify(manifest)+'\n');
  assert.equal(typeof generator.recoverReleaseModule,'function','ensure must recover the module from a valid matching private manifest');
  assert.equal(await generator.recoverReleaseModule(root,manifest),true);
  assert.match(readFileSync(join(root,'server/live/generated-release.ts'),'utf8'),/"buildComplete":true/);
  assert.deepEqual(JSON.parse(readFileSync(join(root,'.release/manifest.json'),'utf8')),manifest);
  writeFileSync(join(root,'server/live/generated-release.ts'),'export const RELEASE_MANIFEST={stale:true};');
  assert.equal(await generator.recoverReleaseModule(root,manifest),true);assert.doesNotMatch(readFileSync(join(root,'server/live/generated-release.ts'),'utf8'),/stale/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('source identity records an unstaged tracked-file deletion without failing verification',()=>{
 const directory=mkdtempSync(join(tmpdir(),'release-deleted-source-'));
 try{
  execFileSync('git',['init','--quiet'],{cwd:directory});
  writeFileSync(join(directory,'maintained.txt'),'maintained release input');
  execFileSync('git',['add','maintained.txt'],{cwd:directory});
  execFileSync('git',['-c','user.name=Synthetic Test','-c','user.email=synthetic@example.invalid','commit','--quiet','-m','Synthetic release input'],{cwd:directory});
  const before=generator.sourceIdentity(directory);
  unlinkSync(join(directory,'maintained.txt'));
  let deleted;
  assert.doesNotThrow(()=>{deleted=generator.sourceIdentity(directory);},'unstaged tracked deletion must remain a valid working-tree identity');
  assert.equal(deleted.sourceSHA,before.sourceSHA);
  assert.notEqual(deleted.sourceTreeHash,before.sourceTreeHash,'deleted tracked bytes must change the source digest');
  assert.deepEqual(generator.sourceIdentity(directory),deleted,'the missing-file sentinel must be deterministic');
  execFileSync('git',['rm','--cached','--quiet','maintained.txt'],{cwd:directory});
  assert.notEqual(generator.sourceIdentity(directory).sourceTreeHash,deleted.sourceTreeHash,'the missing tracked path must be represented, not silently omitted');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
