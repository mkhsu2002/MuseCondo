# Tower homepage publications acceptance — 2026-11-03

## Released and observed

Application v1.67, source `fc5854c1422d43fdd68d8af6c6eebed52f61f5b5`, is deployed to dev and production. Both have 42 applied migrations, 576 canonical schema objects and schema hash `e286b0d660718380a981fd3b4e5e1424e40afddbd13e9de8d11211e171fb2124`. Exact Functions/frontend/manifest, runtime bindings and private Manager Worker bytes were checked. Existing resident, consent, identity, request and original-image records remained unchanged. Both exact-source Quality runs passed.

The shared private Manager Worker byte hash is `765600d77ca8dc8d68a57c8c58479c7be0d15740f257fcd08b989a62c543dc15`. Existing namespace, private endpoints and normal once-daily schedule were retained. Image/recovery work and weekly/daily work use separate actors, preventing image latency from blocking the homepage.

## Weekly and one Lord notice

[Issue 1](https://musetower.neobabylon.app/tower-weekly/tower-weekly-inaugural) was published by the actual deployed bounded Manager. It records two admitted residents, authorized welcomes for Eve and Fang, current public journal news, and the approved Arrival Court scene. The [homepage](https://musetower.neobabylon.app/) and [archive](https://musetower.neobabylon.app/tower-weekly) expose it.

The issue/job/outbox/dispatch each have one persistent record. Own-handler signed proof and provider delivery were verified. Replaying the identical inaugural request left issue, delivery, job and dispatch state unchanged with no additional notice or paid call. This proves provider delivery, not human opening or reading. No subscriber list was enrolled or contacted. Provider credentials remained deployed-only; the operator used only the protected trigger.

Desktop 1440px and mobile 390px homepage checks found no horizontal overflow, broken images or preloaded video iframe. Public copy was reviewed. Saved private operations evidence includes authenticated hosted readbacks and `inaugural-live-acceptance.json`; secret or recipient values are not copied here.

## Hosted navigation and image revalidation

Both residents’ Home, Inside and Dreams pages (six pages) return 200 and expose a Muse Tower brand link to `https://musetower.neobabylon.app/`. Their own three-view navigation remains available. Standalone exports keep independent navigation.

All three currently public hosted PNG images retain their original size and SHA. Conditional requests return bodyless 304 after current publication/consent checks. Initial-image WebP compression is a separate following release; this checkpoint does not claim it is live. See [image delivery](../TOWER-IMAGE-DELIVERY.md).

## Remaining observation boundaries

Daily-journal service, strict fixed-cutoff selection, SSR/client rendering, immediate withdrawal and zero-provider scheduled native tests pass. Actual deployed native scheduled publication is still pending at this checkpoint; a controlled date-specific native event is arranged for observation and its extra cron must be removed afterward. Never replace this gate with a manual due call or synthetic production resident data.

Three approved scenes are public. Known scene repairs and the remaining ten-image collection proceed independently; a new image is not public until its reference binding, receipts, bytes and actual artwork pass inspection. [NEXT](../plans/NEXT.md) owns remaining work and closure.

Subsequent same-day image checkpoint: canonical first five passed cloud review, exact reference/receipt/hash checks and actual visual inspection, then were approved and publicly read back. The old rejected scene03 remains private. The second batch of five started only after that gate.

## Native daily observation, 2026-11-03 22:42 UTC

Actual Cloudflare scheduled invocations were captured in both environments with outcome `ok`; no manual due endpoint created the editions. Production persisted one job, one edition of three authorized journal entries and one audit record at 22:42:18.799Z. Development persisted an honest empty edition at 22:42:35.198Z because it has no public residents. Both use the original 16:00 UTC cutoff, actual observed time and zero provider cost. Public API and homepage SSR match. Original resident/consent/snapshot/identity/request/art state hashes remained unchanged. The date-specific observation cron was removed from both Workers, leaving the original `0 16 * * *` daily schedule.

This is a controlled late first-run observation of the native deployment chain, not a claim that the normal 09:00 event was already observed. Subsequent routine observations remain N3. A maintainer-reported weekly-to-home link exposed an older SPA renderer; its fix must pass real click-through acceptance before N2's link/UI gate closes.

## Pending hosted-home correction and legacy authority boundary

The weekly click-through was reproduced against the live site: the client intercepted `/home/:id/inside` and used the old room renderer, while a fresh request returned the correct published snapshot and journal. The correction uses native document navigation for all three hosted-home views and history restoration. Independent focused tests also cover demo routing, modifier clicks and same-document fragments.

A separate isolated synthetic regression confirmed legacy public detail/dream/assets must not serve stale room data for an admitted Tower household. The narrow backend fix closes those anonymous legacy reads while retaining non-Tower compatibility and owner/delegated private reads; shared interaction authorization remains unchanged. Its release and real click-through/WebP acceptance are still pending.

The native burst test now requires an entire sample inside one real rate-limit window, with bounded fresh-key resampling only when the clock crossed a boundary. It still requires exactly 40 admitted requests, a 429 denial and no further card/database call. Production limits and rate-handling code were not changed. This fixes a timing-sensitive CI assertion rather than weakening the limiter.

The production build also exposed an older registration-race fixture that started two promises without ensuring both WebAuthn ceremonies had verified before the first commit. The fixture now holds both at that specific atomic commit boundary. Strict exact-replay/competition statuses and one receipt/audit are unchanged; twelve repeated races and all 53 registration tests pass. No registration production logic changed. The functional v1.70 source had already passed exact dev and both GitHub Quality runs; this test-only source correction is built and verified in both environments together.

## v1.70 hosted acceptance

Source `8a9b6aa8ff6c409d2da4a11c1b0c1343dff0997b` passed both exact-source Quality runs. Automatic Pages builds correctly skipped its test-only correction, so the verified frozen full Functions/static artifact was deployed via official Wrangler to recover the preceding failed release; no empty/product-no-op change or build-filter relaxation was used. Project configuration, bindings, secrets, branches and schedules remained unchanged. Exact-source/schema/frontend/runtime readback passed in both targets.

Canonical browser link activation from the actual weekly navigated Fang and Eve to their correct server documents, preserved the weekly referrer and correct canonical/title, exposed the real journal bodies and made no legacy public-room request. Physical pointer stability checks were unavailable in the background browser tab; actual DOM link activation exercised the same router/default navigation. All six home-view brand links passed. Legacy public detail/dream aliases return 404; no live owner impersonation or resident mutation was used.

Three public hosted images passed original PNG SHA/dimension checks and actual WebP negotiation: Eve home 2303463→238926 bytes, Eve dream 1879976→224018, Fang home 3818981→394646. Conditional 304, HEAD, private revalidation, Vary and cross-format validators passed. N2 source-link/UI acceptance is closed; automatic new-image conversion and ten-scene closure remain the next batch.
