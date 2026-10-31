/** File-only deployment guard; this does not deploy or configure a hosting account. */
import { readFile, stat, access } from 'node:fs/promises';
import { resolve } from 'node:path';
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
    const file=resolve(root,asset.slice(base.length));
    if (!(await stat(file)).isFile()) throw new Error('Missing built asset: '+asset);
  }
  return {directory,base,javaScript:scripts.length,stylesheets:styles.length};
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
  console.log('PASS: deployable compiled assets',await checkBuild());
  console.log('PASS: identity verification route',await checkIdentityCardBuild());
}
