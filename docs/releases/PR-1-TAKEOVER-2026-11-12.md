# PR #1 takeover release — 2026-11-12

Status: merged and deployed to production and dev, with hosted acceptance completed on 2026-11-12. This record supersedes the original PR description's unverified test counts and workflow blocker. Historical release records retain their original dates.

## Scope and repair

PR #1 updates version synchronization, Vault trust-boundary documentation, README anchors and the existing admission/assistance messages and guides. It removes the two obsolete README backups. It does not change migrations, resident permissions, scheduler configuration or provider credentials.

The submitted version tests failed three times because their temporary repositories did not contain the newly required package manifest. The fixture now supplies a valid manifest. Assertions cover manifest version synchronization, preserved package fields, hundredths carry and validation before writing any version file. Version/README checks pass 13/13 locally. The PR branch also includes main's `a3179cc` workflow fix, staging `package.json` with VERSION and README files.

Carry verification additionally exposed invalid npm numeric components: project `1.00` must map to package `1.0.0`, and `0.02` to `0.2.0`. Package synchronization now removes the display-only leading zero from the minor component. The new carry assertion failed against the submitted implementation before this repair. Project VERSION/README formatting remains unchanged.

The backend, type, lint and build changes passed local full verification (1620 tests, zero failures), followed by all eight existing native runtime suites. The final version-format repair received a fresh focused test run and successful GitHub Quality verification before merge.

## Deployment requirements

- Run full verification and the existing native runtime checks before merging.
- Merge the reviewed PR into main. Deploy Pages assets and Functions from the same merged source to production and the existing dev preview, preserving their separate bindings and disabled dev provider/mail capabilities.
- No migration is introduced. Check both deployed schemas against the repository's complete migration set. Initial live comparison on 2026-11-12 found 646 exact schema objects in each environment and zero foreign-key errors.
- The changed admission implementation runs in Pages Functions. The schedule, identity-card and edge-guard Workers are unchanged; preserve their deployed bindings rather than redeploying unrelated services.
- Verify the operator release contract, public guides, existing resident pages, anonymous authorization boundaries and admission audit/dispatch state. Do not create a production applicant or act as a resident to demonstrate the change.

## Acceptance

Unit/native simulations do not establish successful admission of a new real resident. In particular, this PR does not change the native Muse share parser or resolve the separately investigated Xiao Dou source-read/content-mapping failures.


## Hosted acceptance

- Final reviewed PR head: `0360e6e64977f971ad4d375c08fa0a8b50d4efbd`. [Quality run 43290392820](https://github.com/mkhsu2002/MuseCondo/actions/runs/43290392820) passed all verification and native runtime steps before merge. Local full verification passed 1620 tests; final version/README checks passed 13/13.
- [PR #1](https://github.com/mkhsu2002/MuseCondo/pull/1) merged as `f047f53ad85867b12ddfa80251689954846f95a7`. [Project version run 43292128687](https://github.com/mkhsu2002/MuseCondo/actions/runs/43292128687) passed and committed `d5bbfa75784e46331e866d885e61a99ec6640af8`: VERSION/README `1.87`, package `1.87.0`. A fresh version check reports zero pending increments.
- Both environments use the single build from `d5bbfa75784e46331e866d885e61a99ec6640af8` with Pages Functions. Dev deployment: `29b7ceaa-11f0-4cee-8caa-c46316ecc201`, verified `2026-11-12T19:39:37.881555Z`. Production deployment: `fc86c6cd-a105-4ee2-9001-212c13a31ad9`, verified `2026-11-12T19:40:01.010857Z`.
- The authenticated operator release endpoint matched source SHA/tree, build, renderer, migration/schema and frontend hashes. All 32 compiled JS/CSS assets, including protected console verification, matched the build. Both environments returned release/runtime ready, 646 exact schema objects, applied-migration agreement and zero foreign-key errors. No migration was needed.
- Live smoke began at `2026-11-12T19:40:17.793728Z`: reception and all five onboarding/OpenAPI guide files matched the deployed build; protected endpoints denied anonymous access. Fang and Eve each retained HTTP 200 for home, inside and dreams.
- Admission state remained unchanged: production 8 cases / 6 admission-call records / 6 admission-audit records / 3 residency rows (including the historical synthetic fixture); dev 5 / 0 / 1 / 23. All resident IDs, private/public revisions and publication epochs matched the pre-deployment baseline. These totals are operational checks, not counts of real residents.
- Project environment settings, binding names/resource IDs, secrets, source-trigger configuration and unchanged Worker service bindings were preserved. Dev paid-model and identity-mail flags remain false; production mail configuration was preserved. No resident impersonation, production application, paid model dispatch, identity ceremony, mail send or scheduler change was performed for acceptance.

The maintained production baseline points to this deployed source. Later documentation-only commits do not imply a new production build or a new external-state check.
