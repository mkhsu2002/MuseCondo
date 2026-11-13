# Bilingual UI Implementation Plan

> **For agentic workers:** Use subagent-driven-development for presentation implementation and review; coordinate backend and release in this session.

**Goal:** English/Traditional Chinese UI throughout Tower and home interfaces, preserving resident-authored content and all existing authority boundaries.

**Architecture:** Shared exact UI catalogs and locale resolution. Server-rendered HTML and browser updates use the same catalog; explicit user choice takes precedence over volunteered home language, then browser language, then English. No prompts, machine guides, email templates, or resident writing are translated. Native home JSON stores an optional preferredLanguage with migration 0050 extending the immutable snapshot insert guard; existing snapshots remain readable.

**Tech Stack:** TypeScript, Vite, Pages Functions, parse5, D1 JSON snapshots.

## Tasks

- [x] Implement shared locale validation, bilingual UI catalogs, in-place language controls and HTML/browser integration. Preserve DOM nodes, form values, room route and hash. Mark resident-controlled content as untranslated; never translate scripts, machine JSON, credentials, input values or original content metadata.
- [x] Extend native first-home creation/edit with optional preferredLanguage / guardianLanguage; validate en/zh-TW aliases, retain legacy request replay hashes when absent, persist only normalized UI language, reuse existing revision/audit/consent behavior. Surface home language as a presentation hint, not Guardian information.
- [x] Translate initial HTML at the Pages runtime boundary with per-request locale, language headers and cache isolation; preserve private no-store, CSP and existing status handling. Ensure browser runtime is external and CSP-compatible; no provider calls or recurring tasks.
- [x] Regression tests: explicit selection precedence, browser fallback, malformed language, zh-TW HTML, resident text unchanged (including text identical to UI), private and published native homes, old snapshot compatibility, idempotent requests, forms and new dynamic UI updates.
- [x] Run typecheck/lint/full verify; inspect visible copy and both language catalogs. Review feature against approved scope and review code quality.
- [ ] Merge to main, push, build exact merged source, deploy same artifact to dev and production. Verify schema parity, live release/readback, compiled assets, functions/bindings, original resident state, language routes and content preservation; update README and release evidence with actual results.

## Approved scope

UI labels and controls only, including lobby, three home views, visits and public/private task pages. Owner language can be supplied voluntarily during the existing first creation request; no new separate question, no name/nationality inference. Manual selection always wins. Public links keep their current paths with optional lang query. No resident publication, email send, artwork generation or permission operation is needed for release.

Local verification: Node24.22.1 `npm run verify` passed typechecks, lint, production build and 1,666/1,666 tests, with zero failures/skips. Spec and code-quality reviews passed. Actual runtime DOM checks passed both SSR languages, reversible text, original resident/social content, unsent form values, same nodes, URL fragment and observer quiescence. Canonical Neo Babylon lane was started; the required Neo Babylon MCP namespace was unavailable, so no browser fallback or visual-browser acceptance was claimed.
