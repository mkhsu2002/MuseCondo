# Tower asset storage

Implementation date: 2026-11-02. Hosted migration and deployment are pending independent release readback. This document describes the compatible reader and additive migration 0037; it does not authorize historical cleanup or backfill.

## Storage contract

`server/live/tower-asset-storage.ts` owns byte validation, room-scoped object preparation and revision-reference preparation. It grants no authority. Intake authenticates the household or scoped token before private reads, and enforces publication revision plus dream consent before public reads. Existing `/api/v1/tower/assets/:room/:revision/:purpose.png` and private preview URLs remain unchanged. There is no digest-addressed public endpoint.

- `tower_asset_objects` identifies an immutable object by `(room_id, digest)`, with byte size and chunk count. The digest is the SHA-256 of sanitized PNG bytes.
- `tower_asset_object_chunks` stores contiguous chunks of at most 512 KiB, keyed by `(room_id, digest, sequence)`. Home and dream references in the same room can reuse an identical object; different households never share object identity.
- `tower_asset_refs` maps `(room_id, revision, purpose)` to exactly one object digest or direct physical legacy revision, with expected byte digest and size. Legacy anchors point to `tower_asset_chunks` for the same room and purpose, never to another reference.
- `tower_asset_chunks` remains readable and retained. Migration 0037 only creates empty tables and guards; it performs no historical rewrite, deletion, conversion or backfill. Legacy fixtures inserted after migration are supported.

A reference takes precedence. Missing or corrupt referenced bytes fail closed; healthy same-revision legacy rows cannot mask a bad reference. Only an absent reference permits direct legacy fallback. Both representations verify contiguous sequence numbers, per-chunk bounds, total length, coherent metadata and the SHA-256 of reconstructed bytes. Dedup hits are read and verified before reuse, rather than trusted on an `ON CONFLICT` result.

## Atomic writes and races

Import statements create immutable objects, chunks and references in the same `db.batch` as the snapshot, account/token authorization guard, revision/source guards, current revision, request receipt and audit. Preparation performs reads only. An enclosing failure rolls everything back. Inserts racing for the same room/digest may reuse identical metadata/bytes; collision guards reject different metadata or bytes. Object and reference update/delete guards prevent replacement through `REPLACE` as well as normal mutation.

Text updates create references without inserting or copying BLOB rows. The first edit of a legacy revision anchors its physical bytes. Later edits preserve that direct anchor. The first-anchor batch also compares prevalidated physical chunk bytes, closing the read-to-write race; anchored legacy rows then reject insert/update/delete. These comparisons bind bounded hex strings and write no asset bytes. Selective source sync preserves only unselected purposes. Dream removal omits the new dream reference while retaining every historical object and revision.

Every write requires all storage tables and guards, checked before preparation and again inside the atomic batch. Missing storage schema fails closed. Public access continues to require the current public revision; a draft cannot replace a public asset, and revoked dream consent blocks the public dream asset immediately. Move-in completion uses the same verified resolver and compares actual fetched public bytes.

## Runtime bounds

Chunks remain at most 512 KiB and SQL statements stay small, with at most the storage-schema guard's parameter count (well below 100). Binary ArrayBuffer binds and BLOB reads support native D1 number arrays and local typed views without numeric coercion. Objects above 3 MiB use bounded hex reads; uploads whose aggregate sanitized bytes exceed 3 MiB use hex binds. This keeps the existing 12 MiB final-snapshot ceiling below the D1 32 MiB serialized RPC ceiling without splitting the transaction. Import, selective sync and dream replacement count both selected and retained image sizes before preparing the batch; storage upload preparation also rejects aggregate image bytes above this ceiling. Verified existing objects and duplicate purposes in the same preparation avoid rebinding chunk payloads.

The resolver deliberately validates bytes on reads rather than caching unverified metadata. Storage cleanup, global cross-household deduplication, public digest routes and route-capability gate changes are outside this phase.

## Release and rollback

Apply migration 0037 to development and production before deploying the compatible reader/writer, then cross-check complete deployed schema definitions, migration ledgers, exact deployed code and public/private behavior independently. Use only isolated synthetic data for write tests. No resident republish or historical backfill is required.

The additive migration alone remains compatible with the prior binary. **Once the new writer creates a refs-only revision, the old baseline binary cannot directly serve that revision's assets.** Rollback must retain a compatible reader, or roll forward to a fixed compatible build. Do not roll back to the old reader and assume legacy fallback can reconstruct refs-only revisions. Do not remove migration 0037 or delete immutable asset history during rollback.

Release evidence belongs in [hardening status](HARDENING-STATUS.md). Local tests and native synthetic runtime checks do not certify hosted rollout.
