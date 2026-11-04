/** Same-run Pages publication. Missing context or coordinated runtime changes never auto-deploy. */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {BASELINE_PATH,isDocumentation,selectBase} from './change-scope.mjs';
import {staticPresentation,cssPresentation,modulePresentation} from './presentation-scope.mjs';
import {sourceIdentity} from './release-manifest.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],maxBuffer:20*1024*1024}).trimEnd();
const infra=new Set(['.github/workflows/quality.yml','scripts/change-scope.mjs','scripts/presentation-scope.mjs','scripts/pages-release.mjs','scripts/build-release.mjs','scripts/verify-change.mjs','scripts/check-build.mjs','scripts/check-image-assets.mjs','scripts/check-node.mjs','scripts/check-test-tools.mjs','scripts/run-tests.mjs','scripts/test-discovery.mjs','scripts/verify.mjs','scripts/routes.mjs','scripts/static-routing.mjs','scripts/sanitize-public.mjs','scripts/social-preview.mjs','scripts/release-manifest.mjs','scripts/generate-lobby-css.mjs','scripts/check-static.mjs']);
const displayModules=new Set(['src/shared/lobby-messages.ts','src/shared/lobby-markup.ts','src/shared/community-resources.ts','src/shared/home-directory.ts','src/shared/tower-weekly-markup.ts','src/shared/tower-journals-markup.ts']);
const denied=reason=>({autoAllowed:false,coordinatedRequired:true,reason});
function artworkRedirects(text,assetExists){return text.split(/\r?\n/).filter(line=>line.trim()&&!line.trim().startsWith('#')).every(line=>{const m=line.trim().match(/^\/prototype-assets\/([a-z0-9_-]+)\.png\s+\/prototype-assets\/\1\.webp\s+301$/);return m&&assetExists('/prototype-assets/'+m[1]+'.webp');});}
export async function evaluateDeploymentChanges(entries,{beforeRenderer,afterRenderer,assetExists=()=>false}={}){
 if(!/^[a-f0-9]{64}$/.test(beforeRenderer??'')||beforeRenderer!==afterRenderer)return denied('Renderer identity changed or cannot be verified; match the private Manager before publication.');
 for(const e of entries){
  const path=e.path;if(isDocumentation(path)||path==='ASSET-LICENSE.md'||path==='fixtures/prototype-art/README.md')continue;
  if(!['A','M','D'].includes(e.status)||e.oldPath)return denied('Unknown change status requires coordinated publication.');
  if(/^(?:migrations|workers|functions|server)\//.test(path)||/^wrangler(?:\.|$)/.test(path)||['public/_headers','vite.config.ts','tsconfig.functions.json'].includes(path))return denied('Runtime, schema, routing or deployment configuration changed: '+path);
  if(/^public\/(?:media|og|prototype-assets)\/[a-zA-Z0-9_.-]+\.(?:webp|png|jpe?g|avif)$/.test(path)||/^fixtures\/prototype-art\/[a-zA-Z0-9_.-]+\.(?:webp|png|jpe?g|avif|json)$/.test(path))continue;
  if(path==='public/_redirects'){if(artworkRedirects(e.after??'',assetExists))continue;return denied('Only bounded legacy artwork redirects may publish automatically.');}
  if(['public/prototype-provenance.json','public/character-provenance.json','public/asset-manifest.json'].includes(path)){try{JSON.parse(e.after);continue;}catch{return denied('Artwork provenance is not valid JSON.');}}
  if(path==='src/artwork.ts'){if((e.before??'').replaceAll('`prototype-assets/${id}.png`','`prototype-assets/${id}.webp`')===e.after)continue;return denied('Artwork helper behavior changed.');}
  if(infra.has(path)||/^(?:tests\/.*\.(?:test|spec)\.(?:ts|mjs)|scripts\/[^/]+\.test\.mjs)$/.test(path))continue;
  if(e.status==='M'&&(path==='index.html'||/^(?:project|tower-history)\/(?:[a-z0-9_-]+\/)*index\.html$/.test(path))&&staticPresentation(e.before,e.after,{assetExists}))continue;
  if(/^src\/(?:live(?:\/tower-welcome)?|base|style|project|history|perspectives)\.css$/.test(path)&&cssPresentation(e.before??'',e.after??''))continue;
  if(displayModules.has(path)&&modulePresentation(e.before??'',e.after??'',path==='src/shared/lobby-messages.ts'))continue;
  return denied('Unknown or shared runtime source requires coordinated publication: '+path);
 }
 return {autoAllowed:true,coordinatedRequired:false,reason:'Verified static/build changes preserve runtime contracts and the accepted renderer.'};
}
export async function planPagesRelease({root=process.cwd(),base,head,scope}={}){
 if(!['presentation','full'].includes(scope))return denied('Documentation or unverified scope is not deployable.');
 try{
  const receipt=JSON.parse(git(root,['show',`${base}:${BASELINE_PATH}`]));
  const effectiveBase=selectBase({eventBase:base,head,receipt,isAncestor:(a,b)=>{try{git(root,['merge-base','--is-ancestor',a,b]);return true;}catch{return false;}}});
  if(!effectiveBase)return denied('Missing or untrusted accepted production baseline; use the coordinated operator workflow.');
  const parts=git(root,['diff','--name-status','--no-renames','-z',effectiveBase,head]).split('\0'),entries=[];
  for(let i=0;i<parts.length&&parts[i];i+=2){const status=parts[i],path=parts[i+1];if(!path)throw Error('invalid_diff');entries.push({status,path,get before(){return status==='A'?'':git(root,['show',`${effectiveBase}:${path}`]);},get after(){return status==='D'?'':git(root,['show',`${head}:${path}`]);}});}
  const renderer=sha=>git(root,['show',`${sha}:src/shared/lobby-base-css.ts`]).match(/LOBBY_RENDERER_BUILD_HASH="([a-f0-9]{64})"/)?.[1];
  const assetExists=path=>{try{return git(root,['cat-file','-t',`${head}:public${path}`])==='blob';}catch{return false;}};
  return {...await evaluateDeploymentChanges(entries,{beforeRenderer:renderer(effectiveBase),afterRenderer:renderer(head),assetExists}),effectiveBase,head,scope};
 }catch{return denied('Baseline, source history or runtime identity cannot be confirmed; no automatic deployment.');}
}
export async function assertBuiltRelease({root=process.cwd(),head,readManifest=()=>JSON.parse(readFileSync(resolve(root,'.release/manifest.json'),'utf8')),identity=sourceIdentity}={}){
 const manifest=readManifest();if(manifest.sourceSHA!==head)throw Error('release_manifest_source_mismatch');if(!manifest.buildComplete)throw Error('release_manifest_not_complete');
 const {buildHash,...contract}=manifest;if(hash(JSON.stringify(contract))!==buildHash)throw Error('release_manifest_hash_mismatch');
 const current=identity(root);if(current.sourceSHA!==head||current.sourceTreeHash!==manifest.sourceTreeHash)throw Error('release_manifest_source_tree_mismatch');
 for(const asset of manifest.frontendAssets??[]){if(typeof asset.path!=='string'||asset.path.startsWith('/')||asset.path.split(/[\\/]/).includes('..')||hash(readFileSync(resolve(root,'dist',asset.path)))!==asset.sha256)throw Error('release_frontend_asset_mismatch');}
 if(!manifest.frontendAssets?.length||!existsSync(resolve(root,'functions/[[path]].ts'))||!existsSync(resolve(root,'server/live/generated-release.ts')))throw Error('release_functions_or_assets_missing');
 return manifest;
}
export async function pagesRelease({mode='plan',root=process.cwd(),env=process.env,run=spawnSync}={}){
 const head=env.GITHUB_SHA,base=env.PAGES_EVENT_BASE,scope=env.PAGES_VERIFIED_SCOPE;
 const context=env.GITHUB_EVENT_NAME==='push'&&env.GITHUB_REF==='refs/heads/main'&&/^[a-f0-9]{40}$/.test(head??'');
 const plan=context?await planPagesRelease({root,base,head,scope}):denied('Only successful main push verification may deploy.');
 if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`auto_allowed=${plan.autoAllowed}\ncoordinated_required=${plan.coordinatedRequired}\n`);
 if(env.GITHUB_STEP_SUMMARY)appendFileSync(env.GITHUB_STEP_SUMMARY,`\n### Pages publication\n${plan.autoAllowed?'Automatic publication permitted.':'**Not deployed: coordinated publication required.**'} ${plan.reason}\n`);
 console.log(JSON.stringify(plan));if(mode==='plan'||!plan.autoAllowed)return plan;
 if(mode!=='deploy')throw Error('invalid_pages_release_mode');if(!env.CLOUDFLARE_API_TOKEN||env.CLOUDFLARE_ACCOUNT_ID!=='82af99e90d342a30d2386efaa8ef4966')throw Error('dedicated_pages_deployment_credentials_missing');
 const manifest=await assertBuiltRelease({root,head}),wrangler=resolve(env.RUNNER_TEMP,'muse-native/node_modules/wrangler/bin/wrangler.js');if(!existsSync(wrangler))throw Error('pinned_wrangler_missing');
 const result=run(process.execPath,[wrangler,'pages','deploy','dist','--project-name','musecondo','--branch','main','--commit-hash',head,'--commit-message','Verified Quality '+head,'--commit-dirty=false'],{cwd:root,env:{...env,WRANGLER_SEND_METRICS:'false'},stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)throw Error('pages_upload_failed_do_not_blind_retry');
 console.log(JSON.stringify({uploaded:true,sourceSHA:head,buildHash:manifest.buildHash,rebuilds:0,requiresHostedAcceptance:true}));return plan;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{await pagesRelease({mode:process.argv[2]??'plan'});}catch(error){console.error(error.message);process.exitCode=1;}}
