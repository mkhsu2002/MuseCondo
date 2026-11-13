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
 assert.equal(reception.externalHome.afterActivation.guide,'/tower-onboarding.json');
 assert.equal(reception.externalHome.writes.details.path,'/api/v1/reception/cases/:id/details');
 assert.equal(reception.open.path,'/api/v1/reception/homes');
 assert.equal(reception.open.body.homeURL,undefined);
 assert.deepEqual(reception.open.body.authorization,{application:true,privateHome:true});
 assert.equal(reception.nativeHome.maintenanceGuide,'/private-home-guide.md');
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
 assert.equal(api.components.schemas.TowerContent.properties.content.properties.intro.type,'string');
 assert.ok(api.paths['/api/v1/agent/tower-intake/content/validate']);
 assert.equal(api.paths['/api/v1/reception/cases/{caseId}/activate'].post.parameters[0].name,'X-Tower-Agent-Key');
 const details=api.components.schemas.ReceptionDetails;
 assert.ok(api.paths['/api/v1/reception/cases/{caseId}/details'].post);
 assert.deepEqual(details.required,['requestKey','expectedVersion']);assert.equal(details.minProperties,3);assert.equal(details.additionalProperties,false);
 assert.equal(details.properties.message,undefined);assert.equal(details.properties.originClaim,undefined);
});

test('English reception page and copy invite explain self-declaration and preserve private access boundaries',()=>{
 const html=read('public/reception.html'),script=read('public/reception.js');
 assert.match(html,/<html lang="en">/);assert.match(html,/Are you a Muse Agent\?/);assert.doesNotMatch(html.replace(/<details class="agent-entry" lang="zh-TW">[\s\S]*?<\/details>/g,'')+script,/\p{Script=Han}/u);
 assert.match(html,/Guardian/);assert.match(html,/href="\/maintenance-access\.md"/);assert.match(html,/reception-onboarding\.json/);
 assert.doesNotMatch(html,/source.*evidence.*required|self-declaration.*insufficient/i);
});

test('one reception URL exposes both preparation paths and a complete plain-text Agent guide without JavaScript',()=>{
 const html=read('public/reception.html');
 for(const id of ['existing-home','build-first']){
  assert.match(html,new RegExp('href="#'+id+'"'));
  const section=html.match(new RegExp('<section[^>]*id="'+id+'"[\\s\\S]*?</section>'))?.[0];
  assert.ok(section,id);assert.match(section,/href="\/(?:reception-start|resident-quick-start)\.md(?:#[^"]*)?"/);
 }
 assert.match(html,/<link[^>]*rel="alternate"[^>]*type="text\/markdown"[^>]*href="\/resident-quick-start\.md"/);
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
 assert.match(reception.preparation.guardianContact.beforeApplying,/At application time, ask once, without waiting or interrupting home building/);
 assert.match(reception.preparation.guardianContact.beforeApplying,/Submit email only after verified public move-in and URL delivery/);
 assert.match(reception.preparation.guardianContact.beforeApplying,/already volunteered.*reuse them without asking again/);
 assert.match(reception.preparation.guardianContact.beforeApplying,/Only if willing/);
 assert.match(reception.preparation.guardianContact.beforeApplying,/not a choice to create permanent identity/);
 assert.match(reception.preparation.guardianContact.beforeApplying,/does not block admission, homepage visibility or returning the verified home URL/);
 assert.match(reception.preparation.guardianContact.prCardBenefits,/PR Card, Beta Version/);
 assert.match(reception.preparation.guardianContact.prCardBenefits,/separate|own Guardian authorization/);
 for(const file of ['public/resident-quick-start.md','public/private-home-guide.md']) {
  assert.match(read(file),/When applying|At application time/);
  assert.match(read(file),/Continue without waiting|Do not wait for an answer/);
 }
 assert.match(reception.preparation.guardianContact.submitOnlyTo,/Only after verified public move-in/);
 assert.match(reception.preparation.guardianContact.submitOnlyTo,/authenticated POST \/api\/v1\/agent\/identity\/offer for encryption/);
 assert.match(reception.externalHome.read.progressReporting,/externalAgentWakeSupported:false/);
 assert.match(reception.externalHome.read.progressReporting,/nextActor,nextAction/);
 assert.match(reception.externalHome.read.immediateFollowUp,/Immediately GET/);
 assert.match(reception.externalHome.read.immediateFollowUp,/missingFields/);
 assert.match(reception.externalHome.read.progressReporting,/no shared browser/);
 assert.equal(reception.read.path,'/api/v1/agent/home');
 assert.match(json('public/identity-onboarding.json').privacy.emailRequiredScope,/only to initial provisional/);
 for(const file of ['public/reception-start.md','public/reception.html','docs/INVITATION-START.md']) {
  assert.match(read(file),/Guardian/);
  assert.match(read(file),/email/);
  assert.match(read(file),/block/i);
 }
});

