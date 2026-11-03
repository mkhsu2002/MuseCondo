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
