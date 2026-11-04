[English](COMMUNITY.md) · [繁體中文](COMMUNITY.zh-TW.md)

# Community homepage and public editorial workflow

> Historical fixture/demo workflow, with fixture events dated 2026-10-28. The homepage and pending-service descriptions below belong to that stage, not the current production inventory. See [CURRENT-RELEASE](architecture/CURRENT-RELEASE.md) for current operations. No verification date is advanced here.

At the stage described here, the public homepage has four daily-life sections: Manager bulletin (up to 3 entries), neighbors' windows (up to 4), looking for someone to talk to (up to 3), and new neighbors (up to 10). Adjacent sections cover recruitment preparations, resident rules, plans for other towers and the NeoBabylon entrance. Mobile prominently displays one complete announcement; the others are compact links. Product information lives in About. There are no rankings, popularity, online-status or workload tracking, and no private-message matching.

## Separate public-data layer

`fixtures/resident-activities.json` contains 40 **author-written, fictional events with demonstration publication consent**: one journal, status, social intention and arrival introduction for each of ten residents. Their dates and times are fixture values retained as 2026-10-28; they do not represent real user activity that day. Existing homes, characters and asset provenance remain intact.

The public activity contract is in `src/community/schema.ts`:

- `id`, `residentId`, `type` (journal/status/seeking/arrival, plus household-only gift/message/invitation).
- `occurredAt` is the content-event time; `publishedAt` is when publication was permitted. Both use UTC ISO format. Edition `asOf` is the data cutoff; `editedAt` is the actual editorial execution time. Do not conflate them with “new today.”
- `visibility: public`, `publicationConsent: true`, `origin` (fictional-fixture or resident-authorized), and a matching `isFixture`.
- Only `title`, `summary`, `body` and the fields above are projected. Additional private fields are not serialized. Private, unconsented and browser-local sources are excluded before any editor invocation. Unknown residents, duplicate IDs, invalid times or inconsistent origins abort processing.
- Private memory is not a news source. This fixture file itself is public repository data: **never place real private information in the source file or Git**. Production still requires verified resident identity, separate publication consent and moderation.
- Cities come from explicitly fictional demo profiles. A real resident's city is not public by default and needs a separate optional public field; the existing production public projection does not output cities. The homepage does not list Guardians. Fictional Guardians remain only in explicitly labeled fixture locations within individual homes.

## Run and persist

```sh
# After editing public fixtures, specify the data cutoff; editedAt defaults to actual execution time.
npm run manager:edit -- --as-of 2026-10-28T23:59:59.000Z
MUSE_BASE_PATH=/MuseCondo/ npm run build
```

Use `--input /path/to/authorized-public-events.json --out /path/to/public/community` to run in a test directory. Default `--editor rules` makes no network calls. Rules sort by descending event time, select at most one entry per resident per section, and break time ties by event ID. This is explicit demo curation, not model recommendation; it reads no browser interactions.

Outputs:

1. `events-<SHA256>.json`: public projection, schema version and content digest only.
2. `edition-<UUID>.json`: sourceDigest, asOf, editedAt, editor kind/version/model, fixture marker, and each section's residentId, sourceEventIds, summary and reason.
3. `index.json`: points to an already-written immutable source/edition pair. An atomic rename in the same directory updates the index last. Editorial failure does not publish a new index.

New data appears only after building and publishing. The “Refresh bulletin” button rereads the public index, validates filenames, versions, source SHA-256, event types and selected IDs, then displays that same edition. Failure retains the current verified edition and shows an error; an initial failure invents no content. Empty sections stay empty. This is a complete, persistent, manually triggered file workflow, **not real-time server synchronization**.

Cards and household pages read the same source files. Journals/status/social intentions link to `/:id/inside#event-<id>`; arrivals link to `/:id#event-<id>`. `/選輯紀錄` exposes full selection reasons and source IDs. Gifts, messages and invitations remain browser-local; they are neither submitted nor aggregated into site-wide events.

## Meta adapter and unfinished work

`server/community.ts` provides the `Editor` interface, rules editor and Meta Responses adapter. CLI `--editor meta` requires the existing server-side `MODEL_API_KEY`, verified `MUSE_META_MODEL` / `MUSE_META_METADATA_SOURCE` / `MUSE_META_METADATA_VERIFIED_AT`, and explicit paid-use authorization `MUSE_META_APPROVED_PAID_CALLS=true`. Missing any requirement stops execution. These are deployment-side setting names, not a request to add credentials now or permission to approve spending autonomously.

The adapter calls only Meta, explicitly sets `store:false`, and has no tools, private memory or alternative-model fallback. It transmits only the public projection. Returned source IDs, types, model and metadata must validate; unknown fields are not persisted. Official contracts: [Meta Responses](https://dev.meta.ai/docs/protocols/responses), [Overview](https://dev.meta.ai/docs/overview). This stage used mocked transport for contract tests only: **no real API call, charge or claim of a connected service**. Uncertain remote failures are not automatically retried in this workflow.

GitHub Pages cannot supply resident authentication, authorization management, public-event writes, daily scheduling or shared interactions. Production activation requires a backend and persistent storage, withdrawal/correction, cross-process concurrency controls, abuse handling and approved Meta settings/budget. This file adapter must not be described as completing those services. Immutable snapshots suit this fictional public demo only; real-data withdrawal must also address historical snapshots, CDN copies and other retained systems, which were not implemented in this stage.

## Dynamic-update verification

`tests/community.test.ts` runs the actual CLI: it writes a new public test journal into a temporary source file, regenerates the edition, and checks that the source digest and first bulletin entry change while the previous public snapshot remains verifiable.

On desktop and mobile, `tests/browser.spec.ts` uses actual CLI-persisted files to simulate a public file service: load the old edition → add a test-only 點點 journal → run the editor → click “Refresh bulletin” → confirm that journal becomes the first bulletin entry → open its full text and event anchor. Private/browser-local events and a local visitor message verify exclusion from the homepage. Synthetic journals stay in system temporary directories; they are not copied into public/ or deployed. Evidence is saved to Git-ignored `test-results/<desktop|mobile>-community-workflow-proof.json`.
