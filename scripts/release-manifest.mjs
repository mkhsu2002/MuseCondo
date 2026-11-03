import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {canonicalSchema,SCHEMA_QUERY,hashContract} from '../server/live/release-contract.ts';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sourceIdentity(directory=root){
 const sourceSHA=process.env.CF_PAGES_COMMIT_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:directory,encoding:'utf8'}).trim();
 if(!/^[a-f0-9]{40}$/.test(sourceSHA))throw Error('release_source_sha_invalid');
 const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:directory,encoding:'utf8'}).split('\0').filter(Boolean).sort();
 const sourceTreeHash=hash(JSON.stringify(files.map(file=>{
  try{return [file,hash(readFileSync(resolve(directory,file)))];}
  catch(error){if(error.code==='ENOENT')return [file,{missing:true}];throw error;}
 })));
 return {sourceSHA,sourceTreeHash};
}
export function emittedAssets(directory){
 const output=[];
 function visit(path){for(const entry of readdirSync(path,{withFileTypes:true})){const file=resolve(path,entry.name);if(entry.isDirectory())visit(file);else if(/\.(?:js|css)$/.test(entry.name))output.push({path:relative(directory,file).split('\\').join('/'),sha256:hash(readFileSync(file))});}}
 visit(directory);return output.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export async function createManifest({complete=false,directory=root}={}){
 const db=new DatabaseSync(':memory:');let objects;const migrations=[];
 try{for(const name of readdirSync(resolve(directory,'migrations')).filter(f=>f.endsWith('.sql')).sort()){const sql=readFileSync(resolve(directory,'migrations',name));db.exec(sql.toString());migrations.push({name,sha256:hash(sql)});}objects=canonicalSchema(db.prepare(SCHEMA_QUERY).all());}finally{db.close();}
 const renderer=readFileSync(resolve(directory,'src/shared/lobby-base-css.ts'),'utf8').match(/LOBBY_RENDERER_BUILD_HASH="([a-f0-9]{64})"/);if(!renderer)throw Error('release_renderer_hash_missing');
 const frontendAssets=complete?emittedAssets(resolve(directory,'dist')):[];
 if(complete&&!frontendAssets.some(a=>a.path.endsWith('.js')))throw Error('release_frontend_assets_missing');
 const contract={version:1,...sourceIdentity(directory),schemaHash:await hashContract(objects),schemaObjects:objects.length,schemaDefinitions:objects,migrations,migrationHash:await hashContract(migrations),rendererHash:renderer[1],frontendAssets,frontendHash:await hashContract(frontendAssets),buildComplete:complete};
 return {...contract,buildHash:await hashContract(contract)};
}
function moduleText(manifest){return '// Generated private release contract. Never copy into public output.\nimport type {ReleaseManifest} from \'./release-contract.ts\';\nexport const RELEASE_MANIFEST='+JSON.stringify(manifest)+' satisfies ReleaseManifest;\n';}
export async function recoverReleaseModule(directory,identity){
 try{
  const prior=JSON.parse(readFileSync(resolve(directory,'.release/manifest.json'),'utf8'));
  const {buildHash,...contract}=prior;
  if(prior.sourceSHA!==identity.sourceSHA||prior.sourceTreeHash!==identity.sourceTreeHash||await hashContract(contract)!==buildHash)return false;
  const path=resolve(directory,'server/live/generated-release.ts'),expected=moduleText(prior);
  let actual;try{actual=readFileSync(path,'utf8');}catch{/* Missing generated modules must be recovered. */}
  if(actual!==expected)writeFileSync(path,expected);
  return true;
 }catch{return false;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const complete=process.argv.includes('--complete'),manifest=await createManifest({complete});
 // Preserve valid complete evidence, recovering its missing/stale module without trusting existing dist.
 if(process.argv.includes('--ensure')&&await recoverReleaseModule(root,manifest))process.exit(0);
 mkdirSync(resolve(root,'.release'),{recursive:true});writeFileSync(resolve(root,'.release/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 writeFileSync(resolve(root,'server/live/generated-release.ts'),moduleText(manifest));
}
