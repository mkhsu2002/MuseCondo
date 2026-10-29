import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,sep,dirname,basename} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {validateFrameworkSeed,publicHomeProjection} from '../../src/framework/index.ts';
import {renderHome} from '../../src/framework/render.ts';
import {validatePNG} from '../live/png.ts';
export interface ArtworkReview {assetDigests?:{desktop?:string;mobile?:string};checks?:{self?:boolean;activity?:boolean;ownerPortrait?:boolean;window?:boolean;matchedPair?:boolean}}
interface BuildInput {seed:unknown;art:{desktop:Uint8Array;mobile:Uint8Array};review:ArtworkReview;out:string;extraAssets?:Record<string,Uint8Array>}
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
/** Compare real filesystem paths, including an output directory not created yet. */
export async function assertPrivateInputsOutsideOutput(output:string,inputs:string[]){
 let parent=resolve(output);const missing:string[]=[];
 for(;;){try{parent=await realpath(parent);break;}catch(error){if((error as {code?:string}).code!=='ENOENT')throw error;const next=dirname(parent);if(next===parent)throw error;missing.unshift(basename(parent));parent=next;}}
 const root=resolve(parent,...missing);
 for(const input of inputs){
  const path=resolve(input),entry=resolve(await realpath(dirname(path)),basename(path)),file=await realpath(path);
  if([entry,file].some(candidate=>candidate===root||candidate.startsWith(root+sep)))throw Error('Private inputs must remain outside the deployable output');
 }
}
/** Export an explicitly public home. Inputs/evidence/review receipts remain outside the output. */
export async function buildStandalone(input:BuildInput){
 const seed=validateFrameworkSeed(input.seed);if(!seed.consent.publishHome)throw Error('Publish consent is required for a deployable export');
 const {art,review}=input;if(!art?.desktop||!art.mobile||!review.assetDigests||!review.checks)throw Error('Paired artwork and a visual review receipt are required');
 if(!['self','activity','ownerPortrait','window','matchedPair'].every(k=>review.checks![k as keyof NonNullable<ArtworkReview['checks']>]===true))throw Error('Visual review must confirm all four required elements and matching compositions');
 for(const kind of ['desktop','mobile'] as const){
  const bytes=art[kind];if(bytes.length>8*1024*1024||hash(bytes)!==review.assetDigests[kind])throw Error('Artwork review does not match these bytes');
  const size=await validatePNG(bytes),ratio=kind==='desktop'?16/9:9/16;if(Math.abs(size.width/size.height-ratio)>0.04)throw Error('Artwork composition has the wrong aspect ratio');
 }
 const root=resolve(input.out);if(root===resolve('.')||root===resolve('public')||root===sep)throw Error('Choose a dedicated standalone output directory');
 let id:string;
 try{const prior=JSON.parse(await readFile(resolve(root,'home.json'),'utf8'));if(!/^[a-f0-9]{16}$/.test(prior.id))throw Error('invalid id');id=prior.id;}catch(error){if((error as {code?:string}).code!=='ENOENT')throw Error('Existing home state is invalid; will not replace its identity');id=randomBytes(8).toString('hex');}
 const assets={desktop:`/assets/${hash(art.desktop)}.png`,mobile:`/assets/${hash(art.mobile)}.png`};
 const outputSeed=structuredClone(seed),files:{path:string;bytes:Uint8Array}[]=[{path:assets.desktop,bytes:art.desktop},{path:assets.mobile,bytes:art.mobile}];
 for(const dream of outputSeed.dreams){
  if(!seed.consent.publishDreams||dream.publication!=='public'||!dream.image)continue;
  const bytes=input.extraAssets?.[dream.image];if(!bytes||bytes.length>8*1024*1024)throw Error('Every published dream image needs an explicitly supplied local PNG');await validatePNG(bytes);
  dream.image=`/assets/${hash(bytes)}.png`;files.push({path:dream.image,bytes});
 }
 const doc=publicHomeProjection(outputSeed,{id,assets});
 const css=await readFile(new URL('../../src/framework/home.css',import.meta.url),'utf8');
 const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 await mkdir(resolve(root,'assets'),{recursive:true});
 for(const file of files)await writeFile(resolve(root,'.'+file.path),file.bytes);
 await writeFile(resolve(root,'assets/home.css'),css);
 for(const [page,path] of [['home',''],['inside','inside'],['dreams','dreams']] as const){
  const dir=resolve(root,path);await mkdir(dir,{recursive:true});
  const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escape(doc.intro)}"><title>${escape(doc.name)}的窩</title><link rel="stylesheet" href="/assets/home.css"></head><body style="margin:0"><a class="skip-link" href="#main">跳至主要內容</a>${renderHome(doc,page)}</body></html>`;await writeFile(resolve(dir,'index.html'),html);
 }
 await writeFile(resolve(root,'home.json'),JSON.stringify(doc,null,2)+'\n');
 await writeFile(resolve(root,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src \'none\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\'; base-uri \'none\'; frame-ancestors \'none\'\n  Cache-Control: no-store\n');
 // Remove previously exported assets no longer referenced, so withdrawn dream images do not linger.
 const {readdir,unlink}=await import('node:fs/promises');const keep=new Set(['home.css',...files.map(f=>f.path.split('/').at(-1)!)]);
 for(const file of await readdir(resolve(root,'assets')))if(/^[a-f0-9]{64}\.png$/.test(file)&&!keep.has(file))await unlink(resolve(root,'assets',file));
 return {id,frameworkVersion:'0.01',directory:root,routes:doc.routes};
}
