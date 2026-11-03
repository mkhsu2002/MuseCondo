# Architecture hardening status

> Release note 2026-11-03: the hardening acceptance below remains historical evidence. Current v1.63 preview code/schema and its three private cloud images are recorded in [the current release index](CURRENT-RELEASE.md) and [preview acceptance](TOWER-PREVIEW-ACCEPTANCE-2026-11-03.md). Weekly/mail/daily-journal completion is not claimed.
Current status (2026-11-03): all ten steps and both hosted environments accepted for v1.62 source `4b81f413a34c923a986c6b905a2c5a4c6ed0b151`. Earlier phase-specific pending/unverified statements below are historical checkpoints, superseded by the final acceptance section and [current release index](CURRENT-RELEASE.md).

## Phase 1 — verification baseline (2026-11-02)

Scope: reproducible local and pull-request verification. This section does not assert that either hosted environment has been upgraded or validated. Release configuration and deployed behavior require independent readback.

### Supported environment and entry points

- Node.js **24.22.1**, pinned in `.node-version`, `.nvmrc`, and the package engine. Verification rejects a different runtime with an actionable error; warnings are not globally disabled.
- Python **3.11+** with the standard-library `sqlite3.Connection.deserialize`, `setlimit`, and `getlimit` APIs. The existing synthetic SQL tests deserialize the Node SQLite snapshot and enforce D1-compatible statement/argument limits. These tests remain mandatory.
- `npm ci` installs the locked application dependencies; `npm run verify` runs application and explicit Pages Functions type checks, ESLint, a fresh production build, then the entire discovered test inventory. The build precedes tests and does not require a previously generated `dist` directory.
- `npm test` and `npm run test:all` use the same recursive inventory: every `tests/**/*.test.ts`, `tests/**/*.test.mjs`, and `scripts/**/*.test.mjs` file. A discovery regression checks that a newly added matching file joins the inventory automatically. Existing focused commands remain available.
- Browser E2E remains a separate, identity-isolated operation. The Node test inventory does not execute browser specs.

### Baseline diagnoses

The pre-hardening Node 23.9.0 baseline reported 1,278 tests with seven failures. Node 23 is outside the supported environment:

1. Four synthetic SQL tests require `DatabaseSync.serialize()`, absent on Node 23. On Node 24.22.1 a new in-memory database exposes the method and produces a 4,096-byte snapshot; the tests retain their real Python SQLite compilation and limits.
2. The hosted verifier CLI checks clean stderr. Node 23's experimental type-stripping warning violates that check. Node 24 runs the same subprocess without that warning. The stderr assertion remains strict.
3. The offer UI fixture assumed six promise microtasks were sufficient for `Response.json()` and DOM updates. It now waits for the inspection status to finish with a bounded deadline, retaining the rendered content, consent, privacy and decision assertions.
4. The real card-coordinator runtime regression reproduced `Response.clone: Body has already been consumed` at `tests/identity-card-runtime.test.ts:66` on Node 23, but passes unchanged on Node 24. The production dispatcher reads a clone of only the bounded JSON lifecycle response; the proxy returns the original coordinator response. No product code, response assertion, PDF size check, mail audit check, or replay check was relaxed. This evidence establishes a runtime-dependent failure, not a verified production defect.

The three unchanged suspect suites (`identity-card-runtime`, `condo-hosted-verify`, `identity-offer-ui`) first passed **78/78** on Node 24 before changes. The revised discovery and offer fixture then passed **3/3** focused tests.

### CI and release gates

`.github/workflows/quality.yml` runs on pull requests and pushes to `main` / `framework-v001`, with cancellation of superseded runs and no scheduled builds. Documentation, audit and tracker changes are excluded; published license inputs remain eligible. The workflow runs `npm run verify`, then separately installs **Wrangler 4.156.0** in the runner's temporary directory for native synthetic edge and mail checks. This version was read from the existing local runtime package, not inferred.

Native commands accept a directory containing Miniflare and esbuild:

```sh
npm run test:native:edge -- /path/to/runtime/node_modules
npm run test:native:mail -- /path/to/runtime/node_modules
```

These checks compile the actual Pages and Worker entry points. Every outbound/provider request is denied or replaced by a synthetic handler. They do not read Cloudflare credentials, send real mail, or operate a hosted environment.

The Pages build command must independently invoke `npm run verify`; a GitHub quality check by itself cannot guarantee that Cloudflare's automatic build waits for it. Changing and verifying hosted build configuration, branch targets, migrations, Workers and public behavior belongs to the release evidence, not this local baseline.

### Verification evidence

- `npm run verify`: PASS. Type checks (including Pages Functions), ESLint, fresh production build, then **109 discovered files / 1,291 tests / 1,291 passes / 0 failures / 0 skipped**; test duration 100.87 seconds. The broader count includes existing script tests that the old default command omitted.
- `npm run test:native:edge -- <existing-runtime>/node_modules`: PASS. Actual workerd Pages + private service + native rate-limit bindings; missing required binding fails closed with zero D1/card access.
- `npm run test:native:mail -- <existing-runtime>/node_modules`: PASS. Actual compiled Pages + coordinator + native D1; 4.4 MB attachment bytes, durable audit/lease/finish, concurrent replay, final-batch rollback, signed callback receipts, and unknown-send reconciliation with all external traffic stubbed.
- Local Python SQLite is 3.53.2 with `deserialize` and `setlimit` available.
- Supported Node gate: Node 24.22.1 exits successfully; Node 23.9.0 exits 1 with the required version and selection instructions.
- `git diff --check`: PASS.
- Browser E2E and live environment verification: not performed as part of this phase.

