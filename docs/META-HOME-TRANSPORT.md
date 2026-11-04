[English](META-HOME-TRANSPORT.md) · [繁體中文](META-HOME-TRANSPORT.zh-TW.md)

# Meta Home transport: implemented, not yet connected at this historical stage

> Historical transport reference. Its fixed-palette pipeline and pending connection status describe the original scope, not today's production status or the newer free-scene framework contract. See [META-API](META-API.md) and [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md). This translation does not advance verification dates.

Official-contract review date: 2026-10-29.

- [Meta overview](https://dev.meta.ai/docs/overview): text model `muse-spark-1.3` and image model `muse-image-1.0`.
- [Image generation guide](https://dev.meta.ai/docs/image-generation): generation, image editing, base64 responses and different compositions of the same image.
- [Images schema](https://dev.meta.ai/docs/api-reference/images/schemas): JSON edits `images[].image_url`, `size` as an aspect ratio rather than guaranteed pixel dimensions, `output_format` and tool enablement.
- [Responses API](https://dev.meta.ai/docs/protocols/responses): text-reasoning responses and `store:false`.

`server/live/meta-home.ts` is a real HTTP adapter, not a stub returning successful demo images. In this implementation, `server/live/worker.ts` instantiates it when an encrypted secret exists and `META_PAID_CALLS_APPROVED` is the string `true`; otherwise it remains disconnected. The local runner stays in isolated development mode.

Deployers accept configuration and health checks separately for each environment. Secret presence, a readable local model catalog or adapter integration cannot replace real production generation/persistence acceptance. Private inputs and secrets must not be disclosed publicly.

## Three stages

1. Responses: classify a minimized personality summary into closed palette, atmosphere and furnishing enums. Disable tools; return no free text such as names; use `store:false`.
2. Images generations: assemble those enums into a versioned prompt and generate a 16:9 PNG.
3. Images edits: reference the newly generated room PNG as a data URL and compose 9:16 without redesigning the interior.

Image requests explicitly disable web search, image search and shell. They accept base64 bytes only, never reading provider-returned external URLs. Invalid types, sizes, PNG chunks/CRC/structure, zlib scanline decompression/filters or ratios stop processing before requesting the mobile view. This does not establish visual-consistency QA; actual-service verification remains necessary.

## Uncertain requests and records

After `0003_provider_requests.sql`, `databaseJournal` inserts a unique `(provider_key,stage)` before each request. Every claim rechecks that the original job is still running and analysis consent remains valid. Records contain no API key, original personality input or prompt.

`received` means only that HTTP JSON arrived, not that the image passed review. Neither `started` nor `unknown` may be automatically resent. A response with only a provider request header is recorded as provider-request; without one, it explicitly uses client-request identity. **A local ID is never misrepresented as a provider generation ID.**

Operators can inspect a job's client/provider request IDs and timestamps offline using `inspectMetaRequests(db, jobId)`, without original text or keys.

The official documentation reviewed did not provide retrieval by a local request key or an idempotent-billing guarantee. Accordingly, this implementation invents neither a retrieve endpoint nor an unsupported idempotency promise. Unknown outcomes require human investigation; see [safe closure](RECOVERY.md). The initial version does not automatically resume partial stages or regenerate images.

## Activation requirements

Production deployment approval, an existing authorized API key, explicit spending budget, verified D1 bindings/migrations and visual end-to-end acceptance are required. `approvedPaidCalls` is a deployer-supplied authorization gate, not a price calculator or automatic budget tracker. Without approval or a key, there are zero network calls.

At this documented stage, validation consists only of mock HTTP plus a real SQLite journal contract; no real Meta request was sent. Subsequent production connection still requires cost limits, private-asset retention policy and human provider reconciliation.
