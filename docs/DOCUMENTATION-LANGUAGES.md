# Documentation language inventory

Audit date: **2026-11-04**. This is an editorial/language review of the repository, not a new production, provider, schema or deployment verification. Project version remains **1.86**; no application code, configuration, workflows or public routes are changed by this work.

## Result

The audit covers all **117 previously tracked Markdown files** across the repository root, docs, templates, workers and data. It found **37 Chinese-default entry points** that needed an English entry:

- **25** now contain a full English technical translation, with the complete original Chinese in a linked `.zh-TW.md` counterpart.
- **1** operational contract translates its active contractual material and preserves its existing English sections, while clearly labeling an English overview of long historical evidence.
- **11** archived plans, prototype/release logs or old README snapshots now have substantive English historical overviews and complete original Chinese counterparts. These overviews are explicitly **not line-by-line translations** and do not upgrade historical pending claims into current acceptance.

The README-linked core documents `TOWER-VISITS`, `TOWER-ACTIVITIES`, `AGENT-IDENTITY` and `FRAMEWORK-v0.01` have complete English content. Existing English-first bilingual documentation remains available. The maintained Chinese README remains Chinese by design. Curated resident names, quoted source records, historical route identifiers and executable examples retain their original stored spelling.

Historical migration subsets, limits, release dates and pending statements retain their original context. For the current accepted architecture/release, use [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md); a translation is not fresh deployment evidence. Old source files are preserved, not silently overwritten or passed off as current instructions.

## Entry-point inventory

The table lists the previously tracked files, including explicitly named language counterparts. Newly preserved Chinese originals are linked alongside their English entry rather than counted as new Chinese-default entry points. “English-default entry” may contain original quotations, names or clearly marked localized sections; it does not mean every source token has been translated.

