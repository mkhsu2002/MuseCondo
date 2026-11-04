# Community homepage and project introduction implementation plan

> **For agentic workers:** Execute the approved design with parallel isolated file ownership. Keep NEXT.md as the single active delivery board; this file records implementation dependencies only.

**Goal:** Make Muse Tower a clear Agent community homepage and provide a separate accurate project introduction and verified history.

**Architecture:** Shared pure community markup across SSR/client; independent static Vite project/history documents with native navigation. Reuse authoritative public sources, existing deferred video binding and deployed Manager renderer.

**Tech Stack:** Existing TypeScript/Vite/Pages/Worker/D1, Node contract tests and isolated native SQLite fixtures.

- [x] Write failing community layout/blank-slot/link and navigation tests. Root owns lobby markup/messages/CSS, journal/directory markup, live loading, worker/static-page navigation, history document and docs.
- [x] Independent project agent creates static `/project` HTML/CSS/entry, Vite inputs and exact security headers; tests video privacy, CTA destinations and standalone document. No backend/session fetch on this page.
- [x] Independent persistence agent adds migration0045 to relax only daily count to4, updates selection/contract tests and proves data/index/FK/trigger preservation. Do not alter historical0042 or existing editions.
- [x] History auditor reports source-backed dates; root writes chronological static page with public source pointers and no unsupported timestamps.
- [x] Integrate row order, hide old editorial feed, retain consent/refresh/directory eligibility, preserve published-home routing and derive Manager renderer hash from all new source modules/CSS.
- [x] Run focused tests, types/lint, production/demo build and necessary native schema/HTTP checks; inspect actual responsive pages with dedicated NeoBabylon browser lane. Review visible/SEO/alt/ARIA copy.
- [x] Merge/commit/push accepted source, apply compatible migration to required existing databases, deploy production Pages and matching Manager renderer, verify deployed source/build/schema/bindings and live pages. Keep dev cron/optimization inactive; no routine dev build.
- [x] Mark IA1 tasks with actual evidence and update README/roadmap/status; do not claim next native daily/weekly observation has already occurred.

Historical pre-release checkpoint, 2026-11-03: 1536/1536 full tests, types/lint/Tower build, independent demo build and actual native D1/DO four-journal scenarios pass. Dedicated NeoBabylon browser checked community desktop/mobile, standalone project video privacy and History chronology; deployment and documentation were subsequently completed as recorded below.

Completed 2026-11-03 | production v1.77 source `87fd79de230afa6deda925b9118a0587cbf68d9e`, schema45/592 and matching Pages/Manager renderer verified; dev retains independently matched c945/schema45 for the one necessary contract smoke, OFF/no cron. Main Quality, 1536 base full tests, 29 copy-focused checks, native gates and actual production desktop/mobile/project/history/navigation readback pass. No new art, mail, codec or routine dev presentation release.
