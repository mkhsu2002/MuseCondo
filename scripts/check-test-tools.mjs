/** Real PDF verification requires Poppler; never skip or replace its checks. */
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
export const testTools=['pdftotext','pdffonts','pdftoppm'];
export function checkTestTools({env=process.env,platform=process.platform,uid=process.getuid?.(),run=spawnSync}={}){
 const probe=()=>testTools.filter(tool=>{const result=run(tool,['-v'],{env,stdio:'pipe',timeout:5000});return !!result.error||result.status!==0;});
 const missing=probe();
 if(!missing.length)return {installed:false,tools:[...testTools]};
 const help='Install poppler-utils (Linux) or Poppler (macOS) before verification. Automatic installation requires MUSE_INSTALL_TEST_TOOLS=1 in an identified Linux GitHub Actions or Cloudflare Pages build.';
 if(env.MUSE_INSTALL_TEST_TOOLS!=='1')throw Error(`Required PDF test tools are missing or unusable: ${missing.join(', ')}. ${help}`);
 const ephemeral=env.CF_PAGES==='1'||(env.GITHUB_ACTIONS==='true'&&['true','1'].includes(env.CI));
 if(platform!=='linux'||!ephemeral)throw Error(`Refusing automatic test-tool installation outside an identified Linux ephemeral build. ${help}`);
 const command=uid===0?'apt-get':'sudo';
 const prefix=uid===0?[]:['-n','apt-get'];
 for(const args of [['update'],['install','--yes','--no-install-recommends','poppler-utils']]){
  const result=run(command,[...prefix,...args],{env:{...env,DEBIAN_FRONTEND:'noninteractive'},stdio:'inherit',timeout:240_000});
  if(result.error||result.status!==0)throw Error(`Poppler bootstrap failed during apt-get ${args[0]} (exit ${result.status??'unavailable'}${result.error?.code?`, ${result.error.code}`:''}). The build requires working root apt-get or passwordless sudo; platform support must be verified by an actual build.`);
 }
 const remaining=probe();
 if(remaining.length)throw Error(`Poppler bootstrap completed but required tools remain missing or unusable: ${remaining.join(', ')}. Verification is blocked.`);
 return {installed:true,tools:[...testTools]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=checkTestTools();console.log(`PASS PDF test tools: ${result.tools.join(', ')}${result.installed?' (installed and rechecked)':''}`);}
 catch(error){console.error(error.message);process.exitCode=1;}
}
