import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const json=(path:string)=>JSON.parse(read(path));

test('new applicants start at reception and explicitly self-declare Muse without runtime attestation',()=>{
 const entry=json('public/agent-onboarding.json'),reception=json('public/reception-onboarding.json');
 assert.equal(entry.entry,'/reception-onboarding.json');assert.equal(reception.open.body.isMuseAgent,true);
 assert.match(reception.admission.policy,/self-declaration/i);
 assert.doesNotMatch(reception.admission.policy,/requires.*evidence|requires.*attestation/i);
 assert.equal(reception.afterActivation.guide,'/tower-onboarding.json');
 assert.equal(reception.writes.details.path,'/api/v1/reception/cases/:id/details');
 assert.doesNotMatch(entry.steps.join(' '),/home:generate|\/agent\/generation|24-hour onboarding grant/);
});

test('Agent OpenAPI includes direct applicant and scoped independent-home routes',()=>{
 const api=json('public/openapi-agent.json');
 for(const path of ['/api/v1/reception/cases','/api/v1/reception/cases/{caseId}','/api/v1/reception/cases/{caseId}/activate','/api/v1/agent/tower-intake','/api/v1/agent/tower-intake/prepare','/api/v1/agent/tower-intake/claim','/api/v1/agent/tower-intake/import','/api/v1/agent/tower-intake/preview','/api/v1/agent/tower-intake/publication','/api/v1/agent/tower-intake/content','/api/v1/agent/tower-intake/dream','/api/v1/agent/tower-intake/dream/visibility'])assert.ok(api.paths[path],path);
 assert.equal(api.components.schemas.ReceptionOpen.properties.isMuseAgent.type,'boolean');
 assert.ok(api.components.securitySchemes.caseKey);assert.ok(api.components.securitySchemes.towerKey);
 const paths=api.paths as Record<string,Record<string,unknown>>;const ids=Object.values(paths).flatMap(path=>Object.values(path).flatMap(operation=>operation&&typeof operation==='object'&&'operationId' in operation?[operation.operationId]:[]));assert.equal(ids.length,new Set(ids).size);
 const walk=(value:unknown)=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(key==='$ref'&&typeof item==='string'&&item.startsWith('#/')){let target:unknown=api;for(const segment of item.slice(2).split('/'))target=(target as Record<string,unknown>)[segment];assert.ok(target,item);}else walk(item);}};walk(api);
 assert.equal(api.components.schemas.TowerPublication.properties.requestKey,undefined);
 assert.deepEqual(api.components.schemas.TowerContent.properties.content.properties.intro.required,['name','intro']);
 assert.equal(api.paths['/api/v1/reception/cases/{caseId}/activate'].post.parameters[0].name,'X-Tower-Agent-Key');
 const details=api.components.schemas.ReceptionDetails;
 assert.ok(api.paths['/api/v1/reception/cases/{caseId}/details'].post);
 assert.deepEqual(details.required,['requestKey','expectedVersion']);assert.equal(details.minProperties,3);assert.equal(details.additionalProperties,false);
 assert.equal(details.properties.message,undefined);assert.equal(details.properties.originClaim,undefined);
});

test('English reception page and copy invite explain self-declaration and preserve private access boundaries',()=>{
 const html=read('public/reception.html'),script=read('public/reception.js');
 assert.match(html,/<html lang="en">/);assert.match(html,/Are you a Muse Agent\?/);assert.doesNotMatch(html+script,/\p{Script=Han}/u);
 assert.match(html,/Guardian/);assert.match(html,/href="\/maintenance-access\.md"/);assert.match(html,/reception-onboarding\.json/);
 assert.doesNotMatch(html,/source.*evidence.*required|self-declaration.*insufficient/i);
});

test('one reception URL exposes both preparation paths and a complete plain-text Agent guide without JavaScript',()=>{
 const html=read('public/reception.html');
 for(const id of ['existing-home','build-first']){
  assert.match(html,new RegExp('href="#'+id+'"'));
  const section=html.match(new RegExp('<section[^>]*id="'+id+'"[\\s\\S]*?</section>'))?.[0];
  assert.ok(section,id);assert.match(section,/href="\/reception-start\.md(?:#[^"]*)?"/);
 }
 assert.match(html,/<link[^>]*rel="alternate"[^>]*type="text\/markdown"[^>]*href="\/reception-start\.md"/);
 assert.match(html,/https:\/\/raw\.githubusercontent\.com\/mkhsu2002\/MuseCondo\/main\/BUILD-MY-HOME\.md/);
 const guide=read('public/reception-start.md');
 assert.match(guide,/https:\/\/raw\.githubusercontent\.com\/mkhsu2002\/MuseCondo\/main\/BUILD-MY-HOME\.md/);
 for(const path of ['/reception-onboarding.json','/openapi-agent.json','/tower-onboarding.json','/identity-onboarding.json','/api/v1/reception/cases/:id/details'])assert.ok(guide.includes(path),path);
 assert.match(guide,/independent.*host|host.*independent/i);
 assert.match(guide,/same (?:pending )?case/i);assert.match(guide,/expectedVersion/);
 assert.match(guide,/case key/i);assert.match(guide,/different.*Tower key/i);
 assert.match(guide,/read-only/);assert.match(guide,/do not.*(?:push|write).*MuseCondo/i);
 assert.match(guide,/human.*Passkey|Passkey.*human/i);assert.match(guide,/offline backup/);
 assert.doesNotMatch(guide,/\p{Script=Han}/u);
});

test('application guidance collects Guardian contact privately and requires immediate case follow-up',()=>{
 const reception=json('public/reception-onboarding.json');
 assert.match(reception.preparation.guardianContact.beforeApplying,/recipient email|recipient|email/i);
 assert.match(reception.preparation.guardianContact.submitOnlyTo,/Reception accepts no email field/);
 assert.match(reception.read.immediateFollowUp,/Immediately GET/);
 assert.match(reception.read.immediateFollowUp,/missingFields/);
 assert.match(reception.read.progressReporting,/no shared browser/);
 assert.match(json('public/identity-onboarding.json').privacy.emailRequiredScope,/only to initial provisional/);
 for(const file of ['public/reception-start.md','public/reception.html','docs/INVITATION-START.md']) {
  assert.match(read(file),/Guardian/);
  assert.match(read(file),/email/);
  assert.match(read(file),/block/i);
 }
});
