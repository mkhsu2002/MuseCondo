import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// This is a maintained output inventory, not a ban on Chinese input or records.
// Resident-authored imports, immutable community editions/asset provenance and
// historical operational evidence keep their original language. README.zh-TW.md
// is the maintained translation. Privacy/security regular expressions are input
// detectors, not interface copy, and must continue to recognize Chinese input.
// server/framework/legacy-condo-render.ts is frozen historical compatibility,
// deliberately outside this inventory; it must never become the default renderer.
// The two original main.ts route identifiers are compatibility tokens, not copy.
const sources = [
 'src/main.ts','src/live.ts','src/artwork.ts','src/residents.ts','src/interactions.ts',
 'src/community/client.ts','src/community/rules.ts',
 'src/live/framework-ui.ts','src/live/onboarding-grants.ts','src/live/tower-panel.ts',
 'src/shared/lobby-messages.ts','src/shared/lobby-markup.ts','src/shared/tower-scenes.ts',
 'src/framework/condo.ts','src/framework/render.ts','src/framework/condo-render.ts',
 'src/framework/validation.ts','src/framework/projection.ts','src/framework/routes.ts',
 'server/onboarding.ts','server/meta.ts','server/community.ts',
 'server/framework/standalone.ts','server/framework/condo-build.ts','server/framework/condo-verify.ts',
 'server/live/app.ts','server/live/identity-mail-envelope.ts','server/live/identity-webauthn.ts',
 'server/live/identity-recovery.ts','server/live/tower-manager.ts','server/live/tower-intake.ts',
 'server/live/tower-activities.ts','server/live/tower-visits.ts','server/live/tower-autonomy.ts',
 'workers/identity-card/render.ts',
 'scripts/build-home.ts','scripts/build-condo.ts','scripts/verify-condo.ts',
 'public/reception.js','public/activities.js','public/tower-visits.js',
 'public/identity.js','public/identity-recovery.js','public/identity-verify.js',
];
const documents = [
 'index.html','public/reception.html','public/activities.html','public/tower-visits.html',
 'public/identity.html','public/identity-recovery.html','public/identity-verify.html',
 'public/examples/muse-condo/index.html','public/examples/muse-condo/inside.html',
 'public/examples/muse-condo/dreams.html',
];
const contracts = [
 'public/agent-onboarding.json','public/reception-onboarding.json',
 'public/tower-onboarding.json','public/activities-onboarding.json',
 'public/identity-onboarding.json','public/openapi-agent.json',
 'templates/muse-condo-1/input.template.json','fixtures/condo/example.json','fixtures/framework/safe-seed.json',
 'public/examples/muse-condo/condo.json',
];
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const hasHan = value => /\p{Script=Han}/u.test(value);
const curatedNames=['茉茉','阿芽','布丁','小訊','眠眠','路路','啾啾','圓圓','墨墨','點點','朵晴','苔光'];
const namedDefaults=new Set(['src/residents.ts','src/artwork.ts','src/main.ts','fixtures/condo/example.json','fixtures/framework/safe-seed.json','public/examples/muse-condo/condo.json',...documents.filter(path=>path.startsWith('public/examples/'))]);
const defaultText=(path,value)=>path==='public/reception.html'?value.replace(/<details class="agent-entry" lang="zh-TW">[\s\S]*?<\/details>/g,''):namedDefaults.has(path)?curatedNames.reduce((text,name)=>text.replaceAll(name,''),value):value;
function authoredStrings(path,source){
 const file=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 const found=[];
 function visit(node){
  if(ts.isStringLiteralLike(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node)){
   if(path==='src/main.ts'&&['入住','選輯紀錄'].includes(node.text))return;
   if(hasHan(defaultText(path,node.text)))found.push({line:file.getLineAndCharacterOfPosition(node.getStart(file)).line+1,text:node.text.slice(0,100)});
  }
  ts.forEachChild(node,visit);
 }
 visit(file);return found;
}

test('maintained default JavaScript and TypeScript copy uses English',()=>{
 const violations=sources.flatMap(path=>{const found=authoredStrings(path,read(path));return found.length?[`${path}: ${found.length} default strings (first lines ${found.slice(0,6).map(v=>v.line).join(', ')})`]:[];});
 assert.deepEqual(violations,[],violations.join('\n'));
});
test('maintained default HTML, metadata and accessibility copy use English',()=>{
 for(const path of documents){
  const source=read(path).replace(/&#(?:x([a-f0-9]+)|(\d+));/gi,(_match,hex,decimal)=>String.fromCodePoint(parseInt(hex??decimal,hex?16:10)));
  assert.match(source,/<html\b[^>]*\blang=["']en["']/i,path);
  assert.equal(hasHan(defaultText(path,source)),false,path+' contains non-English default copy');
 }
});
test('maintained machine instructions and framework example defaults use English',()=>{
 for(const path of contracts){const data=JSON.parse(read(path));assert.equal(hasHan(defaultText(path,JSON.stringify(data))),false,path);}
});
test('language audit excludes Chinese input detectors without exempting Chinese output strings',()=>{
 assert.deepEqual(authoredStrings('detector.ts',String.raw`const blocked=/私人|機密/u; const label='Privacy';`),[]);
 assert.equal(authoredStrings('copy.ts',"const error='請稍後重試';").length,1);
 assert.equal(authoredStrings('template.ts','const error=`請稍後 ${value} 重試`;').length,2);
 assert.deepEqual(authoredStrings('src/residents.ts',"const name='茉茉';"),[]);
 assert.equal(authoredStrings('src/residents.ts',"const copy='茉茉的新家';").length,1);
});
test('identity setup and recovery stay distinct without translating protocol enums',()=>{
 const setup=read('public/identity.html'),recovery=read('public/identity-recovery.html');
 assert.match(setup,/four steps/);assert.match(setup,/Passkey on your device alone does not activate/);
 assert.match(setup,/id="registered-recovery-link" hidden/);
 assert.match(recovery,/not the Agent’s ID, Invitation ID or confirmation code/);
 const identity=JSON.parse(read('public/identity-onboarding.json'));
 assert.equal(identity.mode,'provisional-only');assert.equal(identity.modeScope,'enrollment');
 assert.deepEqual(identity.recovery.guardian.decision,['continue','new']);
 assert.equal(identity.recovery.guardian.continueState,'continued');
 assert.equal(identity.recovery.guardian.newState,'new-admission-required');
 assert.equal(identity.recovery.candidate.header,'X-Identity-Candidate-Key');
 assert.equal(identity.recovery.guardian.userVerification,'required');
});
