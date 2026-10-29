import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sanitizePublic} from '../scripts/sanitize-public.mjs';
test('deployment removes production specifications and raw prompt manifests but preserves visible artwork',async()=>{
 const root=await mkdtemp(join(tmpdir(),'muse-output-'));try{for(const file of ['prototype-provenance.json','character-provenance.json','asset-manifest.json','brand-provenance.json'])await writeFile(join(root,file),'{"prompt":"PRIVATE_PROMPT"}');await writeFile(join(root,'home.png'),'image');await sanitizePublic(root);await access(join(root,'home.png'));for(const file of ['prototype-provenance.json','character-provenance.json','asset-manifest.json','brand-provenance.json'])await assert.rejects(access(join(root,file)));}finally{await rm(root,{recursive:true,force:true});}
});
