import {renderStandaloneCondo} from './interface-export.ts';
import {lstat,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {CONDO_ARTWORK_KEYS,CONDO_TEMPLATE_VERSION,publicCondoProjection,validateCondoInput} from '../../src/framework/condo.ts';
import {validatePNG} from '../live/png.ts';
import {sanitizePublicPNG} from './png-public.ts';
import {assertPrivateInputsOutsideOutput} from './standalone.ts';
const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const within=(root:string,path:string)=>path===root||path.startsWith(root+sep);
async function statOrMissing(path:string){try{return await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
/** Output ancestors must be ordinary directories, never aliases to another location. */
async function outputSafety(out:string){
 if(out===sep||within(out,repoRoot)||out===resolve(repoRoot,'data')||['src','server','scripts','tests','public','dist','.git','node_modules'].some(name=>within(resolve(repoRoot,name),out)))throw Error('condo: use a dedicated output subdirectory');
 let current=out;
 for(;;){const info=await statOrMissing(current);if(info&&(info.isSymbolicLink()||!info.isDirectory()))throw Error('condo: output paths must not contain symlinks or regular files');const parent=dirname(current);if(parent===current)break;current=parent;}
}
/** Existing exports have a closed inventory. Never remove unrecognized user files. */
async function priorIdentity(out:string):Promise<string|undefined>{
 const info=await statOrMissing(out);if(!info)return undefined;
 const entries=await readdir(out,{withFileTypes:true});
 const names=new Set(['index.html','inside.html','dreams.html','index.zh-TW.html','inside.zh-TW.html','dreams.zh-TW.html','condo.json','assets']);
 if(![5,8].includes(entries.length)||['index.html','inside.html','dreams.html','condo.json','assets'].some(name=>!entries.some(entry=>entry.name===name))||entries.some(entry=>!names.has(entry.name)||entry.isSymbolicLink()||(entry.name==='assets'?!entry.isDirectory():!entry.isFile())))throw Error('condo: output is not a safely rebuildable home export');
 const files=await readdir(join(out,'assets'),{withFileTypes:true});
 if(!files.some(file=>file.name==='home.png')||!files.some(file=>file.name==='condo.css')||files.some(file=>!['home.png','dream.png','condo.css'].includes(file.name)||!file.isFile()||file.isSymbolicLink()))throw Error('condo: output assets contain unrelated files');
 const previous=JSON.parse(await readFile(join(out,'condo.json'),'utf8'));
 if(previous?.templateVersion!==CONDO_TEMPLATE_VERSION||!/^[a-f0-9]{16}$/.test(previous?.home?.id))throw Error('condo: existing home identity is invalid; replacement refused');
 return previous.home.id;
}
/** Validate all private material first, then swap a dedicated export without publishing evidence. */
export async function buildCondo(options:{input:string;out:string}){
 const inputFile=resolve(options.input),inputDir=await realpath(dirname(inputFile)),source=await realpath(inputFile),out=resolve(options.out);
 if(!within(inputDir,source))throw Error('condo: input must remain within its source directory');
 await outputSafety(out);
 await assertPrivateInputsOutsideOutput(out,[inputFile]);
 const sourceInfo=await lstat(source);if(!sourceInfo.isFile()||sourceInfo.size>100_000)throw Error('condo: input format or size is invalid');
 const input=validateCondoInput(JSON.parse(await readFile(source,'utf8')));
 if(!input.seed.consent.publishHome)throw Error('condo: public home consent is required');
 const artwork={} as Record<typeof CONDO_ARTWORK_KEYS[number],Uint8Array>;
 for(const key of CONDO_ARTWORK_KEYS){
  const entry=resolve(inputDir,input.artwork[key].file),file=await realpath(entry);
  if(!within(inputDir,file))throw Error('condo: artwork must remain within its source directory');
  await assertPrivateInputsOutsideOutput(out,[entry]);
  const info=await lstat(file);if(!info.isFile()||info.size>8*1024*1024)throw Error('condo: artwork must be a complete PNG of at most 8 MiB');
  const bytes=new Uint8Array(await readFile(file));
  if(digest(bytes)!==input.review.digests[key])throw Error('condo: artwork does not match its visual review receipt');
  const size=await validatePNG(bytes),ratio=key==='home'?16/9:1;
  if(key==='home'?Math.abs(size.width/size.height/ratio-1)>=0.01:size.width!==size.height)throw Error('condo: artwork has an invalid aspect ratio');
  artwork[key]=await sanitizePublicPNG(bytes);
 }
 const oldId=await priorIdentity(out),id=oldId??randomBytes(8).toString('hex'),site=publicCondoProjection(input,id);
 const css=await readFile(new URL('../../src/framework/condo.css',import.meta.url));
 const pages=(['en','zh-TW'] as const).flatMap(locale=>(['home','inside','dreams'] as const).map(page=>({name:(page==='home'?'index':page)+(locale==='zh-TW'?'.zh-TW':'')+'.html',html:renderStandaloneCondo(site,page,locale)})));
 const parent=dirname(out);await mkdir(parent,{recursive:true});await outputSafety(out);
 const stage=await mkdtemp(join(parent,`.${basename(out)}-stage-`));let backup:string|undefined;
 try{
  await mkdir(join(stage,'assets'));
  await writeFile(join(stage,'assets','home.png'),artwork.home);if(site.dream)await writeFile(join(stage,'assets','dream.png'),artwork.dream);
  await writeFile(join(stage,'assets','condo.css'),css);
  for(const page of pages)await writeFile(join(stage,page.name),page.html);
  await writeFile(join(stage,'condo.json'),JSON.stringify(site,null,2)+'\n');
  await outputSafety(out);const currentId=await priorIdentity(out);if(currentId!==oldId)throw Error('condo: output changed; rebuild before continuing');
  if(oldId){backup=await mkdtemp(join(parent,`.${basename(out)}-previous-`));await rm(backup,{recursive:true});await rename(out,backup);}
  try{await rename(stage,out);}catch(error){if(backup){await rename(backup,out);backup=undefined;}throw error;}
  if(backup){await rm(backup,{recursive:true});backup=undefined;}
 }finally{await rm(stage,{recursive:true,force:true});}
 return {id,templateVersion:CONDO_TEMPLATE_VERSION,directory:out,routes:site.home.routes};
}
/** CLI flags are deliberately closed: duplicated or unknown values are usually operator mistakes. */
export function parseCondoBuildArgs(args:string[]):{input:string;out:string}{
 const values:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!['--input','--out'].includes(key)||values[key]!==undefined||!value||value.startsWith('--'))throw Error('Usage: condo:build -- --input input.json --out site');values[key]=value;}
 if(!values['--input']||!values['--out'])throw Error('Usage: condo:build -- --input input.json --out site');return {input:values['--input'],out:values['--out']};
}