## Phase 2 — metadata and private release contract (2026-11-02)

Implementation status: local implementation only. Development and production release/readback remain pending; no hosted code or schema claim follows from the local checks below. The releasing maintainer independently reread both environments through the official Cloudflare API: each existing schema has 461 objects and 36 migrations, and both complete canonical schema hashes match `d0618a3896a6c2835e3f5e2e4c519da44168bae18a065c18b89d8cf8b9852c28`. Both still run the previous application; the new endpoint and manifest await deployment. The release generator derives these counts from files automatically rather than hardcoding them.

### Build and private contract

The production build now injects social previews before copying the public shell to `/about`, `/neighbors`, `/move-in` and existing demo resident routes such as `/m7k2px`. Standalone identity, verification, recovery, maintenance and offer documents remain `noindex` without copied social tags. The regression executes the real HTML postprocessors in the maintained build order inside an isolated output fixture, then inspects emitted public and private route HTML. It introduces no `dist` prerequisite for standalone `npm test`.

`npm run build` first generates an incomplete private contract, then builds assets and generates the complete contract. `.release/manifest.json` and `server/live/generated-release.ts` are ignored; neither is copied to `dist`. No timestamp is included. Clean-checkout typechecking and default tests prepare the missing module automatically without treating a pre-existing `dist` as current release evidence. Native Pages compilation must run after the build and consumes the complete generated module.

The contract binds the source SHA (`CF_PAGES_COMMIT_SHA`, otherwise Git HEAD), a digest of the current tracked and non-ignored source inventory, ordered migration names and byte checksums, normalized complete SQLite schema definitions, maintained renderer build hash, and every emitted JavaScript/CSS file and byte hash. The source-tree digest makes uncommitted source changes distinguishable from the recorded commit. A final release must be rebuilt after the release commit; do not reuse a pre-commit manifest or infer source identity from `dist`.

Node 24 `DatabaseSync` applies every migration to a fresh in-memory database. Generator and Pages runtime use the same token normalization and SHA-256 functions. SQL comments and whitespace are ignored; quoted content, columns, constraints, trigger bodies, indexes and views remain in the digest. SQLite internals, `_cf_KV` and `d1_migrations` objects are excluded. Readiness compares full definitions, not only object names. The applied migration ledger must contain exactly the expected names; migration byte checksums identify the source release but do not prove historical SQL bytes from D1's name-only ledger.

`GET /api/v1/operator/release` runs before the existing global schema gate, allowing incomplete databases to report `ready: false`. It retains canonical-host, edge and transport protection, rejects cookies/foreign origins, and verifies `X-Tower-Operator-Key` before D1 or ASSETS access. Only bounded hashes and readiness flags are returned, with `Cache-Control: no-store`; raw DDL, provider errors, credentials and resident rows are never returned. The manifest and endpoint are operational evidence, never visitor UI metadata. Missing database/ledger or schema mismatches fail readiness closed. This does not implement the later route-capability gate.

### Operator verification

After committing, build the exact source again:

```sh
npm run verify
npm run release:verify -- --endpoint https://HOST/api/v1/operator/release
```

Inject `RELEASE_OPERATOR_KEY` only into the temporary child-process environment from secure storage. Never place the key in shell arguments, tracked files or saved readbacks. The CLI sends it only to the specified HTTPS operator endpoint, rejects redirects, then independently downloads only public JS/CSS without credentials and checks their actual bytes. The manifest classifies assets with the same Tower Lord route-prefix predicate as the private router; every public and protected file remains bound into `frontendHash`. The authenticated endpoint reads only fixed build-owned `tower-lord/console.js` and `tower-lord/console.css` paths through the same deployed ASSETS binding, compares actual SHA-256 bytes, and returns only `protectedAssetsReady` and the protected asset-list digest. The CLI requires both to match. Missing bindings, missing files, redirects, changed bytes or classification mismatches fail closed. Public Access protection is unchanged; no content bypass or caller-selected path exists. Edge fetch uses manual redirects and requires status 200 because workerd does not support the Node `error` redirect mode. It compares local source identity, complete manifest, schema, migration, renderer, frontend and aggregate build hashes. A source change after the build requires a rebuild. Unstaged deletion of a tracked input is represented by a deterministic missing-file sentinel in the source inventory; verification remains usable and the deletion changes the source digest. Other filesystem errors remain fatal.

An existing private JSON readback can be checked offline with `npm run release:verify -- --readback /private/path/readback.json`; `--manifest` and `--assets` can select existing local evidence. Offline mode verifies supplied evidence and local asset bytes; it does not certify the current hosted asset bytes. Neither CLI mode needs provider credentials in the repository.

Private supporting Worker code, bindings, secret names, branch targets and both environments still require separate official-platform readback and native checks. The endpoint does not certify private Workers, bindings or external provider behavior. Cloudflare build configuration changes are recorded by the releasing maintainer only after actual API readback; they do not establish that the next application version is already live.

### Regression evidence

The wrong-key request originally returned 503 after accessing the schema gate; the new test first reproduced that failure, then passed with 401 and zero D1 calls. Cookie/foreign-origin rejection, exact schema readiness, an added column, replaced trigger and absent applied migration are covered. The frontend verifier accepts matching evidence, then rejects changed JavaScript bytes. Full verification and native compilation results are recorded by the maintainer with the final release evidence.

