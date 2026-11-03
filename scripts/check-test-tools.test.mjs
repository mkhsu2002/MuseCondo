import test from 'node:test';
import assert from 'node:assert/strict';
import {checkTestTools,testTools} from './check-test-tools.mjs';
function runner({available=false,failStep='',recheckMissing=false}={}){
 const calls=[];let installed=false;
 return {calls,run(command,args,options){calls.push({command,args,options});if(testTools.includes(command))return (available||installed&&!recheckMissing)?{status:0}:{status:null,error:{code:'ENOENT'}};const step=args.includes('update')?'update':'install';if(step===failStep)return {status:100};if(step==='install')installed=true;return {status:0};}};
}
const cf={CF_PAGES:'1',MUSE_INSTALL_TEST_TOOLS:'1'};
test('existing real tools are verified without package-manager calls even when install is opted in',()=>{
 const fake=runner({available:true});assert.deepEqual(checkTestTools({env:cf,platform:'darwin',run:fake.run}),{installed:false,tools:testTools});assert.deepEqual(fake.calls.map(call=>[call.command,call.args]),testTools.map(tool=>[tool,['-v']]));
});
test('missing tools fail early by default without attempting installation',()=>{
 const fake=runner();assert.throws(()=>checkTestTools({env:{CF_PAGES:'1'},platform:'linux',run:fake.run}),/pdftotext, pdffonts, pdftoppm.*MUSE_INSTALL_TEST_TOOLS=1/);assert.equal(fake.calls.length,3);
});
test('installation is refused on local macOS, local Linux and unidentified generic CI',()=>{
 for(const [platform,env] of [['darwin',cf],['linux',{MUSE_INSTALL_TEST_TOOLS:'1'}],['linux',{MUSE_INSTALL_TEST_TOOLS:'1',CI:'true'}]]){const fake=runner();assert.throws(()=>checkTestTools({platform,env,uid:0,run:fake.run}),/Refusing automatic/);assert.equal(fake.calls.length,3);}
});
test('explicit Linux CF build installs via root apt-get and rechecks every actual tool',()=>{
 const fake=runner();assert.equal(checkTestTools({platform:'linux',env:cf,uid:0,run:fake.run}).installed,true);assert.deepEqual(fake.calls.slice(3,5).map(call=>[call.command,call.args]),[['apt-get',['update']],['apt-get',['install','--yes','--no-install-recommends','poppler-utils']]]);assert.equal(fake.calls[3].options.env.DEBIAN_FRONTEND,'noninteractive');assert.equal(fake.calls[3].options.timeout,240_000);assert.equal(fake.calls[0].options.timeout,5000);assert.deepEqual(fake.calls.slice(5).map(call=>call.command),testTools);
});
test('non-root GitHub Actions build requires noninteractive sudo rather than prompting',()=>{
 const fake=runner();checkTestTools({platform:'linux',env:{MUSE_INSTALL_TEST_TOOLS:'1',GITHUB_ACTIONS:'true',CI:'true'},uid:1001,run:fake.run});assert.deepEqual(fake.calls[3].args,['-n','apt-get','update']);assert.equal(fake.calls[3].command,'sudo');
});
test('update/install failures stop bootstrap immediately and never run tests or accept partial success',()=>{
 for(const failStep of ['update','install']){const fake=runner({failStep});assert.throws(()=>checkTestTools({platform:'linux',env:cf,uid:0,run:fake.run}),new RegExp('bootstrap failed during apt-get '+failStep));assert.equal(fake.calls.length,failStep==='update'?4:5);}
});
test('successful package-manager exit is insufficient when real executables still fail recheck',()=>{
 const fake=runner({recheckMissing:true});assert.throws(()=>checkTestTools({platform:'linux',env:cf,uid:0,run:fake.run}),/remain missing or unusable/);assert.equal(fake.calls.length,8);
});
