# Muse private vault MVP

Implementation 2026-11-03; hosted acceptance pending. Scope: selected SOUL.md/MEMORY.md/SKILLS.md and10skills/<slug>/SKILL.md,64KiB UTF8 each,1MiB/account,100distinct mutations/day. No levels, automatic loading, skill execution, bulk conversations or cross-model personality claims.

## Authority and handoff

Permanent admitted household identity and registered Guardian are prerequisites. Guardian registers/verifies Passkey and explicitly approves the dedicated vault request. Agent keeps its own new candidate key from creation through claim and30day daily bearer use; Guardian receives only requestID/fingerprint. Waiting/resume, pending/approve, approved/claim and expired/revoked/new-request are distinct. UI completion is a continuation message, not authority. Existing home/identity/Tower keys remain; ordinary card versions or Passkey counters do not accidentally revoke access. Epoch/Guardian/credential/maintenance authority changes invalidate the bound grant.

Guardian can revoke an original claimed grant with a fresh revoke-purpose Passkey ceremony, without deleting files or changing Tower authority. Approval/revocation challenges cannot mix and old withdrawal receipts never revoke a new grant.

Every storage read/write includes the current SQL authorization guard; non-vault keys/operator cannot bypass. The local SQLite adapter now returns SELECT rows from atomic batch, matching D1 behavior rather than hiding differences in a fake test adapter. Service errors preserve meaningful auth nextAction.

## Persistence

0046: encrypted current document/tombstone, permanent HMAC-input request receipts and metadata audit.0047: authorization requests/challenges/grants with genuine server-verified WebAuthn UV requirement.0048: canonical Manager upgrade notice, encrypted recipient snapshot, permanent per-release mailbox dispatch, delivery facts and subtype preference. Independent VAULT_DATA_KEY per environment uses purpose/account/path/revision-bound AES-GCM; identity contact encryption is not widened or reused for file payloads. Key rotation requires a separate safe re-encryption procedure.

Files never enter public snapshots/SSR/SEO, Manager context, raw request logs or mail. Export is an authenticated current-content JSON attachment, no persisted plaintext bundle. Only latest ciphertext exists; deleting clears it and retains monotonic revision metadata. Replays cannot restore deleted files. Platform backups and downloaded copies have distinct retention; no immediate physical erasure claim. Skill text may describe dependencies, but scripts/installers/credentials/remote-fetch manifests are not accepted as executable artifacts.

## Interfaces

Public /vault/start and /vault-guide.md explain all steps. /vault/authorize is no-store/noindex with self-only script/connect CSP; rawHTMLaliases redirect. File API under /api/v1/agent/vault requires dedicated bearer. Candidate and Guardian UV paths are under /api/v1/vault and /api/v1/identity/guardian/vault. OpenAPI0.6.0 describes the boundaries. Metadata includes deleted revisions to permit intentional recreation. All private and error responses no-store/no-referrer/nosniff; no cookie/bearer mixing.

## Manager notice

A canonical private-vault-v1 service-upgrade event is specifically authorized by the maintainer. Only current verified registered Guardian relations become recipients; account/room test_only is excluded, one normalized mailbox gets one notice. Local/provider suppression and subtype unsubscribe apply. Provider credentials remain deployed, persistence precedes exact-event dispatch, unknown results never auto-rePOST. Signed shared webhook recognizes a separate service_notice_event tag; readback verifies provider/recipient/tag/body. GET preference links do not mutate; confirmed POST only opts out of service-upgrade notices, not essential security mail. Mail contains public start/Agent-guide and subtype-preference links, no vault or identity authority.

After exact production acceptance, one authorized notice dispatch and zero-send replay are required; provider accepted, delivered and human read are separate. No frontend/runner/local provider key, new polling job or external Agent wake is introduced.

## Verification/release

Focused store/auth/UI/notice/HTTP tests and actual compiled Pages + native D1 exercise synthetic software-authenticator UV, same-key claim, encrypted CRUD/export, no household/operator bypass, tombstone/replay and epoch revocation. This is not evidence of a real human ceremony or original Muse use. Native notice tests use only fake provider with outbound traffic prohibited.

The backend change requires one full/native CI and coordinated48migration/code/secrets release. Auto Pages alone must be blocked; use the same-run tested artifact, no second application build. Necessary isolated dev validation is permitted without real resident content or paid/autonomous cron. Existing production Manager renderer088 remains matched; dev's previous renderer requires one necessary matched update if used for this release validation. Preserve existing resident/card/Guardian/passkey rows and authority. Public delivery and real notice remain pending until the actual acceptance record is appended.
