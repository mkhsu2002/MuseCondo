# Hosted home image delivery

Status as of 2026-11-03: ETag revalidation and optional private WebP delivery are implemented locally and have passed focused checks and independent review. Three approved WebP copies and their three manifests have been uploaded to the production private bucket and verified through official object readback. The new product Functions have not been deployed; live WebP delivery and performance acceptance remain pending.

## Observed production baseline

Public GET requests on 2026-11-03 found two directory residents, Eve and Fang. Their currently visible hosted images are original PNG files, without WebP/AVIF delivery variants. Fang's public dreams page did not expose a dream image during this check; private images were not probed.

| Image | Dimensions | Original bytes | Two observed TTFBs | Two observed complete downloads |
| --- | --- | ---: | --- | --- |
| Eve home, revision 2 | 1600 × 900 | 2,303,463 | 1.696 / 0.888 s | 2.012 / 1.238 s |
| Eve dream, revision 2 | 1024 × 1024 | 1,879,976 | 3.247 / 0.816 s | 3.526 / 1.005 s |
| Fang home, revision 6 | 2048 × 1152 | 3,818,981 | 1.215 / 1.297 s | 1.528 / 1.865 s |

These are a small local-network sample, not a performance percentile or SLA. All six responses were `200 image/png`, `Cache-Control: no-store`, and Cloudflare `BYPASS`. Repeat visits therefore transferred the complete image again. The server also reconstructed D1 chunks and verified the complete SHA-256 on each request. Immutable asset deduplication previously improved storage and editing; it did not compress visitor downloads.

The original request paths, dimensions, byte counts and timings are retained in private operational evidence.

## Current implementation

`server/live/tower-asset-delivery.ts` adds content-bound ETags and `private, no-cache, must-revalidate` to public hosted home/dream images. Browsers may retain bytes but must revalidate before reusing them. Shared/CDN freshness caching is not enabled.

The existing route checks the current public revision, snapshot consent and separate dream consent **before** evaluating any conditional request. Matching `If-None-Match` returns an empty `304` only after the immutable asset metadata, chunk order, length and digest bindings are checked. That path avoids reading the image BLOBs and transferring their bytes. A missing, withdrawn or superseded public asset returns `404` even when the request carries its previous ETag. A mismatching validator still reads, reconstructs and hashes the full original before returning `200`.

No schema migration, image regeneration, original-file replacement, publication-pointer update or source hash change is involved. Private previews retain their existing delivery policy.

Local validation: 44 focused delivery/storage/intake tests passed, including consent withdrawal with an old validator, malformed metadata, stale validators, weak validator comparison and HEAD behavior; TypeScript and targeted ESLint checks passed. Production behavior must still be checked after deployment.

## First-visit WebP delivery

ETags alone improve repeat visits. The additional delivery module now negotiates an optional WebP copy on the existing `.png` URL when the browser explicitly accepts `image/webp` with positive quality. All PNG, WebP and conditional responses include `Vary: Accept`; their ETags distinguish representations. Source manifests, hosted HTML, API paths and original PNG files remain unchanged.

A reviewed local batch uses the fixed `webp-q85-m6-v1` profile (`cwebp -q 85 -m 6 -metadata none`), without resizing or cropping:

| Image | WebP bytes | Reduction from original |
| --- | ---: | ---: |
| Eve home | 238,926 | 89.63% |
| Eve dream | 224,018 | 88.08% |
| Fang home | 394,646 | 89.67% |

All three original and converted images were visually inspected separately at their original dimensions. Character features, framing, room details and watercolor appearance were retained. The three approved WebP copies and their manifests are now stored privately in production. Every uploaded object was read back through the official storage API and matched its expected bytes and SHA-256; each binary was verified before its manifest was uploaded. All three original PNG hashes, byte lengths and dimensions were checked again after upload and remain unchanged. Existing production Functions do not yet read these copies, so this is storage preparation rather than verified live WebP delivery. Production resident artifacts were not copied into dev.

The implementation uses the existing private `MANAGER_ASSETS` R2 binding, adding neither a new paid Images service nor a migration. The optional `TowerIntakeEnvironment.derivativeBucket` receives that binding. Publication, current revision, snapshot consent and dream consent are checked before any derivative lookup. No private preview uses this negotiation path.

Each derivative uses a fixed, versioned private namespace scoped to its resident and original source digest. Its allowlisted manifest binds the format/profile version, resident identity, source SHA-256 and byte length, dimensions, output content type, expected storage identity, output SHA-256 and byte length. A manifest cannot redirect reads outside that exact identity. The source digest and size must match the immutable D1 asset metadata. Output digest, byte length, RIFF length and dimensions must all match. This profile accepts only a single static VP8 image without animation or embedded metadata. R2 size is checked before allocating its body: at most 4 KiB for a manifest and 2 MiB for an image, which must also be smaller than its PNG source. The bucket remains private.

