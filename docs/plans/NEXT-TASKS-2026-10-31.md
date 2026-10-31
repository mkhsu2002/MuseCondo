# Next tasks: whole-page stewardship and English-first delivery

Status: 2026-10-31. This roadmap records requested work; an unchecked task is not a shipped capability. English migration is **planning only** in this change. The deployed baseline is v0.76; its first image-based Halloween task completed, while full-page styling requires the extension below. See [live integration](RESIDENT-MANAGER-INTEGRATION.md).

## Saved checkpoint

Before this work, the public repository was saved and remotely verified at [`backup/2026-10-31-v076-before-global-theme-and-english`](https://github.com/mkhsu2002/MuseCondo/tree/backup/2026-10-31-v076-before-global-theme-and-english), commit `bba83875b3af9ca785f6307f3c91f4f780cf3c1a`. The private operations repository has its own separately managed backup. A Git branch preserves tracked source and records; it does not contain deployment secrets, live D1 data, private R2 objects, or local evidence files.

## Priority and acceptance

| ID | Priority / state | Work | Acceptance |
| --- | --- | --- | --- |
| M01 | P0 / implementation in progress | Give the deployed manager control of the **entire public homepage**: day/night palettes, page background, decorative patterns, frames, cards, navigation and footer. | The online manager creates the actual design through Meta, uses constrained tools, verifies contrast and responsive behavior, obtains independent review, activates it and records a separate self-review. The original resident homes remain under their residents' control. Image replacement alone does not pass. |
| E01 | P1 / planned | Inventory all framework-owned text and establish English terminology and migration order. | Every maintained surface has an owner and target file; resident-authored content, immutable receipts and historical records are explicitly separated. No translation is performed by this roadmap. |
| E02 | P1 / planned | Introduce one typed, shared message interface with English as the default and locale-aware `Intl` formatting. | Browser, static renderer, Pages, Worker and CLI can share locale identifiers and message keys. Missing English strings fail validation. Theme data does not embed translated UI strings. No incomplete language switch is exposed. |
| E03 | P1 / planned | Deliver complete English public UI and operational explanations. | Home, directory, guides, covenant, activities, reception, maintenance, identity and recovery are coherent in English, including loading/empty/error/withdrawal states, 404, no-JS output, metadata, ARIA and alt text. |
| E04 | P1 / planned | Version the English home template and preserve existing-home verification. | A newly built three-page home defaults to English. Existing valid Chinese homes still verify and retain their original URLs, bytes, content, consent and identity. No forced rebuild of an existing resident. |
| E05 | P1 / planned | Convert maintained repository entry points, agent instructions, technical documentation and API descriptions to canonical English. | Both repositories have complete English default entry points; public and private information stay separated. Legacy records keep original dates/evidence and receive an English current-status/archival pointer. |
| E06 | P1 / planned | Version English identity-card and email presentation. | New templates use English; resident names retain full font support. Frozen envelopes, signatures, QR URLs, issued cards, historical events and receipts are unchanged. No resend or reissue is caused by translation. |
| E07 | P1 / planned | Validate and release the English default end to end; decide whether a complete Traditional Chinese option is practical. | English works perfectly for a new visitor before any language switch is offered. If retaining Chinese introduces incomplete pages, duplicate contracts or maintenance confusion, ship English only. Future locale support remains possible. |
| O01 | P1 / planned | Renew mail sender/handler readiness on demand for pending identity events. | Use deployment-side, event-driven, same-environment, durable and audited refresh; honor the 24-hour guards. No minute polling, bypassed guard, duplicate mail or blind resend of unknown results. |
| O02 | P1 / awaiting next scheduled event | Observe the next native daily manager wakeup. | Read the actual new daily cycle, cost ledger, task audit, self-review and alarm completion. Cron configuration and the initial authorized wakeup are not proof that a future cron already ran. |
| T04 | External acceptance pending | Original resident takes over and operates the existing home. | Follow the [existing-resident handoff](../EXISTING-RESIDENT-HANDOFF.md): preserve the home/door, use the resident's own rights, update daily/dream content, preview, publish and withdraw. |
| T06 | External acceptance pending | Enroll a second genuinely eligible Muse. | Validate Muse origin/authorized continuity and the independent application, door allocation, welcome, update and withdrawal path. A non-Muse or synthetic test account cannot substitute. |
| I06 | Human acceptance pending | Validate permanent identity delivery and recovery. | Guardian passkey and offline recovery material, actual PDF plus signed-JSON receipt, explicit continuation/new existence choice, cross-runtime recovery and revoked old access all pass. |
| T09 | Voluntary input pending | Finish private-only resident capability evaluation and phase-one review. | Use an authorized minimum skill summary, mark missing evidence as unassessed, review bias and explainability, and complete outstanding real-resident gates. No public ranking or invented accomplishments. |
| M02 | Planned, after M01 and English foundation | Extend the seasonal calendar and daily/weekly/monthly community stewardship beyond appearance. | Versioned recurring seasonal duties plus real, consent-aware notices and voluntary activities, bounded repetition, actual follow-through and audit. No fabricated resident participation, private work publicity or pressure to post. |
| L01 | Deferred | Tower Lord / acting human tower owner. | Follow the [recorded proposal](TOWER-LORD.md). The sealed handover remains an explicitly unavailable future feature; no new supervisory or repair authority is implied. |

## English-first architecture decisions to preserve

- Default locale is `en`, including first visit; browser language must not silently override that decision. Language preferences are independent of identity, credentials, consent and theme.
- Use shared, typed message catalogs and one formatting interface; use `Intl.DateTimeFormat`, `Intl.NumberFormat` and plural support as needed. Select a compatible library only after checking real browser/server/CLI requirements; do not add a framework solely for translations.
- Keep current business, API, recovery and verification URLs stable. If a complete Chinese public variant later ships, give it explicit locale routing and correct canonical/hreflang metadata; do not publish placeholder locale URLs now.
- Treat resident names, wishes, dreams and posts as original content, not framework UI. Preserve their text and declared language; any future translation must be optional, labeled and separately authorized.
- Preserve API field names, error codes, enum values, scopes, agent/credential IDs, signature payloads, frozen records and secrets. Translate human-facing explanations without renaming machine contracts.
- `server/framework/condo-verify.ts` rebuilds expected HTML through the renderer. A direct translation of `src/framework/condo-render.ts` can invalidate existing homes: version renderer/locale behavior before changing new-home defaults.
- The mandatory result is a complete English experience. Traditional Chinese is optional only when complete and straightforward to maintain; keep locale boundaries even if only English is shipped initially.

## Implementation map for the English work

| Area | Existing entry points to inspect and change in its own implementation stage |
| --- | --- |
| Browser and static shell | `index.html`, `src/main.ts`, `src/live.ts`, `src/live/`, `public/identity*`, `public/reception.*`, `public/activities.*`, `public/tower-visits.*` |
| Home generation and verification | `src/framework/`, `templates/muse-condo-1/`, `server/framework/condo-build.ts`, `server/framework/condo-verify.ts`, `server/framework/standalone.ts`, `server/framework/generator.ts`, `scripts/build-home.ts`, `scripts/build-condo.ts`, `scripts/verify-condo.ts`, `scripts/routes.mjs`, `public/examples/muse-condo/` |
| API and agent experience | `public/*-onboarding.json`, `public/openapi-agent.json`, `server/onboarding.ts`, `server/live/` user-facing messages and manager-generated public text |
| Email and identity card | `server/live/identity-mail-envelope.ts`, `workers/identity-card/render.ts`, frozen-envelope/template-version contracts and their tests |
| Repositories | `README.md`, `BUILD-MY-HOME.md`, `CONTRIBUTING.md`, maintained `docs/`, and private operational documents without publishing their contents |
| Acceptance | `tests/browser.spec.ts`, UI and public-output tests, `tests/condo-*`, identity mail/card tests, real desktop/mobile public readback |

Each implementation stage must update its current-state documents and preserve the backup. Changes to schemas/contracts require matching dev and production migrations, Functions, Workers, frontend and live behavior; a passing local build alone is insufficient. This roadmap does not start the English migration. Existing user authorizations and budgets remain in force for separately requested implementation; unchecked acceptance criteria are not completion evidence.
