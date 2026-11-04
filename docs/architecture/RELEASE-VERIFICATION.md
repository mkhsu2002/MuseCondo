# Change-scoped Quality and single-build publication

Current implementation 2026-11-03; supersedes the earlier two-platform verification design. GitHub Quality owns verification and the one Tower build. After successful main-push checks, the same job uploads its existing dist plus Pages Functions to the existing Cloudflare project. Cloudflare Git automatic builds are disabled; preview remains none. No second clone, test suite or Vite build is run by Cloudflare. The dedicated deployment token grants only Pages Write on the target account; provider/model/mail secrets remain in deployed services.

| Scope | Necessary checks | Publication |
| --- | --- | --- |
| docs | No install/build/test | No automatic deployment |
| presentation | Generated renderer consistency, one build/static-image guards and16 focused test files | Same-run result may upload when runtime/renderer contract remains matched |
| full | Existing type/lint/build/full tests and native gates | Same-run upload only if the independent coordination gate confirms no backend/schema/private-service/renderer synchronization is needed |

Copy/layout includes approved static pages, locally existing cover/OG raster images, image dimensions/alt metadata, self-contained accessible article sections and ASSET-LICENSE text. Asset-license changes are presentation, not docs, because their public notice must be rebuilt. Removing unreferenced media/OG raster files can also be light; missing referenced files fail the build. Actual bytes, format, size and dimensions are checked, rather than trusting filenames. Scripts, forms, CSP, external/missing/dynamic image sources, data bindings, existing control identities, unknown routes and executable changes retain conservative full checks. The real five-cover update is a regression fixture and now selects presentation.

The classifier reads the accepted production receipt from the authoritative event base, never an untrusted head change. It includes the entire undeployed span; missing/unverifiable history is full. No commit-message/manual scope override exists. Full tests default to two workers. One coordinator owns a necessary full run; ordinary editing does not repeat the full suite locally and on two hosted platforms.

## Same-build release gate

`scripts/pages-release.mjs` checks main-push context, verified scope, trusted baseline, compatible changed paths, unchanged accepted renderer, complete exact-source manifest, source tree and emitted asset hashes. It invokes pinned Wrangler on the existing dist and current Functions source, without another npm build. PR/docs/failed/cancelled checks cannot enter the secret-bearing deployment step. A source/backend/migration/private-service/renderer change needing coordinated work records **not deployed: coordinated publication required**, retains the tested artifact, and must use the existing matched operator release workflow. A green test job alone is not proof of deployment.

The same-run artifact preserves dist and compilation source/generated release evidence; the private manifest is not copied into public web assets. Operator adoption still requires exact-source Functions/bindings/schema/live checks. No routine dev release, new polling job or blanket validation bypass is introduced.

`npm run verify` remains available for an intentional local full check. `npm run verify:change` selects necessary local checks. `npm run build:release` is a historical/manual entry, not the active production trigger; do not restart Git builds to duplicate successful Quality work. Actual hosted acceptance and timing for this replacement are appended after release.

## Historical acceptance (superseded pipeline)

## Production acceptance — 2026-11-03

Accepted source `65ac5aec3c5d069696f071920025d4f71ff229e0` (v1.78), production Pages deployment `e23714cf-4cfb-499f-81f1-55b4cd633ab3`; actual hosted verification at `2026-11-04T02:44:06.844249Z`. Exact-source [Quality run 41761540314](https://github.com/mkhsu2002/MuseCondo/actions/runs/41761540314) executed full and every native gate successfully; presentation was correctly skipped for this infrastructure change. The policy/runner suite passed 14 tests; an actual light execution built the Tower and passed 59 tests across the 15 frontend files. Historical headline/eyebrow changes classify as presentation.

Cloudflare API configuration readback confirms `npm run build:release`, the four exact routing-script watch paths, main automatic deployment and preview:none; all other build/source settings, bindings and secrets were preserved. This deployment had already captured the previous `npm run verify` command before the configuration change, and passed it. No duplicate deployment was triggered to exercise the new command. The new presentation entry has local execution evidence, not a claimed cloud presentation run.

Hosted source/build/frontend bytes and private boundaries pass. Schema remains 45 migrations/592 objects, full schema hash `1cfde8abb49f5ddcde008e0cd531f0d61a788689f414f98fd8254db2194067b3`; renderer identity remains `088cd46c` and matches the existing Manager. Existing resident/journal/image-job/audit state is retained; no Manager or routine dev deployment was necessary. The accepted baseline receipt now records this real production source. Raw platform/config/hosted receipts remain in the private operations evidence store, without credentials in this repository.
