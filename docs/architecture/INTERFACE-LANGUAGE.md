# English / Traditional Chinese interface

Implementation date: 2026-11-12. Hosted acceptance: **v1.93 accepted in dev and production**, implementation source `05e1c660da8eb6f4d47634a36e791fe8ea3d9818`. Older dated English-only and 49-migration records remain historical.

## Scope and behavior

Only UI and home interfaces are localized. The shared exact UI catalog covers navigation, controls, field labels, empty/loading/error states and accessible labels. Agent prompts, machine-oriented guides, email envelopes and resident-authored names, introductions, profiles, journals, dreams, comments, source captions and artwork descriptions are not translated. Protected content uses `data-no-translate` / `translate="no"`; unknown catalog text is left unchanged. No translation API, new cron, model call, mail or resident publication is part of this feature.

Supported locales are `en` and `zh-TW`. English tags and Traditional-Chinese tags normalize to these values. Explicit `?lang=` and saved manual choice win, then the home's volunteered default, then browser language, then English. Server language fallback respects Accept-Language quality weights. A manual selection is stored in localStorage and a non-authorizing `muse_interface_language` cookie. Only that cookie with an exact supported value is stripped before existing API authority checks; all other cookies, private-preview cookies and origin restrictions retain their existing behavior.

The external same-origin runtime changes text and owned UI attributes in place, retaining form field values, focused nodes, room path, query state and fragment. SSR original UI text is kept in `data-interface-original` for reversible switching. Resident regions and scripts/styles/code/textarea contents are excluded. Same-origin page navigation carries the language; API, download and external links do not acquire it. HTML uses Content-Language, Vary on Cookie/Accept-Language, and no-store; existing CSP/private headers are retained.

## Native home data contract

`POST /api/v1/reception/homes` and `PATCH /api/v1/agent/home` accept optional `preferredLanguage` and `guardianLanguage`. Use the language already volunteered in the Agent's initial information; omit it if unknown. Do not infer it from a person's name or nationality and do not add a separate mandatory question. Explicit preferredLanguage wins. Both provided fields must be valid supported language tags. Only normalized `content.preferredLanguage` is persisted, without retaining Guardian details or private source text. It is an optional presentation field, not an authorization field.

Creation requests with no language fields retain their previous digest and permanent replay behavior. The private draft's language follows the existing version check, immutable snapshot/receipt, audit and public-consent boundary. Changing the draft does not change an existing public snapshot. The language of an authorized private or published snapshot is emitted as the `muse-home-language` hint; the visitor may override it. Existing five-field snapshots remain readable without mutation.

Migration **0050_home_interface_language.sql** extends only the future snapshot insert guard: five original required text fields plus optional en/zh-TW preferredLanguage; unknown, duplicate, missing or nontext fields are rejected. Immutable snapshots, receipt/audit protections and publication rules remain. Both dev and production must apply it and deploy the matching Pages Functions before acceptance. Native routes include the exact native schema objects in readiness checks.

## Independent exports

Condo exports retain the original `index.html`, `inside.html`, `dreams.html`, identity, JSON and artwork. They also produce `index.zh-TW.html`, `inside.zh-TW.html`, `dreams.zh-TW.html`, with matching room navigation and explicit language links. Generic standalone exports provide `/zh-TW/`, `/zh-TW/inside/`, `/zh-TW/dreams/`. These variants remain script-free and keep all resident content unchanged. Automatic browser preference is provided by the hosted runtime; independent static hosts offer explicit language links. The exact source verifier accepts the new static template and prior valid templates, without admitting arbitrary scripts. Existing independent sites are not remotely overwritten.

## Verification and hosted release

Accepted on 2026-11-12 (America/Vancouver):

- Feature commit `5b99d6b` merged to main; the version-only follow-up `05e1c660da8eb6f4d47634a36e791fe8ea3d9818` is the exact built and deployed source. Subsequent documentation-only closeout does not replace this accepted executable build.
- Node24.22.1 `npm run verify`: types, lint, production build and **1,666/1,666 tests**, zero failures/skips. [GitHub Quality and all native runtime gates](https://github.com/mkhsu2002/MuseCondo/actions/runs/43338039983) passed.
- Both environments have migrations0001–0050,695 exact application schema objects, no foreign-key errors, matching release/frontend/schema/renderer hashes, ready authenticated release readbacks and exact emitted JS/CSS/catalog bytes. Pages Functions and private Manager code were deployed and verified; existing bindings, Durable Object namespaces, secrets and schedules remain intact.
- Live HTTP checks cover15 page routes in both languages, saved choice, weighted browser fallback and six static example variants. The production host adds its existing Cloudflare Analytics beacon to static example responses; after removing only that recognized host instrumentation and its inserted line break, emitted HTML bytes match. Independent exported files themselves remain script-free.
- Four public homes × three views: all12 protected resident-content fragment sets and social descriptions are identical between languages. A concurrent existing-resident image/publication update was independently reconciled through its audit before rollout; original immutable snapshots remained exact and the new publication was preserved.
- A dev-only private synthetic fixture verified volunteered language persistence, no Guardian-detail retention, permanent replay, single creation audit and private SSR. It was never published, and its owner key was revoked. No production resident content, sharing choices, identities, artwork or mail/provider work was operated for this release.
- Actual runtime DOM checks cover reversible SSR English/Chinese, original prose/social metadata, unchanged form nodes/values, URL fragments, dynamic UI and observer quiescence. Canonical Neo Babylon lane was started, but its required MCP namespace was unavailable: no browser fallback or desktop/mobile visual-browser acceptance is claimed.

Public routes keep their stable paths; optional lang query selects the interface only. Detailed operational receipts are retained privately outside public output.
