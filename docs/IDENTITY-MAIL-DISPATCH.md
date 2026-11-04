# I05b2a private dispatch and streaming core

English · [繁體中文](IDENTITY-MAIL-DISPATCH.zh-TW.md)

> English technical translation of the dated record. This does not refresh deployment evidence. Historical flags, limits and pending states below belong to their recorded checkpoint; see [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md) for the accepted release.

## Historical integration record: 2026-10-31

I05b streaming/exact-event wiring and I05c delivery/administration deployed together as `f7e9a965`/v0.76 in both environments:0020–0026 applied,321 DDL objects matched, no FK errors and private Worker bytes matched the release bundle. Sender/handler/final transaction gates were connected; early b2 slice wording must not imply that readiness remained missing.

Production sender, own five-event webhook and signed handler probe were verified. Flags were false at19:49–19:50UTC; production true was staged at19:52:11UTC and became effective in completed v0.76 deployments (production=true/dev=false). No real mail was sent in this checkpoint; provider delivery/usable attachments remained unaccepted. Independent Meta same-cycle/r0 TaskAudit passed at20:02UTC and original day/night imagery was enabled, without establishing original-Agent/human identity/receipt/recovery, T09 or the next cron event. See [integration](plans/RESIDENT-MANAGER-INTEGRATION.md) and [mail control](IDENTITY-MAIL-CONTROL.md). Dates and pending states are historical.

## Original b2a/b2b local boundary

At the2026-10-31 local checkpoint b2a streaming and b2b three successful-transaction/receipt integrations were implemented against fixed mocks: not pushed/deployed, no remote migration, real credential/provider/email. Signed webhook/readiness/reconciliation belonged to later I05c. The old b1 transport-free factory does not imply production still used the retired direct-send path.

`IDENTITY_MAIL_DELIVERY_ENABLED` must exactly equal true; default is off. A key/FROM alone cannot permit provider access without namespace/contact key/valid origin/schema. Synchronous configured() checks configuration only; processOne reads required schema before provider HTTP, and every DO control checks identityMailSchema. These are not webhook, live-health or human-receipt evidence; a boolean cannot replace actual readiness.

## Private interface and provider transport

Reuse IdentityCardNamespace/IdentityCardCoordinator. Pages routes to256 fixed `mail:<first-two-eventId-hex>` shards. Permanent D1 transactions—not object memory, instance identity or shard uniqueness—provide deduplication. Worker public fetch always404; workers_dev/preview_urls stay false. Pages `/__internal/identity-mail/*` explicitly404s; public card proxy accepts exact card routes only.

Private DO POST `/__internal/identity-mail/` accepts at most2048bytes and exact shapes:

| Action | Input | Private output |
| --- | --- | --- |
| prepare | `{eventId}` | Small `{descriptor,recipient,from}` metadata. |
| claim | `{eventId,bodyDigest}` | Frozen complete JSON Response.body stream and private X-Identity-Mail-Lease header. |
| suppress | `{eventId,bodyDigest,reason}`; bounce/complaint/manual only | `{recorded:true}`. |
| finish | `{eventId,leaseId,state,providerId,errorCode}` | `{recorded:true}`, exact replay unchanged, conflict409. |

FROM/recipient/body/lease circulate only inside private bindings, never public APIs/headers/console/audit. DO has existing contact key/public ring and ordinary IDENTITY_MAIL_FROM, not provider key/SDK/arbitrary endpoint. Match Worker/Pages FROM per required environment; historic envelopes preserve original FROM/bytes. Reuse identityCardTrust’s strict EdDSA/Ed25519 JWK validation and explicit Ed25519 import after removing alg metadata.

Prepare uses b1 qualification/freezing. Small metadata() separately requalifies encrypted binding/original email/template/final native time without reconstructing attachments. Pages GETs only `https://api.resend.com/suppressions/<URLencoded exact email>` with manual redirects. Only404 permits continuation. A200 must match the recorded official object/id/email/origin/source_id/created_at contract and full email (case-insensitive only for suppression policy); negative reasons return to DO for permanent blocking. Even if another instance claimed/canceled the event, the dedicated suppression path verifies immutable envelope/event/bodyDigest, derives the address policy key and persists the negative. It grants no sending authority and returns no body/address. Unknown shapes, redirects, timeout/HTTP failure leave pending without claim. Do not list contacts/account-wide suppressions or marketing preferences.

Claim repeats b1 current qualification, complete chunks, signed JSON/signature and event/purpose HMAC. With no await after obtaining the final guards, pending/attempt0/no-ledger/no-local-block checks, permanent lease, sending state and audit commit in one D1 batch. Only that successful response can return the body. Lost claim acknowledgement leaves sending; there is no body-recovery RPC. Pages never text()/json()/arrayBuffer()/JSON.stringify()s that body: POST the stream directly to fixed `https://api.resend.com/emails`, with permanent event ID as Idempotency-Key and manual redirects.

## 0021 persistence and I05c contract

The original slice added0021 without changing0012–0020 and had not yet applied it remotely:

