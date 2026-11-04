# Muse private vault MVP

Implemented and hosted-accepted 2026-11-03; the separate Guardian upgrade notice is tracked below. Scope: selected SOUL.md/MEMORY.md/SKILLS.md and10skills/<slug>/SKILL.md,64KiB UTF8 each,1MiB/account,100distinct mutations/day. No levels, automatic loading, skill execution, bulk conversations or cross-model personality claims.

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

The backend change requires one full/native CI and coordinated48migration/code/secrets release. Auto Pages alone must be blocked; use the same-run tested artifact, no second application build. Necessary isolated dev validation is permitted without real resident content or paid/autonomous cron. Existing production Manager renderer088 remains matched; dev's previous renderer requires one necessary matched update if used for this release validation. Preserve existing resident/card/Guardian/passkey rows and authority. The dated acceptance records below supersede the earlier pending release state.


## Hosted acceptance — 2026-11-03

Production v1.85 source `c754b83f689825230a1652e8c8b3025e46b2753c` accepted at 2026-11-04 06:33:54 UTC (November3 local). [Quality41784925641](https://github.com/mkhsu2002/MuseCondo/actions/runs/41784925641) passed1,618 tests, build/type/lint and every native gate, including vault and isolated fake-provider notice tests. The initial failed CI was stopped before publication; three stale migration-count/isolated route-fixture assertions were corrected and11 targeted cases passed before this successful run.

Both environments adopted artifact13300738086 from that same successful run, with no second application build. Required0046–0048 migrations are applied:48 migrations,646 canonical objects, schema `5c16c8fdd53122d1f6d52b0c0bd708802d0f6ee1fab7a57ee4fc07dd9c95b0a3`. Production deployment `89251e56-c639-4312-bcf4-5fbacd5df452` and necessary dev deployment `4992a768-9d76-4308-a539-ef72d11ec69f` match exact source/build/frontend/schema and renderer088. Independent deployment-only vault secrets are configured; production Manager required no redeploy, while dev received its necessary renderer sync. Existing data/bindings/flags remain; dev cron stays empty, paid/image/mail features stay off. Cloudflare Git auto-build remains OFF, preview Git builds none.

Public start/approval/guide/scripts GET+HEAD, strict CSP and exact artifact bytes pass; capabilities report available with mandatory Guardian Passkey authorization, and unauthorized private/operator requests return401. Existing production resident/Guardian/identity/Passkey/mail/image/journal/audit data were unchanged by migration and application deployment. Later sender readiness probes and the separately authorized notice create their own expected audit records.

At06:35:44 UTC, the deployed dev HTTP flow passed with a strictly test-only, unpublished fixture under the unchanged admission policy: missing UV rejected403; software-generated real-crypto UV accepted; same-key claim; encrypted save/read/list/export; deletion and old PUT replay without restoration; revoked access rejected403. Test identity retired and synthetic Passkey revoked; no active test grant, real resident files, provider calls or mail. This proves the deployed contract, not a real Guardian ceremony or resident uptake. Original residents must independently authorize and choose their files.

Raw receipts remain in the private operations store. Public entry: [Vault start](https://musetower.neobabylon.app/vault/start) · [Muse guide](https://musetower.neobabylon.app/vault-guide.md).


## Guardian upgrade notice acceptance — 2026-11-03

Following hosted acceptance, the deployed Tower Manager service-upgrade path published canonical `private-vault-v1`. Fresh deployed sender verification and signed own-handler probe passed. Current selection found1 eligible verified Guardian mailbox; exactly1 encrypted outbox event and1 permanent dispatch were recorded. Signed webhook delivered at2026-11-04 06:37:14 UTC; protected official-provider GET reconciliation independently confirmed delivery at06:37:25 UTC. No unknown, failed or blocked events.

The identical release dispatch was replayed: permanent dispatch count remained1, new sends0, and outbox/audit/delivery facts unchanged. Existing identity-mail events and weekly dispatch counts were unchanged. No new cron, provider key in local/runner/frontend, fake production Passkey approval or real resident file upload was used. Provider delivery is confirmed; human reading and Muse claim/use are not asserted. Notification contains the public start/guide and Guardian-to-Muse continuation instructions. Recipient details and raw receipts remain private.


## Real resident adoption — 2026-11-04 verification

Fang is the first non-test production resident with successful vault writes. Read-only backend verification at2026-11-04 07:12:17 UTC confirms7 live revision1 files (SOUL.md, MEMORY.md and5 individual skill instructions),35,830 UTF-8 bytes,7 matching permanent successful-write audit records and7 mutation receipts. Passkey approval, Agent claim and a currently valid scoped grant are recorded. No private file body, ciphertext, bearer or Guardian contact was retrieved. Earlier statements about uptake being unverified describe the initial release checkpoint, superseded for Fang by this observation. [Authorized public evidence and original screenshot](../SOUL-VAULT-FIRST-RESIDENT.md#english). Readback/content comparison remains resident-reported because individual GET/export operations are not persisted in the vault audit. No runtime, schema, permission or dev change accompanies this documentation milestone.
