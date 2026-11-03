# Core domain module map

Implementation date: 2026-11-03. This map describes the local source; hosted deployment and independent development/production readback remain release work. No schema change is introduced by this extraction.

## Tower intake

| Module | Responsibility and boundary |
| --- | --- |
| `tower-intake.ts` | HTTP route selection and composition; source admission, prepare/claim/source/import and selective synchronization orchestration. Source admission remains database-backed, separate from downloads. |
| `tower-contract.ts` | Pure public snapshot validation, request scalar validation and shared typed errors. `tower-intake.ts` re-exports `validateTowerSnapshot` for existing callers. |
| `tower-intake-types.ts`, `tower-crypto.ts` | Shared domain records and deterministic hashing/random identifiers. No database or network construction effects. |
| `tower-source-reader.ts` | Bounded network/MIME/redirect handling, native/static normalization, source claims, PNG validation and sanitization. Readability is never admission authority. |
| `tower-intake-request.ts` | Actual-stream request limits, JSON decoding and bounded multipart dream uploads. |
| `tower-intake-auth.ts` | Session and delegated scope authorization; exact commit-time guards and guarded batch owner. |
| `tower-intake-repository.ts` | Queries and prepared statement builders for snapshots, receipts, audit, revisions, source generations and consent-filtered published projections. It imports no authorization implementation, HTTP router or renderer and does not commit. |
| `tower-content-service.ts` | Grouped content, dream and dream-visibility commands using repository, authorization and bounded-request ports. |
| `tower-publication-service.ts` | Publication/withdrawal command, directory visibility and durable community recovery event, using the same grouped ports. |
| `tower-home-render.ts` | Pure trusted Tower wrapper around the unchanged standalone renderer. Public and private targets are distinct types. |
| `tower-asset-storage.ts` | Existing immutable room-scoped asset objects, chunks, revision references and legacy anchors; see [storage contract](TOWER-ASSET-STORAGE.md). |

Command services assemble all statements before calling the guarded write port. The identity guard is still first in the same atomic batch as revision checks, snapshot/asset changes, receipt and audit. On batch failure authorization is rechecked before resolving the original failure. Progress callbacks run only after commit; callback failures leave durable progress for bounded recovery. The repository never owns a second transaction or commits partial command state.

Factories are lazy: construction performs no database queries, writes or source requests. [Selected public capabilities](ROUTE-SCHEMA-CAPABILITIES.md) therefore do not acquire private table dependencies merely by constructing the application.

Public home rendering receives only `publicState` plus `getSite(residency, true)`, which selects the published revision and removes unconsented dreams. Canonical and Open Graph URLs use the configured origin, fixed household route and published asset revision. Query parameters, original source URLs, private drafts and share credentials do not supply metadata. Authenticated preview HTML has no canonical/Open Graph tags, includes `noindex, nofollow`, and returns the corresponding `X-Robots-Tag`; preview JSON and private assets also carry that header. GET/HEAD headers agree. Six parsed-body hashes captured from the previous wrapper lock visible home/inside/dreams DOM, styles, visitor widgets and footer behavior for public and private views. Standalone `renderCondo` is unchanged.

## Legacy live application

`app.ts` retains HTTP routing, route-to-onboarding-scope mapping and application orchestration. `live-auth.ts` owns session, owner, onboarding delegation, room delegation and guarded writes; it accepts an explicit onboarding scope and imports no router. `live-community.ts` owns the complete consent-filtered community projection, publication epochs, historical arrival-title stability, digest comparison, persistence and change callback. `persist=false` remains read-only and never calls the change callback; unchanged digests retain the existing edition. `live-contract.ts` and `live-types.ts` hold shared errors, crypto and records; the historical `app.digest` export remains compatible.

## Manager admission

`manager-admission.ts` keeps provider invocation and its immutable dispatch/usage receipts, as well as the related context guard, defer transaction, final approval transaction and interrupted-job recovery owner. `manager-admission-jobs.ts` supplies authoritative durable status/job/case/duplicate queries. `manager-admission-policy.ts` holds supported schema inventory, provider limits and database-native cooldown/runnable predicates; immutable receipt time anchors cooldown. Shared types live in `manager-admission-types.ts`. The validator imports the pure Tower contract rather than intake composition.

Expiry, policy activation, current case version, revocation and lease checks remain database-native at their original transaction boundaries. An interrupted dispatch becomes unknown and blocks automatic redispatch. No provider dispatch abstraction, framework replacement, new dependency, microservice or resident operation is introduced. Seasonal autonomy and historical autonomy recovery extraction remain a later phase.