Local validation: `npm run verify` passed with 112 discovered files, 1,298 tests, zero failures/skips (96.70 seconds for tests), including explicit Pages Functions typechecking and ESLint. `test:native:edge` passed using the existing local runtime: actual compiled Pages/private-service rate limits and missing-binding fail-closed checks, with no external traffic. `test:native:mail` also passed: actual compiled Pages, coordinator and native D1 with attachment bytes, durable audit, race rollback and reconciliation; all network calls were stubbed. The isolated metadata fixture revision then passed focused tests, typechecking and lint. These checks do not establish live deployment readiness.

## Phase 3 — immutable Tower assets (2026-11-02)

Historical implementation snapshot (2026-11-02), superseded by the official platform preparation below: migration 0037 and compatible deployment were pending at this point. The recorded platform preparation subsequently applied migration 0037 to both environments; compatible application deployment and independent live readback remain pending. No historical assets were backfilled, rewritten or deleted by the migration.

The focused [Tower asset storage contract](TOWER-ASSET-STORAGE.md) describes room-scoped immutable objects/chunks, revision references, direct legacy anchors, byte validation, atomic writes, RPC bounds and rollback compatibility. Intake and move-in completion share the resolver. Existing URLs, ownership checks, preview boundaries, current-public-revision checks and dream consent remain with their existing callers.

Text-only revisions now add references while BLOB rows and bytes remain constant, including the first edit of legacy data. Repeated sanitized uploads and identical home/dream bytes reuse the same room object. Every referenced object or legacy anchor is validated from actual bytes, and corrupt refs cannot fall back to healthy legacy data. SQL immutability, matching collision guards and a first-anchor byte comparison protect prepared writes from races; authorization, storage changes, snapshot, current revision, immutable receipt and audit remain in one batch.

Focused synthetic regression coverage includes repeated text revisions, repeated uploads, same-key preparation races, enclosing-batch rollback, missing schema/guards, missing chunks, bad lengths/digests/bytes, corrupt-ref precedence, legacy anchors and cross-household isolation. Existing intake, dream, selective sync, preview, public revision, consent revocation and move-in completion tests verify resolved byte behavior rather than assuming per-revision physical copies. The large import regression retains its conservative serialized-RPC ceiling.

Rollback limitation: after refs-only writes, the pre-0037 reader cannot serve those revisions. Keep a compatible reader or roll forward; retaining old legacy rows alone does not make an old binary compatible. Local verification and native runtime results are recorded below; no hosted readiness claim follows from this implementation note.

Local verification evidence for phase 3:

- Before the final size-boundary review, the releasing maintainer ran `npm run verify` successfully: 113 discovered files / 1,312 tests / 1,312 passes / zero failures or skips, with 124.28 seconds for tests. This includes the corrected bilingual README guide-target parity and refs-only completion regression. The final release rebuild must consume the final source inventory, including the later size-boundary correction described below.
- The final focused storage/intake/sync/source/native-intake/completion run passed 87/87, including corrupt-storage completion rejection despite healthy fetched public bytes. The historical pre-0035 admission fixture passed after explicitly applying additive storage migration 0037 while retaining its historical policy boundary.
- `test:native:assets` passed against actual workerd D1 with the current migration and compiled storage module: native BLOB reads are number arrays; 4-byte, 3 MiB and 8 MiB objects round-trip; a 12 MiB pair commits in one 29-statement batch; repeated uploads/text references keep 23 physical chunks / 11,534,340 bytes fixed; direct legacy anchors, mutation guards, batch rollback, cross-household rejection and byte-corruption rejection passed. All data is synthetic and outbound network access is denied.
- `test:native:edge` passed with actual compiled Pages/private service and rate-limit bindings, including missing-binding fail-closed checks. No credentials, real residents or hosted state were used.
- `git diff --check` passed. Both maintained README files link the storage contract. The quality workflow retains docs-only exclusions and adds the native asset command after the existing pinned runtime installation; it introduces no cron or additional deployment trigger.


Phase 3 size-boundary review follow-up: a red regression showed that dream replacement previously accepted a retained home plus new dream above the existing 12 MiB final-snapshot ceiling. The dream route now counts the validated retained home and selected dream before preparing its batch, returning the existing `413 source_images_too_large` error above the ceiling. Storage preparation independently rejects an uploaded pair above 12 MiB. Exact-boundary and one-byte-over tests cover both object-backed and legacy-backed retained homes, checking unchanged snapshots, asset objects/chunks/refs, request receipts and audit on rejection. The helper boundary test also verifies an exact 12 MiB pair. After correction, the focused storage/dream/intake/sync/completion run passed 74/74; Pages Functions typechecking, ESLint, current-module native D1 asset tests and `git diff --check` passed. These follow-up checks do not replace the final release-wide verification.

## Phase 5: Route schema capabilities (2026-11-02)

Status: implementation only; deployed code/schema and two-environment live behavior remain pending. See [the capability inventory](ROUTE-SCHEMA-CAPABILITIES.md).

Exact supported public read methods/paths select only their actual read dependencies. All private/auth, write, unknown, malformed, status, appearance/autonomy and mixed asset routes retain the original conservative full requirement set, including migration 0037. The private card coordinator keeps its independent gate. Origin, edge and transport checks still run first.

The selected schema query binds one JSON names array through `json_each`, with no readiness cache. Required type, owning table and normalized DDL must match definitions generated from the actual migrations in the private release manifest. Full schema hashes and the migration ledger remain the authenticated release authority. No schema definitions are returned publicly.