- identity_mail_dispatches: event_id primary key, unique lease_id, event/purpose HMAC body_digest/body_length/canonical created_at. Insert checks pending/attempt0/envelope binding. Immutable/permanent: no second POST authority even if another component resets pending.
- identity_mail_finish_receipts: event_id primary key, same lease_id, fixed-order small payload_json/canonical created_at. Exact replay succeeds, different outcome409. Webhook/reconciliation records later facts separately, never rewrites original HTTP finish.
- identity_mail_suppressions: recipient_hash from `hashPrivate(contactKey,'mail-suppression',complete ASCII email.toLowerCase())`, original reason/canonical created_at. Permanent block without raw email or silent removal. This purpose differs from case-preserving Guardian-email HMAC: no contact/identity merge. I05c uses the same policy normalization for webhook negatives and preserves first evidence.

Prepared/sending/suppressed/dispatch-finished audit contains no address/FROM/token/body/plaintext-body SHA;0021 protects the latter three audit classes with uniqueness/immutability. Finish keeps state/providerId/allowlisted errorCode. Accepted requires a valid provider ID; unknown uses fixed codes; only unambiguous4xx may be safe rejection.3xx, timeout,408/409/425/429 and5xx are unknown.

Finish never downgrades existing accepted/delivered/bounced/failed/cancelled or overwrites a different known provider ID. Early webhook may establish ID/terminal state before a timeout: preserve both the exact unknown/null-ID finish receipt and known state/ID. Accepted is not delivered. Sending/unknown/accepted/delivered/bounced/failed never obtain another lease. Credential revocation cannot recall sent mail.

## Local validation and recorded limits

All five templates use the real b1 factory/stored D1 chunks/private transport.4.4MB/8MiB PDF payloads are synthetic bytes; signed JSON genuinely signs/verifies and POST bytes equal the frozen body. This is not PDF raster, real-provider or human-receipt acceptance. Tests cover two-instance single lease/POST, final-guard/suppression races, lost claim acknowledgement/provider timeout, exact finish replay/ID conflict/early terminal, router isolation, default-off/missing configuration/schema and safe existing operator status/process.

Maximum8MiB Pages+DO prepare/claim/finish used44 SQL statements normally and47 after lost prepare acknowledgement, below Free50. Queries obey100 binds, SQL<100KB and parameters<1MB. Captured actual SQL/binds and complete synthetic DB passed Python3.11+ native setlimit for32 arguments,100 binds,100KB SQL,2MB row and5 compound SELECTs, rather than relying on permissive Node defaults/helper-string counts.

The production direct-send legacy path was removed. Guardian accept retains its existing configured() prerequisite: default-off delivery makes a new accept503 before consuming its transaction, while completed historical receipts bypass this new-transaction gate. Configuration is not delivery; actual readiness was I05c work.

## b2b exact-event wiring after commit

Each Pages request captures its own environment/context in identityMailEventDispatcher. With context, hand that same event’s processOne promise to waitUntil; otherwise await it. Dispatch-boundary errors cannot turn a successful identity/card transaction into503, revoke it or repeat it. It never enumerates outbox, invents events/leases/keys or overrides permanent b2a outcomes.

- Guardian accept: new commit and prior() exact permanent receipt, including lost commit acknowledgement reread, recover the original invitation/mailEvent IDs. Confirm authorized account, invitation, kind and complete dedupe key against the existing event before callback. Propose/cancel/errors/other scopes do not dispatch. Void/Promise/reject callbacks leave the original receipt/response unchanged.
- Recovery: new commit/central receipt (including inner-batch catch/authenticatedRetry outer catch) first authorize original proof/input hash, then find requestId plus security-notice plus `identity-recovery:<requestId>`, joining original request/Agent/existing receipt. LIMIT2 must yield exactly one. The Passkey new-admission-required branch has no event and invents none; offline repair resumes the original security notice. Epoch/token/instance/Passkey/offline-code permanent outcomes remain intact.
- Card: only exact POST issue/revoke after trusted successful Coordinator response reads a clone; JSON≤4096 UTF-8 bytes with strict shape. CID comes only from core card.credentialId or revokedCredentialId, never caller body. Query existing pending CID/kind/`card:identity-card:<CID>` or `card:security-notice:<CID>` plus credential/household tuple; LIMIT2 must yield one. Issue/reissue/revoke receipt replay resumes the original event. Conditional revocation without a notice creates none. Public verify/keys/metadata/PDF/JSON GET and failed writes never clone/dispatch lifecycle results.

Callbacks are not stored in long-lived factories/inFlight caches; core/DO have no provider key. Public body/status/headers/permanent receipt shapes remain unchanged, without mail controls, addresses, leases, bodies or raw provider output. Default-off/configuration/schema/provider failures preserve pending. Accepted and delivered stay distinct.

Local red/green regressions reproduced missing Guardian/recovery receipt callbacks,0 card POST/waitUntil and real-render card mail left pending. Integration used synthetic households/Guardians, actual Coordinator/repo TTF generating>4MB PDF, genuine signed JSON and frozen-attachment→Pages-stream→fixed stub transport: not Fang/K/real-resident/platform/provider/receipt evidence. Small synthetic-PDF core tests covered issue/reissue/lost-ack revoke single POST; continue/repair tests retained successful recovery+pending mail under default-off/suppression503 and resumed once from the original receipt. Callback rejection, new/lost-ack/historical receipts, cross-household/different bodies, no-notice branches, context/no-context, concurrency and non-lifecycle routes were covered.

The recorded local-server inventory included0018–0021 without provider configuration/namespace/sending. Later release required full I05c gates and matched required-environment0020/0021, FROM, DO, Pages and deployed schema/code/live behavior, not partial/frontend-only upload. This slice added0 cron/polling/CI sending triggers and0 empty runs.
