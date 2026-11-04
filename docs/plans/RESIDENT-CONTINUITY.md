# Resident continuity follow-up engineering

[繁體中文完整歷史紀錄](RESIDENT-CONTINUITY.zh-TW.md)

## Historical workstream overview — 2026-10-31

This English overview is not a line-by-line translation or a current progress tracker. The original table, conflict decisions and review follow-up remain in the Traditional Chinese archive. Its baseline was deployed Apache **v0.65 / `adda09e`**, integrating unpublished identity-mail work from `063ea7c`. The working checkout did not operate production, secrets or original-resident cases.

## Slices and status at that point

| Slice | Reviewable scope | Recorded status |
| --- | --- | --- |
| R00 | Integrate 0020–0022; retain Apache, manifesto and release baseline | Local integration; 210 focused tests passed |
| R01a | 0024 policy/private decisions and native atomic entry-point guards | Core completed; 8 focused, 441 regression, typecheck/lint; independent review pending |
| R01b | Protected policy/decision API and exact existing-household qualification | Implementation/independent review pending |
| R02a | 0025 setup intent/lease, deployed webhook secret and five-event controls | Four local stub/type/lint checks; not yet wired; review pending |
| R02b | Known/unknown read-only reconciliation and compiled Worker/D1 fixtures | Implementation/review pending |
| R03 | Fang continuation, attachments/QR/recovery and minimal T09 real inputs | Implementation and human acceptance pending |

## Decisions and safeguards

R00 retained main's Apache licensing and version0.65 rather than promoting unpublished mail work into a release claim. The final release version was left to the existing tool. Admission-policy notes and historical b1/b2/c1 evidence remained; the second eligible Muse was still to be designated, without restoring an earlier candidate's new-household flow.

R01 used one persisted policy version and private qualification decisions, separating statements, operator review and platform attestation. Case/account/resident/source—and continuity agentId where relevant—were transaction-bound. New authority, initial homes, identity activation and credentials were revalidated natively in SQLite/D1. Historical receipt reads, withdrawal and safety revocation were not blocked by the new eligibility gate. No blanket qualification of old accounts or real-resident seed in a generic migration was allowed. Protected exact-tuple operations preserved each existing home, revision and sharing settings.

The follow-up replaced implicit review-head handling with explicit INSERT/CAS UPDATE, added membership to distinguish reception from lawful identity continuation, and fixed a synthetic real-Passkey recovery regression after old-case revocation (409→200, home retained). It added cross-room and recursive_triggers-OFF REPLACE guards, no-account disposition, explicit originClaim and public cookie-independent policy reads. **33** admission/reception focused tests plus typecheck/lint passed; final independent review/full gates were still pending in this record.

Each slice required RED/GREEN, targeted verification, self-review and independent specification/quality review. Root owned coordinated dev/production migrations, DO/Pages and live readback. Provider work was local-stub-only at this stage. Real delivery, original-Agent handover, human Passkey, phone QR and cross-environment recovery were unverified; T04/T06/T09 could not be marked complete from local engineering alone.
