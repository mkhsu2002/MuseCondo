# Admission protection release — 2026-10-31

## Verified security core

Application v1.09, source `235ab54e8115fca69b444de30c3e9c7d5052b4a1`, is deployed in dev and production. Both databases have migrations through 0032: 391 source objects match exactly, with zero foreign-key errors. The two additional platform objects are tracked separately. The matching Functions use required private EDGE_GUARD service bindings before D1 and identity proxy work. Existing four Manager/Card workers, namespaces and signing-key references remain unchanged.

## Protection and checks

- Connected source/resident duplicates stop before source downloads or paid review. In a controlled production case referencing the existing household, the actual technical decision completed with zero provider calls, zero home proofs, no account/grant/door and an unchanged original receipt on replay. The synthetic case was withdrawn afterward.
- Unconnected duplicate sources have a bounded 15-minute dispatch-anchored cooldown and resume their original zero-call job. Unknown or dispatching paid outcomes also block matching sources/residents across new cases and keys after that cooldown. They require reconciliation, not a new paid attempt. Independent native D1 checks covered stale unknown/dispatching receipts, both matching dimensions and both count/review phases.
- Case reads have private UTC-hour budgets and JSON 429/Retry-After. Malformed or throttled reads do not wake review. Terminal privacy/security operations retain their existing authenticated contract.
- The private edge workers hold only seven native rate bindings. Deployed bytes match the release bundle; they have no public workers.dev/preview endpoint, database, provider/signing/operator key or scheduler. Native workerd tests verify credential rotation cannot bypass IP limits and denials happen before D1/card work, including dynamic homes. A live dev probe observed JSON 429/Retry-After without creating a case or writing application rate rows.
- WAF is enabled only for the official Tower host's API and home paths, at 120 requests per 10 seconds per IP/location with a 10-second mitigation. A dedicated canary path returned the expected JSON 429 and Retry-After before the final scope was enabled. No general human CAPTCHA or blocking of ordinary static framework pages was introduced.
- The protected aggregate security view reports throttle exceedances, pending/blocked work, unknown results and 80-percent budget warnings. It is a pull-based operator view, not a claim of push notification or a new Guardian-email use.

The final security core passed all 1,010 tests, build/lint/generated-source checks and version checks. Independent readback verified both live sources, schema, bindings, normal public access and immutable historical receipt subsets, while allowing genuine applicant appends. Fang's original seven household datasets and door stayed unchanged. The accepted Halloween appearance remains active; no image generation or paid model call was made by the security probes.

These controls reduce duplicate work and resource abuse. Approximate location-local edge counters complement persistent D1 budget/authorization guards; they do not guarantee availability under every distributed attack or prove universal Agent uniqueness. See [the maintained contract](ADMISSION-ABUSE-PROTECTION.md).

## Concurrent real identity acceptance

The designated Guardian personally completed Fang's setup during this release. Her original permanent identity is active, with recovery configured. The first PDF card and signed JSON passed signature, actual PDF QR, rendering and original attachment-digest validation. One delivery succeeded and the Guardian confirmed both attachments are usable. Private recovery backup contents were not accessed. These are real setup/delivery acceptance facts, not a completed original-Agent recovery exercise; recovery and T09 remain open.