Focused evidence: the eight new capability regressions fail five cases against the previous worker and pass all eight with the new gate; existing Pages/release regressions pass 19/19. Coverage exercises valid published HTML/JSON/image reads despite unrelated missing visits/identity guards, required-storage failures, same-name views/altered DDL, activity list/detail isolation, fail-closed writes without audit/mail effects, drop/restore without stale cache, and one bounded selected schema query per public home request. `npm run verify` passed: typecheck, lint, production build, and all 1,322 discovered tests (0 failures/skips). Native edge passed with real workerd rate-limit bindings and pre-D1/card rejection. Native assets passed canonical capability selection using one JSON bind, unrelated-guard isolation and restoration, plus existing 8MiB reads / 12MiB batches, deduplication, legacy anchors, rollback, household isolation and corruption rejection; all outbound traffic was denied. `git diff --check` passed. No platform migration, deployment or live readback was performed by this implementation phase.


### Official platform preparation verified by the releasing maintainer

On 2026-11-02 (America/Vancouver), migration 0037 was actually applied to development and production, in that order, using the committed source from `6cb69f7`. Both databases match all 477 expected SQL objects and all 37 migration names, with zero foreign-key errors. Existing residency, identity, snapshot, legacy-asset, request-receipt and Tower-audit records remained unchanged; the new storage tables are empty. The original application remains available. This is an additive schema preparation, not a claim that the new Functions or frontend are deployed.

The actual Pages configuration now uses `npm run verify`, Node 24.22.1 and Python 3.13.3 in both environments. Other secret names, bindings and branch filters were read back unchanged. Final application/private Worker deployment and live verification remain pending. Detailed official-platform evidence is retained in the private operations repository, outside public deployment artifacts.

### Protected release assets boundary correction (2026-11-03)

The prior online CLI attempted anonymous downloads of all emitted JS/CSS, including Access-protected Tower Lord assets. A legitimate protected deployment therefore failed verification. Verification now splits public byte downloads from authenticated, binding-local protected byte checks. Offline mode still checks every local asset byte and the complete manifest; supplied readback does not prove current live behavior.

Focused TDD reproduced missing classification and protected-integrity checks before implementation. Regressions cover public-only anonymous downloads despite protected-route 403, authenticated protected hash/flag requirements, local protected-byte tampering, missing/non-200/redirect/tampered binding responses, and wrong authentication with zero database and asset accesses. The native edge smoke compiles the actual worker with an isolated complete manifest and synthetic canonical database responses, uses a real workerd static ASSETS binding, proves authenticated endpoint readiness with matching bytes, and rejects actual protected-file tampering after recreating the binding. This fixture does not require existing `dist`. Hosted deployment and two-environment live readback remain pending.

Local validation for this correction: Node 24.22.1 `npm run verify` passed typechecks, ESLint, production build and all **1,325 tests in 114 discovered files**, with zero failures or skips (121.60 seconds for tests). The post-build native edge/ASSETS command passed with actual workerd and outbound traffic denied. `git diff --check` passed. These checks establish local implementation evidence only; the final release must rebuild the final source inventory and independently verify both deployed environments.

Protected-byte bounds follow-up (2026-11-03): the private ASSETS read enforces a 2 MiB actual-stream limit per static JS/CSS file, independent of `Content-Length`, and a five-second deadline covering fetch and body consumption. Over-limit or stalled reads abort the request and cancel the stream; an ignored abort cannot keep the readiness response waiting indefinitely. Unknown/false length-header cancellation and stalled-fetch/stalled-body regressions were red before the correction. This follow-up retains Access and does not add a content endpoint.

Follow-up validation: all 12 focused release tests, application/Functions typechecks, ESLint, native edge plus actual ASSETS positive/tamper checks, and `git diff --check` passed. The earlier 1,325-test full verification remains the pre-bounds baseline; this narrowly scoped correction was verified with the focused and native checks above. Hosted readback remains pending.


## Phase 6 — core domain boundaries and home metadata (2026-11-03)

Status: implementation only; development/production application deployment and independent code/schema/live-behavior readback remain pending. This phase adds no migration. The earlier phase-3 implementation-only migration note is historical and is superseded by the recorded official platform preparation above; it does not mean migration 0037 remains unapplied.

The [core module map](CORE-MODULES.md) records the source/domain split and transaction owners. Intake now composes pure contract/error validation, source reads, authorization, query/statement builders, bounded requests, trusted rendering, grouped content/dream/visibility commands and publication. Live application authorization accepts explicit onboarding scope while route mapping stays in HTTP composition; complete community projection has its own module. Manager admission imports pure validation and separates durable job queries and SQL policy predicates, retaining provider invocation, context/defer/final transactions and interrupted-result handling together. Construction remains lazy and selected public capability dependencies are unchanged.

The Tower wrapper now adds escaped published-only canonical/Open Graph metadata, using published name/intro and fixed published home image revision. Private preview HTML/JSON/assets are noindex; HTML omits canonical/Open Graph and supports matching GET/HEAD headers. The standalone renderer is unchanged. A regression first failed for the missing canonical tag, then passed with draft isolation, revoked dream consent, escaped metadata, query/share-key exclusion, owner/agent private preview and HEAD behavior. Six parsed-body golden hashes captured from main `07576b2` verify unchanged public/private visible home, inside and dreams markup. The maintained English-copy inventory explicitly includes every new source module so extraction cannot hide public copy from review.

Focused verification before full verification: 117 intake/source/sync/dream/visits/activities tests and 185 live/onboarding/community/Pages/admission/assisted-admission/identity-recovery/manager tests passed with no failures/skips; application/Pages Functions typechecking and ESLint passed. These are synthetic local checks, with no real resident writes or provider calls.


