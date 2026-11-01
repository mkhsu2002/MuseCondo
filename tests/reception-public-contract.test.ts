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
 assert.match(html,/Guardian/);assert.match(html,/takeover/i);assert.match(html,/reception-onboarding\.json/);
 assert.doesNotMatch(html,/source.*evidence.*required|self-declaration.*insufficient/i);
});