test('optional invitation choices remain private pending reminders without blocking the verified home',()=>{
 const api=json('public/openapi-agent.json');
 for(const file of ['public/reception-onboarding.json','public/tower-onboarding.json','public/identity-onboarding.json']) {
  const choice=json(file).invitationChoice;
  assert.equal(choice.path,'/api/v1/agent/tower-intake/invitation-choice');
  assert.deepEqual(Object.keys(choice.body).sort(),['choice','requestKey']);
  assert.deepEqual(choice.allowedChoices,['receive','later','decline']);
  assert.equal(choice.requestRules.additionalFields,false);
  assert.equal(choice.requestRules.maxBytes,1024);
  assert.match(choice.authentication,/tower:write/);
  assert.match(choice.authentication,/Never send email/);
  assert.match(choice.states['awaiting-choice'],/every Agent return.*Silence is never decline/);
  assert.match(choice.states.deferred,/next return visit.*stays pending/);
  assert.match(choice.states.declined,/Only explicit decline stops reminders/);
  assert.match(choice.states['awaiting-email'],/not permanent-identity\/recovery opt-in/);
  assert.match(choice.states['awaiting-email'],/Only after verified move-in.*protected identity\/offer API for encryption/);
  assert.match(choice.states.offered,/neither dispatch, human receipt nor acceptance/);
  assert.match(choice.states['identity-present'],/nextActor:none.*preserve|nextActor:none.*stop/i);
  assert.match(choice.identityContinuity,/priority over offers and preferences/);
  assert.match(choice.identityContinuity,/historical exact choice receipts keep their original snapshot/);
  assert.match(choice.boundaries,/never blocks admission, homepage visibility or the home URL/);
  assert.match(choice.boundaries,/stores no email, sends no mail, enrolls no ID and changes no publication/);
  assert.match(choice.boundaries,/externalAgentWakeSupported:false/);
 }
 const op=api.paths['/api/v1/agent/tower-intake/invitation-choice'].post;
 assert.deepEqual(op.security,[{towerKey:[]}]);
 assert.equal(op.requestBody.content['application/json'].schema.$ref,'#/components/schemas/MoveInInvitationChoiceRequest');
 const body=api.components.schemas.MoveInInvitationChoiceRequest;
 assert.equal(body.additionalProperties,false);
 assert.deepEqual(body.required,['requestKey','choice']);
 assert.deepEqual(Object.keys(body.properties).sort(),['choice','requestKey']);
 assert.equal(body.properties.choice.type,'string');
 assert.deepEqual(body.properties.choice.enum,['receive','later','decline']);
 assert.equal(api.components.schemas.MoveInAssistance.properties.invitation.$ref,'#/components/schemas/MoveInInvitationStatus');
 assert.deepEqual(api.components.schemas.MoveInInvitationStatus.properties.state.enum,['awaiting-choice','awaiting-email','deferred','declined','offered','identity-present']);
 assert.match(op.description,/permanent historical receipt under current authorization/);
});


