import './check-node.mjs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {checkTestTools} from './check-test-tools.mjs';
/** Keep private tool paths alive for every verification child, then remove them. */
export function verify({env=process.env,prepare=checkTestTools,run=spawnSync}={}){
 const tools=prepare({env});
 try{
  console.log('PASS PDF test tools: '+tools.tools.join(', '));
  for(const script of ['typecheck','lint','build','test:all']){
   const result=run(process.platform==='win32'?'npm.cmd':'npm',['run',script],{env:tools.toolEnv,stdio:'inherit'});
   if(result.error)throw Error(`Verification ${script} could not start (${result.error.code??'unknown error'})`);
   if(result.status!==0)return result.status??1;
  }
  return 0;
 }finally{tools.cleanup();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{process.exitCode=verify();}catch(error){console.error(error.message);process.exitCode=1;}
}
