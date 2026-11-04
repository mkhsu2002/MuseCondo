# I05c1 private delivery-fact core

English · [繁體中文](IDENTITY-MAIL-DELIVERY-CORE.zh-TW.md)

> English technical translation of the dated record. This does not refresh deployment evidence. Historical flags, limits and pending states below belong to their recorded checkpoint; see [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md) for the accepted release.

## Historical integration record: 2026-10-31

This core and I05c2 Pages/private-Worker administration were deployed together as `f7e9a965`/v0.76 in dev/production.0020–0026 were applied,321 source-DDL objects matched and FK errors were0. Qualification/final-transaction guards and production sender/five-event webhook/signed handler probe were integrated; the earlier dormant slice was no longer the integrated state.

At19:49–19:50UTC delivery flags were still false; production true was staged at19:52:11UTC, then became effective in completed v0.76 deployment snapshots (production=true/dev=false). No real mail was sent in that checkpoint: provider-delivered, usable attachments and human Guardian/recovery acceptance were unproven. Meta independently passed its same-cycle/r0 TaskAudit at20:02UTC and original day/night images were published; this did not substitute for I06/T09, human receipt/recovery or the next actual cron event. See [integration](plans/RESIDENT-MANAGER-INTEGRATION.md) and [mail control](IDENTITY-MAIL-CONTROL.md). These dates are historical, not renewed evidence.

## Original c1 scope and private interfaces

The original2026-10-31 local c1 introduced0022/factory but no Pages/Worker router, provider administration/key, real signing secret, sending, scheduling or remote migration. Its then-pending0020–0022/c2 work cannot describe current integration. It could not be released/enabled alone; delivery flags were unchanged.

`createIdentityMailDelivery({db,origin,contactKey,webhookSecret,now})` accepts no fetcher/API key/arbitrary endpoint. WebhookSecret is a fixed trusted deployed signing secret or safe async getter; fixtures are synthetic.

- `handleWebhook(request)` checks this origin/POST without deciding the public pathname. Read at most64KiB raw bytes, verify svix-id/svix-timestamp/svix-signature HMAC first, then fatal UTF-8 JSON. A BOM is not removed before crypto: signed BOM may authenticate but still fails JSON. Duplicate decoded keys are rejected.
- `applyReadback(opId, providerEmail)` consumes an already-authorized backend result from official GET email with id/from/to/subject/tags[]/last_event. It does no GET/POST/operator authentication. c2 must authenticate, persist intent and perform fixed GET first; public callers never choose arbitrary facts.
- `receipt('webhook'|'readback', id)` returns the original permanent safe outcome or null. Lost-ack reconciliation checks it before a fresh GET; same op ID with another payload conflicts.
- `status(eventId)` returns only event ID, safe state, five flags, observed time and deliveryVerified—not addresses, FROM, subject, body, ciphertext or lease. DeliveryVerified means observed provider-delivered with no negative fact and delivered state, not human reading/download/I06.

The original c2 follow-up needed own-origin setup/administration, encrypted whsec storage, fixed GET/unknown reconciliation, public webhook/protected operator routes, actual dispatch readiness and coordinated deployment checks. c1 grants no new sending authority, never resets sending/unknown to pending, retries POST, consumes quota or invents notices.

## Signature verification and permanent receipts

