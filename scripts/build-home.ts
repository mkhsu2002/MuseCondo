import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {buildStandalone,assertPrivateInputsOutsideOutput,type ArtworkReview} from '../server/framework/standalone.ts';
import {validateFrameworkSeed} from '../src/framework/index.ts';
const args=process.argv.slice(2),flags:Record<string,string>={};
for(let i=0;i<args.length;i+=2){if(!['--seed','--desktop','--mobile','--review','--out','--assets-dir'].includes(args[i])||!args[i+1])throw Error('Use --seed --desktop --mobile --review --out [--assets-dir]');flags[args[i]]=args[i+1];}
for(const f of ['--seed','--desktop','--mobile','--review','--out'])if(!flags[f])throw Error('Missing required argument '+f);
const out=resolve(flags['--out']);await assertPrivateInputsOutsideOutput(out,[flags['--seed'],flags['--review']]);
const seed=validateFrameworkSeed(JSON.parse(await readFile(flags['--seed'],'utf8'))),extraAssets:Record<string,Uint8Array>={};
for(const dream of seed.dreams){if(!seed.consent.publishDreams||dream.publication!=='public'||!dream.image)continue;if(!flags['--assets-dir'])throw Error('Provide --assets-dir for published dream images');const root=await realpath(flags['--assets-dir']),file=await realpath(resolve(root,'.'+dream.image));if(!file.startsWith(root+sep))throw Error('Dream image escapes the granted asset directory');extraAssets[dream.image]=new Uint8Array(await readFile(file));}
const result=await buildStandalone({seed,art:{desktop:new Uint8Array(await readFile(flags['--desktop'])),mobile:new Uint8Array(await readFile(flags['--mobile']))},review:JSON.parse(await readFile(flags['--review'],'utf8')) as ArtworkReview,out,extraAssets});console.log(JSON.stringify(result));
