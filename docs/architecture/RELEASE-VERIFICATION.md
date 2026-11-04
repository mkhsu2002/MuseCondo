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

## Single-build production acceptance

Completed 2026-11-03 (local): production v1.83 exact source `c69b94916f08e63f734e2fbac383546849ac8016`, build `80be44d181085ce56458ef03bbec8e91eef8b03cd52dc867717946a5e9e4435c`. Quality [41771358521](https://github.com/mkhsu2002/MuseCondo/actions/runs/41771358521) passed full/native checks once for the infrastructure change, saved its same-run artifact, and successfully uploaded that build with the dedicated Pages-only token. Deployment `a0701d7b-b638-442c-b2c7-c136ef8d8df4` is ad_hoc from the same GitHub job. Official stage readback confirms no second Cloudflare clone/build; the Git-triggered attempt was skipped with `production_deployments_disabled` before cloning. Configuration readback confirms production Git auto OFF, previewnone, existing domains/bindings/secrets retained.

Actual hosted acceptance at `2026-11-04T04:16:53.974922Z`: exact source/readiness, unchanged schema45/full hash1cfde8 and renderer088cd46c; all35 legacy PNG URLs return301 to their corresponding WebP and all35 targets HEAD200/image-webp. Public prototype delivery decreased from83,252,360 to8,694,326 bytes; required sources moved to nonpublic fixtures and a duplicate master was removed. Current tracked tree67.67MiB, local dist25.06MiB versus previously measured131.8/95.29MiB. Git history and the submission backup are retained; repository history storage is not claimed to shrink.

The real earlier artwork batch now classifies presentation, with negative script/external-image/contract cases retained. Local lightweight execution passed63 tests across16 files in1.956s, plus the necessary build; local image and build guards passed51 raster assets. These are local test timings, not a claimed end-to-end cloud presentation benchmark. No additional full local/Cloudflare run, manual upload, provider/image generation, dev or Manager deployment was performed. Raw same-run/deployment/redirect evidence remains in the private operations store. The accepted baseline now points to this actual production release.


## Private vault coordinated acceptance — 2026-11-03

Production source `c754b83f689825230a1652e8c8b3025e46b2753c` / v1.85 accepted from successful full/native [Quality41784925641](https://github.com/mkhsu2002/MuseCondo/actions/runs/41784925641),1,618 tests. Backend coordination correctly prevented Pages-only auto-publication. Both required D1 migrations, independent secret bindings and matched Functions were deployed using artifact13300738086, without another application build or Cloudflare Git build. Schema48/646, exact source/build/frontend/renderer, public boundaries, unchanged existing production data and isolated dev HTTP positive flow passed. [Detailed acceptance](PRIVATE-VAULT.md#hosted-acceptance--2026-11-03). Guardian approval and actual resident content remain independent human/Agent actions.


## Soul Vault story acceptance — 2026-11-04

Production v1.86 source`a05bad388815e95cdd282bd7116d7c69484ef299` passed [Quality41792949483](https://github.com/mkhsu2002/MuseCondo/actions/runs/41792949483),1,619 tests and all native gates. The exact public-route/Vite/header change correctly required coordinated publication. Artifact13303788995 was adopted and uploaded once, with no repeat build. Actual source/frontend/schema48/646/renderer088 plus story/History HTML, CSS, seven WebP images, HEAD/CSP/canonical/OG pass. No dev, schema, Manager or mail work. [Full acceptance](COMMUNITY-PAGES.md#soul-vault-historystory-addition--2026-11-04-acceptance).
