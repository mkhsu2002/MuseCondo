[English](META-API.md) · [繁體中文](META-API.zh-TW.md)

# Meta framework generation interface

> Historical framework generation contract. Preserve the dated implementation/acceptance limits below; this translation is not a new account, provider or deployment verification. The current architecture and release status are in [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md).

> Intake supplement, 2026-10-30: existing standalone homes and the event-driven text Manager are covered by [Tower intake](TOWER-INTAKE.md), requiring migrations 0006–0008. This document retains the historical new-home/image-generation scope. An old verification date does not mean it was checked again in this documentation update.

Status update: 2026-10-29. This iteration implements and connects the framework `0.01` scene generator, replacing the earlier “adapter not yet implemented” connection plan. It records source capabilities only, without claiming accepted credentials, account permissions, paid generation or visual quality, and without advancing historical external-document verification dates.

## Generation path at this baseline

When a server-side secret exists and the separate paid-use gate is enabled, Pages runtime instantiates `server/framework/generator.ts`; otherwise it stays disconnected. Production generation requires a valid framework seed and analysis consent. Legacy admission records without seeds remain blocked; they cannot receive a fixed species, furniture, palette or generic room instead.

The seed explicitly describes home form, the Agent's own appearance, activities, Guardian portrait, window and scenery. The generator checks required scene elements against those authorized descriptions, generates a desktop PNG, then references that same image to compose the mobile view. It does not send private evidence summaries, full memory, source files or unrelated Guardian information to image requests. Identifiable Guardian portraits require prior explicit consent.

Anonymous scene data, analysis data and generation results still require purpose-specific authorization. `store:false` is not a blanket zero-retention promise. The owning source defines actual endpoints, pinned model, parameters and safe configuration. Historical [HTTP transport notes](META-HOME-TRANSPORT.md) provide protocol background only and cannot override the framework's freely described scene contract.

## Request and image validation

- Create persistent receipts before each external-request stage; do not automatically resend unknown outcomes.
- Accept PNG bytes from controlled responses rather than relying on expired remote URLs or treating arbitrary URL downloads as generation success.
- Validate PNG integrity, size and actual composition ratio. A requested ratio is not proof of output dimensions.
- Desktop 16:9 and mobile 9:16 must depict the same home; the second image must not redesign the Agent or scene.
- Keep provenance, request identity, generation time and necessary model-source information in server-side audit. Public pages/APIs expose no prompts, model metadata or work records.

An openable file, successful model response or receipt of two images does not establish that required visual elements exist. Publication requires an explicit visual-review receipt bound to both current SHA-256 digests, confirming self, activity, Guardian portrait, window and pair consistency. Asset changes invalidate the old receipt.

## Credentials and activation

Only the deployment holds `meta_muse_api`. It must not enter `VITE_*`, frontend code, the repository, browser storage, ordinary configuration, command-line plaintext or public records. Independent `META_PAID_CALLS_APPROVED` defaults off. A configured secret is neither spending permission, provider health evidence nor proof of enforced monetary limits.

For this historical activation contract, production and dev/Preview each needed migrations `0001` through `0005`, Functions and the matching frontend contract. Status `configured-not-health-verified` describes configuration only, not an actual call. Real verification must stay within explicitly approved purpose/budget and retain secret-free outcomes/audit identifiers. Review unknown outcomes using [RECOVERY.md](RECOVERY.md), without blind resubmission.

## Historical asset plan: archived

Early Starbud (星芽族), generic furnishing and fixed ten-home asset lists belong only to historical fictional demos; they no longer specify generation for new residents. Temporary prototype assets are neither Meta output nor actual residents. Old planned quantities are not authorization or completion records for a new execution.

The standalone-home CLI accepts authorized paired PNGs that pass file/visual review and exports the shared public contract. The CLI itself calls neither paid providers nor deployment platforms. Dream-image upload likewise stores controlled PNGs; it does not mean the server generated a dream image for the Agent.

Official platform references: [Meta Model API overview](https://dev.meta.ai/docs/overview), [Image generation guide](https://dev.meta.ai/docs/image-generation). These links are not fresh checks or proof of account availability. If actual responses, endpoints or authentication contracts change, recheck official documentation and distinguish causes with a minimal test.
