# Change-scoped Quality and release builds

Implementation 2026-11-03. `scripts/change-scope.mjs` is the single policy used by GitHub Quality and Cloudflare `build:release`. No new recurring workflow, service or provider secret is introduced.

| Scope | Checks | Publication |
| --- | --- | --- |
| docs | No dependencies, tests or build in CI; watch paths exclude automatic deployment | No deployment success is granted for a skipped/docs job |
| presentation | Generated-renderer consistency, actual Tower build/static guards, 15 focused frontend test files, two test workers | Existing exact-source Quality and matching-renderer release gates remain required |
| full | Existing types including Functions, lint, build, all tests; every existing native Edge/mail/assets/publications/journals/images CI check | Required deployed schema, Functions/private services and live behavior still must match |

Full is the default for unknown files, missing/shallow/unverifiable history, deletes/renames, dependency/configuration/workflow changes, backend/Workers/migrations, permission/routing/data-contract modules and public Agent protocol documents. Changing the classifier itself is always full.

Presentation is an explicit allowlist of the public community/project/history CSS and HTML, plain display values inside the fixed English catalogue, and visible text in known pure public HTML templates. Structural TypeScript comparison preserves all executable expressions, guards, property keys and imports. Public-template link/attribute/structure changes are full; ordinary static-page layout can move containers while scripts, forms, IDs/data bindings, navigation targets and security metadata remain unchanged. Static display assets are limited to media/OG raster files; generation references and protected/private assets are not broadly allowlisted. Changed CSS dependencies, CSP, scripts or handlers force full. The renderer’s generated source alone never qualifies as presentation.

## Authoritative comparison

Quality uses event-provided PR base/head or push before/after, never commit messages, branch names, labels or caller-supplied path lists. The no-dependency `--docs-only` phase can reject a true docs event early. Executable events expand comparison to the previously verified production source in `docs/releases/production-baseline.json`, read from the **base commit**, not a PR head’s modified receipt.

The receipt is an operator-maintained live-acceptance record, not a cryptographic attestation: update it only after actual production source/deployment/schema/renderer checks. It contains no credentials. Its source must exist and be an ancestor of the authoritative event commits; otherwise full. A stale receipt makes the gate stricter, not weaker. Thus an unshipped backend change cannot be hidden behind a later copy commit.

Cloudflare always enables deployment-mode comparison, including when the last event changed only documentation. If somebody explicitly requests a build of docs following an unshipped backend, the entire outstanding backend span still gets full verification. If a genuine docs build is explicitly started, it must produce a complete dist: exit0 with an empty directory is **not** a safe Pages skip. Automated docs builds are prevented by path filters. A bounded history fetch may recover missing objects; uncertainty remains full.

## Entrypoints and resource limits

- `npm run verify:change -- --base <event-base> --head <head>`: shared classifier and selected checks.
- `npm run build:release`: Cloudflare build command, using the same policy plus deployment-baseline comparison.
- `npm run verify`: retained full local verifier; Quality’s full branch also runs all existing native steps.
- `scripts/run-tests.mjs`: default concurrency2; `MUSE_TEST_CONCURRENCY` explicitly accepts1–8. Parallel agents should run focused owned tests; one coordinator owns a full verification run.

For public renderer source/CSS edits, run the existing build/generator locally and commit its generated renderer identity. The light gate checks this identity rather than silently publishing uncommitted generated source. Existing Pages/private-Manager synchronization still applies whenever that identity changes; CI scope does not waive deployment consistency. The existing release uploader accepts only a successful, actually executed presentation or full check on the exact main SHA; docs/skipped/ambiguous results do not authorize upload.

## Evidence and validation

Scope tests cover copy versus executable changes in the same module, protected files, metadata/handlers, dependency edits, renames, generated-only changes, authoritative Git history and a forged head receipt. They also replay the actual c945→87fd headline/eyebrow edit as presentation. Runner tests prove presentation invokes only the build plus selected frontend files, while full retains the original verifier and a failure stops the process. An independent review reproduced and closed the docs-after-unshipped-backend deployment case.

This pipeline change itself takes the full route once. Record the real CI/Cloudflare configuration readback and accepted source in the same delivery; subsequent receipt/docs updates do not trigger a full build or production deployment.
