import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverTests} from './test-discovery.mjs';

test('default test discovery includes every supported test file and excludes browser specs and native opt-in scripts',()=>{
 const root=mkdtempSync(join(tmpdir(),'muse-tests-'));
 try{
  const expected=['scripts/check.test.mjs','tests/a.test.ts','tests/nested/new.test.mjs'];
  for(const file of [...expected,'tests/browser.spec.ts','tests/helper.ts','scripts/test-native.mjs','scripts/ignored.test.ts']){
   mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'');
  }
  assert.deepEqual(discoverTests(root),expected);
  writeFileSync(join(root,'tests/newly-added.test.ts'),'');
  assert.deepEqual(discoverTests(root),[...expected,'tests/newly-added.test.ts'].sort());
 }finally{rmSync(root,{recursive:true,force:true});}
});
