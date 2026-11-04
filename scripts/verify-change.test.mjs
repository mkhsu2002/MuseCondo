import test from 'node:test';
import assert from 'node:assert/strict';
import {verificationCommands,executePlan} from './verify-change.mjs';
import {releaseCommands} from './build-release.mjs';
test('presentation executes only focused test files and a real build, never full/PDF/native tools',()=>{
 const c=verificationCommands('presentation',['tests/lobby-markup.test.ts']);assert.equal(c.length,2);assert(c[1][1].includes('tests/lobby-markup.test.ts'));assert(c[1][1].includes('--test-concurrency=2'));assert.deepEqual(c[0],['npm',['run','build']]);assert.doesNotMatch(JSON.stringify(c),/test:all|native|check-test-tools|verify"/);
});
test('docs do no CI work; explicit Cloudflare docs builds still produce dist',()=>{assert.deepEqual(verificationCommands('docs',[]),[]);assert.deepEqual(releaseCommands({scope:'docs',tests:[]}),[['npm',['run','build']]]);});
test('full and unknown scopes retain the existing complete verifier',()=>{for(const scope of ['full','unknown'])assert.deepEqual(verificationCommands(scope,[]),[['npm',['run','verify']]]);});
test('a failed build stops focused checks; no deployment success is fabricated',()=>{const calls=[];const result=executePlan(verificationCommands('presentation',['test.ts']),{run:(cmd,args)=>{calls.push([cmd,args]);return {status:1};}});assert.equal(result,1);assert.equal(calls.length,1);});
