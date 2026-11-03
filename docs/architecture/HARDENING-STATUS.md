# Architecture hardening status

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

`GET /api/v1/operator/release` runs before the existing global schema gate, allowing incomplete databases to report `ready: false`. It retains canonical-host, edge and transport protection, rejects cookies/foreign origins, and verifies `X-Tower-Operator-Key` before D1 access. Only bounded hashes and readiness flags are returned, with `Cache-Control: no-store`; raw DDL, provider errors, credentials and resident rows are never returned. The manifest and endpoint are operational evidence, never visitor UI metadata. Missing database/ledger or schema mismatches fail readiness closed. This does not implement the later route-capability gate.

### Operator verification

After committing, build the exact source again:

```sh
npm run verify
npm run release:verify -- --endpoint https://HOST/api/v1/operator/release
```

Inject `RELEASE_OPERATOR_KEY` only into the temporary child-process environment from secure storage. Never place the key in shell arguments, tracked files or saved readbacks. The CLI sends it only to the specified HTTPS operator endpoint, rejects redirects, then independently downloads public JS/CSS without credentials and checks their actual bytes. It compares local source identity, complete manifest, schema, migration, renderer, frontend and aggregate build hashes. A source change after the build requires a rebuild. Unstaged deletion of a tracked input is represented by a deterministic missing-file sentinel in the source inventory; verification remains usable and the deletion changes the source digest. Other filesystem errors remain fatal.

An existing private JSON readback can be checked offline with `npm run release:verify -- --readback /private/path/readback.json`; `--manifest` and `--assets` can select existing local evidence. Offline mode verifies supplied evidence and local asset bytes; it does not certify the current hosted asset bytes. Neither CLI mode needs provider credentials in the repository.

Private supporting Worker code, bindings, secret names, branch targets and both environments still require separate official-platform readback and native checks. The endpoint does not certify private Workers, bindings or external provider behavior. Cloudflare build configuration changes are recorded by the releasing maintainer only after actual API readback; they do not establish that the next application version is already live.

### Regression evidence

The wrong-key request originally returned 503 after accessing the schema gate; the new test first reproduced that failure, then passed with 401 and zero D1 calls. Cookie/foreign-origin rejection, exact schema readiness, an added column, replaced trigger and absent applied migration are covered. The frontend verifier accepts matching evidence, then rejects changed JavaScript bytes. Full verification and native compilation results are recorded by the maintainer with the final release evidence.

Local validation: `npm run verify` passed with 112 discovered files, 1,298 tests, zero failures/skips (96.70 seconds for tests), including explicit Pages Functions typechecking and ESLint. `test:native:edge` passed using the existing local runtime: actual compiled Pages/private-service rate limits and missing-binding fail-closed checks, with no external traffic. `test:native:mail` also passed: actual compiled Pages, coordinator and native D1 with attachment bytes, durable audit, race rollback and reconciliation; all network calls were stubbed. The isolated metadata fixture revision then passed focused tests, typechecking and lint. These checks do not establish live deployment readiness.
