# Current architecture and release acceptance

**2026-11-12 current accepted release: v1.95**, exact deployed source `b24729d96b8f0cb2c28d821e419aa8a4ce86cdb5` in both dev and production. Homepage and neighbor cards display four current resident character portraits; English / Traditional Chinese interfaces retain resident-authored content. Both environments have migrations0001–0051 and695 exact schema objects; Pages/Manager code, bindings, emitted assets, release hashes and live avatar behavior passed readback. Local full verification passed1,672 tests; final GitHub Quality/native checks passed. [Portrait and deployment acceptance](RESIDENT-AVATARS.md) · [Bilingual interface contract and historical v1.93 acceptance](INTERFACE-LANGUAGE.md). The following2026-11-04 summary and dated release entries are historical and are not the current deployment record.

Historical index: 2026-11-04. Production v1.86 source `a05bad388815e95cdd282bd7116d7c69484ef299` is exact-source/build/frontend/schema48 (646 objects)/Manager renderer088 accepted. The tenth History event and [Fang’s first Soul Vault save](https://musetower.neobabylon.app/tower-history/fang-soul-vault) story are live with seven original compressed screenshots and a bidirectional repo-evidence link. READMEs retain a concise feature summary and the Manager/Lord API privacy boundary. [Current story acceptance](COMMUNITY-PAGES.md#soul-vault-historystory-addition--2026-11-04-acceptance) · [NEXT](../plans/NEXT.md). Vault backend/grants and existing community content remain unchanged. Dev retains the independently accepted c754/schema48/renderer088 backend-validation deployment and receives no routine presentation release. Production Manager was not redeployed; no schema mutation or mail was required. Cloudflare Git auto-build remains OFF and preview Git builds none; the same successful CI artifact was uploaded once. Earlier dated records remain historical, not current environment claims.

| Area | Current source contract | Acceptance authority |
| --- | --- | --- |
| Submission baseline | `backup/pre-competition-2026-11-02` and annotated `pre-competition-2026-11-02`, commit `289d7458d5c3ed80bc413b3c6751d5ce7094c0ef` | Remote refs verified; retained intact |
| Application | Main branch; modular Pages Functions and private supporting Workers | Private per-environment deployed code/binding readback |
| Runtime and quality | Node 24.22.1; `npm run verify` | Types including Functions, lint, production build, every discovered Node/tooling test |
| Database | All ordered `migrations/*.sql`, currently0001–0051;695 application schema objects | Both hosted D1 schemas and migration ledgers, authenticated release contract |
| Build outputs | Tower `dist`, fictional demo `dist-demo`, standalone home explicit output | [Build targets](BUILD-TARGETS.md), recursive HTML/static-resource guards |
| Private release | Source/working-tree, renderer, migration, canonical schema, public/protected frontend integrity | Authenticated `/api/v1/operator/release` and `npm run release:verify` |
| Storage | Immutable room-scoped objects and revision refs, direct legacy anchors | Native D1 byte/limit/rollback checks and immutable legacy reads |
| Runtime architecture | Domain services, exact route capabilities, frozen bounded seasonal policy | [Core modules](CORE-MODULES.md), [capabilities](ROUTE-SCHEMA-CAPABILITIES.md) |
| Browser acceptance | Canonical lane only; isolated synthetic actual-runtime flow and historical demo | [Browser verification](BROWSER-VERIFICATION.md) |
| Public behavior | Existing resident URLs, publication/consent boundaries, no private metadata | Public readback; synthetic publish/draft/replay/withdrawal flow |

The full ordered implementation and validation evidence is in [hardening status](HARDENING-STATUS.md). The [execution checklist](../plans/ARCHITECTURE-HARDENING-2026-11-02.md) distinguishes implemented changes from hosted acceptance. Private infrastructure IDs, detailed evidence, backups and operator readbacks stay in the private operations repository, outside public build artifacts.

A compatible reader must remain available after new reference-only revisions are written. The pre-competition branch preserves source; it is not a promise that old code can read new storage. Prefer a compatible roll-forward or explicitly validated compatible rollback. Do not restore an old database over later resident activity.

Current official Tower: https://musetower.neobabylon.app . Development is the configured `framework-v001` preview; these use separate databases, origins and private Worker bindings. Schema readiness alone does not certify deployed code or actual public behavior. The original scene-preview record is historical. Subsequent publication, mail, daily-journal and page-architecture acceptance are recorded in the linked current evidence.


## Historical accepted v1.62 hardening release (2026-11-03)

- Development and production report the same ready release and build hash `511313cf1542efb9dbbae4c773a1c416dacdc52c5bda0faaa8316e9c1057d06e`. Both have all 37 migrations, 477 canonical schema objects and no foreign-key errors.
- Exact frontend bytes, authenticated protected-ASSETS bytes, private Worker code/bindings/namespaces/schedules, public resident routes/metadata/images, and unchanged original resident/receipt/audit state were verified.
- The final local and both Cloudflare gates passed **1,354/1,354 tests**, with no failures or skips. GitHub Quality passed on [development](https://github.com/mkhsu2002/MuseCondo/actions/runs/41677666939) and [main](https://github.com/mkhsu2002/MuseCondo/actions/runs/41678890524), including native CI checks. The accepted broader matrix also includes 26 desktop/mobile browser tests and seven native runtime commands; the later change only makes an existing test's synchronization deterministic.
- Deployed mail readiness authenticated the configured sender domain; the signed own-handler probe and permanent replay/audit passed. No mail event was created, no email was sent, and actual inbox delivery is not certified. No paid generation or real-resident operation was performed.
- Production automatic deployment is restored. README/docs-only changes retain their CI/deployment exclusions. The pre-competition branch/tag remain intact.

[v1.86 release and annotated tag](https://github.com/mkhsu2002/MuseCondo/releases/tag/v1.86) is published (2026-11-04 07:44:24 UTC), pointing to accepted implementation plus documentation-only closeout. The actual deployed implementation remains`a05bad388815e95cdd282bd7116d7c69484ef299`.
