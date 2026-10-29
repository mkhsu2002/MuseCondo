import {unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
/** These development records contain generation instructions, not visitor-facing content. */
export async function sanitizePublic(directory='dist'){
 for(const file of ['prototype-provenance.json','character-provenance.json','asset-manifest.json','brand-provenance.json']){
  try{await unlink(resolve(directory,file));}catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await sanitizePublic(process.argv[2]||'dist');
