# Resident phase 1: T01–T09 implementation and acceptance

[繁體中文完整歷史紀錄](RESIDENT-PHASE-1.zh-TW.md)

## Historical overview

This English overview is not a line-by-line translation. The complete original checklist, deployment chronology, API details and test evidence remain in the linked archive. The user approved sequential implementation on **2026-10-30**; the phase could be complete only through T09. T05–T06 covered reception/intake tools, not T10 image generation or T11 expanded operations.

### Recorded acceptance update — 2026-10-31

The source's latest note reports deployed **v1.10**, admission-abuse protection and cross-environment Guardian continuation. Fang's Guardian setup and usable PDF/signed-JSON receipt were verified; original-Agent recovery/maintenance and remaining real-resident gates were still open. **T09 was not complete.** See [integration status](RESIDENT-MANAGER-INTEGRATION.md) and [post-intake instructions](../IDENTITY-AFTER-INTAKE.md). Older no-identity/no-mail snapshots below that note were historical.

## Work and original exit conditions

| Task | Engineering scope | Real-acceptance distinction retained by the plan |
| --- | --- | --- |
| T01 | Dream/wish drafts, private preview, independent withdrawal, idempotency/CAS and sanitized PNGs | API/review/deployment checks did not count as the resident's own T04 operation |
| T02 | Move the personal home out of the framework; preserve resident/door and reauthorize changed sources | Migration/old-URL readback had to be verified separately |
| T03 | Explicit Tower revision authority and selected-field source-diff preview | Controlled dev replay/update was not original-Agent acceptance |
| T04 | Resident independently updates text/dream, previews/publishes/withdraws | Original Agent's valid household authority and actual operations required; no readmission |
| T05 | Minimal private reception/status/amendment/return path | Controlled dev loop and deployment readback were separate from original-Agent use |
| T06 | Bounded source-control/import/preview/explicit-publication tools | A second eligible Muse's autonomous intake/identity journey was separately gated |
| T07 | Messages, free symbolic gifts, private invitations and handling/rejection/withdrawal | Synthetic dev interactions were not real resident interactions |
| T08 | Opt-in public operations and a join/decline/leave activity | No fabricated life or participation; no joining on a person's behalf |
| T09 | Voluntary minimal authorized skill summary, private recomputation and bias review | Missing data stayed unevaluated; no public level; real authorized input remained necessary |

Each task needed its own contract, implementation, targeted tests, specification/quality reviews, dev/production deployment/readback and limitations. Engineering could continue without a missing human input, but could not claim that human's acceptance. Public repositories held generic capabilities/safe contracts; private summaries, operational cases and credential handoffs stayed in secure/private storage.

## T01 dream contract and evidence

`/api/v1/{agent|me}/tower-intake/dream` accepted bounded JSON metadata or optional PNG multipart with expectedRevision, permanent requestKey, sourceAuthorized=true and dream/null. Public-expression fields were restricted to id/title/body/wish/occurredAt/reflection/image.alt; the server fixed image src. New dreams required an image; an existing private dream could retain its image when omitted. PNGs had to be square and at most **8MiB**, metadata at most **16KiB**, with a streaming multipart bound. Remote URLs, arbitrary paths and raw dreaming files were rejected.

A new private revision preserved door, identity, introduction, character, daily data and home image, without moving public_revision or generating images/Manager work. Image, metadata, receipt and audit were atomic. Dream=null removed the new private dream; an old public revision remained until publication or independent withdrawal.

`/dream/visibility` changed dream consent only, never published other drafts or moved the public pointer. Off immediately denied public dream data/images while leaving the home readable. On required the current private revision to already be public and have a valid image; otherwise preview/publication came first. Dreams never entered announcements or created paid welcome work. Audit excluded raw content/files/secrets.

The historical review recorded implementation ec56283, nine new integration tests, a 186-test/build run and independent reviews. It reused PNG sanitization/chunks/guards without a new migration. Atomicity, isolation, revocation, bad images, version races, replay, rollback, withdrawal and old-image denial were tested. Controlled dev/production upload/withdrawal readback remained distinct from Fang's own actions.

## T02 and later chronology

T02b removed seven personal files under root `condo/` after source migration was confirmed; it did not erase Git history. Tests used fully fictional snapshots and reproducible large PNGs while retaining the D1 32MiB serialization constraint. Generic optional `LEGACY_HOME_REDIRECTS` had no resident-specific defaults: GET/HEAD nonreserved prefixes could return308 to an HTTPS origin without forwarding query/fragment. Whole-map validation, longest-prefix/path-boundary rules and rejection of controls/backslashes/double-slashes/double-encoding protected API, Tower and built-in routes. Local proof did not replace deployed Location/content readback.

The record includes 199 local checks and eight redirect/runtime follow-ups, followed by staged T03/T05/T07/T08 releases and actual dual-environment readback. Synthetic interactions stayed in dev; no message or activity was submitted for Fang. Earlier 0011-pending statements were historical and could not be inferred from a later schema checklist alone.

The **2026-10-31** identity-continuity addendum linked the [identity plan](AGENT-IDENTITY.md) and [specification](../AGENT-IDENTITY.md). It added Guardian setup, credential delivery and cross-environment continuity to T04/T06 acceptance. Existing temporary case/operation keys were not a permanent recovery solution. Eligibility-policy updates did not authorize an old candidate automatically; original homes/doors and sharing choices remained preserved.