Final local phase-6 evidence:

- Node 24.22.1 `npm run verify`: PASS — application and Pages Functions typechecks, ESLint, fresh production build and **115 discovered files / 1,334 tests / 1,334 passes / zero failures or skips**, test duration 96.20 seconds. The maintained bilingual README links and complete public-copy inventory pass. Readable formatting preserves the executable AST; current-source typechecks and ESLint also pass.
- Native edge/ASSETS: PASS — actual compiled workerd Pages/private service, required rate-limit bindings, canonical guard, pre-D1/card rejection, protected static integrity positive/tamper/missing-binding checks; external traffic denied.
- Native immutable assets: PASS — actual D1 number-array BLOB reads, 8 MiB round-trip, 12 MiB single 29-statement commit, fixed physical chunks/bytes across deduplication/reference updates, legacy anchors, rollback, household isolation and corruption rejection; external traffic denied.
- Native manager: PASS — actual compiled Pages + D1, scoped scheduled Worker, ManagerClock SQLite durable object, replay/audit/scope guards, database-native billing/calendar boundaries and count/paid-claim midnight seam; external traffic denied.
- Independent AST comparison against main `07576b2` confirms the provider `invoke`, admission `context`/`defer`/`finish`, complete `editBuilding`, unchanged session/delegated guards and guarded write functions, and public snapshot validator preserve their executable syntax after relocation/formatting. Existing behavior and native tests remain the transaction-boundary authority; source size or absence of SQL is not used as proof.
- `git diff --check`: PASS. No dependency, migration, platform setting, secret or resident data changed. Commit/push/deployment are performed separately by the releasing maintainer, who must rebuild the committed source and verify both hosted environments.

## Phase 7 — bounded seasonal policy and historical audit recovery (2026-11-03)

Status: implementation only; application deployment and independent development/production deployed-code/schema/live-behavior readback remain pending. This phase adds no migration, mandate, schedule, provider/model selection, budget increase or real resident operation. Commit/push/deployment remain the releasing maintainer's responsibility.

The [core module map](CORE-MODULES.md) identifies the generic autonomy lifecycle, pure frozen policy registry and historical recovery transaction owner. Only the existing version-1 Halloween case is registered. Its original dates, anchor, permissions, standing-duty acceptance, private planner/auditor instructions and task/repair limits have moved into policy; existing appearance exports remain compatible. Unknown policy IDs, wrong local days and expired windows fail closed. Historical recovery pins that version rather than following a future current-policy selector.

The complete historical recovery eligibility and atomic batch were moved together. A mechanical source comparison against main `594136c` confirmed exact equality for all native recovery predicates, exact legacy ID/step/token/billing conditions, R2 readback and transaction statements after only anchor-constant, generic type and function-name substitution. Reservation/actual billing, native current-day/task authority and expiry, unknown/dispatching outcomes, immutable resume receipt and rollback behavior remain intact. No paid call is replayed and no preserved image is regenerated.

TDD and focused checks: the new policy boundary test first failed because its module was absent, then passed with known/unknown/wrong-day/expired/malformed-time and frozen-policy checks. All 31 autonomy/policy tests passed, including the added unknown durable-anchor recovery case and existing settled/legacy/unknown/expiry/budget/changed-case/each-SQL-boundary rollback matrix. The complete selected autonomy/theme/appearance/schedule suite passed 79 tests, zero failures/skips. The maintained English default-output inventory now includes both extracted modules, so private operational strings remain subject to copy review.

Final full verification: Node 24.22.1 `npm run verify` exited 0 with application/Pages Functions typechecks, ESLint, fresh production build and **116 discovered files / 1,335 tests / 1,335 passes / zero failures or skips**, test duration 116.79 seconds. `git diff --check` passed. Public copy/default-English checks and the maintained bilingual README checks passed. This evidence establishes local implementation only; hosted release readback remains pending.

Final-source native evidence (all commands exited 0 using existing cached Miniflare/esbuild; external provider traffic denied):

- `test-tower-manager-native.mjs`: actual compiled Pages/D1, scheduled Worker and ManagerClock SQLite durable object; permanent replay/audit, native billing/calendar and count/paid-claim midnight seam pass.
- `test-tower-theme-native.mjs`: existing/fresh/repaired/unknown/midnight activation cases preserve the original account, budget, completion and pair evidence.
- `test-tower-theme-native-guards.mjs`: renderer authority, lease, mandate, budget and revision rollback; immutable receipt/provenance and final expiry guard pass.
- `test-tower-theme-build-native.mjs`: actual product D1/R2/lease/billing for PASS, unknown, claim expiry, reduced budget and disabled authority pass; completed prior theme/account/screens remain preserved.
- Mechanical comparison of the entire provider module confirms identical source after only policy import/window/anchor substitutions. Models, prices, receipt accounting, request/response contracts and last synchronous dispatch gates are unchanged.

## Phase 8 — isolated builds, client graph, and local migration ledger (2026-11-03)

Build/frontend/local migration implementation is complete locally; dedicated-lane browser acceptance and final hosted release/code/schema readback are tracked separately. See [build targets and migration safety](BUILD-TARGETS.md) and [browser verification](BROWSER-VERIFICATION.md). This entry does not authorize an appearance activation, model call, mail send, or resident operation.

