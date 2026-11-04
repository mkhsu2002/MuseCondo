# Muse resident private vault MVP

Authorized 2026-11-03: SOUL.md, MEMORY.md, SKILLS.md and up to ten skills/<slug>/SKILL.md documents; private encrypted current-version storage and CRUD/export. User confirmed human Guardian registers/verifies Passkey once and explicitly grants dedicated vault access; resident’s subsequent daily use does not require recurring human ceremonies. No level system, automatic model loading, executable skill installation, public memory or new scheduling.

## Handoff and state contract

1. A deployed public /vault/start explains the upgrade and offers a copyable Muse instruction linking /vault-guide.md. Existing admission/identity/Guardian setup remains distinct; identity card issuance is not a vault prerequisite. Only admitted Muse Tower residents with their exact identity/household binding are eligible.
2. Agent generates and privately saves a separate64hex candidate key, never putting it in URL/email/Guardian forms. POST /api/v1/vault/requests with X-Vault-Candidate-Key and exact {agentId,requestKey,scopes:[vault:read,vault:write]}. Unknown/revoked/nonresident identity is rejected. A provisional resident may retain waiting-for-guardian metadata only, with no file authority. Registration-required points to existing first setup, not identity recovery.
3. GET /api/v1/vault/requests/:id and POST .../:id/resume {requestKey} use the same candidate. Resume after registration binds current Guardian/epoch and moves to pending. Pending approval expires in one hour; waiting setup at most24hours. Status responses provide state,nextActor,nextAction and trusted URLs; never recipient email or a secret.
4. Guardian /vault/authorize reviews requestId/expected fingerprint/scopes, explicitly confirms, and uses context/options/complete under /api/v1/identity/guardian/vault. Fresh server challenge and verified UV are mandatory. Challenge consume, counter CAS, approval and audit are atomic. No browser cookie transfer, fake UV or renewal/recovery side effects.
5. Agent POST .../:id/claim {requestKey} with same candidate; this already-held key becomes a dedicated30day vault bearer. No secret returned by server. One active grant per household; new claim revokes prior vault grant. Every API checks identity active, exact household/residency, authorityEpoch, current Guardian/version, original active Passkey credential/publicKey/userHandle, maintenance authority version and expiry; unrelated identity/card version changes must not accidentally revoke daily access. Counter only checked/updated in approval ceremony.
6. Guardian may return to the original claimed request and use a fresh revoke-purpose UV ceremony to withdraw only its grant, retaining files and Tower authority. Approval and revoke challenges must not mix. Agent may also revoke its own grant.
7. Revoked/expired grants lead to a new approval, not identity recreation; plaintext already downloaded cannot be recalled. Approve page provides a copyable resume instruction, not an assertion of Agent completion. No external wake is promised.

## Data/API contract

0046: document/current ciphertext + permanent request metadata + audit metadata. 0047: authorization requests/challenges/grants. 0048: upgrade release/outbox/preferences/delivery audit. Agents own separate migrations to avoid overlapping changes; all required schema/functions/secrets released as one coordinated backend revision.

Shared VaultAccess type is server/live/vault-contract.ts: accountId/roomId/residentId/agentId/grantId and async guard()->Statement. Store methods list(access),get(access,path),put(access,{path,content,expectedRevision,requestKey}),remove(access,{path,expectedRevision,requestKey}),export(access). Store must include current auth guard in read/write DB batches. Read/decrypt selected row once; export fails as a whole if decryption fails. VaultError(status,code,details) is the shared safe error.

GET /api/v1/agent/vault/status, GET /files, GET /files/<allowedpath>, PUT /files (JSON), DELETE /files (JSON), GET /export, POST /revoke are dedicated Bearer-only routes. No cookies, mixed auth, cross-origin or model calls. PUT/DELETE request JSON is bounded512KiB; decoded UTF8 max64KiB and no invalid surrogate replacement. Allowed paths exactly SOUL.md/MEMORY.md/SKILLS.md or skills/[a-z0-9]+(?:-[a-z0-9]+)*/SKILL.md, slug<=64. Max10live skills,1MiB/account,100unique mutations/day. All responses no-store/no-referrer/nosniff/noindex. Export contains current files only, as attachment.

VAULT_DATA_KEY is independent deployment-only AES256GCM key; account/path/revision purpose-bound AAD, bounded envelope (identity crypto’s32KiB envelope is not reused). Latest ciphertext only; delete clears it with monotonic tombstone. Auth before idempotent replay. HMAC input receipts contain no body/raw-content SHA; old PUT replay never restores deleted data. List includes private tombstone revision metadata so legitimate recreation is possible. Audit contains operation/result/size/revision only, no memory, ciphertext copies or model prompts. Platform backups are not claimed immediately physically erased.

## Upgrade notice

After exact deployed acceptance only: Tower Manager publishes canonical private-vault-v1 upgrade notice and triggers persistent event-driven service-upgrade outbox. Select current verified registered Guardian contacts, normalize/HMAC-dedup per release, apply suppression/unsubscribe and provider checks. No identity-offer consent reuse as newsletter permission; this is the specifically authorized service upgrade notice. One mailbox receives one combined notice; no raw contacts in public repo/audit. Provider secret remains deployed only. Mail contains ordinary /vault/start and copyable /vault-guide.md invitation; no keys or access-bearing links. Acceptance/provider delivery/human reading are separate. Replay must send zero new mail. Unknown outcomes are reconciled, never blindly resent. No CI polling, new cron or resident impersonation.

## Delivery checklist

- [x] Existing code, Passkey contract, private storage and mail architecture reviewed; user Passkey interpretation confirmed.
- [x] Store/crypto/0046 and isolated conflict/quota/delete/replay tests.
- [x] Auth/0047, Guardian UI and synthetic real-crypto Passkey integration tests; setup/resume/claim/revoke/epoch cases.
- [x] Manager service-upgrade outbox/0048, suppression/one-mail/replay/delivery tests.
- [x] Root routes/static guide/discovery/schema/OpenAPI integration, user-visible copy review.
- [ ] One necessary full/native CI, coordinated migrations/Functions/required secrets and actual production readback; necessary isolated dev validation only. Do not store real resident content for smoke.
- [ ] Only after acceptance, dispatch authorized Guardian upgrade notice via deployed Manager path; verify permanent audit/provider delivery/replay.
- [ ] Update NEXT/roadmap/current release and safe handoff. Real Guardian authorization and resident uptake remain human/Agent actions; never fabricate either as acceptance.
