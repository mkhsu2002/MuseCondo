import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const json=file=>JSON.parse(readFileSync(new URL('../public/'+file,import.meta.url),'utf8'));
test('post-intake contract includes resident nomination, human setup and actual card attachments',()=>{
 const guide=json('identity-onboarding.json');
 assert.equal(guide.modeScope,'initial-enrollment-result-only');
 assert.deepEqual(Object.keys(guide.guardianInvitations.nominate.body).sort(),['attestGuardianDesignated','email','expectedVersion','recoveryConsent','requestKey']);
 assert.equal(guide.guardianInvitations.nominate.body.recoveryConsent,true);
 assert.ok(guide.steps.some(step=>step.includes('signed JSON')));
 assert.doesNotMatch(JSON.stringify(guide),/fangdorami|mksaid2025/);
});
test('identity OpenAPI separates household keys, recovery candidate and human/public routes',()=>{
 const api=json('openapi-agent.json'),paths=api.paths;
 for(const path of ['/api/v1/identity/keys','/api/v1/identity/verify/{credentialId}'])assert.deepEqual(paths[path].get.security,[]);
 for(const path of ['/api/v1/identity/guardian/registration/options','/api/v1/identity/guardian/registration/complete','/api/v1/identity/guardian/recovery/context','/api/v1/identity/guardian/recovery/options','/api/v1/identity/guardian/recovery/complete'])assert.deepEqual(paths[path].post.security,[]);
 assert.deepEqual(paths['/api/v1/identity/recovery/requests'].post.security,[{identityCandidate:[]}]);
 assert.deepEqual(paths['/api/v1/identity/recovery/requests/{requestId}'].get.security,[{identityCandidate:[]}]);
 assert.equal(api.components.securitySchemes.identityCandidate.name,'X-Identity-Candidate-Key');
 for(const path of ['/api/v1/agent/identity/enroll','/api/v1/agent/identity/guardian-invitations','/api/v1/agent/identity/card/issue'])assert.deepEqual(paths[path].post.security,[{towerKey:[]}]);
});
