# I05a sender-domain readiness diagnostics

English · [繁體中文](IDENTITY-MAIL-READINESS.zh-TW.md)

> This is the English technical translation of the dated record. Translation does not refresh deployment evidence or historical pending states. For the current accepted release, use [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md).

## Historical integration context

The original I05a slice is not current release status. The v0.94–v0.96 production sequence verified sender/handler readiness before Fang’s first Guardian invitation and delivered that accepted invitation once through the deployed transactional path. At that checkpoint, delivery of an invitation did not establish human Passkey/backup completion, active identity, usable PDF/signed-JSON attachment receipt or recovery. See [integration](plans/RESIDENT-MANAGER-INTEGRATION.md), [post-intake steps](IDENTITY-AFTER-INTAKE.md) and the current release index rather than treating these historical pending statements as current facts. Provider credentials remain deployed; readiness expires and must be checked for a later send. No unattended readiness refresh was claimed.

## Original implementation scope: 2026-10-31

The subsequent local b2a dispatch/Pages streaming work is documented in [dispatch](IDENTITY-MAIL-DISPATCH.md). Its then-unpublished state and the earlier slice below are historical, not permission to restore the old direct-send path.

This slice offered only operator-only deployed Resend domain-metadata checks: no email, webhook creation or DNS change. It did not complete I05 attachment delivery/receipt. `identity-card` and `security-notice` events remained pending under their contracts; existing Guardian behavior was unchanged. No new UI or scheduler: new scheduled invocations and empty runs both0.

## Private endpoint

Exact `POST /api/v1/operator/identity/mail-readiness` authenticates the same-environment `X-Tower-Operator-Key` against deployed `TOWER_OPERATOR_KEY`. Body is only `{"requestKey":"operator-chosen-key"}`:8–96 printable ASCII characters, maximum1024 UTF-8 JSON bytes. Reject duplicate keys, extra fields, queries (including an empty query), wrong host/Origin, cross-site requests, Cookie and non-POST methods. Unauthorized/invalid input causes no write or provider access. Callers cannot supply FROM, domain, recipients, keys, URLs or content.

Only the deployed Pages Function temporarily uses `IDENTITY_MAIL_API_KEY`; it is never retrieved into local/runner processes. `IDENTITY_MAIL_FROM` comes from deployment configuration. Its parser permits one ASCII dot-atom mailbox and an optional plain display name without RFC-special characters. Reject controls, address lists, comments, unmatched brackets and invalid domains/IPs. Unsupported syntax is unknown, not a guessed sender. Extract only its exact normalized case-insensitive DNS domain, never a parent domain. Raw FROM/address is absent from responses and audit.

## Fixed provider reads

The Function GETs `https://api.resend.com/domains?limit=100`, following `has_more=true` with the page’s last ID as `after`, at most10 pages. After an exact match it GETs `/domains/:id` and independently checks status and capabilities.sending. A shared15second deadline includes body reads; each successful body is at most128KiB, each error body4KiB. workerd-compatible `redirect: manual` rejects3xx before body parsing; never follow Location or forward Authorization. Missing configuration means no network access.

Domain missing is established only by a complete valid traversal. Empty pages with continuation, repeated/cyclic IDs, excess pages, invalid/duplicate/oversized JSON, unknown status/capability and timeout are unknown. Detail ID/domain must match the selected entry. Other domains/IDs/DNS records and raw provider bodies/messages/secrets are neither stored nor returned.

Provider refusals preserve original HTTP status and only allowlisted official `providerErrorName` values, for example `restricted_api_key`. Insufficient metadata permission makes this diagnostic unknown; it does not establish an invalid key or justify rotation. Prefix/length guesses cannot establish credential validity.

## Responses and permanent state

| Result | Meaning |
| --- | --- |
| `200 ready` | Exact domain verified and sending enabled; senderReady=true proves only this sender observation. |
| `200 not_ready` | A complete valid list has no exact domain, or the domain is unverified/sending disabled; senderReady=false. |
| `503 unknown` | New refusal, incomplete/untrusted data or missing configuration; senderReady=null. Preserve providerHttpStatus and allowlisted providerErrorName. |
| `202 checking` | Permanent intent exists, work is unfinished; replay does not recheck or establish health. |
| `409 request_key_conflict` | Original FROM/origin changed, including display-name/case-only changes. |
| `429 mail_readiness_rate_limited` | Same environment reached10 distinct logical checks/hour. |
| `503 mail_readiness_unavailable` or `audit_unavailable` | Diagnostic schema/persistence unavailable; not a pass. |

New diagnostic dependency failures use503 instead of502 so edge error pages do not replace application JSON. The [Custom Errors documentation](https://developers.cloudflare.com/rules/custom-errors/) read for the implementation excludes503 from Error Pages; actual deployed behavior still requires readback. This neither turns errors into200 nor changes zone settings. Existing receipts with response_status=502 replay their original JSON/status byte-for-byte, without changing audit/quota/checkedAt.0019 already allowed503; no new migration was needed.

All results retain deliveryVerified=false. PDF/JSON attachments, frozen envelopes, exact dispatch, signed delivery/suppression webhook and unknown reconciliation were later slices; senderReady must not be represented as completed delivery acceptance.

`0019_identity_mail_provider_checks.sql` adds `identity_mail_provider_checks`, `identity_mail_provider_audit` and four permanent/immutable triggers. It does not borrow account-bound tower_audit or invent a global account. Purpose-separated SHA-256 hashes retain requestKey and FROM/origin binding; domain may be stored, but not raw FROM, recipient, secret or provider body.

Reservation, the `identity-mail-provider:global`10/hour rate counter and intent audit commit in one D1 batch before provider reads. Sanitized outcome/completed audit commit together afterward. Same key/input permanently replays the original response/status without quota/network work; concurrent identical keys produce one logical check. Unknown is not automatically retried. Interrupted checking is retained, not reclaimed by replay. Failed completion audit returns unknown; lost commit acknowledgement is resolved by reading the permanent receipt, not repeating the provider request.

A requestKey returns the historical checkedAt snapshot. Refresh—including after DNS/permissions/provider configuration changes—requires a new requestKey and new hourly quota. Checking/unknown are not healthy.

## Release boundary and historical readback

Missing diagnostic schema fails only this endpoint closed; it is not added to platform-wide requiredTables. The recorded release required actual0019 application and checks of two tables/four triggers/FKs, deployed Pages code/bindings and same-environment authorization, missing-configuration, replay/audit/quota behavior. Intentionally unconfigured dev remains unknown/no-network. The contract alone is not migration/deployment/live evidence.

Primary provider contracts were read during that original implementation: [List Domains](https://resend.com/docs/api-reference/domains/list-domains), [Retrieve Domain](https://resend.com/docs/api-reference/domains/get-domain), [Resend OpenAPI](https://github.com/resend/resend-openapi/blob/main/resend.yaml). The architecture follows global newsletter-worker-standard.

On2026-10-31, v0.64 was deployed to both environments,0019/146 source-DDL objects matched and diagnostics were exercised. Production sender metadata was verified/sending-enabled; dev stayed unconfigured/unknown. Permanent snapshots, quota and intent/completed audit passed. No email was sent; deliveryVerified=false. Other deployments cannot inherit this observation as proof of their own readiness. Historical v0.62/502 details are in the [stage record](plans/AGENT-IDENTITY.md).
