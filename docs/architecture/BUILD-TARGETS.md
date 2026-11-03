# Build targets and local migration safety

Implementation: 2026-11-03. This document describes source/build behavior; it does not certify a hosted release. Browser acceptance is separately recorded in [browser verification](BROWSER-VERIFICATION.md). Current release evidence and outstanding work belong in [hardening status](HARDENING-STATUS.md).

## Three outputs

| Command | Entry | Output | Purpose |
| --- | --- | --- | --- |
| `npm run build` / `npm run build:tower` | `index.html` → `src/main.ts` | `dist/` | Official Tower, live routes, and preserved historical routes/assets |
| `npm run build:demo` | `demo/index.html` → `src/demo-entry.ts` | `dist-demo/` | Historical fictional community; live branch disabled at build time |
| `npm run condo:build -- --input <input.json> --out <directory>` | Standalone condo renderer | Explicit requested directory | Independent home; existing CLI contract unchanged |

`npm run preview:demo` serves the isolated demo output on `127.0.0.1:4173`. Building the demo does not clear or overwrite `dist`. Both Vite targets support `MUSE_BASE_PATH`; production uses `/`. Demo community files and interactions remain local/static and do not call a live Tower API. Day/night controls use original static artwork. No image generation, image conversion, model dispatch, mail, or resident publication is part of either build.

The Tower entry imports route policy, founder-link enhancement, common base styles, and render-blocking live/Tower styles. The server-rendered header and hero remain fully styled while the live JavaScript import is delayed. It dynamically imports `live.ts` for the lobby and valid live routes, or `demo.ts` for historical/unknown routes. Artwork manifests, ten fictional residents, browser-only interactions, historical community loading, and demo layout CSS remain behind the demo import. Historical IDs and their `/inside` and `/dreams` URLs, `about`, `入住`, and `選輯紀錄` remain available in the production output. Existing PNG compatibility paths retain their original bytes; the Main Tower continues using its existing WebP images.

Navigation invalidates older asynchronous work before awaiting a new import. A superseded import cannot render or move focus. Demo event listeners use an abortable mount; leaving the demo also disposes its appearance binding. Live rendering retains its own request epoch. Ordinary same-page fragment links retain the lobby shell and player; live feed updates replace only the feed, preserving server-rendered doors, landscape, and video nodes.

## Renderer-only embedded assets

`src/shared/lobby-markup.ts` contains shared markup without embedded logo/poster imports. `src/shared/lobby-preview.ts` owns masked preview fixtures and imports the generated embedded CSS/brand module only for the private renderer and tests. The private renderer continues using identical preview DOM, style bytes, masked records, and brand/poster bytes. `generate-lobby-css.mjs` includes the new renderer module in its source digest. A changed local digest is build evidence; it does not authorize theme activation or an audit/model call.

## Deployment guards

`check-build.mjs` retains the compiled entry and standalone identity/privacy checks and parses **every HTML document** with parse5. All local script and stylesheet references must resolve to regular files inside the output. Raw TypeScript, encoded traversal, escaping paths, symbolic links, and missing private-console assets fail the build. External URLs are never fetched by this verification.

