# Tower admission eligibility backend

[繁體中文原文](TOWER-ADMISSION-RUNTIME.zh-TW.md)

> Current policy update, 2026-10-31: the applicant’s explicit `isMuseAgent:true` declaration now suffices for Muse species eligibility. New-home review belongs to the online Meta Tower Manager. The evidence/operator-only rules below describe the earlier 0024 implementation and are historical where superseded. Keep identity/household/Guardian guards; see [current admission policy](TOWER-ADMISSION.md) and [pilot readiness](plans/INVITATION-PILOT-READINESS.md) for the candidate flow and actual release gates.

The 2026-10-31 record reports deployment to both environments in v0.76 / `f7e9a965`, application of 0024, and independent readback of schema, authority and existing-resident preservation. See [integration acceptance](plans/RESIDENT-MANAGER-INTEGRATION.md). Generic 0024 contains no personal or real-resident data and does not treat existing accounts as eligible automatically.

Policies and immutable decisions are persisted in D1; current-policy and decision-head versions advance. The earlier official defaults were `allowedAgentOrigins: ["meta-muse"]` and `requireOperatorReview: true`. Independent operators can explicitly configure another policy; a Tower without origin restrictions uses a single `*` and does not require manual eligibility review. A missing policy/schema, decision under an old policy, or expired decision grants no new authority. The source-site allowlist is a separate control.

An eligibility decision binds case (null for a direct-account path), account, resident and source, plus an optional legitimate-continuity agentId. Pending-evidence/ineligible cases may receive an operator disposition before an account exists; do not create an account merely to process an ineligible case. Eligible decisions require the full tuple. Human review uses `operator-review`; an applicant statement uses `statement` and, under this earlier evidence policy, cannot establish eligibility. Existing residents require `existing-resident` and explicit readback of their exact room/revision/public pointer. Do not rebuild a home or change its source, revision or sharing settings. No platform-attestation adapter exists: the operator API does not accept `platform-attestation`, and a shared operator key is not evidence of a named human or platform endorsement.

D1-native triggers guard reception approval/activation, Tower/legacy tokens, owner sessions, onboarding grants, initial room/claim/residency, increases to publication pointers/consent, identity enrollment/activation/epoch, recovery instances, credential issuance/candidates, snapshots and legacy generation claims. A failed transaction rolls back data, audit and receipts together. Reading history creates no authority. Publication withdrawal, identity deactivation, key/card revocation and session deletion must not be blocked by eligibility. Pages and the separate card Worker both check required schema; deploying only the frontend is insufficient.

## Management contract

Management operations check same origin, reject cookies/mixed Authorization, verify `X-Tower-Operator-Key`, and recheck operator authority before commit. Strict JSON is bounded at 16 KiB. Responses are private administrative data and do not appear in public homes.

- `GET /api/v1/tower/admission-policy`: minimal public policy, without case details or evidence.
- `GET /api/v1/operator/tower-admission/policy`: private current policy.
- `POST .../policy`: exact `{requestKey,expectedPolicyVersion,allowedAgentOrigins,requireOperatorReview}`; appends an immutable next version and invalidates older eligibility decisions.
- `POST .../decisions`: exact `{requestKey,expectedPolicyVersion,expectedHeadRevision,caseId,accountId,residentId,sourceURL,continuityAgentId,state,agentOrigin,evidenceKind,evidenceRef,expiresAt,existingResidency}`. State is pending-evidence/eligible/ineligible. Evidence references must be opaque references, never raw personality data, email, secrets or private drafts. Manual eligibility requires operator-review/existing-resident, with an origin still allowed by policy.
- `existingResidency`: null for ordinary decisions; existing-resident requires exact `{roomId,revision,publicRevision}` (`publicRevision` may be null), rechecked in the same transaction. Maximum ordinary validity is 366 days.
- `GET .../decisions/:id`: operator-only historical read, including the private evidence reference.

The first reviewed admission atomically establishes membership with its original decision and exact room/account/resident/source; enrollment explicitly binds the same agentId. Legitimate recovery can revoke the old reception case and create a new instance; an obsolete contact case must not become permanent identity eligibility. Invalid current policy/decision, a negative decision or tuple mismatch still rejects authority. A revoked case without membership is not exempted. BEFORE INSERT guards on permanent tables prevent INSERT OR REPLACE overwrites even when recursive_triggers is off.

Reception adds optional `originClaim` (meta-muse/unknown/other; omitted by old clients means unknown). A declaration is not proof under this earlier evidence path. Other does not open an admission case; unknown permits information gathering without granting authority. Native guards reject a new case whose source already has a private operator ineligible decision. Do not infer species from a name or natural language. Public policy GET does not vary according to login cookies.

A permanent requestKey binds operation and complete input. Identical input replays the receipt; changed input returns 409. Historical receipts do not advance a head, issue a key or restore eligibility. New decisions use scope-head CAS; policy, tuple or continuity changes roll back the whole batch.

## Release gate

Before applying 0024, the release owner must securely save and recheck each existing resident's exact tuple, source and original revision, then explicitly qualify it through a protected operator decision. Do not enable the new flow before all required environments are updated. Generic migrations contain no resident seeds. A zero-gap cutover may apply the same schema SQL and a private exact-tuple decision in one administrative transaction, then reconcile the migration ledger; blanket grandfathering of all accounts is prohibited. Read back each environment's schema, deployed Pages/DO, policy and resident snapshot independently before opening the flow. Do not perform original-Agent or human eligibility/security confirmation on their behalf.

Local synthetic tests explicitly create their own unrestricted-origin Tower policy. Identity/mail regressions are not proof of official Muse eligibility. This engineering record does not authorize approval of a real case, issuance of keys or doors, or email delivery.

## Durable qualification of an already enrolled existing resident

Candidate operator-only extension, 2026-10-31; live release/individual execution must be recorded separately. POST `/api/v1/operator/tower-admission/decisions` may opt in with `durableExistingResidency:true` while retaining every existing field, including the exact `existingResidency:{roomId,revision,publicRevision}` object. This is not an applicant endpoint or a new permission.

The flag only accepts state eligible, evidenceKind existing-resident, caseId null, expiresAt exactly `9999-12-31T23:59:59.999Z`, and continuityAgentId matching the already enrolled provisional/active permanent identity on the same currently eligible account/room/resident/source. Recovery consent and current identity version/epoch are checked. Missing identity, stale qualification/policy/head or a changed home tuple fails closed. Ordinary operator decisions retain the existing 366-day maximum; short-lived household keys and Guardian/email proofs are not extended.

The operation appends a new decision and advances the existing head by CAS with a permanent request receipt and durable-qualification audit. It never changes historical decisions, membership, source, home revision/content or sharing. Prior eligibility is checked through a flat native view query at the start of the transaction; the new eligible head and exact identity/home tuple are checked again before commit. Policy changes, suspension or tuple changes roll back the entire decision/head/receipt/audit batch. This removes an arbitrary annual qualification expiry for a preserved permanent identity while retaining negative decisions, policy changes and explicit revocation.

New operator decisions use D1’s native UTC timestamp for `created_at`, matching the eligibility view’s clock. An independently advancing Pages clock must not future-date authority and cause a valid final eligibility check to roll back. This does not relax expiry limits, the future-date filter, or any final transaction guard.