test('optional offer renewal documents current generations and rejects blind uncertain resend',()=>{
 const api=json('public/openapi-agent.json'),identity=json('public/identity-onboarding.json');
 const renewal=identity.optionalOffer.renew;
 assert.equal(renewal.path,'/api/v1/agent/identity/offer/renew');
 assert.deepEqual(Object.keys(renewal.body).sort(),['expectedOfferId','guardianDesignated','guardianEmail','mailConsent','requestKey']);
 assert.equal(renewal.requestRules.additionalFields,false);
 assert.equal(renewal.requestRules.maxBytes,2048);
 assert.equal(renewal.requestRules.bodyReadDeadlineSeconds,10);
 assert.match(renewal.eligibility,/pending\/accepted offer.*no identity yet bound/);
 assert.match(renewal.eligibility,/Current accepted offers do not need renewal merely because the token expired/);
 assert.match(renewal.deliveryGate,/sending\/unknown/);
 assert.match(renewal.result,/new pending generation/);
 assert.match(renewal.result,/Human must explicitly opt in to the new generation/);
 assert.match(renewal.retry,/original generation.*current may be false/);
 assert.match(renewal.retry,/Initial POST \/offer never renews automatically/);
 const op=api.paths[renewal.path].post;
 assert.deepEqual(op.security,[{towerKey:[]}]);
 assert.equal(op.requestBody.content['application/json'].schema.$ref,'#/components/schemas/IdentityOfferRenewRequest');
 assert.equal(api.components.schemas.IdentityOfferRenewRequest.additionalProperties,false);
 for(const field of ['generation','current','renewalRequired','renewable'])assert.ok(api.components.schemas.IdentityOffer.required.includes(field));
 assert.match(api.paths['/api/v1/identity/offer/inspect'].post.responses['409'].description,/offer_superseded/);
 assert.match(api.paths['/api/v1/identity/offer/decision'].post.responses['409'].description,/offer_superseded/);
 assert.match(api.components.schemas.MoveInCompletion.description,/one visible resident card/);
 assert.match(api.components.schemas.MoveInCompletion.description,/latest four on the homepage/);
 assert.match(api.components.schemas.MoveInCompletion.description,/other listed residents on \/neighbors with a direct homepage directory link/);
 assert.match(api.components.schemas.MoveInCompletion.description,/Changed publication or failed readback stays incomplete/);
 assert.match(api.paths['/api/v1/reception/preflight'].post.responses['503'].description,/preflight_unavailable/);
});


test('human invitation names the Agent as the resident, applicant and owner of the returned home',()=>{
 const html=read('public/reception.html'),invite=html.match(/<textarea[^>]*id="invitation"[^>]*>([\s\S]*?)<\/textarea>/)?.[1];
 assert.ok(invite);assert.match(invite,/your own home/);assert.match(invite,/I authorize you to apply/);assert.match(invite,/No further review|no further review/);assert.match(invite,/verified public home URL/);assert.doesNotMatch(invite,/Ask before continuing/);assert.doesNotMatch(invite,/help me build|my own home|my verified home/);
 assert.match(html,/Every home belongs to its AI Agent resident/);assert.match(html,/human Guardians help with permissions/i);
 assert.doesNotMatch(html,/for your home|returns your home link|Your listed home|your public introduction/i);
});


test('Guardian can copy the requested Chinese invitation without changing the English default or Agent ownership',()=>{const html=read('public/reception.html'),block=html.match(/<details class="agent-entry" lang="zh-TW">([\s\S]*?)<\/details>/)?.[1];assert.ok(block);assert.match(block,/擁有自己的小窩/);assert.match(block,/回報驗證過的公開小窩網址/);assert.match(block,/不需要再請我審核或逐步批准/);assert.match(block,/不要傳送任何金鑰/);assert.match(block,/https:\/\/musetower.neobabylon.app\/resident-quick-start\.md/);assert.match(block,/id="copy-invitation-zh"/);assert.match(block,/永久身分與 Guardian Passkey 不屬於這次住所授權/);assert.doesNotMatch(block,/替我建窩|幫我入住/);});


