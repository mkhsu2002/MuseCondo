# English homepage: staged review and safe cutover

Status: candidate implementation, 2026-10-31; based on `c451125` (v0.80). The user has explicitly authorized English homepage delivery now while retaining the existing Halloween appearance. The previous recommendation to wait for seasonal expiry is superseded. This file records the English homepage increment of [E01–E03/E07](NEXT-TASKS-2026-10-31.md); it does not claim completion of the whole-site migration or a production release.

## Implemented candidate scope

- `src/shared/lobby-messages.ts`: typed English catalog and UTC `Intl` date presentation. English is explicit; no browser-language override or incomplete language switch.
- `src/shared/lobby-markup.ts`, `src/shared/tower-scenes.ts`, `src/community/notices.json`: homepage, common navigation/footer, guide, covenant, noticeboard, empty/feed states and day/night controls.
- Homepage branches in `src/live.ts` and `src/main.ts`, plus `src/live/tower-appearance.ts`: loading, unavailable/retry and view-change announcements. Public failures show fixed product copy rather than raw internal errors. Historical demo chrome is English; fictional resident content is retained.
- `index.html`: English title/description, language, skip link and no-JS text. Untranslated SPA routes retain their body language, while shared English chrome declares its own language.
- `scripts/generate-lobby-css.mjs`: the catalog, including its date formatter, participates in the reviewed renderer digest. Production markup/CSS and masked private-preview markup remain shared.
- The backend workstream owns the private renderer's `lang="en"` update and append-only new-build review. Its final source must be integrated before generating the single candidate/final digest.

Resident names, posts, dreams, wishes, original images and home bytes are unchanged. The frozen condo renderer/verifier, API contracts, identity and credential records are outside this change. Reception, sign-in/maintenance, directory, activities, identity/recovery and remaining documentation are not fully translated by this increment.

## Required release order

1. Deploy the backend review lane with the **complete old public Chinese markup and old renderer digest**. Confirm the existing Halloween presentation remains active. Do not cherry-pick the English digest inputs into this stage.
2. Freeze the complete English candidate: shared markup/catalog/notices/CSS/index plus the backend renderer source and generated digest. Deploy the candidate Manager Worker; keep the public Pages UI on the reviewed old build.
3. Through the new append-only lane, reuse the exact existing manifest and original two images. Obtain four actual day/night × desktop/mobile screenshots, new-build verification, independent review and self-review. Preserve the original completion, receipts and accumulated cost. No image generation or reuse of an old-build PASS is implied.
4. Only after actual successful candidate review, publish matching English Pages/Functions with the **exact candidate digest**. The backend's matching activation switches the accepted presentation to the new review. No public-copy edits after freezing without fresh review.
5. Read back dev and production separately: deployed code, schema/bindings, active digest, public presentation and real browser behavior. If review, budget, authority window or deployment consistency fails, retain the old reviewed public build and record the blocker. Never bypass the digest guard or reopen the old completed extension through undispatched recovery.

## Release acceptance still required

- [ ] Root integration uses one frozen English digest across candidate Worker and final Pages; existing artifacts/receipts and original image hashes remain intact.
- [ ] Real candidate screenshots, independent review, self-review and atomic public cutover succeed through the deployed manager; local tests do not prove them.
- [ ] Desktop/mobile: English fits without overflow; branding, focus, cards and text remain readable in day/night and standard/seasonal appearance. All navigation, retry controls and SPA cleanup work.
- [ ] Framework-owned homepage copy, SEO, ARIA and alt text are English across success/loading/empty/failure states. Original resident-authored languages remain intact and safely escaped; public errors expose no internal details.
- [ ] Catalog-only changes alter the digest; stale-build screenshots fail closed. Candidate/private preview and public layout/CSS/language agree.
- [ ] Existing condo verification, URLs, resident permissions and data still pass; no language-triggered mail resend, identity reissue or image call.
- [ ] Update current-state roadmap and release evidence using actual observed results, without changing historical verification dates or claiming linked routes are fully English.
