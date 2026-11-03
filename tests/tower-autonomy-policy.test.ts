import test from 'node:test';
import assert from 'node:assert/strict';
import {CURRENT_AUTONOMY_TASK_POLICY,autonomyTaskPolicy,policyAllowsAppearance} from '../server/live/tower-autonomy-policy.ts';
test('only the explicitly registered seasonal policy authorizes its original local-day window',()=>{
 const policy=CURRENT_AUTONOMY_TASK_POLICY;
 assert.equal(autonomyTaskPolicy(policy.id),policy);
 assert.equal(autonomyTaskPolicy('appearance:future:2027'),null);
 assert.equal(policyAllowsAppearance(policy.id,'2026-10-31','2026-10-31T07:00:00.000Z'),true);
 for(const [id,day,at] of [[policy.id,'2026-10-31','2026-11-01T07:00:00.000Z'],[policy.id,'2026-10-30','2026-10-31T19:00:00.000Z'],['appearance:future:2027','2026-10-31','2026-10-31T19:00:00.000Z'],[policy.id,'2026-10-31','invalid']])assert.equal(policyAllowsAppearance(id,day,at),false);
 assert.equal(Object.isFrozen(policy),true);assert.equal(Object.isFrozen(policy.permissions),true);
});
