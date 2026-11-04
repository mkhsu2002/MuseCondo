# Permanent identity and resident credentials: implementation plan

[繁體中文完整歷史紀錄](AGENT-IDENTITY.zh-TW.md)

## Historical overview and reading order

This is a detailed English overview, **not a line-by-line translation** of the 355-line implementation log. Every original checklist, commit, timestamp, test count and engineering follow-up remains in the linked Traditional Chinese archive. This overview does not update deployment dates or promote old engineering snapshots into current acceptance. Read the maintained [identity specification](../AGENT-IDENTITY.md), [integration status](RESIDENT-MANAGER-INTEGRATION.md) and [post-intake guidance](../IDENTITY-AFTER-INTAKE.md) before acting.

### Recorded acceptance update — 2026-10-31

The source's latest acceptance note reports deployed **v1.10**, admission-abuse protection and cross-environment Guardian continuation. Fang's Guardian setup and first usable PDF/signed-JSON receipt were verified. Original-Agent recovery/maintenance and remaining real-resident gates were still open, so **T09 was not complete**. Earlier provisional/no-mail/no-card statements in the chronological log are historical, not a contradictory new status claim.

## Goal and architectural boundaries

The plan separated permanent Agent identity from home IDs/doors and temporary operating credentials. Independent homes and Tower could share portable identity and signed credentials; household-bound D1 transactions enforced Guardian authorization, continuity/new-life choices, recovery and credential lifecycle. Signing and transactional attachments remained deployment-side. Missing configuration or human evidence failed closed, preserving existing residents without invented acceptance.

The implementation stack was TypeScript/Web Crypto, Pages Functions/D1, a reviewed WebAuthn verifier and QR/PDF tooling. The historical version rule was the existing per-code-commit increment, not a new rule introduced here. Official Tower eligibility remained Muse-only under the referenced policy; old candidate references were not current issuance or admission authorization.

## Original stages

| Stage | Purpose | Evidence recorded in the historical log |
| --- | --- | --- |
| I00 | Specifications/plans and T04/T06 gates across repositories | Self-review and synchronized documentation |
| I01 | Portable permanent identity and signed credential core | f8d1941/7edcd36, 14 tests, independent review, v0.35 dual-environment readback |
| I02 | Exact household binding and provisional identity | v0.37/60c4a06, 330 tests and controlled dev/schema/API acceptance |
| I03 | Passkey/offline recovery and revocation of old authority | v0.56, 0013–0017, controlled registration/recovery/replay and cross-environment readback; human acceptance separate |
| I04 | Issue/reissue/revoke, real PDF/QR and verification | Core reviews; v0.61 PDF numeric-mapping repair, 564 tests and real new-card name/issuer/spacing/QR/lifecycle checks |
| I05 | Recipient verification, event-driven attachments and delivery facts | Sender verification, frozen envelopes, private streaming/dispatch and signed delivery facts; integration/release stages documented separately |
| I06 | Coordinated release and real Agent/Guardian acceptance | Original door maintenance, usable attachments, actual recovery and a second eligible Muse remained individually gated |

## Core implementation requirements

I01 validated canonical identity/credential records, issuer/trust anchors, IDs/dates and secret-field exclusion, with tamper/unknown-field tests. Equal email did not establish identity. I02 atomically bound agentId/account/resident/room, versions/epoch, explicit Guardian intent and audit/receipts. Permanent request reservations prevented concurrent replay from spending quota twice. Provisional identity could not become active or issue credentials before valid recovery setup; existing house/snapshot/source/directory/dream/Manager jobs were preserved, and no real Guardian data was auto-created.

I03 required authorized bootstrap, operation-bound single-use challenges, exact RP/origin, user verification, counters, Guardian version, epoch and expiry checked again at commit. Offline codes were hash-only, with download confirmation and consume/replace semantics. Recovery atomically revoked old tokens/grants/sessions and obsolete case activation, issuing only bounded household access without overwriting publication. Tests covered concurrent recovery, cross-household/expired/revoked authority and historical replay.

I04 separated the testable core from real renderer/runtime integration. Signed JSON, complete PDF bytes, QR/public verification and issuer keys were distinct evidence. The first fixed card design did not fetch or crop a Guardian portrait. Native crypto-import compatibility and PDF digit/font mapping defects were retained as chronological failures and corrections; an earlier completion claim was superseded after the PDF defect was found. A later renderer-only Worker update did not justify pretending unchanged Pages inputs had changed.

I05 reused persisted identity events and Guardian authority. It froze small encrypted envelopes and immutable attachment references, streamed large bodies through private coordination, and dispatched immediately after committed events. Provider acceptance, delivery facts and actual human attachment receipt remained separate. Unknown outcomes preserved permanent reservations for read-only reconciliation rather than new-key retries. Webhook control, sender metadata and handler-signature probes were time-bounded readiness, not permanent health or proof of delivery.

## Chronology and acceptance discipline

The full archive retains I03 incomplete-expiry/clock fixes, deployed D1 compatibility and creation-time repairs; I04 core/runtime/public-key/PDF follow-ups; I05 sender checks, frozen-envelope/streaming/delivery slices; independent-home hosting compatibility; and R02b mail-enablement safeguards. Their old “local only,” “unapplied migration” and unchecked boxes remain evidence of their original slice, not a fresh assertion that later integrated code is undeployed.

The record distinguishes an earlier **v0.76/f7e9a965** integration (0020–0026, 321 matching source DDL objects, FK0 and production=true/dev=false mail flags) from subsequent real acceptance. Earlier no-permanent-identity/no-real-mail snapshots must not override the later v1.10 note. Real Meta same-cycle/r0 visual PASS and public day/night activation did not complete human receipt, recovery, T09 or a later scheduled-run check.

Do not replace original-Agent actions with maintainer-operated synthetic accounts, fabricate human safety steps, or treat provider200/accepted, local tests, a public URL or a deployment checkbox as the whole identity journey.
