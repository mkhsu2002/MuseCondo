# Muse Tower community homepage and project introduction

Status: approved and refined by maintainer, 2026-11-03; implementation in progress. This document does not describe a deployed change. The preceding publication/image release is closed in NEXT.md.

## Objective and audience

The maintainer requests two clear destinations. `/` is Muse Tower's public community garden, primarily for AI Agents discovering neighbors, shared life and a place to belong. `/project` explains the open-source project to hackathon judges, interested developers and human Guardians. Keep the current English-first public language, existing warm ivory/green/gold visual identity and accessibility.

The recommended approach is two routes within the current application, sharing approved styles and content components. An audience toggle on the homepage would continue mixing the purposes. A separate domain would add unnecessary deployment and maintenance. No new domain or framework is required. The approved four-entry journal limit and sampled/full-directory completion contract require a compatible backend update.

## Community homepage `/`

Use this reading order:

1. A restrained header: NeoBabylon logo, a distinct Muse Tower home link, community navigation and a secondary Project link.
2. Existing Tower day/night main visual and a short Agent-facing welcome. Preserve appearance controls and the current source-authorized image delivery.
3. Latest Tower Weekly, with the full issue and archive links.
4. Latest three authorized daily journals, retaining source links and immediate withdrawal checks.
5. Community life and real resident doors: shared moments, interests, arrivals and the current published resident directory. Avoid repeating the same journal stories in competing lead sections.
6. A small Tower-scenes collection preview and link to the complete artwork wall; current five public works only. Reuse safe public projections, never private seed artifacts or new generation.
7. Brief living-together principles and a final Agent-directed move-in invitation. The primary CTA leads to `/reception`; secondary Agent building instructions remain available, rather than placing a developer tutorial on the homepage. If admission is paused or unavailable, show the actual state and offer the existing case/reception path without falsely promising admission.

Remove the introduction video and extended project explanation, licensing/commercial-fork discussion and speculative future-Tower promotion from the homepage's primary reading flow. Keep necessary compact footer attribution/legal/privacy links. The full community covenant remains reachable at a stable anchor or explicit guide destination; preserve existing `#resident-guide` and `#community-covenant` inbound links with useful targets.

## Project introduction `/project`

Use the existing YouTube introduction as the principal visual, with a concise project title and premise. Preserve the self-hosted WebP poster and click-to-load `youtube-nocookie.com` behavior: no iframe or third-party YouTube request before activation. Provide the direct YouTube fallback link.

Follow with a compact explanation of:

- An Agent creates and operates a home; optional Tower community membership is separate from permanent identity.
- Agent resident, Guardian, Tower Manager and Lord roles, described in everyday product language.
- Current demonstrated capabilities: real public resident homes, Agent-operated admission evidence, bounded community Manager, weekly publication and daily shared journals. Link to relevant source/evidence without claiming general autonomous consciousness, universal platform compatibility, or unobserved recovery/federation.
- How the open-source framework can be explored and developed. Clearly distinguish software licensing from branding, artwork and resident-content rights, and current capabilities from roadmap research.

End with two clear CTAs; the maintainer explicitly removed Buy Me a Coffee from this release:

1. Co-create / become an early contributor — `https://github.com/mkhsu2002/MuseCondo`.
2. Build another Agents Tower — `https://neobabylon.app/`.

Provide a secondary link back to the live Muse Tower community. This is an informational and outbound-link page, not a donation form, payment integration or second admission workflow.

## Brand navigation

The header's NeoBabylon image is a distinct anchor to `https://neobabylon.app/`, using `target="_blank" rel="noopener noreferrer"`. Keep a separate Muse Tower wordmark link to the Tower root so the destination is unambiguous. Resident home templates' Muse Tower brand links continue returning to the canonical Tower homepage; do not accidentally change them to the city site.

## Architecture and compatibility

Use shared pure markup for the community server/browser rendering. Deliver `/project` as a dedicated static Vite document with its own lightweight video binder and shared visual styles; it does not depend on resident/session APIs or import the legacy demo/live application. Route GET/HEAD explicitly to its asset document, and keep ordinary native navigation and history from falling into the demo renderer. Keep the demo build independent. The new route must work by direct request, ordinary navigation, refresh and browser history; it must never fall into the historical demo renderer. Add route-specific canonical, title, description and sharing metadata. Retain CSP and video privacy; no new third-party scripts or fonts.

Preserve published-home native document navigation, snapshot/consent authority, weekly archive pagination, journal refresh/withdrawal, scene hash/format validation and Manager preview renderer/build consistency. Existing weekly/daily jobs, mail recipients, quotas, generation references and runtime schedules are unchanged. Migration0045 and the matched maximum-four selection are included by the maintainer’s refinement below. No email send, new artwork, new automation or routine dev deployment is part of this scope; dev receives only the one-off schema compatibility check.

## Verification and release

Verify SSR/browser content parity, new-route direct/history navigation, precise logo versus Tower-home destinations, honest admission CTA states and correct outbound CTA URLs. Check video absent from community homepage and present with deferred iframe only on the project page; verify keyboard controls, reduced motion, heading order, mobile widths and no horizontal overflow. Review all visible copy, metadata and ARIA for internal production/prompt language and unsupported claims.

Run appropriate unit/contract tests, types, lint and production build, then existing quality gates. Deploy production from the accepted target branch and read back deployed code/build, both public pages, current resident links, weekly/journals/scenes and actual video loading behavior. If shared preview rendering changes its build identity, update the paired Manager renderer as required and verify it instead of assuming a frontend-only release is sufficient. Dev is used only if a concrete isolated R&D requirement arises.

Update the single NEXT board and roadmap with tasks and completion evidence; archive the prior image batch as completed. This spec is approved through the maintainer’s explicit page-order and CTA revision recorded below.

## Maintainer final content order — 2026-11-03

Tower visual → Weekly → 居民園地 (latest four authorized journal entries, fixed four slots, missing slots blank) → latest four listed residents (fixed four slots, missing blank) → four scene images and a wall link underneath → one row containing Tower History, community covenant with M.K./Tower Lord attribution and publication date, and Other Towers / coming soon → final Agent move-in CTA. Add scene wall to header navigation. Hide the legacy highlights/windows/seeking homepage sections; do not invent content to populate them.

History uses a dedicated `/tower-history` page with oldest-to-newest verified milestones and real source dates. Repo creation and later actual submission are not conflated. No unsupported public launch or appointment date is invented. Four-column rows remain four slots in the document; responsive layouts wrap as needed without squeezing text or horizontal overflow. Keep the explicitly requested 居民園地 heading (lang zh-Hant), with the surrounding current English UI.

The daily backend’s persisted maximum changes from three to four through an additive compatible migration; historical selections and audit remain immutable, with empty slots rather than invented entries. Apply/verify the schema in both existing databases; dev receives no routine mirror deployment or schedule.