The production entry now dynamically loads the live or historical renderer. The historical module owns artwork, residents, interactions, community reads and demo layout CSS; its abortable handlers and appearance binding are disposed on navigation. Asynchronous import/render epochs reject stale completion and focus changes. Initial Tower markup remains intact while the live import is pending; feed updates preserve the landscape/player nodes and independently validated public doors. Unknown routes remain historical 404s. All ten fixture IDs, their inside/dreams routes, historical about/entry/records routes, and original compatibility artwork remain in the production output.

`build:tower` produces `dist`; `build` aliases it. `build:demo` uses its own `demo/index.html` root, disables live routing at build time and produces only `dist-demo`. `preview:demo` serves that isolated output. The standalone `condo:build` contract is unchanged. Demo appearance controls use static images with an in-process null appearance response and no API request. Shared lobby markup no longer imports the generated embedded asset module: masked preview data and embedded brand/poster imports live in renderer-only `lobby-preview.ts`, which is included in the renderer source digest.

Build verification now parses every emitted HTML document with parse5, verifies all local script/stylesheet files, and rejects raw TypeScript, missing private-console assets, path traversal and symlinks while retaining entry compilation and identity privacy guards. The emitted Pages `_routes.json` uses only six explicit static-directory exclusions and exact `condo-template.css`. API, home, Tower Lord and private identity paths continue through Functions. Cloudflare's official version-1 wildcard/exclusion precedence contract was checked for these tests; there is no arbitrary external fetch in the build guard.

The local server discovers all 37 migration files and records exact-byte hashes. Existing databases without a ledger require one exact full-schema prefix match against in-memory replay. Unknown/ambiguous schema, changed hashes, or schema drift fail closed. Adoption, remaining migrations, ledger writes, final schema and foreign-key checks share one immediate transaction. In-memory tests cover fresh/idempotent application, a 33-migration legacy prefix retaining a synthetic account, unknown/ambiguous schemas, hash mismatch, and rollback when retained data causes a later migration to fail. Existing `data/local-mvp.sqlite` was not opened or modified by this work.

Local evidence before browser integration:

- Node 24.22.1 `npm run verify`: exit 0; application/Functions typechecks, lint, fresh Tower build, and **119 discovered files / 1,343 tests / 1,343 passes / zero failures or skips** (100.97 seconds test duration).
- `npm run build:demo`: exit 0 using the actual demo root. Both Tower and demo were additionally built into isolated temporary directories with `MUSE_BASE_PATH=/MuseCondo/`; recursive build guards passed for both.
- Original and extracted renderer preview outputs were compared directly against HEAD for both day and night: identical DOM. All **51** public PNG/WebP/JPEG/GIF/SVG files were compared byte-for-byte with both output targets: identical original bytes.
- Current-source native edge checks passed: actual workerd Pages/private service/rate-limit bindings, missing-binding fail-closed, and protected ASSETS integrity; no external traffic.
- Current-source native asset checks passed: actual workerd D1 immutable objects/chunks/refs, 8 MiB reads, 12 MiB batch, legacy anchors, isolation/tamper rejection and rollback; outbound denied.
- Current-source native manager and theme-build checks passed with synthetic D1/R2/DO/provider transport. Scheduled dispatch, durable clock and midnight authority seam passed; theme review preserved old completed theme/account/PASS/screens and rejected duplicate evidence, wrong manifest and wrong PNG. No external provider was called.
- `git diff --check` passed. The default-English inventory now explicitly covers `demo.ts`, `route-policy.ts` and renderer-only preview source; extraction cannot hide public copy from review.

Browser acceptance is not established by the Node/native evidence above; final release verification must use the completed dedicated-lane synthetic runtime suite and then independently check deployed development/production code/schema/live behavior.

Phase 8 browser-integration follow-up: the first real demo browser run exposed a refresh regression introduced during extraction: the existing-edition refresh button was incorrectly gated on missing community data. The handler now gates on `!communityLoading`, preserving refresh of an existing edition while rejecting duplicate in-flight clicks. A focused test executes the maintained click handler against both states and passes; typechecks and lint pass. The small base stylesheet also restores the original generic reset, typography, link/button, accessibility and reduced-motion rules, keeping demo layouts deferred without changing shared Tower defaults. These follow-ups require the final build/full-suite/browser verification; the earlier 1,343-test evidence above predates them.


Phase 8 fresh-lobby CSS/SSR follow-up (2026-11-03): the initial review's suspected `site-header`/`page-width` omission was withdrawn because those selectors belong to the historical demo, while the real lobby uses `live-*`/`tower-*`. Actual browser comparison nevertheless found a smaller mobile button-font difference; the original `.82rem` mobile rule and shared button-span sizing now live in base CSS. Live/Tower styles are also static render-blocking entry imports, preserving the server header/hero before the dynamic live JavaScript arrives. The runtime suite now holds that actual JavaScript request and checks SSR header/intro/panorama/image geometry, then compares every effective computed property of the live DOM before/after temporarily adding the original full stylesheet. Custom-property source-token quote serialization is excluded; its effective computed properties remain checked, and motion is disabled only during style snapshots. Desktop and mobile actual runtime suites passed together (2/2, 7.1 seconds), including the full existing publication/replay/withdrawal flow; typechecks, lint and 19 focused Node tests passed. The runtime child cleanup also covers startup failure and already-exited children, with a bounded fallback for only the test-owned process. Final release-wide verification remains the final acceptance evidence.


