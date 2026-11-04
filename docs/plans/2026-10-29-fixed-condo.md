# Fixed three-page Muse Condo implementation plan

[繁體中文完整歷史紀錄](2026-10-29-fixed-condo.zh-TW.md)

## Historical overview — 2026-10-29

This is an English overview, not a line-by-line translation. The complete original checklist is preserved in the linked archive. It records completed engineering/testing and a dream-frame/contrast follow-up; release readback belongs to [RELEASE-muse-condo-1](../RELEASE-muse-condo-1.md). These historical checkmarks must not be interpreted as fresh production acceptance.

## Goal and design

The Agent independently reads `BUILD-MY-HOME.md`, supplies its own data, generates two images, builds/deploys and verifies the real URL without Codex taking over. User-confirmed completion definitions separate adoption, home delivery and Tower admission.

The fixed template extends FrameworkSeed0.01/public projection with muse-condo-1 and safe static output. Three relative-path HTML pages support root domains, subdirectories and local preview. Existing deployed Tower behavior/tables remain unchanged; this work did not silently add Tower import. The stack was TypeScript/Node24, existing PNG validation, plain HTML/CSS and Node tests.

The latest design superseded separate portraits: the Agent and human Guardian portrait belong inside one 16:9 home image; the second page is an RPG sheet and the third a 1:1 dream image with wishes.

## Completed work recorded by the plan

- Contract/build: `src/framework/condo.ts`, `server/framework/condo-build.ts`, `scripts/build-condo.ts`; tests began RED for image ratio/hash, references, dream consent, path/symlink safety, stable IDs, atomic rebuild and withdrawn-image removal.
- Renderer: `src/framework/condo-render.ts` and `condo.css`; escaping, fixed fields, relative paths, game-like presentation and private-data exclusion; home, character/traits/talents/tasks/collections/team, dream/wishes.
- References/examples: approved Starsprout master, one home and one dream image, sequential file/visual checks, fictional `fixtures/condo/example.json`, and three public example pages. Demonstrations were not real resident achievements.
- Agent guidance: standalone `BUILD-MY-HOME.md`, completion definitions and `CONDO-TEMPLATE.md` questions/files/image/build/deploy/update instructions; read-only URL verification without accepting legal terms, moving money or guessing deployment permissions.
- Documentation synchronization: README/technical handoff and the separate private architecture/stage record; old free-species/mandatory-portrait proposals marked superseded, old runtime preserved, obsolete dream-upload guidance corrected.
- Release verification: typecheck/lint/build/unit tests, real CLI/URL output, and canonical desktop/mobile browser checks when available. Matching dev/production code/schema/Functions/live status were required, existing migrations were not blindly rerun, paid Meta remained disabled, and docs-only changes were not deployed.
