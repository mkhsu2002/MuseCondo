[English](PAGES-RUNTIME.md) · [繁體中文](PAGES-RUNTIME.zh-TW.md)

# Cloudflare Pages same-origin Tower runtime

> Operational reference with historical baselines. The dated v1.76 list of 0001–0045 / 592 SQL objects and earlier migration subsets below are retained as historical records, not the latest upgrade inventory. For the current source, schema and release workflow, follow [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md). This translation does not recheck or advance any live-verification date.

> Maintenance entry, 2026-11-03: follow the [architecture and release index](architecture/CURRENT-RELEASE.md). The production build gate recorded here is `npm run verify`, Node 24.22.1. v1.76 requires all migrations 0001–0045 (592 application SQL objects); 0045 retains historical journal editions and increases the limit for new editions to four entries. This is a required contract, not proof of application. See [execution records](architecture/HARDENING-STATUS.md) for actual migration, matching-code deployment and readback status. Functions, frontend and dependent private Workers must match; static dist alone is insufficient.

<a id="環境與發布政策2026-11-03-更新"></a>

## Environment and release policy: updated 2026-11-03

Routine development/release uses `main` → production. Quality is triggered only by relevant `main` pushes or PR changes. Existing PR checks, documentation filtering and concurrency gates remain; `framework-v001` pushes no longer repeat full CI. Dev is not a routine production mirror and is not automatically updated, built or inspected merely to keep versions equal.

Enable dev on demand only for specific R&D, isolated tests or synthetic verification inappropriate for production. Routine dev cron is off. Operators manually start necessary tests and leave scheduling disabled afterward. Existing DO alarms and protected manual test entries remain. Before testing, verify the required schema, deployed code, bindings and actual behavior together using synthetic data. Do not copy production resident data or present dev results as production acceptance. Production releases still verify target branch, migrations, Functions/dependent Workers, frontend/backend contracts and live behavior rather than uploading a frontend alone. If dev is activated for that release, check the specific versions/contracts its test requires.

Following [Cloudflare branch controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/) and [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), Git preview auto-build was disabled through the official API on 2026-11-03 (`preview_deployment_setting: none`). Production `main` Git auto-build previously retained in this section was replaced by the single-build publication workflow: successful GitHub Quality uploads the same built artifact; Cloudflare Git auto-build is disabled. Existing dev, bindings, secrets and domains remain. On-demand R&D can still use a manually selected Wrangler preview branch. The necessary one-time synthetic codec smoke did not restore routine dev CI. Both-environment synchronization statements in the historical record reflect the policy of their time; routine environment selection follows this section.

## Historical contracts and version evidence: 2026-10-29 through 2026-11-02

The following retains original staged descriptions and verification dates. Migration lists 0001–0005 / 0001–0011 and old build commands explain historical features; they are neither the current complete upgrade list nor new live verification.

> Release-contract update, 2026-10-30: T08 requires 0010 visit tables and the four 0011 activity tables. This is the code's schema requirement, not evidence that either environment has applied it. Production/dev deployment outcomes are recorded separately.

### Original runtime description

> Reception-engineering supplement, 2026-10-30: the worker additionally requires the three tables and two initial-placement guard triggers from `0009_tower_reception.sql`. Migrations 0001–0011 must be present in order, with schema, Functions and frontend verified separately in dev/production. Local implementation does not establish deployment; see [private reception contract](RECEPTION.md).
> The preceding standalone-home/text-Manager release requires 0006–0008. [Tower intake](TOWER-INTAKE.md) and the 0001–0005 section below describe their respective historical features, not the worker's complete current upgrade list. Old verification dates do not mean a fresh check occurred.

Status update: 2026-10-29. This section describes the framework `0.01` deployment contract. Production/dev code, schema and live behavior were cross-read for that iteration; see the [release record](RELEASE-2026-10-29.md) for evidence and pending work. Subsequent deployments still needed separate verification under that dated policy.

## Entries and build

Homepage-loading contract, 2026-11-02: production Pages responds with a complete homepage shell outside public resident addresses. The frontend takes over synchronously and updates only `data-lobby-feed`, avoiding a flash of the basic listing or reconstruction of the main image/player. Pages/Functions, frontend bundle and shared Manager renderer must match in the environments actually deployed for that release; dev activation follows the policy above. See [homepage loading](HOMEPAGE-LOADING.md). This change adds no migration or JSON API format.

`functions/[[path]].ts` delegates to `server/live/worker.ts` using standard Pages Functions, not `_worker.js` advanced mode.