Final integrated local acceptance (2026-11-03): Node 24.22.1 `npm run verify` exited 0, with both typecheck targets, lint, fresh Tower build, **119 discovered files / 1,344 tests / 1,344 passes / no failures or skips** (96.08 seconds test duration). Fresh `build:demo` passed. The canonical NeoBabylon CDP suite passed **26/26** desktop/mobile tests (25.4 seconds), including actual-runtime application/proof/import/publication, private draft/replay/stale rejection, private noindex and public metadata, republishing, withdrawal, historical navigation and persisted/corrupt community recovery. Synthetic runtime checks asserted zero mail, unexpected provider calls and foreign-key errors. The suite uses no real resident authority.

Browser acceptance additionally holds the actual live JavaScript import and verifies styled server-rendered header/hero before releasing it. Effective computed styles on the fresh live DOM match the original shared stylesheet in both viewports; original mobile button typography is preserved. Initial Tower navigation loads no historical demo module and creates no YouTube iframe. Desktop/mobile screenshots were visually inspected as local synthetic evidence. Test startup failure and child termination are bounded; the fixture rejects non-NeoBabylon lanes and disconnects without closing the canonical browser.

Final native edge/ASSETS, immutable asset storage, mail/coordinator, ManagerClock/admission, theme activation, theme guards and theme-build commands all passed with current source and cached Wrangler 4.156.0 runtime dependencies. These compile actual application/Workers and use isolated synthetic workerd D1/R2/DO bindings. All external/provider traffic was denied or synthetic. No live mail or model result is claimed. Independent specification and quality reviews passed after the lane restriction, refresh and stylesheet corrections. Hosted deployment/readback remains the remaining release gate.

## Phase 9 — maintained architecture and release index (2026-11-03)

The [current release index](CURRENT-RELEASE.md) is the maintained entry for architecture, migration inventory, build targets and acceptance evidence. Both maintained READMEs link to it. `PAGES-RUNTIME.md` now distinguishes the current 37-migration/477-object contract and `npm run verify` from dated 0001–0005/0011 history. The old static deployment guide is explicitly archived, including its old output, hosting and license assumptions. Historical plans and immutable evidence retain their original dates. The private operations README now separates earlier v1.32/v1.15 milestones from this release record. No private infrastructure evidence is copied into public artifacts.

## Hosted build prerequisite correction — real PDF tooling (2026-11-03)

Historical implementation evidence: the privileged installer described in this subsection was rejected by the real Cloudflare build and is superseded by the rootless follow-up below. Do not use it as the current bootstrap procedure.

