import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {addSocialPreview} from '../scripts/social-preview.mjs';
test('social metadata is added only at build output and cannot invalidate the reviewed visual shell',()=>{const shell=readFileSync(new URL('../index.html',import.meta.url),'utf8');const html=addSocialPreview(shell);assert.match(html,/property="og:image" content="https:\/\/musetower.neobabylon.app\/og\/muse-condo-share-20261102.jpg"/);assert.match(html,/name="twitter:card" content="summary_large_image"/);assert.equal(html.replace(/<!-- social-preview:start -->[\s\S]*?<!-- social-preview:end -->\n/,''),shell);assert.equal(addSocialPreview(html),html);assert.doesNotMatch(shell,/property="og:image"/);});
test('isolated emitted public HTML has previews and private identity pages remain noindex without social tags',()=>{
 const directory=mkdtempSync(join(tmpdir(),'muse-social-routes-'));
 try{
  mkdirSync(join(directory,'dist'));writeFileSync(join(directory,'dist/index.html'),readFileSync(new URL('../index.html',import.meta.url),'utf8'));
  for(const path of ['public','src','LICENSES','LICENSE','NOTICE','ASSET-LICENSE.md'])symlinkSync(fileURLToPath(new URL('../'+path,import.meta.url)),join(directory,path));
  // Execute the maintained build's real HTML postprocessors in its declared order.
  const build=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts.build;
  for(const match of build.matchAll(/node (scripts\/(?:social-preview|routes)\.mjs)/g))execFileSync(process.execPath,[fileURLToPath(new URL('../'+match[1],import.meta.url))],{cwd:directory,stdio:'pipe'});
 for(const route of ['','about/','neighbors/','move-in/','m7k2px/']){
  const html=readFileSync(join(directory,'dist',route,'index.html'),'utf8');
  assert.equal((html.match(/property="og:image" /g)||[]).length,1,route);
  assert.match(html,/name="twitter:card" content="summary_large_image"/);
 }
 for(const route of ['identity/','identity/verify/','identity/recover/','identity/maintenance/','identity/offer/']){
  const html=readFileSync(join(directory,'dist',route,'index.html'),'utf8');assert.match(html,/noindex/,route);assert.doesNotMatch(html,/property="og:|name="twitter:/,route);
 }
 }finally{rmSync(directory,{recursive:true,force:true});}
});
