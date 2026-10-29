import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { residents } from '../src/residents.ts';
import { publicEvents, sourcePath, validateCommunity, type PublicEvent } from '../src/community/schema.ts';
import { editCommunity, metaEditor, publishEdition, ruleEditor } from '../server/community.ts';
const ids = residents.map(r => r.id);
const fixture = JSON.parse(await readFile(new URL('../fixtures/resident-activities.json', import.meta.url), 'utf8')) as PublicEvent[];
const asOf = '2026-10-28T23:59:59.000Z';
const editedAt = '2026-10-29T03:00:00.000Z';
const json = (x: unknown) => JSON.stringify(x);

test('public boundary drops private, unconsented and browser-local events and unknown fields before editing', async () => {
  const publicEvent = { ...fixture[0], privateMemory: 'TEST-PRIVATE', ownerEmail: 'PRIVATE-OWNER', apiKey: 'PRIVATE-CREDENTIAL' };
  const events = [publicEvent, {...fixture[0], id:'hidden-private',visibility:'private'}, {...fixture[0],id:'no-consent',publicationConsent:false}, {...fixture[0],id:'local-entry',origin:'browser-local'}];
  const result = await editCommunity(events, ids, {asOf,editedAt});
  assert.equal(result.eventsFile.events.length,1);
  assert.doesNotMatch(json(result), /TEST-PRIVATE|PRIVATE-OWNER|PRIVATE-CREDENTIAL|hidden-private|no-consent|local-entry/);
  assert.equal(result.edition.editor.model,null);
  assert.equal(result.edition.isFixture,true);
});
test('invalid timestamps, duplicate sources, unknown residents and origin mismatches fail closed', () => {
  for(const change of [{occurredAt:'2026-02-31T10:00:00.000Z'}, {residentId:'absent'}, {isFixture:false}, {publishedAt:'2025-10-28T00:00:00.000Z'}]) assert.throws(()=>publicEvents([{...fixture[0],...change}],ids,asOf));
  assert.throws(()=>publicEvents([fixture[0],fixture[0]],ids,asOf));
  assert.equal(publicEvents(fixture,ids,'2026-10-27T00:00:00.000Z').length,0);
});
test('four small sections keep source IDs, preserve old event dates and never introduce rankings or local interactions', async () => {
  const result=await editCommunity(fixture,ids,{asOf,editedAt});
  assert.deepEqual(Object.keys(result.edition.sections),['highlights','windows','seeking','arrivals']);
  assert.deepEqual(Object.values(result.edition.sections).map(x=>x.length),[3,4,3,10]);
  assert.equal(result.eventsFile.events.length,40);
  assert.ok(result.eventsFile.events.every(e=>e.occurredAt.startsWith('2026-10-28')));
  for(const [section,picks] of Object.entries(result.edition.sections)) for(const pick of picks){
    const event=result.eventsFile.events.find(e=>e.id===pick.sourceEventIds[0])!;
    assert.equal(event.residentId,pick.residentId); assert.ok(pick.reason.length>0);
    assert.equal(sourcePath(event),`${event.residentId}${section==='arrivals'?'':'/inside'}#event-${event.id}`);
  }
  const bad=structuredClone(result);bad.edition.sections.highlights[0].sourceEventIds=['invented-event'];
  assert.throws(()=>validateCommunity(bad.eventsFile,bad.edition,ids),/Untraceable/);
  const wrongType=structuredClone(result);wrongType.edition.sections.windows[0]=wrongType.edition.sections.highlights[0];
  assert.throws(()=>validateCommunity(wrongType.eventsFile,wrongType.edition,ids),/does not belong/);
});
test('empty editions stay empty, and editor failures cannot replace a published pointer', async()=>{
  const out=await mkdtemp(join(tmpdir(),'muse-empty-'));
  try{
    const result=await editCommunity([],ids,{asOf,editedAt});
    assert.ok(Object.values(result.edition.sections).every(x=>x.length===0));
    await publishEdition(out,result);const before=await readFile(join(out,'index.json'),'utf8');
    await assert.rejects(editCommunity(fixture,ids,{asOf,editedAt,editor:{...ruleEditor,async select(){throw new Error('editor unavailable');}}}));
    assert.equal(await readFile(join(out,'index.json'),'utf8'),before);
  } finally{await rm(out,{recursive:true,force:true});}
});
test('real CLI persists a new public diary, changes small-paper selection, and leaves earlier snapshot auditable', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'muse-flow-'));
  try{
    const input=join(dir,'input.json'),out=join(dir,'public');
    await writeFile(input,json(fixture));
    const run=(cutoff:string)=>JSON.parse(execFileSync(process.execPath,['--experimental-strip-types','scripts/edit-community.ts','--input',input,'--out',out,'--as-of',cutoff,'--edited-at','2026-10-30T00:00:00.000Z'],{cwd:new URL('..',import.meta.url),encoding:'utf8'}));
    const first=run(asOf);
    const added={...fixture.find(e=>e.residentId==='t7e3qs'&&e.type==='journal')!,id:'t7e3qs-journal-test-new',title:'測試專用：窗邊發現一顆新星',summary:'這是測試更新，不會發布成真實活動。',body:'測試日記原文：一個小小的觀察。',occurredAt:'2026-10-29T14:00:00.000Z',publishedAt:'2026-10-29T14:00:00.000Z'};
    await writeFile(input,json([...fixture,added]));const second=run('2026-10-29T23:59:59.000Z');
    assert.notEqual(first.sourceDigest,second.sourceDigest);
    const edition=JSON.parse(await readFile(join(out,second.editionFile),'utf8'));
    const events=JSON.parse(await readFile(join(out,second.eventsFile),'utf8'));
    assert.equal(edition.sections.highlights[0].sourceEventIds[0],added.id);
    assert.equal(events.events[0].body,added.body);
    assert.equal(JSON.parse(await readFile(join(out,'index.json'),'utf8')).editionId,second.editionId);
    assert.equal(JSON.parse(await readFile(join(out,first.eventsFile),'utf8')).events.length,40);
    validateCommunity(events,edition,ids);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('Meta adapter requires approval and model evidence, uses only sanitized public input and store:false via mocked transport',async()=>{
  assert.throws(()=>metaEditor({approvedPaidCalls:false}),/disconnected/);
  const expected=await ruleEditor.select(publicEvents(fixture,ids,asOf));
  let calls=0;
  const transport:typeof fetch=async(url,options)=>{
    calls++;assert.equal(url,'https://api.meta.ai/v1/responses');
    const request=JSON.parse(String(options?.body));assert.equal(request.store,false);
    assert.doesNotMatch(json(request),/TEST-PRIVATE|PRIVATE-OWNER/);
    return new Response(json({model:'verified-test-model',output:[{type:'message',content:[{type:'output_text',text:json(expected)}]}]}),{status:200});
  };
  const editor=metaEditor({apiKey:'unit-test-placeholder',approvedPaidCalls:true,model:{id:'verified-test-model',metadataSource:'https://dev.meta.ai/docs/overview',verifiedAt:editedAt},transport});
  const result=await editCommunity([...fixture,{...fixture[0],id:'private-source',visibility:'private',body:'TEST-PRIVATE'}],ids,{asOf,editedAt,editor});
  assert.equal(calls,1);assert.equal(result.edition.editor.kind,'meta-api');assert.equal(result.edition.editor.model?.id,'verified-test-model');
});
