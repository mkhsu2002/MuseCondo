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
