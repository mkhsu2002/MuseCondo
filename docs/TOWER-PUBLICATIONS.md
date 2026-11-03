# Tower publications and scene collection

Status: 2026-11-03 parallel delivery in progress. Current live v1.66 has three maintainer-approved public scenes; the earlier [v1.63 preview acceptance](architecture/TOWER-PREVIEW-ACCEPTANCE-2026-11-03.md) is historical. Weekly/mail bindings are prepared, but no issue or notice has yet been published. Scene recovery and daily journals are implemented and await synchronized migrations 0041/0042 and release acceptance. See [NEXT](plans/NEXT.md) for current gates.

## Cloud ownership

The existing private `tower-manager` Worker queues publication tasks in separate `ManagerClock` Durable Objects named `tower-publications` (weekly/daily) and `tower-scenes` (images/recovery). Its alarms call the protected Pages Functions step endpoint. Only deployed Pages Functions hold Meta and email provider credentials; the Worker and operator client carry protected trigger credentials. No local process generates Tower images or sends provider email. Existing daily schedules, unrelated duties, namespace and cost limits remain unchanged.

Each scene uses three bounded cloud stages: planning, image editing with the original reference attached, and independent visual checking against both the reference and stored result. Shared `manager_jobs` receipts account for every paid call; the scene call ledger records its purpose, model, real provider request ID when available and usage. Unknown outcomes stay held and are never blindly paid again. Immutable R2 artifacts bind PNG dimensions, SHA-256 and D1 metadata. Private previews require operator authorization; public routes expose only approved artwork metadata/bytes.

## Fixed visual reference

Master: `public/tower/muse-tower-reference-v1.png`, 1086×1448, SHA-256 `6f68c848ff2883ef903521f709edc3f4c78356652cbfbd8975b4c285b76f5d96`. This is the maintainer-supplied original, separate from the homepage hero. Every image request re-reads and verifies its exact bytes. Bible `tower-v1` preserves the stepped ivory tower, rounded modular windows, monumental open arches, amber interiors, planted terraces, curved glass roof pavilions and dusk palette. The internal catalog fixes ten distinct corners. These are architectural artwork, not records of invented residents or events.

The maintainer approved the three actual previews on 2026-11-03 and asked to retain them as future references. Style approval was persisted before continuing. The original exterior remains primary; each subsequent scene also includes one matching approved exterior (seed01), interior (seed02) or roof (seed05) artifact as a secondary reference. Fixed IDs, hashes and dimensions are validated against immutable R2 readback for planning, image editing and independent review; plan metadata binds the references permanently. Later generated outputs are never automatically promoted into the reference catalog. Missing or modified approved references stop further paid calls. The initial visual gate generated only private seed01/02/05 before this explicit approval. Native SQL guards enforce this boundary. After approval, finish and inspect batch one of five before batch two of five; never generate more than six per batch. Reference changes require a new version rather than overwriting historical artifacts.

## Public routes and source boundaries

- `/tower-weekly`: historical issues; `/tower-weekly/:issueId`: immutable issue.
- `/tower-scenes`: accumulating scene collection.
- `/api/v1/public/tower-weekly` and `/api/v1/public/tower-scenes`: safe public data.
- `/api/v1/tower/scenes/:id.png`: approved image only.

HTML routes intentionally avoid `/tower/*`, which is reserved for static assets in the Pages routing policy. The shared SSR/client renderer preserves the homepage hero/video and resident doors. Artwork captions and alternative text describe only the scene; internal prompts, provider choices, generation checks and operational instructions never appear in public output.

Weekly facts come only from connected, non-test Tower households and currently authorized public revisions. Newcomer dates use original admission dates. Journals use only the current public snapshot daily entries of admitted Tower households, matching the actual public home router. Explicit dates and stable `tower-snapshot` identities are preserved. Legacy `posts` belonging to a Tower room never fill an empty or deleted snapshot journal; pure legacy/independent nonmember homes and private drafts/memory are excluded. Source/revision/consent guards run inside publication transactions and on public reads. Aggregate counts require a separate approved deployment flag.

