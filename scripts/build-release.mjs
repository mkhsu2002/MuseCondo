/** Cloudflare build entry. Shares classification with Quality; never uploads an empty docs-only dist. */
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {BASELINE_PATH,classifyRange} from './change-scope.mjs';
import {currentComparison,executePlan,verificationCommands} from './verify-change.mjs';
export function releaseCommands(result){return result.scope==='docs'?[['npm',['run','build']]]:verificationCommands(result.scope,result.tests);}
export function ensureReleaseHistory(head){
 if(!/^[a-f0-9]{40}$/i.test(head))return;
 try{
  const parent=execFileSync('git',['rev-parse',`${head}^`],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  const receipt=JSON.parse(execFileSync('git',['show',`${parent}:${BASELINE_PATH}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
  execFileSync('git',['merge-base','--is-ancestor',receipt.sourceSHA,head],{stdio:'ignore'});return;
 }catch{/* Bounded history hydration only; missing/untrusted history still classifies full. */}
 try{execFileSync('git',['fetch','--no-tags','--depth=128','origin',head],{stdio:'ignore',timeout:30000});}catch{/* The shared classifier fails closed. */}
}
export async function buildRelease({run,env=process.env}={}){
 const initial=currentComparison();ensureReleaseHistory(initial.head);const comparison=currentComparison();const result=await classifyRange({...comparison,deployment:true});
 console.log(JSON.stringify({releaseScope:result.scope,reason:result.reason,effectiveBase:result.effectiveBase,tests:result.tests}));
 if(result.scope==='docs')console.log('Automatic docs builds are excluded by watch paths. This explicit build still produces a complete artifact.');
 if(result.scope==='presentation'){
  const status=executePlan([[process.execPath,['scripts/generate-lobby-css.mjs','--check']]],{run,env});if(status)return status;
 }
 return executePlan(releaseCommands(result),{run,env});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{process.exitCode=await buildRelease();}catch(e){console.error(e.message);process.exitCode=1;}}