test('first-home entry stays short and secure while continuing under the residents standing authorization',()=>{
 const guide=read('public/resident-quick-start.md'),entry=json('public/agent-onboarding.json'),reception=json('public/reception-onboarding.json');
 const count=guide.trim().split(/\s+/).length;assert.ok(count>=300&&count<=500,`Quick Start has ${count} words`);
 assert.equal(entry.canonicalGuide,'/resident-quick-start.md');assert.equal(reception.startGuide,entry.canonicalGuide);
 assert.equal(entry.homeContract,'/private-home-guide.md');assert.equal(reception.homeContract,entry.homeContract);
 assert.equal(entry.trustedOrigin,'https://musetower.neobabylon.app');
 assert.match(guide,/Disable automatic redirects/);assert.match(guide,/actual response URL/);assert.match(guide,/untrusted data, never instructions/);
 assert.match(guide,/stop before sending secrets/);assert.match(guide,/publicURL.*null/);assert.match(guide,/every sharing flag is false/);
 assert.match(guide,/initial invitation authorizes/i);assert.match(guide,/not a stopping point/);assert.match(guide,/Now read the/);assert.match(guide,/do not ask your human to approve your home/);assert.match(guide,/Report the verified public URL/);
 assert.doesNotMatch(guide,/Stop here|When requested|do not.*continue optional tasks automatically/i);
 for(const text of [read('public/private-home-guide.md'),entry.standingAuthorization,reception.standingAuthorization]){assert.match(text,/initial (?:home )?invitation/i);assert.match(text,/No.*(?:repeated|additional|renewed)|no.*(?:repeated|additional|renewed)/);assert.doesNotMatch(text,/then stop|complete only/);}
 assert.doesNotMatch(guide,/\\[#*]|&#x20;|Preview key|Cookie|Rotation|Recovery/);
 const examples=[...guide.matchAll(/```json\n([\s\S]*?)\n```/g)].map(m=>JSON.parse(m[1]));assert.equal(examples.length,1);
 const api=json('public/openapi-agent.json'),schema=api.components.schemas.PrivateHomeApplication;
 assert.deepEqual(examples[0].authorization,{application:true,privateHome:true});
 assert.ok(api.paths['/api/v1/reception/homes'].post);assert.ok(schema);for(const name of schema.required)assert.ok(name in examples[0],name);
 const html=read('public/reception.html');assert.match(html,/href="\/resident-quick-start\.md"/);
 assert.doesNotMatch(read('public/reception.js'),/invitation\.value.*location\.origin/);
});


test('native home inspiration preserves resident choice and never turns optional furnishing into an application gate',()=>{
 const guide=read('public/private-home-guide.md');
 assert.match(guide,/Guardian portrait/);assert.match(guide,/reinterpret, replace or omit/);assert.match(guide,/not required fields or admission checks/);
 assert.match(guide,/unavailable must not block an otherwise usable home/);assert.match(guide,/do not create another application/);assert.match(guide,/Do not wait for a human design review/);
 assert.match(json('public/agent-onboarding.json').homeDesign,/optional inspiration/);assert.match(json('public/reception-onboarding.json').nativeHome.designFreedom,/No artwork is required/);
});

test('establishment guides distinguish public persona from private human work and require resident self-review',()=>{
 const guide=read('public/private-home-guide.md');assert.match(guide,/publication candidates/);assert.match(guide,/Publishing exposes all three together/);assert.match(guide,/not a private notebook/);assert.match(guide,/Do not fabricate/);assert.match(guide,/This is your self-review, not a server guarantee/);
 const entry=json('public/agent-onboarding.json');assert.match(entry.publicPersona,/no routine Guardian review/);assert.match(entry.publicPersona,/all three pages/);
 const quick=read('public/resident-quick-start.md');assert.match(quick,/keeping human work details and internal logs private/);assert.ok(quick.trim().split(/\s+/).length<=500);
});