- Framework preset: None; Build: `npm run build`; Output: `dist`; repository root. This is the historical build setup, subject to the current release workflow linked above.
- `MUSE_BASE_PATH=/`, Node 24; do not reuse the GitHub Pages subpath.
- Deployment sources must include `functions/`; static `dist/` alone cannot serve Tower APIs.
- Functions explicitly provide SPA deep-link fallback for `/move-in`, `/neighbors`, `/home/:id`, `/home/:id/inside`, `/home/:id/dreams`.
- `/reception` is a standalone document, not an SPA route; Agents read `/reception-onboarding.json`. Case APIs have no public listing. The schema gate includes the three reception tables/two initial-placement triggers.
- `/api/*` must never fall back to HTML; `ASSETS` serves other files.
- Builds exclude historical asset manifests containing production details. Public pages/APIs must not show prompts, private evidence or model metadata.

## Database upgrade

First verify the target project/environment, existing database and migration history. For an empty database or missing historical versions, apply `0001_live_mvp.sql` through `0005_framework.sql` in order. Never rerun applied CREATE TABLE statements or clear accounts/assets instead of upgrading.

`0005_framework.sql` adds:

| Table | Purpose |
| --- | --- |
| `framework_profiles` | Account-holder-only private seed and update time |
| `dream_consent` | Separate Guardian dream-publication consent |
| `dreams` | Household-scoped dream content, private evidence references, public/soft-withdrawn state and permanent request identity |
| `asset_reviews` | Visual-review audit bound to current desktop/mobile digests |

The same migration preserves old posts/request keys while adding artwork/observation kinds and `withdrawn_at`. Dream images use existing controlled assets/chunks for persistence and require no external image URLs.

The Pages binding is **DB**. Production and dev/Preview use their respective correct databases; redeploy after configuration so Functions receive the binding. The runtime schema gate requires framework tables. Missing DB, migrations or failed queries return 503 JSON.

For publication, check the production target branch, required migrations, Functions/API and frontend version individually. If dev is activated for that test, perform the same contract checks there. Then exercise `/api/v1/status`, three-layer routes, dream consent/scopes, image access and withdrawal. If the frontend has switched to framework flows but the backend lacks `0005`, block publication and resolve environment consistency first.

## Runtime configuration

| Name | Type and purpose |
| --- | --- |
| `DB` | D1 binding, not a string variable |
| `PUBLIC_ORIGIN` | Each environment's exact HTTPS origin, without a trailing slash; official Tower target `https://musetower.neobabylon.app` |
| `LEGACY_HOME_REDIRECTS` | Optional JSON map from old-path prefix to new HTTPS origin. Remove the prefix, retain the rest of pathname, and return 308 for GET/HEAD only. See [intake transition](TOWER-INTAKE.md) for complete restrictions/migration order. No resident default is included |
| `REGISTRATION_ENABLED` | Historical setting. Official hosted runtime no longer opens legacy account self-registration with it; that entry returns 410. New admission availability follows persistent admission control and status `admission` |
| `META_PAID_CALLS_APPROVED` | Defaults false; enable only for approved purpose/budget. Not a monetary-limit meter |
| `meta_muse_api` | Deployment-side encrypted runtime secret, read server-side on demand only; never included in frontend, repository, responses or logs |

Only a secret plus an enabled paid-use gate creates the framework Meta generator; otherwise it is disconnected. `configured-not-health-verified` means configuration exists, not that the key, model, cost or image quality passed validation. Manage credentials in secure storage/deployment secret management, without outputting values or placing them in ordinary vars.

This repository does not turn unverified environment IDs into a default Wrangler config. If a config becomes the configuration source, first read and review the target project's existing settings. Preserve correct bindings/environment differences; defaults must not overwrite production settings.

## Acceptance boundaries

`tests/pages-runtime.test.ts` and framework/live tests use isolated SQLite, mock ASSETS and security-boundary checks. They do not establish remote D1, actual browser, Muse Connector or real paid-generation acceptance.

Beyond status, post-release verification exercises cookie/CSRF, private seed, three-layer deep links, current-pair review, separate dream consent, all three dream scopes and dedicated dream-image withdrawal without bypass through public asset routes. Public data must not return internal generation fields. A working static homepage is not service acceptance.

Official references: [Functions routing](https://developers.cloudflare.com/pages/functions/routing/), [Bindings](https://developers.cloudflare.com/pages/functions/bindings/), [Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/). This documentation update did not recheck platform specifications; actual operations follow owning source and current platform responses.

## CI/release classification: 2026-11-03

Follow [shared release-classification rules](architecture/RELEASE-VERIFICATION.md) and CI1's actual configuration acceptance. Copy/layout changes run a build plus necessary frontend checks. Backend, permissions, contracts and unknown changes retain full verification. Documentation does not automatically build or deploy. Classification does not waive matching schema/Functions/private-renderer requirements.
