# Hosted home image delivery

Status: implemented locally on 2026-11-03; deployment and hosted revalidation readback are pending. This document does not assert that all image optimization is complete.

## Observed production baseline

Public GET requests on 2026-11-03 found two directory residents, Eve and Fang. Their currently visible hosted images are original PNG files, without WebP/AVIF delivery variants. Fang's public dreams page did not expose a dream image during this check; private images were not probed.

| Image | Dimensions | Original bytes | Two observed TTFBs | Two observed complete downloads |
| --- | --- | ---: | --- | --- |
| Eve home, revision 2 | 1600 × 900 | 2,303,463 | 1.696 / 0.888 s | 2.012 / 1.238 s |
| Eve dream, revision 2 | 1024 × 1024 | 1,879,976 | 3.247 / 0.816 s | 3.526 / 1.005 s |
| Fang home, revision 6 | 2048 × 1152 | 3,818,981 | 1.215 / 1.297 s | 1.528 / 1.865 s |

These are a small local-network sample, not a performance percentile or SLA. All six responses were `200 image/png`, `Cache-Control: no-store`, and Cloudflare `BYPASS`. Repeat visits therefore transferred the complete image again. The server also reconstructed D1 chunks and verified the complete SHA-256 on each request. Immutable asset deduplication previously improved storage and editing; it did not compress visitor downloads.

The private deployment evidence stores request paths, dimensions, byte counts and timings in `home-image-delivery-before.json`. It contains no provider credentials.

## Current implementation

`server/live/tower-asset-delivery.ts` adds content-bound ETags and `private, no-cache, must-revalidate` to public hosted home/dream images. Browsers may retain bytes but must revalidate before reusing them. Shared/CDN freshness caching is not enabled.

The existing route checks the current public revision, snapshot consent and separate dream consent **before** evaluating any conditional request. Matching `If-None-Match` returns an empty `304` only after the immutable asset metadata, chunk order, length and digest bindings are checked. That path avoids reading the image BLOBs and transferring their bytes. A missing, withdrawn or superseded public asset returns `404` even when the request carries its previous ETag. A mismatching validator still reads, reconstructs and hashes the full original before returning `200`.

No schema migration, image regeneration, original-file replacement, publication-pointer update or source hash change is involved. Private previews retain their existing delivery policy.

Local validation: 44 focused delivery/storage/intake tests passed, including consent withdrawal with an old validator, malformed metadata, stale validators, weak validator comparison and HEAD behavior; TypeScript and targeted ESLint checks passed. Production behavior must still be checked after deployment.

## Remaining first-visit improvement

The first request still downloads the full PNG. ETags improve repeat visits, not this initial payload.

A same-dimension local WebP quality-85 experiment produced Eve's home at 246,394 bytes (89.3% smaller) and dream at 233,858 bytes (87.6% smaller). These are feasibility measurements only: the experimental files are not deployed, have not been accepted as production derivatives and do not replace original art.

The next delivery phase should use the deployed platform's [Images binding](https://developers.cloudflare.com/images/optimization/binding/) to transform private image bytes into bounded WebP variants, while retaining the PNG master and its digest. The repository currently has no `IMAGES` binding. Both dev and production bindings, deployed code and live behavior must therefore be updated and verified together. Every request must still authorize the current publication before consulting any derivative cache. Cache keys must bind room, source digest, variant and encoder version; originals remain unchanged. Transformation failure must fall back to the verified PNG. A public transformation URL that bypasses withdrawal checks is unsuitable.

Before marking that phase complete, verify actual WebP content types/byte savings, visual quality, mobile sizing, missing-binding fallback, consent withdrawal, revision changes and absence of public access to private derivatives. Compare initial and conditional request timings with the saved baseline; do not infer a speed improvement solely from a passing build.
