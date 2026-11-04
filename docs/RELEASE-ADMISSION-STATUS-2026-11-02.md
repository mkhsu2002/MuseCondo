# Admission status and retirement of legacy registration — release verification

[繁體中文完整歷史紀錄](RELEASE-ADMISSION-STATUS-2026-11-02.zh-TW.md)

## Historical verification overview

This is an English overview, not a line-by-line translation or a fresh live check. The original recorded successful dev/production verification at **dev 2026-11-02T19:29:29.812299+00:00** and **production 2026-11-02T19:31:27.347501+00:00** (UTC), with application **v1.46**, source [`5e42b72`](https://github.com/mkhsu2002/MuseCondo/tree/5e42b723abc48b7b552ab702c31a320be786857d), OpenAPI **0.5.4**, Reception **9**, and start-guide **1.4**. It proved deployment consistency, not new real-resident acceptance or guaranteed future applications.

## Contract changes

`GET /api/v1/status` returned `admission:{status:"accepting"|"paused"|"unavailable",applyURL}` from persisted admission control, failing closed when control/runtime schema was missing. These public contract markers did not change existing case.version or immutable receipts.

Deprecated `registrationEnabled` described legacy account self-registration only. Official `POST /api/v1/accounts` returned **410** with `registration_retired`, message and applyURL. Existing sign-in, approved-case activation, resident maintenance and independent local framework capability remained. Retiring that public entry did not delete the account system or mean that the Tower rejected all new applications.

Paused/unavailable preflight/new-case requests returned **503** with error, admission, applyURL, `formalCaseCreated:false` and nextAction. Existing case reads, amendments, resubmission and historical receipts remained. Paused also suspended qualification, automated assistance and final completion verification until reopening. Existing authority still had to be valid; this was not a promise that every in-flight admission could finish. No waiting list, quota, capacity allocation or automatic assignment was added. Failed/missing status could not display accepting, and acceptance of applications did not imply approval, completion or publication.

## Recorded cross-environment checklist

Both branches deployed source5e42b72 (`framework-v001` dev, `main` production). There was no new migration: **645 schema objects** were unchanged and runtime-ready. Pages/Functions and the shared Manager renderer matched, preserving bindings, DO namespace and schedule. Both environments read accepting with persisted control1 and their own trusted Reception URL; production controls were not toggled for testing.

Isolated local/dev tests covered all three states, source-check-time changes, rejection of new cases, receipt retention and transaction rollback. Live accepting and anonymous retired-registration410 were read back; no test residents or real cases were created in production. Reception HTML/JS, contracts, maintenance guides and build bytes matched. Fang/Eve doors and all three pages returned HTTP200; hero/OG/history materials were unchanged. Existing authority, idempotency and audit boundaries were retained. No resident impersonation, notices or paid-model calls occurred.

## Evidence and limits

Build/TypeScript, repository lint and **77 targeted tests** passed. Of an initial **1,285-test** run, 1,282 passed; three policy/fixture/410 expectation failures were fixed and **49** related regressions passed. The native SQLite fixture retained its constraints; a private temporary snapshot and 30-second timeout supported a **21-test** file. Final README/version checks recorded **12** passes. These are the original run counts, not new executions.

Both environments retained control1. Reception schemaVersion9 was a guidance contract marker, not a migration. The shared deployed/local renderer digest was `33af9440e3e59aac1ffce35c20e95ee9326eaae3881d3b8a75eb5f742df26451`; the existing schedule remained `0 16 * * *`, with no new polling.

Production checks were public reads and the retired entry's unauthorized probe only. Paused/unavailable behavior was proven in isolation, not by switching production. [Reception](https://musetower.neobabylon.app/reception) and [status](https://musetower.neobabylon.app/api/v1/status) are live entry points; their present state may differ from this dated record.
