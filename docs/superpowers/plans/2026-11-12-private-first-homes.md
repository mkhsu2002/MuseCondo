# Private-first homes implementation plan

> For agentic workers: execute the approved design using subagent-driven-development with focused implementation and separate spec/quality review. User authorized continuous execution through merge, dev/production deployment and hosted acceptance.

**Goal:** Deliver private Tower homes with exclusive maintenance and opt-in publication without an external-home admission prerequisite.

**Architecture:** Add an explicitly typed native home domain alongside existing imported homes. Reuse reception case continuity and safe cryptographic primitives; keep native content, authority, receipts and audit separate so legacy admission guards remain strict. Cheap provisioning and mutations persist their complete state atomically within the request; no polling or paid-model dependency.

**Tech stack:** Existing TypeScript Pages Functions, D1 migrations/native workerd, static reception guides and CI/release contracts.

## Tasks

- [ ] Implement additive migration, native domain contract/store/routes/rendering and reception integration. Files: `migrations/0049_private_first_homes.sql`, `server/live/private-home-*.ts`, `server/live/reception.ts`, `server/live/worker.ts`, `server/live/schema-capabilities.ts`. Write failing tests in `tests/private-homes.test.ts`, then run with pinned Node 24.22.1. Tests must inspect actual SQL receipts/audit and legacy preservation, not mirror implementation.
- [ ] Integrate public directories, private browser preview access, asset authorization and operator lifecycle visibility. Own/public routes must use the same snapshot/consent boundaries. Add focused worker/directory tests and native Pages+D1 smoke. No arbitrary remote execution or public capability key is allowed.
- [ ] Update `public/reception-start.md`, `reception-onboarding.json`, `agent-onboarding.json`, `openapi-agent.json`, `reception.html/js`, README translations and current admission/completion docs. Preserve historical documents with dated status notes. Update former preflight-before-case tests to assert safe persisted continuation. Review every visible string/ARIA/SEO field for user relevance.
- [ ] Independent spec review followed by quality/security review; fix findings and rerun affected checks. Run `npm run verify` plus the existing native suites and new isolated native flow. Commit/push branch, merge only passing reviewed changes into main.
- [ ] Capture dev/production settings/schema/resident baseline securely. Apply only pending migration with exact schema and FK checks; deploy the same merged build with existing bindings to dev first, then production. Verify operator release contracts and every compiled asset. Perform a synthetic dev create/edit/upload/private-preview/publish/draft-edit/withdraw/revoke flow; verify production read-only privacy and existing Fang/Eve pages. Persist sanitized release evidence, actual deployment IDs/dates and baseline; docs-only follow-up must not redeploy.

Run commands from the repository root with `/Users/mkhsu/.npm/_npx/ef8b185be06dfeb4/node_modules/node/bin` first on PATH. Existing Wrangler 4.156.0 native runtime is at `/Users/mkhsu/.npm/_npx/2fea031b5bd76b2e/node_modules`. Provider/platform credentials come from Keychain through the existing private ops helper and are injected only into process environment. Do not copy values into this plan, source or command arguments.