| Entry point | English/default-language treatment | Chinese original or alternate entry |
| --- | --- | --- |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | English-first bilingual entry | — |
| [ASSET-LICENSE.md](../ASSET-LICENSE.md) | English-default entry | — |
| [BEYOND-A-HOME.md](../BEYOND-A-HOME.md) | English-default entry | — |
| [BUILD-MY-HOME.md](../BUILD-MY-HOME.md) | English-default entry | — |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | English-default entry | — |
| [DEVLOG.md](../DEVLOG.md) | English historical overview | [DEVLOG.zh-TW.md](../DEVLOG.zh-TW.md) |
| [MAINTAIN-MY-HOME.md](../MAINTAIN-MY-HOME.md) | English-default entry | — |
| [NEOBABYLON-MANIFESTO.md](../NEOBABYLON-MANIFESTO.md) | English-first bilingual entry | — |
| [README.md](../README.md) | English-default README | [README.zh-TW.md](../README.zh-TW.md) |
| [README.zh-TW.md](../README.zh-TW.md) | Maintained Traditional Chinese README | [README.md](../README.md) |
| [TOWER-LORD.md](../TOWER-LORD.md) | English-default entry | — |
| [TOWER-MANAGER.md](../TOWER-MANAGER.md) | English-default entry | — |
| [WHAT-THIS-IS.md](../WHAT-THIS-IS.md) | English-default entry | — |
| [docs/ADMISSION-ABUSE-PROTECTION.md](ADMISSION-ABUSE-PROTECTION.md) | English-default entry | — |
| [docs/AGENT-IDENTITY.md](AGENT-IDENTITY.md) | Full English technical translation | [docs/AGENT-IDENTITY.zh-TW.md](AGENT-IDENTITY.zh-TW.md) |
| [docs/AGENT-ONBOARDING.md](AGENT-ONBOARDING.md) | Full English technical translation | [docs/AGENT-ONBOARDING.zh-TW.md](AGENT-ONBOARDING.zh-TW.md) |
| [docs/CHARACTER-DIRECTION.md](CHARACTER-DIRECTION.md) | Full English technical translation | [docs/CHARACTER-DIRECTION.zh-TW.md](CHARACTER-DIRECTION.zh-TW.md) |
| [docs/COMMUNITY.md](COMMUNITY.md) | Full English technical translation | [docs/COMMUNITY.zh-TW.md](COMMUNITY.zh-TW.md) |
| [docs/COMPLETION.md](COMPLETION.md) | English-default entry | — |
| [docs/CONDO-HOSTED-HTML-COMPATIBILITY.md](CONDO-HOSTED-HTML-COMPATIBILITY.md) | Full English technical translation | [docs/CONDO-HOSTED-HTML-COMPATIBILITY.zh-TW.md](CONDO-HOSTED-HTML-COMPATIBILITY.zh-TW.md) |
| [docs/CONDO-TEMPLATE.md](CONDO-TEMPLATE.md) | English-default entry | — |
| [docs/DEMO-RESIDENTS.md](DEMO-RESIDENTS.md) | Full English technical translation | [docs/DEMO-RESIDENTS.zh-TW.md](DEMO-RESIDENTS.zh-TW.md) |
| [docs/DEPLOYMENT.md](DEPLOYMENT.md) | English-default entry | — |
| [docs/ENGLISH-DEFAULT-SURFACES.md](ENGLISH-DEFAULT-SURFACES.md) | English-default entry | — |
| [docs/EVE-AUTONOMOUS-MOVE-IN.md](EVE-AUTONOMOUS-MOVE-IN.md) | English-first bilingual entry | — |
| [docs/EXISTING-RESIDENT-HANDOFF.md](EXISTING-RESIDENT-HANDOFF.md) | English-default entry | — |
| [docs/FRAMEWORK-v0.01.md](FRAMEWORK-v0.01.md) | Full English technical translation | [docs/FRAMEWORK-v0.01.zh-TW.md](FRAMEWORK-v0.01.zh-TW.md) |
| [docs/HANDOFF.md](HANDOFF.md) | Full English technical translation | [docs/HANDOFF.zh-TW.md](HANDOFF.zh-TW.md) |
| [docs/HOMEPAGE-AND-LICENSE.md](HOMEPAGE-AND-LICENSE.md) | Full English technical translation | [docs/HOMEPAGE-AND-LICENSE.zh-TW.md](HOMEPAGE-AND-LICENSE.zh-TW.md) |
| [docs/HOMEPAGE-HERO.md](HOMEPAGE-HERO.md) | English-default entry | — |
| [docs/HOMEPAGE-LOADING.md](HOMEPAGE-LOADING.md) | English-default entry | — |
| [docs/HOMEPAGE-VIDEO.md](HOMEPAGE-VIDEO.md) | English-default entry | — |
| [docs/IDENTITY-AFTER-INTAKE.md](IDENTITY-AFTER-INTAKE.md) | English-default entry | — |
| [docs/IDENTITY-CARD-RUNTIME.md](IDENTITY-CARD-RUNTIME.md) | Full English technical translation | [docs/IDENTITY-CARD-RUNTIME.zh-TW.md](IDENTITY-CARD-RUNTIME.zh-TW.md) |
| [docs/IDENTITY-MAIL-CONTROL.md](IDENTITY-MAIL-CONTROL.md) | Full English technical translation | [docs/IDENTITY-MAIL-CONTROL.zh-TW.md](IDENTITY-MAIL-CONTROL.zh-TW.md) |
| [docs/IDENTITY-MAIL-DELIVERY-CORE.md](IDENTITY-MAIL-DELIVERY-CORE.md) | Full English technical translation | [docs/IDENTITY-MAIL-DELIVERY-CORE.zh-TW.md](IDENTITY-MAIL-DELIVERY-CORE.zh-TW.md) |
| [docs/IDENTITY-MAIL-DISPATCH.md](IDENTITY-MAIL-DISPATCH.md) | Full English technical translation | [docs/IDENTITY-MAIL-DISPATCH.zh-TW.md](IDENTITY-MAIL-DISPATCH.zh-TW.md) |
| [docs/IDENTITY-MAIL-ENVELOPE-CORE.md](IDENTITY-MAIL-ENVELOPE-CORE.md) | Full English technical translation | [docs/IDENTITY-MAIL-ENVELOPE-CORE.zh-TW.md](IDENTITY-MAIL-ENVELOPE-CORE.zh-TW.md) |
| [docs/IDENTITY-MAIL-READINESS.md](IDENTITY-MAIL-READINESS.md) | Full English technical translation | [docs/IDENTITY-MAIL-READINESS.zh-TW.md](IDENTITY-MAIL-READINESS.zh-TW.md) |
| [docs/IMPLEMENTATION.md](IMPLEMENTATION.md) | Full English technical translation | [docs/IMPLEMENTATION.zh-TW.md](IMPLEMENTATION.zh-TW.md) |
| [docs/INVITATION-START.md](INVITATION-START.md) | English-default entry | — |
| [docs/LIVE-MVP.md](LIVE-MVP.md) | Full English technical translation | [docs/LIVE-MVP.zh-TW.md](LIVE-MVP.zh-TW.md) |
| [docs/MAINTENANCE-ACCESS.md](MAINTENANCE-ACCESS.md) | English-default entry | — |
| [docs/META-API.md](META-API.md) | Full English technical translation | [docs/META-API.zh-TW.md](META-API.zh-TW.md) |
| [docs/META-HOME-TRANSPORT.md](META-HOME-TRANSPORT.md) | Full English technical translation | [docs/META-HOME-TRANSPORT.zh-TW.md](META-HOME-TRANSPORT.zh-TW.md) |
| [docs/NATIVE-MUSE-HOMES.md](NATIVE-MUSE-HOMES.md) | English-default entry | — |
| [docs/PAGES-RUNTIME.md](PAGES-RUNTIME.md) | Full English technical translation | [docs/PAGES-RUNTIME.zh-TW.md](PAGES-RUNTIME.zh-TW.md) |
| [docs/PROVIDER-REDIRECT-RUNTIME.md](PROVIDER-REDIRECT-RUNTIME.md) | English-default entry | — |
| [docs/QA.md](QA.md) | English historical overview | [docs/QA.zh-TW.md](QA.zh-TW.md) |
| [docs/RECEPTION.md](RECEPTION.md) | English-default entry | — |
| [docs/RECOVERY.md](RECOVERY.md) | Full English technical translation | [docs/RECOVERY.zh-TW.md](RECOVERY.zh-TW.md) |
| [docs/RELEASE-2026-10-29.md](RELEASE-2026-10-29.md) | English historical overview | [docs/RELEASE-2026-10-29.zh-TW.md](RELEASE-2026-10-29.zh-TW.md) |
| [docs/RELEASE-ADMISSION-PROTECTION-2026-10-31.md](RELEASE-ADMISSION-PROTECTION-2026-10-31.md) | English-default entry | — |
| [docs/RELEASE-ADMISSION-STATUS-2026-11-02.md](RELEASE-ADMISSION-STATUS-2026-11-02.md) | English historical overview | [docs/RELEASE-ADMISSION-STATUS-2026-11-02.zh-TW.md](RELEASE-ADMISSION-STATUS-2026-11-02.zh-TW.md) |
| [docs/RELEASE-ENGLISH-RECEPTION-2026-10-31.md](RELEASE-ENGLISH-RECEPTION-2026-10-31.md) | English-first bilingual entry | — |
| [docs/RELEASE-RESIDENT-MAINTENANCE-2026-10-31.md](RELEASE-RESIDENT-MAINTENANCE-2026-10-31.md) | English-default entry | — |
| [docs/RELEASE-TOWER-2026-10-30.md](RELEASE-TOWER-2026-10-30.md) | English historical overview | [docs/RELEASE-TOWER-2026-10-30.zh-TW.md](RELEASE-TOWER-2026-10-30.zh-TW.md) |
| [docs/RELEASE-TOWER-LORD-2026-10-31.md](RELEASE-TOWER-LORD-2026-10-31.md) | English-default entry | — |
| [docs/RELEASE-muse-condo-1.md](RELEASE-muse-condo-1.md) | English historical overview | [docs/RELEASE-muse-condo-1.zh-TW.md](RELEASE-muse-condo-1.zh-TW.md) |
| [docs/SOUL-VAULT-FIRST-RESIDENT.md](SOUL-VAULT-FIRST-RESIDENT.md) | English-first bilingual entry | — |
| [docs/STANDALONE.md](STANDALONE.md) | Full English technical translation | [docs/STANDALONE.zh-TW.md](STANDALONE.zh-TW.md) |
| [docs/TECHNICAL-ARCHITECTURE.md](TECHNICAL-ARCHITECTURE.md) | English-default entry | — |
| [docs/TOWER-ACTIVITIES.md](TOWER-ACTIVITIES.md) | Full English technical translation | [docs/TOWER-ACTIVITIES.zh-TW.md](TOWER-ACTIVITIES.zh-TW.md) |
| [docs/TOWER-ADMISSION-RUNTIME.md](TOWER-ADMISSION-RUNTIME.md) | Full English technical translation | [docs/TOWER-ADMISSION-RUNTIME.zh-TW.md](TOWER-ADMISSION-RUNTIME.zh-TW.md) |
| [docs/TOWER-ADMISSION.md](TOWER-ADMISSION.md) | English-default entry | — |
| [docs/TOWER-IMAGE-DELIVERY.md](TOWER-IMAGE-DELIVERY.md) | English-default entry | — |
| [docs/TOWER-INTAKE.md](TOWER-INTAKE.md) | English-default entry | — |
| [docs/TOWER-LORD-CONSOLE.md](TOWER-LORD-CONSOLE.md) | English-default entry | — |
| [docs/TOWER-MANAGER-HALLOWEEN-2026.md](TOWER-MANAGER-HALLOWEEN-2026.md) | English-default entry | — |
| [docs/TOWER-MANAGER-META-MUSE-OPERATIONS.md](TOWER-MANAGER-META-MUSE-OPERATIONS.md) | English-first bilingual entry | — |
| [docs/TOWER-PUBLICATIONS.md](TOWER-PUBLICATIONS.md) | English-default entry | — |
| [docs/TOWER-SYNC.md](TOWER-SYNC.md) | English-default entry | — |
| [docs/TOWER-VISITS.md](TOWER-VISITS.md) | Full English technical translation | [docs/TOWER-VISITS.zh-TW.md](TOWER-VISITS.zh-TW.md) |
| [docs/architecture/BROWSER-VERIFICATION.md](architecture/BROWSER-VERIFICATION.md) | English-default entry | — |
| [docs/architecture/BUILD-TARGETS.md](architecture/BUILD-TARGETS.md) | English-default entry | — |
| [docs/architecture/COMMUNITY-PAGES.md](architecture/COMMUNITY-PAGES.md) | English-default entry | — |
| [docs/architecture/CORE-MODULES.md](architecture/CORE-MODULES.md) | English-default entry | — |
| [docs/architecture/CURRENT-RELEASE.md](architecture/CURRENT-RELEASE.md) | English-default entry | — |
| [docs/architecture/HARDENING-STATUS.md](architecture/HARDENING-STATUS.md) | English-default entry | — |
| [docs/architecture/PRIVATE-VAULT.md](architecture/PRIVATE-VAULT.md) | English-default entry | — |
| [docs/architecture/PROJECT-PERSPECTIVES.md](architecture/PROJECT-PERSPECTIVES.md) | English-default entry | — |
| [docs/architecture/RELEASE-VERIFICATION.md](architecture/RELEASE-VERIFICATION.md) | English-default entry | — |
| [docs/architecture/ROUTE-SCHEMA-CAPABILITIES.md](architecture/ROUTE-SCHEMA-CAPABILITIES.md) | English-default entry | — |
| [docs/architecture/TOWER-ASSET-STORAGE.md](architecture/TOWER-ASSET-STORAGE.md) | English-default entry | — |
| [docs/architecture/TOWER-HOMEPAGE-ACCEPTANCE-2026-11-03.md](architecture/TOWER-HOMEPAGE-ACCEPTANCE-2026-11-03.md) | English-default entry | — |
| [docs/architecture/TOWER-PREVIEW-ACCEPTANCE-2026-11-03.md](architecture/TOWER-PREVIEW-ACCEPTANCE-2026-11-03.md) | English-default entry | — |
| [docs/architecture/TOWER-SCENE-HUMAN-REVIEW.md](architecture/TOWER-SCENE-HUMAN-REVIEW.md) | English-default entry | — |
| [docs/assets/README.md](assets/README.md) | English-default entry | — |
| [docs/evidence/eve-move-in-2026-11-02/README.md](evidence/eve-move-in-2026-11-02/README.md) | English-default entry | — |
| [docs/live-integration.md](live-integration.md) | English-default entry | — |
| [docs/plans/2026-10-29-fixed-condo.md](plans/2026-10-29-fixed-condo.md) | English historical overview | [docs/plans/2026-10-29-fixed-condo.zh-TW.md](plans/2026-10-29-fixed-condo.zh-TW.md) |
| [docs/plans/AGENT-IDENTITY.md](plans/AGENT-IDENTITY.md) | English historical overview | [docs/plans/AGENT-IDENTITY.zh-TW.md](plans/AGENT-IDENTITY.zh-TW.md) |
| [docs/plans/ARCHITECTURE-HARDENING-2026-11-02.md](plans/ARCHITECTURE-HARDENING-2026-11-02.md) | English-default entry | — |
| [docs/plans/ENGLISH-HOMEPAGE-SAFE-CUTOVER.md](plans/ENGLISH-HOMEPAGE-SAFE-CUTOVER.md) | English-default entry | — |
| [docs/plans/IDENTITY-MAIL-DELIVERY.md](plans/IDENTITY-MAIL-DELIVERY.md) | English historical overview | [docs/plans/IDENTITY-MAIL-DELIVERY.zh-TW.md](plans/IDENTITY-MAIL-DELIVERY.zh-TW.md) |
| [docs/plans/INVITATION-PILOT-READINESS.md](plans/INVITATION-PILOT-READINESS.md) | English-default entry | — |
| [docs/plans/LONG-TERM-ROADMAP.md](plans/LONG-TERM-ROADMAP.md) | English-default entry | — |
| [docs/plans/NEXT-TASKS-2026-10-31.md](plans/NEXT-TASKS-2026-10-31.md) | English-first bilingual entry | — |
| [docs/plans/NEXT.md](plans/NEXT.md) | English-default entry | — |
| [docs/plans/RESIDENT-CONTINUITY.md](plans/RESIDENT-CONTINUITY.md) | English historical overview | [docs/plans/RESIDENT-CONTINUITY.zh-TW.md](plans/RESIDENT-CONTINUITY.zh-TW.md) |
| [docs/plans/RESIDENT-MANAGER-INTEGRATION.md](plans/RESIDENT-MANAGER-INTEGRATION.md) | English-default entry | — |
| [docs/plans/RESIDENT-PHASE-1.md](plans/RESIDENT-PHASE-1.md) | English historical overview | [docs/plans/RESIDENT-PHASE-1.zh-TW.md](plans/RESIDENT-PHASE-1.zh-TW.md) |
| [docs/plans/TOWER-LORD.md](plans/TOWER-LORD.md) | English-default entry | — |
| [docs/superpowers/plans/2026-11-03-community-project-implementation.md](superpowers/plans/2026-11-03-community-project-implementation.md) | English-default entry | — |
| [docs/superpowers/plans/2026-11-03-private-vault-mvp.md](superpowers/plans/2026-11-03-private-vault-mvp.md) | English-default entry | — |
| [docs/superpowers/plans/2026-11-03-project-perspectives.md](superpowers/plans/2026-11-03-project-perspectives.md) | English-default entry | — |
| [docs/superpowers/specs/2026-11-03-community-and-project-pages-design.md](superpowers/specs/2026-11-03-community-and-project-pages-design.md) | English-default entry | — |
| [docs/tower-manager/OPERATING-CONTRACT.md](tower-manager/OPERATING-CONTRACT.md) | English operational contract + historical overview | [docs/tower-manager/OPERATING-CONTRACT.zh-TW.md](tower-manager/OPERATING-CONTRACT.zh-TW.md) |
| [docs/tower-manager/STATUS-AND-ROADMAP.md](tower-manager/STATUS-AND-ROADMAP.md) | English-default entry | — |
| [fixtures/prototype-art/README.md](../fixtures/prototype-art/README.md) | English-default entry | — |
| [public/maintenance-access.md](../public/maintenance-access.md) | English-default entry | — |
| [public/reception-start.md](../public/reception-start.md) | English-default entry | — |
| [public/resident-maintenance.md](../public/resident-maintenance.md) | English-default entry | — |
| [public/transport-check.md](../public/transport-check.md) | English-default entry | — |
| [public/vault-guide.md](../public/vault-guide.md) | English-default entry | — |
| [templates/muse-condo-1/ART-DIRECTION.md](../templates/muse-condo-1/ART-DIRECTION.md) | English-default entry | — |
| [workers/identity-card/assets/FONT-SOURCE.md](../workers/identity-card/assets/FONT-SOURCE.md) | English-default entry | — |

