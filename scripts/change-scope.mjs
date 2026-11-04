import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const BASELINE_PATH='docs/releases/production-baseline.json';
const css=new Set(['src/live.css','src/live/tower-welcome.css','src/style.css','src/project.css','src/history.css','src/perspectives.css']);
const html=new Set(['index.html','project/index.html','tower-history/index.html',...['index','chatgpt','muse','gemini','grok','claude'].map(name=>'project/perspectives/'+(name==='index'?'':name+'/')+'index.html')]);
const rasterAsset=/^public\/(media|og)\/[^/]+\.(webp|png|jpe?g|avif)$/i;
const views=new Set(['src/shared/lobby-markup.ts','src/shared/community-resources.ts','src/shared/home-directory.ts','src/shared/tower-weekly-markup.ts','src/shared/tower-journals-markup.ts']);
export const PRESENTATION_TESTS=['scripts/check-image-assets.test.mjs','scripts/readme.test.mjs','scripts/social-preview.test.mjs','tests/build-output.test.mjs','tests/static-routing.test.mjs','tests/community-home-layout.test.ts','tests/community-documents.test.ts','tests/lobby-markup.test.ts','tests/lobby-language.test.ts','tests/home-directory.test.ts','tests/framework-default-language.test.ts','tests/project-page.test.ts','tests/route-policy.test.ts','tests/tower-video.test.ts','tests/tower-theme-renderer.test.ts','tests/tower-journals-markup.test.ts'];
export function isDocumentation(path){return path===BASELINE_PATH||path==='VERSION'||(!path.includes('/')&&/\.(md|mdx|rst|txt|bk)$/i.test(path)&&!['ASSET-LICENSE.md'].includes(path))||/^(docs|audit|audits|tracker|handoff|outputs)\/.*\.(md|mdx|rst|txt|bk)$/i.test(path);}
const sha=s=>typeof s==='string'&&/^[a-f0-9]{40}$/i.test(s)&&!/^0+$/.test(s);
export function selectBase({eventBase,head,receipt,isAncestor}){
 if(!sha(eventBase)||!sha(head)||!sha(receipt?.sourceSHA)||receipt?.version!==1||receipt?.environment!=='production'||!(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(receipt?.deploymentId??''))||!Number.isFinite(Date.parse(receipt?.verifiedAt??''))||!isAncestor(eventBase,head)||!isAncestor(receipt.sourceSHA,eventBase)||!isAncestor(receipt.sourceSHA,head))return null;
 return receipt.sourceSHA;
}
export async function classifyEntries(entries,{assetExists=()=>false}={}){
 if(!entries.length||entries.every(e=>isDocumentation(e.path)&&(!e.oldPath||isDocumentation(e.oldPath))))return {scope:'docs',reason:'Only documentation or operational release records changed.',tests:[]};
 let renderer=false,presentation=false;const {modulePresentation,staticPresentation,cssPresentation}=await import('./presentation-scope.mjs');
 for(const e of entries){
  if(isDocumentation(e.path))continue;
  if(e.oldPath||!['M','A'].includes(e.status)&&!(e.status==='D'&&rasterAsset.test(e.path)))return {scope:'full',reason:'Protected deletion, rename or unknown change status requires full verification.',tests:[]};
  if(e.path==='src/shared/lobby-base-css.ts'){renderer=true;continue;}
  let safe=false;
  if(css.has(e.path))safe=cssPresentation(e.before??'',e.after??'');
  else if(html.has(e.path))safe=e.status==='M'&&staticPresentation(e.before??'',e.after??'',{assetExists});
  else if(e.path==='ASSET-LICENSE.md')safe=true;
  else if(views.has(e.path))safe=modulePresentation(e.before??'',e.after??'');
  else if(e.path==='src/shared/lobby-messages.ts')safe=modulePresentation(e.before??'',e.after??'',true);
  else if(e.path==='scripts/social-preview.mjs')safe=modulePresentation(e.before??'',e.after??'',false,true);
  else if(rasterAsset.test(e.path))safe=true;
  else if(PRESENTATION_TESTS.includes(e.path))safe=true;
  if(!safe)return {scope:'full',reason:`Executable, protected, dependency, policy or unknown change: ${e.path}`,tests:[]};
  presentation=true;
 }
 if(renderer&&!presentation)return {scope:'full',reason:'Renderer identity changed without a verified presentation source.',tests:[]};
 return {scope:'presentation',reason:'Only approved public copy/layout changed; executable expressions, behavior and protected sources are unchanged.',tests:PRESENTATION_TESTS};
}
function git(root,args){return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:20*1024*1024}).trimEnd();}
function changes(root,base,head){
 const chunks=git(root,['diff','--name-status','--no-renames','-z',base,head]).split('\0');const out=[];
 for(let i=0;i<chunks.length&&chunks[i];i+=2){const status=chunks[i],path=chunks[i+1];if(!path)throw Error('invalid_git_diff');out.push({status,path});}return out;
}
export async function classifyRange({root=process.cwd(),base,head,docsOnly=false,deployment=false}={}){
 const full=reason=>({scope:'full',reason,tests:[],base,head,effectiveBase:null});
 try{
  if(!sha(base)||!sha(head))return full('Missing authoritative commits; fail closed.');
  git(root,['cat-file','-e',`${base}^{commit}`]);git(root,['cat-file','-e',`${head}^{commit}`]);
  const eventChanges=changes(root,base,head);
  if(!deployment&&eventChanges.every(e=>isDocumentation(e.path)))return {scope:'docs',reason:'This event changes documentation only; do not build or deploy.',tests:[],base,head,effectiveBase:base};
  if(docsOnly)return full('Executable changes require installed structural analysis.');
  let receipt;try{receipt=JSON.parse(git(root,['show',`${base}:${BASELINE_PATH}`]));}catch{return full('Missing or unreadable verified production baseline.');}
  const effectiveBase=selectBase({eventBase:base,head,receipt,isAncestor:(a,b)=>{try{git(root,['merge-base','--is-ancestor',a,b]);return true;}catch{return false;}}});
  if(!effectiveBase)return full('Production baseline or commit history cannot be verified.');
  const entries=changes(root,effectiveBase,head).map(e=>({...e,get before(){return e.status==='A'?'':git(root,['show',`${effectiveBase}:${e.path}`]);},get after(){return e.status==='D'?'':git(root,['show',`${head}:${e.path}`]);}}));
  const assetExists=path=>{try{return git(root,['cat-file','-t',`${head}:public${path}`])==='blob';}catch{return false;}};
  return {...await classifyEntries(entries,{assetExists}),base,head,effectiveBase};
 }catch{return full('Change classification failed or history is incomplete; full verification required.');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
 const result=await classifyRange({base:value('--base'),head:value('--head'),docsOnly:args.includes('--docs-only')});
 if(args.includes('--github-output'))appendFileSync(value('--github-output'),`scope=${result.scope}\nreason=${result.reason.replace(/[\r\n]/g,' ')}\ntests_json=${JSON.stringify(result.tests)}\n`);
 console.log(JSON.stringify({...result,tests_json:JSON.stringify(result.tests)}));
}
