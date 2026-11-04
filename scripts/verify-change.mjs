import {spawnSync,execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {classifyRange} from './change-scope.mjs';
export function verificationCommands(scope,tests){
 if(scope==='docs')return [];
 if(scope==='presentation')return [['npm',['run','build']],[process.execPath,['--test','--test-concurrency=2',...tests]]];
 return [['npm',['run','verify']]];
}
export function executePlan(commands,{run=spawnSync,env=process.env}={}){
 for(const [command,args] of commands){const r=run(command,args,{env,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)return r.status??1;}return 0;
}
export async function verifyChange({base,head,root=process.cwd(),run,env=process.env}={}){
 const result=await classifyRange({root,base,head});console.log(JSON.stringify({verificationScope:result.scope,reason:result.reason,effectiveBase:result.effectiveBase,tests:result.tests}));
 if(result.scope==='presentation'){
  // The private renderer must be generated before focused source/digest checks.
  const r=(run??spawnSync)(process.execPath,['scripts/generate-lobby-css.mjs','--check'],{env,stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)return r.status??1;
 }
 return executePlan(verificationCommands(result.scope,result.tests),{run,env});
}
export function currentComparison(){
 const head=process.env.CF_PAGES_COMMIT_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();let base;
 try{base=execFileSync('git',['rev-parse',`${head}^`],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{base='0'.repeat(40);}
 return {base,head};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),get=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined;};const defaults=currentComparison();
 try{process.exitCode=await verifyChange({base:get('--base')??defaults.base,head:get('--head')??defaults.head});}catch(e){console.error(e.message);process.exitCode=1;}
}
