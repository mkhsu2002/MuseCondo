import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkTestTools,testTools,resolveTestPackages} from './check-test-tools.mjs';
import {verify} from './verify.mjs';
const cf={CF_PAGES:'1',MUSE_INSTALL_TEST_TOOLS:'1',PATH:'/usr/bin',LD_LIBRARY_PATH:'/existing/libraries'};
const simulation='Inst libpoppler126 [22.12.0-1] (22.12.0-2+deb12u1 Debian:12 [amd64])\nInst poppler-utils (22.12.0-2+deb12u1 Debian:12 [amd64])\nConf poppler-utils (22.12.0-2+deb12u1 Debian:12 [amd64])\n';
function runner({available=false,failStep='',recheckMissing=false,output=simulation,archiveMismatch=false}={}){
 const calls=[];let extracted=false;
 return {calls,run(command,args,options){
  calls.push({command,args,options});
  if(testTools.includes(command))return available||extracted&&!recheckMissing&&options.env.PATH.includes('muse-pdf-tools-')?{status:0}:{status:null,error:{code:'ENOENT'}};
  const step=command==='dpkg-deb'?'extract':args.includes('update')?'update':args.includes('-s')?'resolve':'download';
  if(step===failStep)return {status:100};
  if(step==='resolve')return {status:0,stdout:output};
  if(step==='download')for(const name of archiveMismatch?['poppler-utils']:['poppler-utils','libpoppler126'])writeFileSync(join(options.cwd,name+'.deb'),'synthetic archive');
  if(step==='extract'){const library=join(args[2],'usr/lib/x86_64-linux-gnu');mkdirSync(library,{recursive:true});writeFileSync(join(library,'libpoppler.so.126'),'synthetic library');extracted=true;}
  return {status:0};
 }};
}
function rootless(fake,options={}){return checkTestTools({env:cf,platform:'linux',username:'build',run:fake.run,...options});}
test('existing tools are probed without package managers or scratch writes',()=>{
 const fake=runner({available:true}),result=checkTestTools({env:cf,platform:'darwin',run:fake.run});assert.equal(result.installed,false);assert.equal(result.toolEnv,cf);result.cleanup();assert.deepEqual(fake.calls.map(call=>[call.command,call.args]),testTools.map(tool=>[tool,['-v']]));
});
test('missing tools fail early by default; macOS/local Linux/generic CI never bootstrap',()=>{
 const fake=runner();assert.throws(()=>checkTestTools({env:{CF_PAGES:'1'},platform:'linux',run:fake.run}),/pdftotext, pdffonts, pdftoppm.*MUSE_INSTALL_TEST_TOOLS=1/);
 for(const [platform,env] of [['darwin',cf],['linux',{MUSE_INSTALL_TEST_TOOLS:'1'}],['linux',{MUSE_INSTALL_TEST_TOOLS:'1',CI:'true'}]])assert.throws(()=>checkTestTools({platform,env,run:fake.run}),/Refusing automatic/);
 assert.equal(fake.calls.length,12);
});
test('resolver pins signed-index versions and refuses malformed, unbounded, removal and libc/loader plans',()=>{
 assert.deepEqual(resolveTestPackages(simulation),['libpoppler126=22.12.0-2+deb12u1','poppler-utils=22.12.0-2+deb12u1']);
 for(const output of ['',simulation+'Remv example [1]\n',simulation+'Inst libc6 (2.40 Debian [amd64])\n',simulation+'Inst libc-bin:amd64 (2.40 Debian [amd64])\n',simulation+'Inst unsafe broken\n',simulation+simulation])assert.throws(()=>resolveTestPackages(output));
});
test('rootless bootstrap uses private authenticated APT state, exact downloads, extraction and inherited tool paths',()=>{
 const fake=runner(),result=rootless(fake);const apt=fake.calls.filter(call=>call.command==='apt-get');
 try{
  assert.equal(result.installed,true);assert.equal(apt.length,3);assert(apt[0].args.includes('APT::Sandbox::User=build'));assert(apt[0].args.includes('APT::Get::AllowUnauthenticated=false'));assert(apt[0].args.includes('Acquire::AllowInsecureRepositories=false'));assert(apt.every(call=>call.options.env.LC_ALL==='C'&&call.options.timeout===240_000));
  const config=apt[0].args[1],scratch=apt[0].options.cwd;
  assert.equal(statSync(scratch).mode&0o777,0o700);assert.match(readFileSync(config,'utf8'),/#clear APT::Update::Post-Invoke;/);assert.match(readFileSync(config,'utf8'),/Dir::Cache::pkgcache ""/);
  for(const key of ['Dir::State::Lists=','Dir::Cache='])assert(apt[0].args.some(arg=>arg.startsWith(key+scratch+'/')));
  assert(apt[1].args.includes('-s'));assert(apt[1].args.includes('--reinstall'));assert.deepEqual(apt[2].args.slice(-3),['download','libpoppler126=22.12.0-2+deb12u1','poppler-utils=22.12.0-2+deb12u1']);
  assert.equal(fake.calls.filter(call=>call.command==='dpkg-deb').length,2);assert(fake.calls.every(call=>call.command!=='sudo'));
  assert(result.toolEnv.PATH.startsWith(scratch+'/prefix/usr/bin:'));assert(result.toolEnv.PATH.endsWith(':/usr/bin'));assert(result.toolEnv.LD_LIBRARY_PATH.includes('/prefix/usr/lib/x86_64-linux-gnu'));assert(result.toolEnv.LD_LIBRARY_PATH.endsWith(':/existing/libraries'));assert.equal(cf.PATH,'/usr/bin');
  assert.deepEqual(fake.calls.slice(-3).map(call=>call.command),testTools);result.cleanup();assert.equal(existsSync(scratch),false);
 }finally{result.cleanup();}
});
test('GitHub Actions uses the same rootless bootstrap, with no sudo branch',()=>{
 const fake=runner(),result=rootless(fake,{env:{...cf,CF_PAGES:undefined,GITHUB_ACTIONS:'true',CI:'true'}});try{assert(result.installed);assert(fake.calls.every(call=>call.command!=='sudo'));}finally{result.cleanup();}
});
test('every bootstrap failure cleans scratch and blocks partial or unauthenticated success',()=>{
 const parent=mkdtempSync(join(tmpdir(),'muse-bootstrap-test-'));
 try{
  for(const options of [{failStep:'update'},{failStep:'resolve'},{failStep:'download'},{failStep:'extract'},{recheckMissing:true},{archiveMismatch:true},{output:simulation+'Inst libc6 (2.40 Debian [amd64])\n'}]){
   assert.throws(()=>rootless(runner(options),{scratchRoot:parent}));assert.deepEqual(readdirSync(parent),[]);
  }
 }finally{rmSync(parent,{recursive:true,force:true});}
});
test('orchestrator propagates the private tool environment through all gates and always cleans up',()=>{
 for(const failure of ['', 'lint','spawn']){
  const calls=[];let cleanups=0;const toolEnv={PATH:'/synthetic/prefix/usr/bin:/usr/bin',LD_LIBRARY_PATH:'/synthetic/prefix/usr/lib'};
  const options={env:{initial:'yes'},prepare:({env})=>{assert.equal(env.initial,'yes');return {tools:testTools,toolEnv,cleanup:()=>{cleanups++;}};},run(command,args,opts){calls.push({command,args,opts});if(failure==='spawn')return {status:null,error:{code:'ENOENT'}};return {status:args[1]===failure?2:0};}};
  if(failure==='spawn')assert.throws(()=>verify(options),/could not start/);else assert.equal(verify(options),failure?2:0);
  assert.equal(cleanups,1);assert(calls.every(call=>call.opts.env===toolEnv));assert.deepEqual(calls.map(call=>call.args[1]),failure==='spawn'?['typecheck']:failure?['typecheck','lint']:['typecheck','lint','build','test:all']);
 }
});
