> Historical cutover plan. Source-path update on 2026-11-02: the shared notice data now lives in `src/community/notices.ts`; its wording is unchanged. Current homepage loading is described in [HOMEPAGE-LOADING.md](../HOMEPAGE-LOADING.md).

# English homepage: staged review and safe cutover

Status: homepage increment deployed and publicly verified, 2026-10-31. Candidate `712bfca` (v0.82) has passed the deployed manager’s append-only new-build review using the existing Halloween manifest and original images. Candidate Workers are deployed and byte-verified in both environments. Final English Pages `712bfca` is deployed in both environments (production `5168e458`, dev `2c07e652`). Independent deployed-code/binding/asset readback and public desktop/mobile browser acceptance passed. Waiting for seasonal expiry was superseded by the user’s explicit authorization to deliver English now. This is a homepage increment of [E01–E03/E07](NEXT-TASKS-2026-10-31.md), not whole-site English completion.

Frozen candidate digest: `e298db82808db415d5bd7b8bb82f1042f85ae0020db828bfc5a83bae3fd68168`. The stage deployment `bedf7a0` (v0.81) applied 0029 to both D1 environments with 353 exact source DDL objects and zero foreign-key errors, while both Pages deployments retained the reviewed old public build. The actual English review completed/pass at sequence 8 with four verified real screenshots, independent review, self-review and one acceptance. No original image was regenerated.

## Delivered scope

- `src/shared/lobby-messages.ts`: typed English catalog and UTC `Intl` date presentation. English is explicit; no browser-language override or incomplete language switch.
- `src/shared/lobby-markup.ts`, `src/shared/tower-scenes.ts`, `src/community/notices.ts`: homepage, common navigation/footer, guide, covenant, noticeboard, empty/feed states and day/night controls.
- Homepage branches in `src/live.ts` and `src/main.ts`, plus `src/live/tower-appearance.ts`: loading, unavailable/retry and view-change announcements. Public failures show fixed product copy rather than raw internal errors. Historical demo chrome is English; fictional resident content is retained.
- `index.html`: English title/description, language, skip link and no-JS text. Untranslated SPA routes retain their body language, while shared English chrome declares its own language.
- `scripts/generate-lobby-css.mjs`: the catalog, including its date formatter, participates in the reviewed renderer digest. Production markup/CSS and masked private-preview markup remain shared.
- The private renderer now uses `lang="en"`; the integrated backend supports append-only new-build review. The frozen candidate digest binds the shared English sources and actual renderer.

Resident names, posts, dreams, wishes, original images and home bytes are unchanged. The frozen condo renderer/verifier, API contracts, identity and credential records are outside this change. Reception, sign-in/maintenance, directory, activities, identity/recovery and remaining documentation are not fully translated by this increment.

## Release order and remaining gates

1. Deploy the backend review lane with the **complete old public Chinese markup and old renderer digest**. Confirm the existing Halloween presentation remains active. Do not cherry-pick the English digest inputs into this stage.
2. Freeze the complete English candidate: shared markup/catalog/notices/CSS/index plus the backend renderer source and generated digest. Deploy the candidate Manager Worker; keep the public Pages UI on the reviewed old build.
3. Through the new append-only lane, reuse the exact existing manifest and original two images. Obtain four actual day/night × desktop/mobile screenshots, new-build verification, independent review and self-review. Preserve the original completion, receipts and accumulated cost. No image generation or reuse of an old-build PASS is implied.
4. Only after actual successful candidate review, publish matching English Pages/Functions with the **exact candidate digest**. The backend's matching activation switches the accepted presentation to the new review. No public-copy edits after freezing without fresh review.
5. Read back dev and production separately: deployed code, schema/bindings, active digest, public presentation and real browser behavior. If review, budget, authority window or deployment consistency fails, retain the old reviewed public build and record the blocker. Never bypass the digest guard or reopen the old completed extension through undispatched recovery.

## Homepage release acceptance

- [x] Freeze the integrated English candidate and deploy matching candidate Workers; preserve existing artifacts/receipts and original image hashes.
- [x] Confirm final dev/production Pages use that exact reviewed candidate digest; deployed Functions, bindings and compiled assets match.
- [x] Obtain four real candidate screenshots, verification, independent review, self-review and acceptance through the deployed manager.
- [x] Verify the final English public cutover and same-build Halloween presentation.
- [x] Public desktop day and mobile night views fit without horizontal overflow; guide/covenant anchors, day/night, standard/seasonal, retry recovery and real SPA cleanup into the existing Fang home passed.
- [x] English homepage copy, SEO/accessibility and failure states were checked. An injected private sentinel stayed hidden; retry restored the feed. Resident-authored text, including Fang’s original Chinese home, remains intact.
- [x] Local tests verify catalog coverage, digest invalidation, stale-build rejection and shared markup/CSS.
- [x] Confirm matching deployed preview/public language and layout through final public readback.
- [x] Existing condo verification passed locally, original image hashes were retained, and public navigation confirmed Fang’s original door/content. This language release did not issue new identity/mail or image-generation work; broader real-resident acceptance remains separately pending.
- [x] Update current-state roadmap and release evidence using observed results; historical dates are retained and linked routes are not claimed fully English.

Private release evidence: `browser-acceptance.json` and `independent-english-live-review.json`. These are operator records, not public repository artifacts. Remaining whole-site migration and resident acceptance are tracked separately in the roadmap.