The [Resend raw-body](https://resend.com/docs/webhooks/verify-webhooks-requests) and [Svix manual](https://docs.svix.com/receiving/verifying-payloads/how-manual) contracts read on2026-10-31 sign UTF-8 `id.timestamp.` followed by exact raw body bytes. Use WebCrypto HMAC-SHA256/subtle.verify, without another SDK. Support space-separated v1 signatures; ignore unknown versions. Signatures are canonical Base64 of32bytes. Secrets allow canonical padded/unpadded Base64 of1–512bytes (the official vector has18), not an invented fixed32byte limit. Svix ID allows128 ASCII ID characters; timestamp at most11 second digits; signature header at most4096bytes.

The attempt’s ±5minute window is separate from event-body time. App clock, initial native clock and final native batch guard all enforce it; rounded epoch milliseconds avoid Julian-day floating-point boundaries. A valid old body can replay with a new attempt timestamp while the permanent receipt survives across days. Invalid signature/host/method/body/expired attempt writes nothing.

Handle only email.delivered/bounced/complained/failed/suppressed. Other valid signed events are acknowledged/ignored without storing shared-account foreign/tracking data. Existing source/ID first checks original HMAC even before ignoring an unsupported/foreign replacement payload, preventing conflict bypass. Payload_hmac binds contact key, origin, event, source, ID and Base64(raw bytes), not raw payload or plaintext SHA-256. New factories/concurrent/lost-ack retries read the permanent result rather than reapplying effects.

## Historical binding and monotonic facts

Require the original32hex identity_event tag, permanent dispatch lease and matching immutable envelope digest/length. Webhook tags use the provider object shape; GET tags use an array with exactly one identity_event. Decrypt original event/purpose-bound mail-envelope control and validate origin/event/template/attachment references. Do not materialize the body, use pending-only qualification, or infer historical eligibility from current FROM/Guardian/card head/recovery/public consent. Historical sent-mail facts remain recordable after card revocation, Guardian change, retired identity or withdrawn publication.

Provider ID cannot overwrite a different known ID; genuine signals may fill null. An ID already belonging to another event is ignored even if from/to/subject match. Final native ownership guards prevent races from assigning one message to two events without rewriting old migrations or adding a cross-finish unique index. FROM strict-parser mailbox and the single complete ASCII TO are compared with ASCII casefold; subject is exact. Addresses never merge identities. Final lease/sealed-context/digest/length/provider-ID/unique-receipt/webhook-window guards commit with all effects in one batch.

`identity_mail_delivery_facts` retains delivered/bounced/complained/failed/suppressed and each first-observed time independently; mail.created_at is not delivery time. State precedence is bounced/complained, then failed/suppressed, then delivered; later positives cannot downgrade existing negative terminals. GET sent/delayed/opened/clicked/queued/scheduled/canceled establishes only accepted/provider-existence, not tracking facts or delivery. Original HTTP finish receipts remain immutable.

Only bounce/complaint/suppressed adds the0021 address block, using `hashPrivate(contactKey,'mail-suppression',complete ASCII email.toLowerCase())`; identity/Guardian email hashes do not change. previous_bounce/previous_complaint map to bounce/complaint. Unknown reason or GET last_event without details uses the existing conservative manual category, which does not assert provider manual action. Preserve the first block reason; later stronger facts have separate audit/facts. Audit stores only allowlisted suppression reason/type, not diagnosticCode/message/raw failure reason. Email.failed alone does not permanently block an address.

## Persistence and local verification

0022 adds three tables/nine triggers: permanent(source,message_id) receipts, first-observed event/fact records and receipt-bound audit, with immutable/permanent and dispatch/envelope/event guards. Receipts also bind origin; safe lookup cannot cross origins. Times require non-null canonical millisecond UTC; ID/HMAC checks include ASCII/BLOB length/allowlists.0012–0021 remain unchanged.

Tests run real b1 prepare→b2 claim, synthetic Svix signatures, WebCrypto and SQLite. Coverage includes official vectors, Unicode/BOM/whitespace/byte changes, multiple signatures, app/native queued clocks, five events/two tag shapes, foreign/no-ledger/metadata/provider-ID isolation, historic revocation/Guardian change, two runtimes/concurrency/lost commit ack/conflicting payload, early webhook/late finish, reordered GET/webhook negatives, casefold, nonblocking failed, safe output and permanent SQL constraints.

Actual negative webhook/readback paths used12/10 SQL statements, below conservative Free50 counting. Captured SQL/binds and complete synthetic DB were compiled in Python3.11+ SQLite using native setlimit:32 function arguments,100 binds,100KB SQL,2MB rows and5 compound SELECTs,26queries. No new CI/cron/polling/public harness. I04/b2 render/large-attachment evidence was reused; this slice did not repaint cards or prove real provider/human receipt.
