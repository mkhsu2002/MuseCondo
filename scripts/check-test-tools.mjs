/** Real PDF verification requires Poppler; all bootstrap state stays private to this process. */
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const testTools=['pdftotext','pdffonts','pdftoppm'];
export function resolveTestPackages(output){
 if(/^Remv\s/m.test(output))throw Error('Rootless Poppler resolver proposed package removal');
 const lines=output.split('\n').filter(line=>line.startsWith('Inst '));
 const packages=lines.map(line=>{
  const match=line.match(/^Inst ([a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?) (?:\[[^\]]+\] )?\(([A-Za-z0-9.+:~_-]+)(?:\s|\))/);
  if(!match)throw Error('Rootless Poppler resolver returned an unsupported package record');
  const [,name,version]=match;
  if(/^(?:libc6(?:-.+)?|libc-bin|libc-dev-bin|ld-linux[^:]*)(?::|$)/.test(name))throw Error('Rootless Poppler bootstrap refuses a libc/loader replacement');
  return `${name}=${version}`;
 });
 if(!packages.length||packages.length>64||new Set(packages).size!==packages.length||!packages.some(pkg=>/^poppler-utils(?::[^=]+)?=/.test(pkg)))throw Error('Rootless Poppler resolver did not produce a bounded Poppler package set');
 return packages;
}
function libraryDirectories(prefix){
 const paths=[];
 function visit(directory,depth=0){
  let entries;try{entries=readdirSync(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(entries.some(entry=>/\.so(?:\.|$)/.test(entry.name)))paths.push(directory);
  if(depth<4)for(const entry of entries)if(entry.isDirectory())visit(join(directory,entry.name),depth+1);
 }
 visit(join(prefix,'usr/lib'));visit(join(prefix,'lib'));visit(join(prefix,'usr/lib64'));visit(join(prefix,'lib64'));
 return paths;
}
export function checkTestTools({env=process.env,platform=process.platform,username,run=spawnSync,scratchRoot=tmpdir()}={}){
 const probe=toolEnv=>testTools.filter(tool=>{const result=run(tool,['-v'],{env:toolEnv,stdio:'pipe',timeout:5000});return !!result.error||result.status!==0;});
 const missing=probe(env),noop=()=>{};
 if(!missing.length)return {installed:false,tools:[...testTools],toolEnv:env,cleanup:noop};
 const help='Install Poppler before verification, or explicitly set MUSE_INSTALL_TEST_TOOLS=1 in an identified Linux GitHub Actions or Cloudflare Pages build.';
 if(env.MUSE_INSTALL_TEST_TOOLS!=='1')throw Error(`Required PDF test tools are missing or unusable: ${missing.join(', ')}. ${help}`);
 const ephemeral=env.CF_PAGES==='1'||(env.GITHUB_ACTIONS==='true'&&['true','1'].includes(env.CI));
 if(platform!=='linux'||!ephemeral)throw Error(`Refusing automatic test-tool installation outside an identified Linux ephemeral build. ${help}`);
 const currentUser=username??userInfo().username;
 if(!/^[A-Za-z0-9_][A-Za-z0-9_.-]*\$?$/.test(currentUser))throw Error('Rootless Poppler bootstrap cannot identify a safe current user');
 const scratch=mkdtempSync(join(scratchRoot,'muse-pdf-tools-'));
 const cleanup=()=>rmSync(scratch,{recursive:true,force:true});
 try{
  const lists=join(scratch,'lists'),cache=join(scratch,'cache'),downloads=join(scratch,'downloads'),prefix=join(scratch,'prefix');
  for(const path of [join(lists,'partial'),join(cache,'archives/partial'),downloads,prefix])mkdirSync(path,{recursive:true,mode:0o700});
  const config=join(scratch,'apt.conf');
  writeFileSync(config,'#clear APT::Update::Pre-Invoke;\n#clear APT::Update::Post-Invoke;\n#clear APT::Update::Post-Invoke-Success;\nDir::Cache::pkgcache "";\nDir::Cache::srcpkgcache "";\n',{mode:0o600});
  const aptOptions=['-c',config,'-o',`Dir::State::Lists=${lists}`,'-o',`Dir::Cache=${cache}`,'-o','Debug::NoLocking=1','-o',`APT::Sandbox::User=${currentUser}`,'-o','APT::Get::AllowUnauthenticated=false','-o','Acquire::AllowInsecureRepositories=false','-o','Acquire::AllowDowngradeToInsecureRepositories=false'];
  const aptEnv={...env,LC_ALL:'C',DEBIAN_FRONTEND:'noninteractive'};
  function execute(command,args,{capture=false,cwd=scratch}={}){
   const result=run(command,args,{env:aptEnv,cwd,stdio:capture?'pipe':'inherit',encoding:'utf8',timeout:240_000,maxBuffer:8*1024*1024});
   if(result.error||result.status!==0)throw Error(`Rootless Poppler bootstrap failed: ${command} (exit ${result.status??'unavailable'}${result.error?.code?`, ${result.error.code}`:''}). Build verification is blocked.`);
   return result.stdout??'';
  }
  execute('apt-get',[...aptOptions,'update']);
  const packages=resolveTestPackages(execute('apt-get',[...aptOptions,'-s','--reinstall','--no-install-recommends','install','poppler-utils'],{capture:true}));
  execute('apt-get',[...aptOptions,'download',...packages],{cwd:downloads});
  const archives=readdirSync(downloads,{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name.endsWith('.deb'));
  if(archives.length!==packages.length)throw Error('Rootless Poppler download archive count mismatch');
  for(const archive of archives)execute('dpkg-deb',['-x',join(downloads,archive.name),prefix]);
  const libraries=libraryDirectories(prefix);
  const toolEnv={...env,PATH:[join(prefix,'usr/bin'),join(prefix,'bin'),env.PATH].filter(Boolean).join(':'),LD_LIBRARY_PATH:[...libraries,env.LD_LIBRARY_PATH].filter(Boolean).join(':')};
  const remaining=probe(toolEnv);
  if(remaining.length)throw Error(`Rootless Poppler extraction completed but tools remain missing or unusable: ${remaining.join(', ')}. Verification is blocked.`);
  return {installed:true,tools:[...testTools],toolEnv,cleanup};
 }catch(error){cleanup();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let tools;
 try{tools=checkTestTools();console.log(`PASS PDF test tools: ${tools.tools.join(', ')}${tools.installed?' (private rootless extraction verified)':''}`);}
 catch(error){console.error(error.message);process.exitCode=1;}
 finally{tools?.cleanup();}
}
