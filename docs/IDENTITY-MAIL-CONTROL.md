# Deployed identity-mail administration

English · [繁體中文](IDENTITY-MAIL-CONTROL.zh-TW.md)

> English technical translation of the dated record. This does not refresh deployment evidence. Historical flags, limits and pending states below belong to their recorded checkpoint; see [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md) for the accepted release.

## Historical release: 2026-10-31 / v0.76

Identity-mail integration passed separate specification/quality reviews and merged as `f7e9a965`/v0.76 into main and framework-v001. Both Pages deployments succeeded;0020–0026 were applied,321 source-DDL objects matched, foreign-key checks passed and both Identity Workers matched the verified bundle byte-for-byte. See [integration](plans/RESIDENT-MANAGER-INTEGRATION.md).

Production sender metadata was verified/domainVerified/sendingEnabled/senderReady at2026-10-31T19:46:26Z; the own-origin five-event webhook was configured and its real signed handler probe passed at19:47:41Z. These facts did not prove provider delivery or usable attachment receipt. During19:49–19:50Z readback both deployed delivery flags were false; at19:52:11Z production configuration had staged true awaiting deployment, dev remained false. The completed v0.76 deployment snapshots were production=true/dev=false. No real mail was sent in that release; human Passkey/attachment/recovery acceptance was still pending then. These are dated checkpoints, not current or permanent readiness.

## Deployment-owned interface

Only Pages holds `IDENTITY_MAIL_API_KEY`. Administration uses fixed `https://api.resend.com` and the current environment’s `/api/v1/identity/mail/webhook` callback; input cannot specify endpoints, event lists, addresses or provider keys. All deployed fetches use redirect:manual and do not follow non-2xx responses; do not use unsupported Workers redirect:error.

Migration0025 stores setup intent, a permanent create lease, encrypted webhook secret, input HMAC, immutable success/unknown receipts, audit and a one-time handler nonce. Before-insert protection also rejects REPLACE with recursive_triggers disabled. Raw provider bodies, unrelated mail, addresses, credentials/secrets/signatures never enter audit or operator output.

All `/api/v1/operator/identity/mail-delivery/` endpoints require same origin, reject Cookie/mixed Authorization and authenticate the operator before body/provider work:

| Method/action | Exact input and behavior |
| --- | --- |
| POST setup | `{requestKey}`. Persist intent/lease before bounded webhook-list reads. Retrieve the unique own endpoint first. Create only when none exists and this operation owns its unused create lease. Subscribe only delivered/bounced/complained/failed/suppressed, never open/click/sent or polling. |
| POST reconcile | `{requestKey}`. GET known webhook ID or bounded list/retrieve of the unique own endpoint. After unknown create, no match remains unknown: never repeat POST. Multiple matches, pagination limits, wrong events or disabled state are not ready. |
| POST probe | `{requestKey}`. The deployed service signs its fixed callback; only consumption of the permanent nonce by the real signature handler establishes handlerVerified. This is not provider delivery/human attachment receipt. |
| POST event-reconcile | `{requestKey,eventId}`. GET a known provider ID; otherwise inspect at most three100-item summary pages, narrow by frozen from/to/subject/time and retrieve candidates. Only one exact identity_event-tag match may write delivery facts. Zero/multiple matches remain unknown; never send POST. Check the permanent readback receipt before fresh GET so a lost HTTP acknowledgement does not reapply facts. |
| GET status | Safe configuration only, never webhook secret. Handler readiness, sender metadata, accepted/delivered and usable attachment receipt are distinct. |

## Freshness and atomic sending gate

Pages connects administration and the fixed callback. Before suppression reads, DO access or sending, require complete0020–0022/0025 schema, same-environment setup, the latest successful sender snapshot bound to current full FROM/domain/origin input hash, a handler probe within24hours, neither observation in the future, and a webhook signing secret decryptable with this environment’s contact key. A newer pending/negative/malformed sender attempt cannot reuse an older success.

The DO’s final atomic claim rechecks readiness/probe and original identity/attachment authority. A failed guard writes no lease, sending audit or attempt. Sender fields must agree exactly: state complete, HTTP200, ready/domainVerified/sendingEnabled/senderReady, domain, checkId, checkedAt and completed_at. App and native D1 clocks both enforce canonical timestamps within24hours. Final binding includes own endpoint, provider ID, encrypted secret and probe timestamp. Expiry between precheck and claim still blocks sending.

