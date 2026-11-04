import {parse} from 'parse5';
import {checkImageAssets} from './check-image-assets.mjs';
/** File-only deployment guard; this does not deploy or configure a hosting account. */
import { readFile, stat, access, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function checkBuild(directory='dist',base=process.env.MUSE_BASE_PATH||'/') {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error('MUSE_BASE_PATH must be a root or slash-delimited project path.');
  const root=resolve(directory),html=await readFile(resolve(root,'index.html'),'utf8');
  if (/(?:src|href)=["'][^"']*(?:\/src\/|\.tsx?(?:["'?#]))/.test(html)) throw new Error('Raw TypeScript/source entry found. Run npm run build and deploy dist, not the repository root.');
  const scripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(m=>m[1]);
  const styles=[...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)["'][^>]*>/g)].map(m=>m[1]);
  if (!scripts.length||!styles.length) throw new Error('Built JavaScript and CSS are required; this is not a deployable Vite output.');
  for (const asset of [...scripts,...styles]) {
    if (!asset.startsWith(base+'assets/')||asset.includes('..')||!(/\.(js|css)$/.test(asset))) throw new Error('Built asset has an unexpected base path: '+asset);
  }
  const references=[];
  async function visit(directory){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      const file=resolve(directory,entry.name);
      if(entry.isSymbolicLink())throw Error('Build output contains a symbolic link: '+file);
      if(entry.isDirectory()){await visit(file);continue;}
      if(!entry.isFile()||!entry.name.endsWith('.html'))continue;
      const document=parse(await readFile(file,'utf8'));
      function inspect(node){
        const attrs=Object.fromEntries((node.attrs||[]).map(attr=>[attr.name,attr.value]));
        const asset=node.tagName==='script'?attrs.src:node.tagName==='link'&&(attrs.rel||'').toLowerCase().split(/\s+/).includes('stylesheet')?attrs.href:undefined;
        if(asset){references.push({file,asset});}
        if(node.tagName==='img'&&attrs.src)references.push({file,asset:attrs.src});
        if(node.tagName==='img'&&attrs.srcset)for(const candidate of attrs.srcset.split(','))references.push({file,asset:candidate.trim().split(/\s+/)[0]});
        if(node.tagName==='meta'&&['og:image','twitter:image'].includes(attrs.property??attrs.name)){
          const value=attrs.content?.replace(/^https:\/\/musetower\.neobabylon\.app(?=\/)/,'');
          if(value)references.push({file,asset:value});
        }
        for(const child of node.childNodes||[])inspect(child);
        if(node.content)inspect(node.content);
      }
      inspect(document);
    }
  }
  await visit(root);
  const canonicalRoot=await realpath(root);
  for(const {file,asset} of references){
    if(/^(?:https?:)?\/\//i.test(asset))continue; // No network access during verification.
    if(asset.startsWith('data:')&&asset.startsWith('data:image/'))continue;
    if(/^[a-z][a-z0-9+.-]*:/i.test(asset))throw Error('Unsupported local build asset: '+asset);
    let decoded;try{decoded=decodeURIComponent(asset.split(/[?#]/)[0]);}catch{throw Error('Invalid build asset encoding: '+asset);}
    if(decoded.includes('\\')||decoded.split('/').includes('..')||decoded.includes('\0'))throw Error('Build asset path traversal: '+asset);
    if(/\.tsx?$/i.test(decoded)||decoded.includes('/src/'))throw Error('Raw TypeScript/source entry found: '+asset);
    const path=decoded.startsWith(base)?resolve(root,decoded.slice(base.length)):decoded.startsWith('/')?resolve(root,decoded.slice(1)):resolve(dirname(file),decoded);
    const relativePath=relative(root,path);
    if(relativePath.startsWith('..'+sep)||relativePath==='..')throw Error('Build asset path traversal: '+asset);
    try{if(!(await stat(path)).isFile()||!(await realpath(path)).startsWith(canonicalRoot+sep))throw Error('not a local file');}
    catch{throw Error('Missing built asset: '+asset+' referenced by '+relative(root,file));}
  }
  const images=await checkImageAssets(directory);
  return {directory,base,javaScript:scripts.length,stylesheets:styles.length,images:images.length};
}
export async function checkIdentityCardBuild(directory='dist') {
  const root=resolve(directory), html=await readFile(resolve(root,'identity/verify/index.html'),'utf8');
  for(const path of ['identity-verify.js','identity-verify.css','identity.css','identity-onboarding.json','licenses/identity-card.txt'])await access(resolve(root,path));
  if((html.match(/<h1\b/g)||[]).length!==1||!html.includes('noindex')||!html.includes('aria-live="polite"')||!html.includes('src="/identity-verify.js"')||/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html)||/\b(?:src|href)="https?:\/\/(?!github\.com\/mkhsu2002\/MuseCondo)/.test(html))throw Error('Identity verification document is not standalone/private');
  const headers=await readFile(resolve(root,'_headers'),'utf8'),section=headers.match(/\/identity\/verify\/\*\n([\s\S]*?)(?:\n\n|$)/)?.[1];
  if(!section||!['Cache-Control: no-store','X-Robots-Tag: noindex','Referrer-Policy: no-referrer',"default-src 'none'"].every(value=>section.includes(value)))throw Error('Identity verification privacy headers are missing');
  try{await access(resolve(root,'MuseCondoTC-Regular.ttf'));}catch(error){if(error.code==='ENOENT')return {route:'/identity/verify/:credentialId'};throw error;}
  throw Error('Worker font must not be published by Pages');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  console.log('PASS: deployable compiled assets',await checkBuild(process.argv[2]||'dist'));
  console.log('PASS: identity verification route',await checkIdentityCardBuild(process.argv[2]||'dist'));
}