An absent binding, missing copy, malformed manifest or corrupted image falls back to the original PNG with its full-byte integrity verification. Source revisions without a prepared copy continue to work. Derivative preparation is an operator batch task, capped at six images: fetch currently authorized source bytes, verify original hashes/dimensions, compress, inspect each pair, write the binary, read back and hash, then publish its manifest last. Never replace the PNG master or upload to a public bucket. Identical existing keys must be read back; conflicting objects must not be overwritten.

Local validation includes 50 focused tests covering content negotiation, explicit WebP refusal, format-specific validators, bounded reads, bad source/output metadata, original fallback, consent withdrawal and stale revisions with no R2 reads; independent review and local checks of the actual converted artifacts have also passed. Before marking this phase complete, deploy and verify both environments' code and binding, then check actual WebP content types/bytes/hashes, conditional requests, original PNG hashes, visual display and absence of direct public bucket access. Dev currently has no public resident homes: validate its empty public API and synthetic native cases without importing production resident data. Production requires hosted readback against the three prepared copies. Compare initial and conditional timings with the saved baseline; a passing build alone does not establish a speed improvement.

## Automatic delivery pipeline (local implementation; deployment pending)

The prepared three-image batch is a bootstrap, not the future operating model. Migration `0043_tower_image_optimization.sql` and the deployed-platform pipeline add event-driven WebP preparation for these display sources:

| Source | Authority before enqueue, claim and delivery | Event |
| --- | --- | --- |
| Hosted home main image | Current published snapshot/revision, snapshot consent and exact source SHA | Successful publication; an authorized first WebP read can fill a missed enqueue |
| Hosted dream image | The same checks plus separate dream-sharing consent | Successful publication; the same bounded first-read recovery |
| Tower scenes, collection wall and weekly scene | `tower_scenes.state='published'` and exact source SHA | Scene approval or completed automatic weekly scene publication |
| Active Tower appearance day/night | The canonical Manager public-state gate, active time window, approved presentation, generation and exact source SHA | Successful public appearance activation |

One scene derivative serves its wall card and any weekly issue that references that scene. Private proposals, operator previews, unshared dreams and original generation references are excluded. Jobs freeze the authorized source epoch when enqueued and recheck it at claim and completion; source or publication-epoch changes before completion cancel the result. Previously ready copies can be reused only after fresh current-source authorization and exact source-SHA matching.

The existing private Manager Workers receive an `IMAGES` binding in **both dev and production**. Pages Functions keep their existing `MANAGER_RUNTIME` service binding and R2 binding; no new public image transformer or bucket is exposed. The Images binding accepts verified raw source bytes from a protected Pages claim response. It never fetches an arbitrary supplied URL. Pages receives the output bytes, strips EXIF/XMP/ICC metadata, rejects animation or malformed containers, preserves alpha chunks, checks proportional scale-down dimensions and size savings, and writes a private content-addressed R2 object. A successful R2 readback precedes the immutable `ready` state. Original PNGs, admission hashes and the original Tower baseline remain unchanged.

`cf-webp-1920-q85-v1` uses WebP quality 85 within a 1920 × 1920 bounding box, `fit: scale-down`, and `anim: false`. It preserves aspect ratio, never crops and never enlarges a small source. This is distinct from the bootstrap's local `webp-q85-m6-v1` encoder profile. Input is limited to the existing 8 MiB source bound; output is at most 2 MiB and must be smaller. Sources at or below 256 KiB do not need a runtime conversion job.

The display route immediately uses a ready authorized copy. When conversion is incomplete, unavailable, invalid, over quota, or unsupported by the browser, it keeps the verified original PNG available. A first read may enqueue one missing durable job; it does not wait for conversion, repeatedly call the codec, introduce a placeholder, or run a polling loop. This is automatic smaller-format delivery with a reliable fallback, not a guarantee that every response is WebP.

### Persistence, quota and recovery

`tower_image_jobs` permanently binds the source kind/id/SHA/epoch and fixed profile. Its state machine is `pending → running → ready | rejected | unknown | cancelled`. Atomic native-clock reservations use **UTC billing days and months** (`strftime`), independently of the Tower community's PCT calendar, and prevent concurrent claims from exceeding daily/monthly limits. Terminal jobs, source bindings, reservations and append-only `tower_image_events` cannot be rewritten or deleted. Unknown outcomes and expired in-flight leases never automatically re-run the codec, even after withdrawal/regrant or a new publication epoch with the same source SHA/profile. Native claim guards also prevent a newer-epoch pending job from bypassing an older running/unknown job. A cancelled pre-conversion epoch can create a new authorized job; a ready copy can be reused across epochs after current authority is rechecked. Lowering runtime limits also constrains already-pending jobs; their historical higher limit snapshots cannot override a reduced current cap. Completion upload retries reuse the exact existing bytes; they do not create another transformation.