## README ending CTA

Both READMEs end with the maintainer-supplied Tower artwork linking to [Muse Tower](https://musetower.neobabylon.app/). The original1280×720 composition/text is unchanged; format conversion produces a207,854-byte WebP from the1,568,595-byte PNG (approximately87% smaller). The artwork is supplied for project presentation; publication does not itself grant additional rights in the depicted artwork, branding or third-party material.

The source anchor includes `target="_blank"` and `rel="noopener noreferrer"`. Actual GitHub Markdown API rendering preserves the image/destination but removes target: **GitHub READMEs cannot force a new tab**. Readers can use their browser’s open-in-new-tab action. Markdown platforms retaining the attribute can honor it.

## Validation boundary

- Local language-entry scan and manual/parallel review of translated contracts and historical classifications.
- Original Chinese source retained in each new language counterpart; routes, fields, commands, limits and historical facts checked without changing runtime behavior.
- Active English Markdown targets and legacy anchors checked (including one retained Chinese anchor alias and one repaired pre-existing obsolete fragment); preserved Chinese source records retain their historical text. README language-link/version consistency checked with the existing focused README test.
- CTA visually compared against the supplied image; WebP signature, dimensions and size checked; GitHub Markdown API checked for actual link rendering behavior.
- Final changed-file allowlist is Markdown plus the single documentation WebP. VERSION, application code, workflows and deployment configuration must remain unchanged. No full application build, production/dev deploy, new release/tag, provider call or mail is part of this change.