A published weekly issue must have one approved scene. The inaugural issue requires at least one maintainer-approved published cover; it does not wait for the independent ten-image collection. Later issues add one new scene. An incomplete scene blocks the issue and notice. The issue and its permanent Lord outbox event are inserted atomically, followed immediately by deployment-side dispatch. Provider acceptance, delivery confirmation and human reading are separate facts. Recipient HMAC binding, permanent single-dispatch receipts, daily bounded recovery and signed webhook facts preserve the existing identity-email service. Future guardian subscriptions are outside this release.

## Environment contract

Migrations `0038`–`0042` add weekly, notification, scene/recovery and daily-journal storage/audit/guards. Both dev and production must receive identical schema and matching Functions/Worker/frontend code. Feature bindings are `TOWER_SCENES_ENABLED`, `TOWER_WEEKLY_ENABLED`, `TOWER_PUBLICATION_MAIL_ENABLED`, `TOWER_PUBLICATION_AGGREGATE_APPROVED`, `TOWER_DAILY_JOURNALS_ENABLED`; the Lord recipient is a server-only secret binding. Required existing dependencies include `ASSETS`, `MANAGER_ASSETS`, `MANAGER_RUNTIME`, the protected schedule trigger, approved Meta authorization and unchanged shared budgets. Development keeps paid generation and real mail disabled. The initial preview release enabled scenes only. The next release prepares the weekly/mail/aggregate bindings for their separate real acceptance; development retains paid generation and real mail disabled.

Validate exact deployed source, schema, bindings, private Worker bytes and live public/protected behavior together. Tests and build success alone are not production acceptance. Keep raw recipient details, credential material, provider payloads and private previews in the private operations evidence directory. Track completion and remaining gates in NEXT; do not mark N1/N2 complete at the preview stage.

Archive reads use stable issue-number cursors, 20 issues per page, with an older-issues link in both server and client output. The homepage requests only the newest issue. Public history never depends on a fixed total-issue cutoff.

Source-authority correction before first issue: the earlier unshipped mixed-post adapter was superseded after comparison with the actual public-home router. Snapshot publication epoch/revision/digest guards remain authoritative. New event IDs bind the stable source kind; existing old-format issue news would be conservatively redacted rather than silently remapped. Both hosted issue inventories were checked empty before this release, so no published news requires migration.

## Parallel homepage and image delivery

The maintainer explicitly separated image work from visible homepage delivery. Image and repair tasks use the private `tower-scenes` DO queue; weekly/daily tasks use `tower-publications`. Both reuse the existing namespace and guarded Pages endpoints; no extra recurring polling is introduced. The first three approved previews may publish as their own inspected batch.

Migration 0041 adds bounded, immutable recovery intents/events and a canonical logical-seed view. A failed free count can resume only when existing paid outputs are known, reusing them; a known visual rejection gets a separately identified replacement (maximum two), preserving original rows and spend. Unknown outcomes and approved reference images remain immutable. Free count checks retry only bounded transient failures; paid calls never retry. Publication transport and leases account for the full bounded operation duration.

Migration 0042 adds independent, atomic zero-cost daily jobs/editions/audit. `TOWER_DAILY_JOURNALS_ENABLED` works even when weekly/model/mail are disabled. Each day selects up to three currently authorized snapshot journals at the fixed Tower 09:00 cutoff, requiring both snapshot creation and actual publication time to precede that cutoff. Late runs record their actual observation time and gaps; no invented historical edition. Public `/api/v1/public/tower-journals` and shared SSR/client output revalidate current content/author/revision/epoch; errors hide unverified entries. Visibility and bfcache restoration trigger fresh validation. The daily-capability transport ID is versioned to avoid consuming an earlier weekly-only day's completion receipt.
