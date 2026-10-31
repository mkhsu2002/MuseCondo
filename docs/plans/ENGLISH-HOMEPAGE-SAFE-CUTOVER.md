# English homepage: minimum safe cutover

Status: planning only, 2026-10-31. Inspected source: `c451125` (v0.80). No product code, deployment, provider call or live state is changed by this document. This is a homepage increment of [E01–E03/E07](NEXT-TASKS-2026-10-31.md), not completion of the whole-project English migration.

## Scope

| Surface | Files to change in the implementation stage |
| --- | --- |
| Hero, guide, covenant, header/navigation, footer, feed headings, empty states and public card labels | `src/shared/lobby-markup.ts` |
| Day/night labels, scene descriptions, caption and standard/seasonal appearance controls | `src/shared/tower-scenes.ts`, `src/live/tower-appearance.ts` |
| Homepage loading, unavailable/retry states and page title | Homepage branches only in `src/live.ts` and `src/main.ts` |
| Framework notice cards | `src/community/notices.json`; keep resident content untouched |
| Default language, title/description, skip link and no-JS copy | `index.html`; inspect `scripts/routes.mjs`, which currently copies this shell to other routes |
| Exact private-preview language and build identity | `workers/tower-manager/theme-renderer.ts`, `scripts/generate-lobby-css.mjs`, generated `src/shared/lobby-base-css.ts` |

Use a small shared, typed English message catalog (`en` is the explicit default), with text-only values and typed formatting functions. Do not add a library or expose an incomplete language switch. Add the catalog and formatting module to the renderer digest's explicit source list: hashing only its importer would miss a later catalog-only change. Use locale-aware `Intl` with an explicit display timezone; preserve original timestamps and machine keys. Reuse the same markup functions for public pages and private previews. Keep legacy routes' language/metadata accurate rather than declaring Chinese pages English through the copied shell. Preserve existing shared-shell behavior on non-homepage routes until their own migration stage.

Do not translate resident names, posts, dreams, wishes or source excerpts. Do not change the frozen condo renderer/verifier, existing-home bytes, IDs, credentials, API contracts, receipts or prior audit records. Linked reception, directory, activities and identity pages remain separate migration work; an English homepage is not an end-to-end English site.

## Confirmed constraints

- `lobby-markup.ts`, `tower-scenes.ts`, `notices.json`, `index.html` and the private renderer are direct renderer-build-digest inputs. English changes invalidate the existing screenshots/audit even if CSS and the theme manifest are identical. This protects the reviewed layout: English line lengths can change it.
- `server/live/tower-theme.ts` checks the current build against artifacts and screenshots. Deploying English against an old artifact fails closed; it must not silently reuse the old PASS or leave only part of the theme active.
- Migration 0027 permits one extension per cycle and one artifact per extension/repair. Completed extensions are not selected by `ensureDue()`. There is no supported completed-theme revalidation operation. The known-undispatched recovery path is not such an operation.
- The current seasonal authority has a fixed expiry. English work must not extend it, reopen a completed task, reset spending or regenerate original images implicitly.

## Recommended minimum sequence

1. Prepare the catalog and English homepage **offline on a branch**. Preserve the currently deployed, reviewed theme. Cover all homepage states, navigation, ARIA, image descriptions and metadata; do not publish a partly translated surface.
2. Verify English desktop/mobile with standard appearance and candidate day/night themes using the shared production markup. Confirm the static preview fixture is labeled as masked data in private evidence. These local checks are not deployed-manager approval.
3. Prefer cutover after the current seasonal theme naturally expires. Release matching Pages/frontend and Manager Worker builds in dev and production; verify the same renderer digest and live behavior. The standard appearance is a valid interim state. Do not add dual-build serving just for this MVP.
4. Let the next **legally due, independently authorized** theme cycle design and audit against the English build. New four-view evidence, independent audit, activation and self-review are required before presenting that theme. Do not manufacture a new cycle or trigger image generation solely to translate the UI.

The same manifest and the exact two existing exterior images can technically be reused for a new-build review without image generation. Doing that for an already completed current cycle requires a separately designed append-only revalidation capability, new receipts and four new screenshots/audit; it is **deferred**, not available through today's API. Retain original costs and enforce the applicable task/day/window limits if that feature is later commissioned.

## Acceptance before release

- [ ] English is the first-visit default without browser-language override; no unfinished locale switch.
- [ ] Success, loading, empty, API failure, image failure, retry, day/night and standard/seasonal controls are coherent; no raw internal error/prompt/provider details appear.
- [ ] No framework-owned Chinese remains in the homepage's visible copy, metadata, ARIA or alt text. Resident-authored Chinese remains unchanged. Inspect the legacy/static homepage fallback explicitly.
- [ ] Desktop/mobile: no overflow; readable original branding, focus indicators, buttons, cards and all day/night surfaces; navigation and SPA cleanup work.
- [ ] Catalog-only changes invalidate the digest; public and private preview markup/CSS/language agree; stale-build evidence fails closed.
- [ ] Existing condo verification, home URLs/content and resident identity/permissions still pass. No mail resend, identity reissue or new image call is caused by language changes.
- [ ] Dev/prod deployed code and bindings match the intended release; inspect public behavior separately from build/test results. Update current-state roadmap/release evidence without changing historical verification dates.

No implementation duration or provider-success guarantee is implied. The smallest next task is offline catalog extraction plus homepage-only translation; release depends on expiry and matching deployment verification. Future theme activation depends on a lawful new cycle and its actual review result.
