import {access,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const sources={SOUL:'SOUL.md',IDENTITY:'IDENTITY.md',AGENTS:'AGENTS.md',USER:'USER.md',TOOLS:'TOOLS.md',PROACTIVE_PREFERENCES:'PROACTIVE_PREFERENCES.md',ALIGNMENT_SYNTHESIS:'dreams/alignment/derived/ALIGNMENT_SYNTHESIS.md','custom-skills':'workspace/custom-skills','skills-config':'config/skills.yaml',goals:'workspace/goals'};
/** Metadata only: never reads source contents or crawls a directory. */
export async function inspectMuseSources(home){
 if(typeof home!=='string'||!home.trim())throw Error('An explicitly authorized Muse home is required');
 const root=await realpath(resolve(home));if(!(await stat(root)).isDirectory())throw Error('Muse home must be a directory');
 const results=[];
 for(const [source,relative] of Object.entries(sources)){
  let status='not-provided';
  try{const file=await realpath(resolve(root,relative));if(!file.startsWith(root+sep))status='outside-grant';else{await access(file,constants.R_OK);status='available';}}catch{/* Missing/unreadable sources never count as read. */}
  results.push({source,status});
 }
 return {frameworkVersion:'0.01',metadataOnly:true,sources:results};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.argv.length!==4||process.argv[2]!=='--home')throw Error('Usage: node scripts/muse-sources.mjs --home /authorized/muse/home');console.log(JSON.stringify(await inspectMuseSources(process.argv[3]),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