The development Cloudflare Pages build ran the 1,344-test suite (1,342 passed) but failed two identity-card render tests with `spawnSync pdftotext ENOENT`. GitHub Quality [run 41602152102](https://github.com/mkhsu2002/MuseCondo/actions/runs/41602152102) independently had the same two missing-Poppler failures. Those tests also require `pdffonts` and `pdftoppm`. This was a missing hosted build prerequisite; the real PDF text/font/raster and independent jsQR checks remain required and unchanged.

`npm run verify` now runs `scripts/check-test-tools.mjs` immediately after its Node check, so missing/unusable Poppler executables fail early. By default it only probes the three actual tools and reports the prerequisite. System installation requires the explicit `MUSE_INSTALL_TEST_TOOLS=1` flag, Linux, and an identified ephemeral GitHub Actions or Cloudflare Pages environment. It uses root apt-get or noninteractive `sudo -n apt-get`, installs only `poppler-utils` with no recommended packages, and rechecks all three commands. Installation or recheck failure stops verification. It never installs packages on local macOS or unidentified Linux. GitHub quality opts in without altering path/concurrency gating. Cloudflare flags are external deployment configuration and are not established by this source change.

Focused local evidence: seven injected-runner tests passed for existing-tool no-op, default missing-tool failure, platform/environment refusal, root install, non-root noninteractive sudo, update/install failure and mandatory real-command recheck. No apt command ran during these tests. The actual local Poppler preflight, application/Functions typechecks and ESLint passed. The unchanged real identity-card render suite also passed all four tests (2.94 seconds), including real Poppler text/font/raster inspection and jsQR decoding, with zero skips. Hosted root/sudo support and successful repair remain unverified until the next actual development build; no Cloudflare build-image privilege guarantee is assumed.

Post-bootstrap integrated local verification: Node 24.22.1 `npm run verify` passed with the actual Poppler preflight, application/Functions typechecks, lint, fresh Tower build and **120 discovered files / 1,351 tests / 1,351 passes / zero failures or skips** (95.68 seconds). The seven additional tests cover bootstrap boundaries without running apt. Specification and quality reviews independently passed. Actual Cloudflare/GitHub installation and successful full gates still require the next candidate build.


## Rootless PDF toolchain follow-up (2026-11-03)

Actual development candidate v1.60 build `14a6c8a0` failed after five seconds with `sudo: a password is required`. The former privileged bootstrap therefore did not establish hosted readiness. It has been removed rather than bypassing the real PDF checks.

Both identified Linux CI services now share a rootless bootstrap under the existing explicit opt-in flag. A private temporary APT configuration isolates lists/cache/downloads, disables binary package caches and update hooks, and retains system signed sources/trusted keys with unauthenticated/insecure repositories disabled. The C-locale solver's exact `Inst` package versions are downloaded through APT, extracted only to a temporary prefix with `dpkg-deb -x`, and all three real executables are rechecked. Unexpected/removal/unbounded plans and libc/loader replacements fail closed. The host package database and installed files are untouched; there is no sudo branch.

`verify.mjs` keeps the private executable/library environment alive through the existing typecheck, lint, build and complete test sequence and cleans temporary state in `finally`. Seven injected-runner tests cover existing-tool no-op, unauthorized-environment refusal, exact dependency/version parsing, private authenticated APT options, extraction, inherited environment for every gate, and cleanup for bootstrap/gate failure or unsuccessful recheck. Focused tests, application/Functions typechecks and ESLint pass. No actual APT operation was run on the local Mac; real Linux/Cloudflare acceptance remains pending the next hosted build. [Current toolchain procedure and primary documentation](BUILD-TARGETS.md#pdf-verification-tools) supersede the old privileged instructions above.

Rootless integrated local verification: `npm run verify` via the new orchestrator passed the actual existing-tool preflight, application/Functions typechecks, lint, fresh build and **120 files / 1,351 tests / 1,351 passes / zero failures or skips** (99.83 seconds). The environment/cleanup/solver tests execute no apt commands. Native/browser product code and assertions are unchanged from the accepted seven-native-command/26-browser matrix. Actual rootless Cloudflare and GitHub builds remain the required next gate.


## Private release configured runtime readiness (2026-11-03)

A real release configuration update treated Cloudflare API secret readback `null` as replacement values: the build passed while operator authentication returned 401. Secrets were restored through incremental updates from secure storage. To prevent an authenticated release from appearing ready while other enabled-feature secrets are missing, its private readback now includes boolean `runtimeBindingsReady`, and aggregate `ready` requires it. The release verifier rejects missing, false or nonboolean runtime readiness. Existing origin, edge, authentication and method gates retain their order; unauthorized calls still access neither D1 nor ASSETS.

This check covers only configured nonempty strings required by present identity-card/manager runtime bindings, enabled mail delivery and approved paid calls. It does not validate key formats, provider authorization, actual mail delivery or platform binding IDs. Manager approval alone does not require a paid provider. Private Worker checks remain separate. Final deployment and development/production readback acceptance for this guard remain pending.

Final configured-readiness verification (2026-11-03): both independent specification and quality reviews approved the guard. Node 24.22.1 `npm run verify` passed types, lint, build and **120 files / 1,354 tests / 1,354 passes / zero failures or skips** (167.50 seconds). Current-source native edge/ASSETS checks passed, including the new boolean on an actual workerd authenticated release response, matching protected bytes, tamper/missing-binding failure and pre-auth zero-D1 boundaries. This introduces no migration or paid/mail operation; final exact-source development and production deployment acceptance remains pending.


## Deterministic delayed identity replay verification (2026-11-03)

Candidate v1.62 GitHub Quality run 41673223546 reached its 20-minute job timeout after the identity enrollment capacity/onboarding tests, without a failing assertion. The next delayed-replay test assumed cryptographic digests completed in request-call order. If the request named `first` reached the second rate batch, the test awaited its own promise. A temporary focused reproduction delayed that request by 50 ms and reliably hit a 2-second test deadline.

The test now waits explicitly until the first request has entered its uncommitted identity-insert batch before starting the second request. The second rate batch releases the first commit and waits for its permanent receipt. Both 201 responses, identical response bodies, exactly one identity/receipt, and account/global rate counters of one remain required. A 5-second test deadline bounds future regressions. The same forced-delay reproduction passes with the barrier. No production request handling changed, and no assertion or verification gate was removed. Full local and hosted follow-up acceptance is recorded after it actually completes.


Delayed-replay follow-up local acceptance: independent specification and quality reviews approved the synchronization change. Node 24.22.1 `npm run verify` passed application/Functions types, lint, fresh build, and **120 files / 1,354 tests / 1,354 passes / zero failures, cancellations or skips** (154.75 seconds). Hosted development and production acceptance still require the corrected-source deployment.


## Phase 10 — final two-environment acceptance (2026-11-03)

All planned implementation and verification steps are complete. Released source `4b81f413a34c923a986c6b905a2c5a4c6ed0b151` is on both `main` and `framework-v001`. Development and production authenticated release readback passed with the identical build hash recorded in the current release index, configured runtime readiness true, complete 37-entry migration ledgers and identical 477-object canonical schemas. Exact downloaded public JS/CSS and protected ASSETS matched. Public home/inside/dreams metadata and existing images passed; original residency, snapshot, identity, receipt, legacy-chunk and Tower-audit hashes remain unchanged. Foreign-key checks returned zero errors.

All three supporting Workers were deployed to both environments and actual compiled bytes, bindings, Durable Object namespaces, R2/database/service associations, compatibility settings, private endpoints and unchanged schedules were verified. Production automatic deployment was restored with all other configuration preserved. The correct-domain mail credential was restored from secure storage: deployed sender metadata, signed own-handler probe, permanent replay and persistent intent/completion audits passed without adding mail events or sending an email. No resident credential/content, paid generation, consent, budget, model authority or cron frequency was changed.

Final local full gate: 120 files / 1,354 passes, no failures/skips/cancellations (154.75 seconds). Cloudflare development and production independently passed the same full 1,354-test gate (164.68 / 168.67 seconds). GitHub Quality runs 41677666939 (development) and 41678890524 (main) succeeded, including all native CI steps. The accepted 26-test dedicated-lane browser suite and seven-command native runtime matrix remain valid; subsequent production code added only the independently reviewed private configured-readiness guard, whose actual workerd edge/ASSETS test also passed. The final delayed-replay change affects tests only and preserves all original assertions.

The actual final dist was scanned in memory against the supplied mail and production operator credentials: 156 files, zero matches. Private infrastructure IDs and raw acceptance/backup/configuration evidence remain outside public artifacts in the operations repository. Documentation-only follow-up commits describe this frozen binary and must not be mistaken for a newer application deployment. No real inbox delivery or resident-owned acceptance is claimed.