A frozen envelope with old FROM cannot use readiness for a changed FROM. Restore the originally verified FROM or handle that envelope separately. Expired events remain pending, with no suppression GET/send POST/automatic scheduler. Recovery uses **new requestKeys** for mail-readiness, necessary reconcile/setup and then probe; old receipts only prove past outcomes and never refresh expiry. After fresh observations, reprocess only the intended protected event. Credentials stay deployed; no minute polling or local/DO provider key is required. Real activation requires actual provider metadata and own-handler evidence, not synthetic fixtures. On-demand automatic refresh was not implemented in the recorded slice.

Estimated callback load was roughly one final event per normal email, with additional negative changes possible; scheduled invocations/empty runs0. Shared-provider unrelated-event volume was not measured. Signed foreign events are verified then ignored without persisting unrelated payload; estimates are not measurements.

Provider contracts read on2026-10-31: [Create Webhook](https://resend.com/docs/api-reference/webhooks/create-webhook), [List Webhooks](https://resend.com/docs/api-reference/webhooks/list-webhooks), [Retrieve Webhook](https://resend.com/docs/api-reference/webhooks/get-webhook) (signing_secret), [Retrieve Email](https://resend.com/docs/api-reference/emails/retrieve-email) (tags/last_event), [List Emails](https://resend.com/docs/api-reference/emails/list-emails). No nonexistent provider test-event endpoint is used: the own-handler probe is self-signed and separately labeled.

## Historical engineering verification: 2026-10-31

These local slice results retain their original dates and pre-release limits; they do not replace hosted/human acceptance.

R02a concurrent adoption uses native CAS against the original setup snapshot and preserves the first immutable encrypted secret. A losing CAS or stale provider error cannot downgrade concurrent success; a genuinely fresh failed reconcile closes handler readiness. A regression reproduced expected-ready/actual-unknown before fixing it. Both concurrent permanent results became configured with no create POST; fresh503 still closed readiness. No actual key/whsec was read.

R02b `scripts/test-identity-mail-native.mjs <existing-node_modules>` reused esbuild/Miniflare without installing dependencies. It compiled real Pages/private DO under Miniflare5/workerd, compatibility2026-10-30, applied native D1 migrations and seeded separate synthetic households. Only the DO batch boundary injected readiness changes; product classes otherwise ran unchanged. All outbound traffic ended in local stubs and DO outbound was rejected.

Passing cases covered durable intent/create lease, five events/own callback, encrypted secret, consumed probe, zero pre-probe provider requests, final-batch race rollback, exact4,400,000-byte synthetic PDF plus genuine signed-JSON attachments, one POST/lease/finish/sending audit under concurrency/replay, two public internal404s, permanent signed-callback replay, and unknown-send reconciliation with bounded list/retrieve and zero replay GETs. These signals did not establish real provider setup, delivery or attachment receipt.

Removing each required0022/0025 table/trigger failed before provider access; unprobed, unknown/blocked, wrong key/origin or undecryptable-secret cases never entered DO/provider. Maximum attachment path used47 SQL statements; lost-prepare-ack used50. The recorded sender remained `NeoBabylon <residents@neobabylon.app>`, provider secret stayed Pages-only, dev had no provider key and that local slice did not change either environment’s flags or impersonate designated Muse/human participants.

R02a contract-error handling treats empty/oversized/invalid provider JSON as unknown, not caller400/413 that skips setup closure. Provider-ID binding and unknown/probe clearing commit atomically with audit. Failed completion receipt preserves a committed outcome audit; failed outcome audit rolls the whole state back. Unknown-send searches use permanent dispatch.created_at, not possibly days-old event.created_at.

Freshness regressions covered missing/stale/future/wrong-domain/input-hash sender, changed FROM, latest negative sender, stale/future/malformed handler, expiry at native claim, frozen-FROM mismatch and cross-day event search. Compiled Pages/DO/native-D1 stub tests verified zero provider access when blocked, then recovered via actual administration routes against local stubs. Budgets remained47/50 SQL statements. The local combined identity/Pages/live/Tower/admission/source run passed448 tests plus types/scoped lint/diff checks. Historical configured/handlerVerified flags and receipts alone never prove a still-fresh24hour window or unattended long-term mail operation.