A separate actor in the existing Manager Durable Object namespace drains at most six jobs per wake. Publication/activation events wake that actor immediately. The existing daily Manager run can recover stranded pending work at most once per day; there is no new cron, CI polling or local automation. Operator backfill accepts at most six currently authorized source ids per request. R2 object keys include both the immutable job id and output SHA, so concurrent different completions cannot overwrite the winning artifact.

Deploy with `TOWER_IMAGE_OPTIMIZATION_ENABLED=true` and these explicit per-environment limits:

| Environment | `TOWER_IMAGE_DAILY_LIMIT` | `TOWER_IMAGE_MONTHLY_LIMIT` |
| --- | ---: | ---: |
| dev | 8 | 100 |
| production | 64 | 1000 |

The combined 1100 reserved transformations have a gross Images transformation price of at most **US$0.55/month** at US$0.50/1000, before any account-wide free allowance; this excludes existing Worker/R2 usage. Do not assume another project's account usage leaves a free balance. [Current Cloudflare pricing](https://developers.cloudflare.com/images/pricing/) lists 5000 free unique transformations per month, with Free-plan excess returning `9422` rather than charging, and Paid-plan excess at US$0.50/1000. [Images binding calls are billed per unique transformation](https://developers.cloudflare.com/images/optimization/binding/) and are not automatically cached. Persisting verified R2 output avoids repeated decoding and future-month re-encoding. No plan upgrade or paid purchase is part of this implementation.

### Static display assets and boundaries

The live homepage's existing day/night hero files are already WebP, measured at 209,394/226,428 bytes. The introduction poster now has a locally reviewed 1280 × 720 WebP at 209,292 bytes instead of the 316,161-byte JPEG (33.80% smaller); the shared video component and private preview renderer use the same WebP. The original JPEG remains available. The click-to-load player and its third-party privacy behavior are unchanged.

The 3,159,963-byte original Tower reference PNG remains exact, including its baseline SHA; it is a generation reference rather than a normal display image. Original prototype/example PNG downloads remain original files. This work does not claim that every public downloadable file has been converted.

### Release acceptance

Local tests include real SQLite state/authority/quota races and a synthetic native workerd path through protected Pages APIs, the Manager SQLite Durable Object, R2 and D1. The native codec itself is an explicit local stub: those tests prove the deployed routing/state boundaries, not the real Images service's visual output or billable account behavior. Before completion, apply 0043 and deploy matching Pages/Workers/bindings to both environments; read back deployed schema/code/bindings, then use a bounded real Images smoke test and inspect its actual output. Verify public WebP bytes, PNG fallback/original hashes, active-appearance expiry/epoch checks, metadata stripping/alpha, one reservation/audit per job and no duplicate transform after replay. Empty dev resident data must remain an explicitly empty acceptance scope rather than a claim of real-home validation.


### Dev-only real-codec smoke

After dev code, 0043/0044 and Worker binding readback, an authenticated operator can POST `{}` to `/api/v1/operator/images/smoke`. Pages forwards the request through `MANAGER_RUNTIME`, adding its deployment-held trigger credential; the local operator never reads or supplies that trigger or any provider secret. Both Pages and the Worker inspect their configured environment origin, not a caller `Origin` header. Production returns exact 404.

The existing Manager DO namespace uses one isolated `image-codec-smoke-v1` actor. It permanently claims one fixed transparent 3 × 3 synthetic PNG/profile before dispatch, records the one-off **500 micro-USD gross** reservation, then saves output SHA/size/dimensions/alpha/metadata result and tiny output bytes in the durable receipt. It creates no resident, D1 source row, R2 object, service or cron. Concurrent/replayed calls only read the receipt; an ambiguous dispatch cannot retry. This one-off dev diagnostic is separate from the ordinary 1100/month job cap and adds at most US$0.0005 gross. Missing binding fails before claiming. A completed receipt is historical evidence; replay does not claim another fresh transformation.

Scene projections and shared wall/weekly markup now use the stable `?display=webp-v1` contract to bypass historical immutable PNG cache entries. Both new PNG and WebP responses include `Vary: Accept`, representation-specific ETags and mandatory private revalidation. Original `.png` URLs and explicit PNG responses remain available with unchanged source bytes. No timestamps or global cache purge are used.
