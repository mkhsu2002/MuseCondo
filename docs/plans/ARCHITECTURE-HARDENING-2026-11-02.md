# Architecture hardening implementation plan

Status: active implementation, 2026-11-02. This plan does not certify deployed behavior.

Goal: complete the ten architecture-review recommendations while preserving resident identity, URLs, consent, immutable receipts, and audit history.

Architecture: retain the modular Pages application and private supporting Workers. Improve release verification first, then storage and domain boundaries. No paid model work, resident publication, real mail, or destructive historical cleanup is required for this work.

Baseline: main `289d7458d5c3ed80bc413b3c6751d5ce7094c0ef`, preserved remotely as branch `backup/pre-competition-2026-11-02` and annotated tag `pre-competition-2026-11-02` (pre-competition submission version). The maintainer explicitly requested implementation on main and authorized commit, push and deployment after verification.

## Execution checklist

- [x] Preserve and verify the pre-competition branch and annotated tag; return to main.
- [x] 1. Establish a reproducible verification baseline: select a supported Node runtime that provides the required SQLite APIs, pin it, discover all Node tests and tooling tests, fix the seven observed failures at their source, add focused code-change CI gating and explicit Functions typechecking. Commands: `npm run verify`, targeted failing tests, then full discovery.
- [x] 2. **Implementation only; live readback pending.** Correct social metadata ordering and verify emitted public route HTML, preserving private-route metadata boundaries. Run build-output/social-preview tests and inspect the built routes.
- [x] 3. **Implementation only; private Worker/platform and two-environment live verification pending.** Introduce a release manifest and environment verifier covering source commit, frontend and renderer hashes, migration checksums, normalized schema definitions, private Worker code/bindings, and both deployed environments. Do not publish internal deployment metadata in visitor UI. Audit existing Cloudflare credentials via secure storage and preserve configured resource scopes.
- [x] 4. **Implementation and both-environment migration 0037 complete; compatible application deployment/readback pending.** Add immutable digest-addressed Tower asset storage and revision references. Keep legacy asset paths readable; text-only edits must create references without copying bytes. Preserve authorization, current public revision checks, dream revocation, atomic batch writes, receipts and audits. Apply additive migration to dev and production before deploying compatible code; no deletion of resident history.
- [x] 5. **Implementation only; deployment and two-environment live readback pending.** Replace unrelated per-request schema gating with explicit route capability checks while retaining complete release/readiness schema validation and fail-closed writes. Test missing unrelated schema, missing required guards, and database failures.
- [ ] 6. Split core intake/auth/source/asset/content/publication responsibilities into readable modules without breaking transaction boundaries. Format maintained source independently where useful. Verify request replay, stale revision, cross-household, preview, publish and withdrawal behavior.
- [ ] 7. Extract bounded seasonal policy and historical recovery handlers from the autonomy core, retaining exact authority/expiry/unknown-result protections and never redispatching historical paid work. Run autonomy/theme/provider regression tests and native checks.
- [ ] 8. Separate production/demo/standalone build targets and renderer-only embedded assets. Preserve existing public routes and demo content. Add meaningful synthetic Tower runtime browser coverage using the required dedicated browser lane; do not use generic Chrome/Playwright fallback.
- [ ] 9. Maintain one current release/acceptance index; point maintained READMEs and deployment docs to it. Date and archive superseded claims without rewriting immutable evidence. Recheck links, route inventories, migration counts and stale status assertions.
- [ ] 10. Review specification compliance, then code quality; resolve findings. Run complete verification, native runtime checks, copy/public-output review, and two-environment deployment/schema/code/live-readback checks. Commit/push only intended changes and record exact release evidence privately where required.

## Verification and release rules

Use red/green tests for changed domain behavior. Tests use synthetic isolated data and provider mocks. Use official Cloudflare APIs before browser operations; secrets are injected temporarily from secure storage and never printed or committed. Existing deployed code, namespace IDs, bindings, and schedules are read before modification. Development is verified before production. Documentation-only changes do not run production builds/deploys; application changes require necessary quality checks. Runtime capability checks do not replace full schema validation at release.

For each completed step, record commit, commands, actual outcomes and material limitations in `docs/architecture/HARDENING-STATUS.md`; private platform evidence belongs in Condo4AIAgents operations records. Do not claim completion until all required checks are satisfied.

Release follow-up (2026-11-03): protected Tower Lord assets now use authenticated ASSETS-bound integrity readback; the online CLI anonymously downloads public assets only. Local implementation is complete, with Access preserved. Deployment and two-environment live readback remain pending; see the hardening status correction note.
