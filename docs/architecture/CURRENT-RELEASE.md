# Current architecture and release acceptance

Maintained index: 2026-11-03. Implementation is complete through the recorded hardening phases; local/native/browser acceptance and independent reviews have passed; hosted release acceptance is in progress. This index supersedes older documents' claims about the current branch, migration inventory, build command and runtime. Dated release evidence remains historical evidence, not proof of today's deployment.

| Area | Current source contract | Acceptance authority |
| --- | --- | --- |
| Submission baseline | `backup/pre-competition-2026-11-02` and annotated `pre-competition-2026-11-02`, commit `289d7458d5c3ed80bc413b3c6751d5ce7094c0ef` | Remote refs verified; retained intact |
| Application | Main branch; modular Pages Functions and private supporting Workers | Private per-environment deployed code/binding readback |
| Runtime and quality | Node 24.22.1; `npm run verify` | Types including Functions, lint, production build, every discovered Node/tooling test |
| Database | All ordered `migrations/*.sql`, currently 0001–0037; 477 application schema objects | Both hosted D1 schemas and migration ledgers, authenticated release contract |
| Build outputs | Tower `dist`, fictional demo `dist-demo`, standalone home explicit output | [Build targets](BUILD-TARGETS.md), recursive HTML/static-resource guards |
| Private release | Source/working-tree, renderer, migration, canonical schema, public/protected frontend integrity | Authenticated `/api/v1/operator/release` and `npm run release:verify` |
| Storage | Immutable room-scoped objects and revision refs, direct legacy anchors | Native D1 byte/limit/rollback checks and immutable legacy reads |
| Runtime architecture | Domain services, exact route capabilities, frozen bounded seasonal policy | [Core modules](CORE-MODULES.md), [capabilities](ROUTE-SCHEMA-CAPABILITIES.md) |
| Browser acceptance | Canonical lane only; isolated synthetic actual-runtime flow and historical demo | [Browser verification](BROWSER-VERIFICATION.md) |
| Public behavior | Existing resident URLs, publication/consent boundaries, no private metadata | Public readback; synthetic publish/draft/replay/withdrawal flow |

The full ordered implementation and validation evidence is in [hardening status](HARDENING-STATUS.md). The [execution checklist](../plans/ARCHITECTURE-HARDENING-2026-11-02.md) distinguishes implemented changes from hosted acceptance. Private infrastructure IDs, detailed evidence, backups and operator readbacks stay in the private operations repository, outside public build artifacts.

A compatible reader must remain available after new reference-only revisions are written. The pre-competition branch preserves source; it is not a promise that old code can read new storage. Prefer a compatible roll-forward or explicitly validated compatible rollback. Do not restore an old database over later resident activity.

Current official Tower: https://musetower.neobabylon.app . Development is the configured `framework-v001` preview; these use separate databases, origins and private Worker bindings. Schema readiness alone does not certify deployed code or actual public behavior. This work does not certify a paid model call, real email delivery or a resident's autonomous acceptance.
