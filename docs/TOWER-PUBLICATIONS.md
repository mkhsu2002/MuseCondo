# Tower publications and scene collection

Status: 2026-11-03 implementation candidate; see [NEXT](plans/NEXT.md) for actual deployment, visual approval and publication acceptance. Existing v1.62 remains the released baseline until a verified release is recorded. No image or issue is represented as published by this design document.

## Cloud ownership

The existing private `tower-manager` Worker queues publication tasks in a separate `ManagerClock` Durable Object named `tower-publications`. Its alarms call the protected Pages Functions step endpoint. Only deployed Pages Functions hold Meta and email provider credentials; the Worker and operator client carry protected trigger credentials. No local process generates Tower images or sends provider email. Existing daily schedules, unrelated duties, namespace and cost limits remain unchanged.

Each scene uses three bounded cloud stages: planning, image editing with the original reference attached, and independent visual checking against both the reference and stored result. Shared `manager_jobs` receipts account for every paid call; the scene call ledger records its purpose, model, real provider request ID when available and usage. Unknown outcomes stay held and are never blindly paid again. Immutable R2 artifacts bind PNG dimensions, SHA-256 and D1 metadata. Private previews require operator authorization; public routes expose only approved artwork metadata/bytes.

## Fixed visual reference

Master: `public/tower/muse-tower-reference-v1.png`, 1086×1448, SHA-256 `6f68c848ff2883ef903521f709edc3f4c78356652cbfbd8975b4c285b76f5d96`. This is the maintainer-supplied original, separate from the homepage hero. Every image request re-reads and verifies its exact bytes. Bible `tower-v1` preserves the stepped ivory tower, rounded modular windows, monumental open arches, amber interiors, planted terraces, curved glass roof pavilions and dusk palette. The internal catalog fixes ten distinct corners. These are architectural artwork, not records of invented residents or events.

The maintainer requested a visual gate: generate only private seed01 (arrival court), seed02 (atrium) and seed05 (rooftop greenhouse) first. Explicit confirmation is required before recording style approval, generating the remaining seven, or publishing initial scenes. Native SQL guards enforce this boundary. After approval, finish and inspect batch one of five before batch two of five; never generate more than six per batch. Reference changes require a new version rather than overwriting historical artifacts.

## Public routes and source boundaries

- `/tower-weekly`: historical issues; `/tower-weekly/:issueId`: immutable issue.
- `/tower-scenes`: accumulating scene collection.
- `/api/v1/public/tower-weekly` and `/api/v1/public/tower-scenes`: safe public data.
- `/api/v1/tower/scenes/:id.png`: approved image only.

HTML routes intentionally avoid `/tower/*`, which is reserved for static assets in the Pages routing policy. The shared SSR/client renderer preserves the homepage hero/video and resident doors. Artwork captions and alternative text describe only the scene; internal prompts, provider choices, generation checks and operational instructions never appear in public output.

Weekly facts come only from connected, non-test Tower households and currently authorized public revisions. Newcomer dates use original admission dates. Journals use selected snapshot daily entries or eligible legacy public posts, with explicit dates and stable identities; private drafts/memory and independent nonmember homes are excluded. Source/revision/consent guards run inside publication transactions and on public reads. Aggregate counts require a separate approved deployment flag.

A published weekly issue must have one approved scene. The inaugural issue requires all ten initial works; later issues add one new scene. An incomplete scene blocks the issue and notice. The issue and its permanent Lord outbox event are inserted atomically, followed immediately by deployment-side dispatch. Provider acceptance, delivery confirmation and human reading are separate facts. Recipient HMAC binding, permanent single-dispatch receipts, daily bounded recovery and signed webhook facts preserve the existing identity-email service. Future guardian subscriptions are outside this release.

## Environment contract

Migrations `0038`–`0040` add weekly, notification and scene storage/audit/guards. Both dev and production must receive identical schema and matching Functions/Worker/frontend code. Feature bindings are `TOWER_SCENES_ENABLED`, `TOWER_WEEKLY_ENABLED`, `TOWER_PUBLICATION_MAIL_ENABLED`, `TOWER_PUBLICATION_AGGREGATE_APPROVED`; the Lord recipient is a server-only secret binding. Required existing dependencies include `ASSETS`, `MANAGER_ASSETS`, `MANAGER_RUNTIME`, the protected schedule trigger, approved Meta authorization and unchanged shared budgets. Development keeps paid generation and real mail disabled. Initial production preview release enables scenes only; weekly/mail publication remains disabled until subsequent acceptance.

Validate exact deployed source, schema, bindings, private Worker bytes and live public/protected behavior together. Tests and build success alone are not production acceptance. Keep raw recipient details, credential material, provider payloads and private previews in the private operations evidence directory. Track completion and remaining gates in NEXT; do not mark N1/N2 complete at the preview stage.
