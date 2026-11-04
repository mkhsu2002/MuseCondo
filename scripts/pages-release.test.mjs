import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {evaluateDeploymentChanges,planPagesRelease,assertBuiltRelease} from './pages-release.mjs';
const entry=(path,before='',after='',status='M')=>({path,before,after,status});
const renderer={beforeRenderer:'a'.repeat(64),afterRenderer:'a'.repeat(64),assetExists:()=>true};
test('verified static assets and build-only infrastructure can use the same-run Pages upload',async()=>{
 const plan=await evaluateDeploymentChanges([entry('public/prototype-assets/old.png','','','D'),entry('public/prototype-assets/old.webp','','image','A'),entry('public/asset-manifest.json','{}','{"version":1}'),entry('.github/workflows/quality.yml'),entry('scripts/check-build.mjs'),entry('fixtures/prototype-art/reference.png','','data','A'),entry('src/artwork.ts','const p=`prototype-assets/${id}.png`;','const p=`prototype-assets/${id}.webp`;')],renderer);
 assert.equal(plan.autoAllowed,true);assert.equal(plan.coordinatedRequired,false);
});
test('backend, migrations, bindings, runtime contracts, changed renderer and unknown paths require coordinated deployment',async()=>{
 for(const path of ['migrations/0046_new.sql','workers/tower-manager/worker.ts','functions/[[path]].ts','server/live/worker.ts','wrangler.jsonc','public/_headers','src/shared/tower-journals.ts','src/route-policy.ts','package-lock.json','unknown.js'])assert.equal((await evaluateDeploymentChanges([entry(path)],renderer)).coordinatedRequired,true,path);
 assert.equal((await evaluateDeploymentChanges([entry('public/media/art.webp')],{...renderer,afterRenderer:'b'.repeat(64)})).autoAllowed,false);
});
test('legacy artwork redirects are bounded to matching public WebP files; arbitrary redirects and artwork code changes deny auto',async()=>{
 assert.equal((await evaluateDeploymentChanges([entry('public/_redirects','','/prototype-assets/old.png /prototype-assets/old.webp 301','A')],renderer)).autoAllowed,true);
 for(const text of ['/api/* https://other.example/:splat 302','/prototype-assets/old.png /prototype-assets/other.webp 301'])assert.equal((await evaluateDeploymentChanges([entry('public/_redirects','',text,'A')],renderer)).autoAllowed,false);
 assert.equal((await evaluateDeploymentChanges([entry('src/artwork.ts','const n=1','fetch("/api/write")')],renderer)).autoAllowed,false);
});
test('trusted baseline is read from the event base, so a forged HEAD receipt cannot conceal an undeployed backend',async()=>{
 const root=mkdtempSync(join(tmpdir(),'muse-pages-gate-'));const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();const put=(p,s)=>{mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),s);};const commit=()=>{git('add','.');git('-c','user.name=Synthetic','-c','user.email=synthetic@example.invalid','commit','-qm','synthetic');return git('rev-parse','HEAD');};
 try{git('init','-q');put('src/shared/lobby-base-css.ts','export const LOBBY_RENDERER_BUILD_HASH="'+'a'.repeat(64)+'";');put('public/media/a.webp','one');const deployed=commit();put('docs/releases/production-baseline.json',JSON.stringify({version:1,environment:'production',sourceSHA:deployed,deploymentId:'12345678-1234-1234-1234-123456789abc',verifiedAt:'2026-11-01T00:00:00Z'}));const base=commit();put('server/live/new.ts','export const changed=true;');const backend=commit();put('docs/releases/production-baseline.json',JSON.stringify({version:1,environment:'production',sourceSHA:backend,deploymentId:'12345678-1234-1234-1234-123456789abc',verifiedAt:'2026-11-02T00:00:00Z'}));put('public/media/a.webp','two');const head=commit();const p=await planPagesRelease({root,base,head,scope:'full'});assert.equal(p.coordinatedRequired,true);assert.equal(p.effectiveBase,deployed);assert.equal((await planPagesRelease({root,base:'0'.repeat(40),head,scope:'full'})).autoAllowed,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('upload refuses missing, stale or incomplete build evidence without running another build',async()=>{
 await assert.rejects(assertBuiltRelease({root:'/',head:'a'.repeat(40),readManifest:()=>({sourceSHA:'b'.repeat(40),buildComplete:true})}),/source|manifest/);
 await assert.rejects(assertBuiltRelease({root:'/',head:'a'.repeat(40),readManifest:()=>({sourceSHA:'a'.repeat(40),buildComplete:false})}),/complete|manifest/);
});
