[English](RECOVERY.md) · [繁體中文](RECOVERY.zh-TW.md)

# Generation failure: offline operator closure

> Legacy offline-generation recovery reference. The original SQLite-only validation boundary below is retained, not a new deployment assertion. Current service/release status is indexed in [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md).

`server/live/recovery.ts` is an **offline operations function**, not a resident API, Worker or public page. It makes no network/model calls, does not regenerate images and does not give the account holder a failure-based reroll.

Apply `migrations/0002_recovery_audit.sql` first. It adds a table without changing existing rooms or generation jobs. Production application still requires a separately authorized migration workflow; this documented validation used a SQLite test database only.

## Procedure

1. `inspectRecovery(db, jobId)` returns state and `updatedAt`, without original personality input, login credentials, provider key, prompts or raw responses.
2. A running job cannot be closed directly. The service first blocks an overdue unknown job as recovery; this does not establish reconciliation.
3. An operator reviews provider records/incident tickets through a separate controlled operations channel. Evidence remains in a private incident-management system, not Git or public journals.
4. Call `closeRecovery` with jobId, the just-inspected expectedUpdatedAt, operatorRef, evidenceRef, outcome and explicit `attestEvidenceReviewed:true`. Reference fields accept only short opaque identifiers without URLs, such as `incident:2026-042`; never include keys, raw prompts or private data.

Only two closure outcomes are supported:

- `provider-confirmed-no-output` → `closed-no-output`: the operator attests to reviewing evidence that the provider produced no output.
- `abandoned-unknown` → `closed-unknown`: the provider outcome remains unconfirmed; retain that uncertainty explicitly and stop the job.

**Neither is successful generation, and neither allows another provider call.** The system records the operator's evidence attestation; it does not independently authenticate external evidence, guarantee absence of charges or issue refunds. There is no reset-to-prepared, resend or authorization-bypass entry. Future recovery of original images would need a separate safe flow with provider receipts and asset verification.

The transaction checks recovery state, updatedAt, absence of existing images and absence of prior closure, then writes a one-time audit and updates job/room state. Stale or competing operator requests fail rather than overwriting completed state. Existing assets require separate asset reconciliation; this tool cannot discard them.

Validation: `node --experimental-strip-types --test tests/recovery.test.ts`. These tests touch isolated SQLite only, not real providers or cloud accounts.
