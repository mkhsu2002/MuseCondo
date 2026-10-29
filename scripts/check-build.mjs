/** File-only deployment guard; this does not deploy or configure a hosting account. */
import { readFile, stat } from 'node:fs/promises';
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
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  console.log('PASS: deployable compiled assets',await checkBuild());
}
