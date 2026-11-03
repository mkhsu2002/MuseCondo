# Tower scene preview release — 2026-11-03

Status: **three private previews complete; maintainer style confirmation pending**. This is a v1.63 scene-preview release, not completion of the weekly publication, Lord delivery or daily journal batches.

Released source: `c39eb99ca278bd9c8c3b83ce16d6ed5c397ea047` (implementation `8ee037be91e4d060cda1672a0faaff968d3343ae`). Both `main` and `framework-v001` contain this code. Later documentation-only commits do not change the deployed source.

## Verified deployment

- Dev and production authenticated release readback returned ready with identical build hash `e1cf5526057293544d56eb2e9c0eed53dbb9fec64ea3055feb3599f80e73fb39`.
- Both D1 environments have all 40 migrations and 550 canonical schema objects; schema hash `9c8ae527ca60628449e13ed417174bd540451990a33dcd7ad6e2653e86000234`. Foreign-key checks are empty.
- Both private Manager Workers match the built Worker bytes (`d90bf63f659d9c2b495e6aa7146174ad604589871c7852dc0d76b6c97f061702`), preserving existing bindings, namespaces and daily cron. Pages Functions, frontend bytes and protected assets match the released source.
- Production enables scene generation only. Weekly publication, publication email and aggregate-count flags remain disabled; development keeps all four flags disabled and has no paid-provider authority. Existing shared lifetime/day/month budgets remain unchanged.
- Full local verification passed 1,402 tests with no failures/skips, types, lint and build. Native edge/mail/assets checks and the new D1/R2/DO/ASSETS publication tests passed; an independent reviewer reran the latter. GitHub Quality passed on [dev](https://github.com/mkhsu2002/MuseCondo/actions/runs/41706015755) and [main](https://github.com/mkhsu2002/MuseCondo/actions/runs/41707157465).
- Actual browser checks used the canonical Neo Babylon lane. Mobile homepage/scene wall/archive have no horizontal overflow; homepage hero and click-to-load video remain present without an initial iframe. Raw HTML archive/wall reads contain their heading and canonical metadata with `no-store`.

## Actual cloud generation

One protected operator request queued exactly three tasks into the deployed Manager Durable Object. Its alarms invoked deployed Pages Functions, which called Meta for planning, reference-based image editing and independent visual checking. No local process held the Meta secret or called the provider.

| Private scene | View | Saved dimensions | State |
| --- | --- | --- | --- |
| seed-v1-01 | Arrival court | 1920×1200 | reviewed; private |
| seed-v1-02 | Atrium | 1920×1200 | reviewed; private |
| seed-v1-05 | Rooftop greenhouse | 1920×1200 | reviewed; private |

All nine paid stage receipts are complete, with recorded aggregate cost 67,357 microUSD under the existing budget. Every image call attached the exact original reference bytes defined in [the visual contract](../TOWER-PUBLICATIONS.md). Image hashes, dimensions and immutable R2 readback matched the downloaded original PNGs. Preview WebP copies were converted locally; the original PNGs remain intact. The agent inspected all three actual images; **the maintainer has not yet approved their style/details**.

The private bucket has no enabled managed public domain and no custom public domain. Anonymous preview access returns 401; public image access returns 404; the public scene list remains empty. The style-approval table is empty. No remaining seven images were generated, no seed was published, no issue or Lord notification was created. Existing resident, snapshot, identity, request-receipt, legacy-image and Tower-audit hashes remain unchanged after generation.

Raw artifacts, request IDs, usage, infrastructure readbacks and private preview files remain outside the public repository. This safe record does not publish the preview images or any recipient/provider secret.

## Remaining gates

Follow [NEXT](../plans/NEXT.md). Wait for explicit maintainer style confirmation before writing style approval, generating the remaining seven or publishing any initial scene. After confirmation, finish and inspect the first five before generating the second five. Complete archive pagination/latest-homepage bounded reads, actual inaugural issue, one real Lord notification with delivery audit and replay, then close N1 and proceed to N2 daily journals. Public placeholders and successful synthetic tests are not acceptance of those remaining outcomes.