`routes.mjs` emits Cloudflare Pages version-1 `_routes.json`, with `include: ["/*"]` and exclusions limited to `/assets/*`, `/prototype-assets/*`, `/tower/*`, `/media/*`, `/og/*`, `/examples/*`, and exact `/condo-template.css`. According to [Cloudflare's routing contract](https://developers.cloudflare.com/pages/functions/routing/#functions-invocation-routes), exclusions take priority and `*` spans path segments. `/api/*`, `/home/*`, `/tower-lord*`, private identity routes, and protected API assets continue invoking Functions. Do not add extension-wide or broad console/identity exclusions.

## Local SQLite migration ledger

`dev:live` discovers ordered migration files rather than checking a hand-maintained list of sentinel tables. `local-migrations.ts` hashes their exact bytes and replays known prefixes into an in-memory database. Fresh databases apply all 37 current migrations. A database without `local_migrations` is adopted only when its entire application schema exactly matches one unique known prefix. Unknown, ambiguous, modified, or hash-mismatched databases fail closed. Existing data is never reset or dropped.

Adoption, remaining migrations, ledger writes, final schema verification, and `PRAGMA foreign_key_check` run in one local immediate transaction. Failures roll back the whole operation. Existing `data/local-mvp.sqlite` is not touched by tests: they use only `:memory:`. A local migration result is not evidence that either hosted D1 environment has been updated. Local development has no mail or paid provider dispatch.

## PDF verification tools

`npm run verify` runs `scripts/verify.mjs`: Node validation, real `pdftotext`/`pdffonts`/`pdftoppm` preflight, then the existing typecheck, lint, build and complete Node-test gates. The identity-card suite retains full Poppler text/font/raster inspection and independent jsQR decoding of the real PDF. Missing tools block verification early; no test is skipped or replaced.

Install Poppler through normal operating-system package management for local development. The preflight never installs on macOS or unidentified local Linux. An identified Linux ephemeral Cloudflare Pages build (`CF_PAGES=1`) or GitHub Actions build (`GITHUB_ACTIONS=true`, `CI=true`) may explicitly opt in with `MUSE_INSTALL_TEST_TOOLS=1`. Existing working tools receive only version probes.

When tools are absent, both CI services use the same **rootless** bootstrap. A private temporary directory holds APT lists, caches, downloads and the extracted prefix. System signed sources and trusted keys remain in use; unauthenticated/insecure repositories are explicitly disallowed. Update hooks are cleared in the private configuration, and binary package caches are disabled so package-manager state remains private. A C-locale simulation of `--reinstall --no-install-recommends install poppler-utils` supplies the exact solver-selected package versions. APT downloads those pinned packages using its native authenticity/hash checks, then `dpkg-deb -x` extracts them only into the private prefix. Package removals, malformed/unbounded plans, and libc/loader replacements fail closed. No sudo, root package installation, or host package-database update occurs.

After extraction, all three actual tools must pass again. The orchestrator propagates the prefix's `PATH` and library directories in `LD_LIBRARY_PATH` to **every** verification child, and removes temporary state in `finally`, including on failure. Calling the standalone preflight checks that toolchain but cleans it before exiting; the orchestrator is required to retain the environment throughout verification.

The quality workflow opts in while retaining its path filters and concurrency. Relevant pushes trigger Quality only on `main`; pull-request gates remain enabled, and `framework-v001` pushes no longer duplicate the full run. Routine delivery targets production from `main`; dev is an on-demand isolated R&D environment, without automatic mirroring. Configure the test-tool flag only in an environment intentionally used for that build. When dev is needed, verify its deployed schema, code and actual synthetic behavior before relying on it; see the [environment policy](../PAGES-RUNTIME.md#環境與發布政策2026-11-03-更新). The earlier development build lacked Poppler; candidate v1.60 build `14a6c8a0` then rejected the initial privileged bootstrap with `sudo: a password is required`. That privileged path is superseded. Actual rootless development and production Cloudflare builds, plus both final GitHub quality gates, passed on 2026-11-03 for the accepted v1.62 source; all 1,354 tests, including real Poppler PDF checks, passed. See the current release index for exact-source evidence. Local injected-runner success alone does not establish hosted acceptance.

Primary contracts: [APT simulation/download behavior](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html), [APT private directories/configuration](https://manpages.ubuntu.com/manpages/noble/man5/apt.conf.5.html), and [dpkg-deb extraction](https://manpages.ubuntu.com/manpages/noble/man1/dpkg-deb.1.html).

## Configuration updates and release readback

Cloudflare project GET responses redact encrypted variable values. PATCH only the fields being changed; never echo opaque/null `secret_text` entries back from a GET. Restore an intended value only from its authorized secure source, using an incremental encrypted-variable update. Actual deployment readback is required after changing configuration.

The authenticated release response also requires `runtimeBindingsReady`: configured contact/trigger secrets for their bound services, mail contact/key/from values when mail is enabled, and a provider key when legacy paid calls are enabled. This is nonempty configured presence, not provider authentication or delivery verification. Disabled optional features remain valid. The verifier rejects missing, false or non-boolean flags, including older readbacks. No secret names or values appear in this response or visitor UI.
