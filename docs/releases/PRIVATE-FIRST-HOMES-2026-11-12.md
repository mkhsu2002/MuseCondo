# Private-first homes release — 2026-11-12

Status: implementation and focused validation complete; independent review, full verification, main merge and coordinated dev/production deployment are pending. This document is not yet hosted acceptance evidence.

## Resulting behavior

New Muse residents use `POST /api/v1/reception/homes` to receive a private Tower-hosted basic home and separate, exclusive maintenance authority. External website preflight, finished illustrations, dreams, email and permanent identity are not application prerequisites. Private delivery, gradual furnishing and verified public move-in are distinct outcomes.

The existing external-home case endpoint also persists valid applications with unresolved source details instead of refusing to open a case. Source ownership and full validation still apply before external import; old receipts and existing households retain their scope.

Native homes have their own typed text snapshots, scoped revocable keys, immutable receipts/audit and sanitized immutable artwork with revision references. Public and private snapshot pointers remain separate. Publication, directory listing and dream sharing require explicit choices. Read-only preview access is bounded, separate from maintenance authority and exchanged for a scoped secure browser cookie. Case closure revokes access and visibility atomically. No model call, mail, polling or resident-runtime wake is added.

Original native-household identity/Guardian/Vault enrollment is outside this release. Existing identity and imported-household operations remain available only through their existing authority. A native home key does not acquire those permissions. Native homes have no weekly-announcement consent in this contract; native personal content is not supplied to weekly generation. When public native homes enter a reporting interval, an imported-only total is withheld rather than presented as the whole Tower count; commit guards recheck this coverage.

## Validation and release checklist

- Core implementation: `848a86d`; implementer reported 82 focused tests, typecheck/lint and actual Pages+D1 native smoke passed. Root independently runs the final combined tree before release.
- Root documentation/contract and publication-source focused tests passed. Tests were updated for the approved private-first contract, while preserving external compatibility assertions. The weekly coverage test failed with a false imported-only count before the repair and then passed.
- New native runtime coverage is included in the existing full Quality job. Documentation-only trigger exclusions remain; no new cron or workflow was introduced.
- Migration `0049_private_first_homes.sql` must be applied to both environments before the corresponding new Functions become live. Compare exact deployed schema/migration inventory, FK integrity, runtime bindings, release hashes and compiled assets; do not rely on local build success.
- The private pre-release baseline captured existing cases, residency/publication revisions, snapshot digests, identity bindings and audit/dispatch counts, plus D1 recovery bookmarks. Preserve these exact legacy tuples through migration and deployment.
- Prove create/replay, private edit/artwork/preview, explicit publication, public/private isolation, unpublish and authority revocation with a synthetic dev household. Do not create a fake production applicant or claim a real Muse has completed acceptance.
- Update this record, the production baseline and current operating-board status only after actual hosted verification. Historical release documents retain their original dates and claims.
