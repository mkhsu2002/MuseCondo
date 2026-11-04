# I05b1 private frozen-envelope core

English · [繁體中文](IDENTITY-MAIL-ENVELOPE-CORE.zh-TW.md)

> This is the English technical translation of the dated record. Translation does not refresh deployment evidence or historical pending states. For the current accepted release, use [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md).

## English-default template revision recorded on2026-10-31

The revision made subjects, bodies and labels of five newly frozen transactional templates English, as well as new PDF card framework labels. Resident publicName, permanent IDs, signed JSON and existing PDF/JSON artifacts are not translated, re-signed or repainted.

Template_version v1 still identifies the existing event payload/eligibility contract. New encrypted metadata records locale="en", copyRevision="en-1" and prepared audit without schema changes or rewriting old envelopes; these fields are created only at first freeze. Existing envelopes—including Chinese originals—reconstruct their original encrypted subject/text/FROM and attachments and validate the original HMAC body digest. They are not regenerated under new templates, their permanent receipts are unchanged and sent events are not resent. Unfrozen pending events first prepared afterward use English.

The recorded release required matched Pages and private Identity Card/Mail Coordinator Worker revisions in the required environments: render.ts and identity-mail-envelope.ts are both in the Card Worker bundle; Pages also contains WebAuthn display-name/recovery copy. No new migration, dependency, secret or provider request. Local English/legacy exact-byte replay, real PDF text/QR and permanent idempotency tests do not establish production delivery or human acceptance; do not resend invitations just to test translation.

## Original dormant slice and interface

The following state describes the2026-10-31 local slice, not current hosted readiness. Subsequent b2a streaming and b2b exact-event transaction/receipt wiring are in [dispatch](IDENTITY-MAIL-DISPATCH.md). At the original b1 checkpoint,0020 was not remotely applied; there was no HTTP/DO/Pages/provider dispatch, sending lease, scheduling or processOne modification. This slice did not prove delivery.

`createIdentityMailEnvelope({db, origin, contactKey, from, trustedKeys, now})` accepts only the backend’s explicit public Ed25519 CryptoKey trust map. It has no provider secret, fetcher, resident disk data or model dependency. Origin is a complete HTTPS origin; FROM uses readiness’s strict parser.

- `prepare(eventId)` accepts an existing pending32hex event, verifies eligibility/attachments, then atomically and permanently freezes small AES-GCM metadata, an event/purpose-bound body HMAC, UTF-8 length, template version and attachment references with one prepared audit. It does not change event state, attempt_count or quota.
- `materialize(eventId, expectedDigest?)` also requires pending. It rechecks the current four-part household tuple, original event ciphertext, current Guardian/contact and actual template facts, then reconstructs the fixed complete JSON body from immutable chunks. `{body, recipient, from, descriptor, guards}` is private backend material: never public HTTP, console or audit.
- A new factory, time or display-FROM setting still returns the original body for that event. Changed origin, current ineligibility, changed contact/Guardian designation, revoked or superseded credentials block processing without automatic cancellation or a delivery claim.

BodyDigest is HMAC-SHA256 using `hashPrivate(contactKey, "mail-body:" + eventId, encodedBody)`. DB/prepared audit stores this keyed integrity code, not a plaintext body SHA-256 that would permit email dictionary attacks. Same event/body/key replays deterministically; different event, purpose or key changes the code. Existing PDF/JSON manifests retain SHA-256 and64hex contracts.

`guards()` obtains the injected clock at invocation, includes per-chunk/count/signed-JSON guards and ends with the native context guard: at most four SELECTs for card attachments; only context for other notices. Permanent binding preserves original event/household tuple/Guardian/invite/immutable credential-receipt facts. Dynamic context additionally checks current versions, epoch and room revision without permanently freezing legitimate later versions. I05b2 must include `materialized.guards()` and pending-to-sending claim in the same D1 transaction, with no await after the final context guard and no separate lease transaction. Materialization is not sending authority. Non-pending throws IdentityMailEnvelopeError code event_already_processed; other eligibility/digest failures use fixed codes without recipient/raw provider errors.

## Templates and attachments

Only five factual templates exist: Guardian invitation, issued identity card, revoked card, continued recovery and Guardian-verification repair. Initial Guardian confirmation codes exist only in original encrypted payload, frozen encrypted metadata and private body; URLs contain no query secret. Repair does not claim a new Agent ID, admission, transferred home or restoration of unbacked memory. Marketing/newsletter lists do not determine eligibility. Security notices show the original canonical event time and link `/identity/recover`; ordinary card copy labels `/identity` as identity guardianship. A later epoch may exceed the historical recovery epoch, but original receipt/instance (or offline-backup repair history) epoch must match payload.

Card mail includes actual existing PDF and signed-JSON attachments with fixed filenames. D1 raw48KiB chunks are checked for canonical base64, indexes/counts, manifest length/SHA-256, PDF magic, exact stored signed-JSON bytes and genuine Ed25519/issuer/Agent ID/CID against the caller’s trusted keys. Limits: PDF8MiB, JSON16KiB, complete JSON body12MiB. Large base64 is neither envelope metadata nor a single large D1 row. Each guard parameter groups at most14 chunks and stays under1MB. One SELECT per attachment checks all groups; maximum PDF55 binds (<100), no compound UNION.8MiB materialize plus b2 guards/claim/audit and lost-ack reread paths have Free-D150-query-budget regressions.

## Validation and platform limits

Fixtures are synthetic. Small PDF bytes test lifecycle;4.4MB synthetic bytes test body/base64/chunk/digest sizes, not production PDF raster/QR/font acceptance. Original b1 rendering evidence comes from I04, without repainting or reading real residents. b2b later used synthetic households with the real renderer; see dispatch. At the recorded local checkpoint b2a/b2b private streaming, permanent lease, suppression and successful transaction/receipt wiring were complete, while signed webhook, real readiness, reconciliation and combined release remained I05c work.

SQL snapshots use one nested object per alias: inner objects at most12 pairs (24 arguments), outer at most8 pairs (16 arguments); any future layer exceeding16 pairs fails before SQL construction. The [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) used for the implementation were32 arguments/function,100 binds/query,100KB SQL,2MB row and50 queries/Free invocation. Tests capture actual five-template prepare/materialize/guard SQL, copy the synthetic DB over stdin to Python SQLite and use native setlimit/EXPLAIN, including at most5 compound SELECTs. Node SQLite’s wider defaults are not proof of compatibility.8MiB tests check actual bound values,55-bind maximum, parameters below1MB and end-to-end budget. Per-statement counting is more conservative than counting one batch as one query. This establishes compatibility within documented limits, not that two deployed databases were observed rejecting the old SQL.

Native cross-engine tests require Python3.11+ in PATH with standard-library sqlite3.Connection.setlimit/deserialize. No Python package is added. Missing runtime/capability fails clearly rather than skipping tests. This slice did not change CI scope.
