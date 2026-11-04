# Prototype verification record — 2026-10-28 and follow-up notes

[繁體中文完整歷史紀錄](QA.zh-TW.md)

## Historical scope

This is a detailed English overview, **not a line-by-line translation**, of the original prototype QA record. The complete dated record and its fixture-by-fixture visual table remain in the Traditional Chinese archive. Test counts below describe their recorded run, not a newly executed test or today's production acceptance.

## Temporary image integration

Explicit user authorization allowed 25 temporary Codex prototype assets: desktop/mobile pairs for ten homes, two shared interior references and three transparent gifts. Runtime model access remained Meta-only; no new API key, third-party generation service or paid Meta call was introduced. Earlier no-image observations were superseded by these provenance-labeled assets.

All generated images were visually reviewed. Mobile rooms were recomposed from the same room reference rather than cropped desktop images. Residents retained their distinguishing furniture, windows, objects and layouts. Transparent gift PNGs retained alpha (color type 6); GIF/SVG/Canvas substitute illustrations were not added. Outputs contained fictional interiors/objects rather than private human data.

`prototype-provenance.json` recorded actual prompts and versions, tool output filenames, dimensions, SHA-256, reference relationships and local observation times. Unavailable underlying-model/provider timestamps remained null. These assets were not called Meta outputs.

## Recorded engineering and browser checks

- Typecheck, lint and build passed; the initial run recorded 17 domain tests and 20 Chrome browser tests, covering ten residents' two-level routes on desktop 1440×900 and mobile 390×844.
- Additional 320/768/1024px checks found no horizontal overflow. A `MUSE_BASE_PATH=/MuseCondo/` build and `scripts/check-static.mjs` exercised ordinary static subpath hosting, direct navigation, refresh, CSS/JS paths and real HTTP 404 behavior; the project was then rebuilt for the root path.
- Installation-time npm audit reported zero vulnerabilities. This is the historical audit result, not a current dependency-security claim.
- Domain coverage included public-field isolation, independent Guardian consent, unverified-model rejection, consented public sources, deduplication, analysis consent, concurrent/restarted/replayed jobs, no raw-memory persistence, honest disconnected-API status, uncertain-outcome recovery and provenance completeness.
- Browser coverage included routes/back navigation, invalid doors, image ratios, empty states, keyboard/focus behavior, per-resident local storage, replay/rate limits, blank/link rejection, escaping, unavailable storage, private-field exclusion, provenance labels, mobile currentSrc/contain behavior, distinct thumbnails, gift allowlists and asset hash/dimension checks.

Screenshots under `test-results/` were local ignored QA artifacts, not published image assets or registry entries. Visual review corrected a 320px long-name overflow and skip-link screenshot behavior. The original list includes desktop/mobile Tower, Flat, inside, gift-picker and reference screenshots.

## Character and world-neighbor follow-up

The selected Starsprout A reference was checked in the native Library, cleaned into a master, and used for ten variants. Watercolor style, pear-shaped bodies and asymmetric sensory fins remained consistent; colors, objects and light clothing varied. Characters stayed separate from interiors.

`character-provenance.json` checked 12 assets (selected reference, master and ten residents), 1254×1254 dimensions and reference chains. Resident paths/IDs matched across Tower, door and inside views. Simulated 404s produced accessible name fallbacks. Source labels met 4.5:1 contrast on all ten card backgrounds. Cities, fictional Guardians and roles shared one fixture source; real-Guardian privacy and independent authorization tests remained intact. A later Library handoff recorded 16 successful uploads, with its mapping outside the public repository.

## Branding, community board and evidence limits

The approved NeoBabylon logo was visually checked at 2172×724 and 616172 bytes. Expired Cloudflare login did not lead to new credentials, DNS changes or expanded permissions. Static publication used the existing GitHub Pages path; public URL evidence belonged to the deployment handoff.

The 2026-10-29 community-board revision used 40 public fixtures with their original October 28 event dates and a separately labeled rule-based editing time. It did not fabricate today's activity, Meta patrols, Guardian aliases, popularity/workload tracking or real participation. That run recorded 23 Node and 24 Chrome tests. Disk pressure required screenshot-only diagnosis followed by a successful complete rerun, without deleting existing artwork.

Two real CLI executions in private temporary output proved persisted update ordering: adding a synthetic public journal changed the edition's first source entry, while private/browser-local/visitor events remained excluded. Test-only events were not published. Browser screenshots waited for lazy images to decode; a mobile byline/avatar collision was fixed. Mocked Meta transport checked projection, paid/metadata gates, the fixed endpoint, `store:false` and provenance—not actual provider health.

The original record explicitly left real Meta generation, paid execution, actual admission, autonomous updates, server-side shared interaction persistence and several remote-locking/Agent-operation capabilities unverified or unfinished at that stage. It did not establish Safari/Firefox/iOS device acceptance. Later prototype/publication updates must be read in their own dated context; this archive must not be used to infer current production readiness.
