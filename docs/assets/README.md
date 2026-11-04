# Presentation artwork

`muse-tower-cover.webp`, `first-neobabylon-agent-id.jpg`, `fang-home-showcase.jpg`, `fang-home-dreams-identity-overview.webp`, `tower-lord-full-handover.jpg`, `beyond-a-home-digital-life.jpg` and `musecondo-digital-world.jpg` are user-provided project presentation images. They are excluded from the Apache software license; rights remain with the respective rights holders. Publishing these illustrations does not grant an additional artwork license or claim third-party rights.

The identity-card illustration is an MVP demonstration. Its verification QR is not an account-access or recovery credential.

## Technical diagrams

`tower-manager-architecture.svg` is an original technical documentation diagram used by both READMEs. It is covered by the repository's Apache 2.0 technical-documentation license; it is separate from the presentation artwork listed above. The detailed component and authority descriptions are maintained in [ARCHITECTURE.md](../../ARCHITECTURE.md).

## README cover and social image — 2026-11-02

Both READMEs use the restored original full-tower artwork in `muse-tower-cover.webp`. The landscape artwork remains the social preview at `public/og/muse-condo-share-20261102.jpg` (1280 × 720); its image and metadata are unchanged by the README restoration.

中英文 README 已恢復使用 `muse-tower-cover.webp` 的原始整塔圖。橫向圖片繼續作為社群分享預覽，位於 `public/og/muse-condo-share-20261102.jpg`（1280 × 720）；本次恢復 README 主圖不變更 OG 圖片或中繼資料。

## Image delivery — 2026-11-02

The two README illustrations use WebP at their existing dimensions: `muse-tower-cover.webp` (1086 × 1448) and `fang-home-dreams-identity-overview.webp` (1672 × 940). Their composition and subject matter are unchanged. The three JPEG illustrations now have `.jpg` extensions matching their encoded format: `fang-home-showcase.jpg`, `beyond-a-home-digital-life.jpg`, and `musecondo-digital-world.jpg`. Existing artwork rights continue to apply to these delivery versions.

Runtime optimization remains a separate follow-up: the 37 images in `public/prototype-assets/` still use PNG. Convert them in batches of at most six, review each batch, and update application references, provenance digests, license paths and relevant tests together. The standalone generator and generation tests validate PNG input; keep their PNG fixtures and the fixed `home.png` / `dream.png` example contract until a compatible change is implemented and verified. Historical evidence screenshots remain unchanged. The Tower scenes already use WebP; social previews retain JPEG.

The homepage now selects the approved 1280 × 720 day/night pair with the `20261102` filename suffix. The previous `v2` images are retained for rollback. See [homepage artwork and restoration](../HOMEPAGE-HERO.md) for exact paths, dimensions and the shared renderer release requirements. This selection does not replace the README cover or NeoBabylon's main-site artwork.

## Presentation download

The maintainer-supplied hackathon presentation is stored unchanged at [`../downloads/MuseCondo_Meta_Hackathon_2026.pptx`](../downloads/MuseCondo_Meta_Hackathon_2026.pptx). Both READMEs offer one download link and a separate introduction-video link; slides are not embedded into the README. The presentation is outside `public/`, so it is not copied into the website build. Its separate rights notice is in [ASSET-LICENSE.md](../../ASSET-LICENSE.md).

## Current introduction-video thumbnail

The homepage uses `public/media/musecondo-introduction-qb-fyaymkFg.jpg` for the maintainer-selected video `qb-fyaymkFg`. The older `public/media/musecondo-introduction.jpg` is retained as historical artwork and is no longer selected by the homepage or shared renderer. See [homepage video](../HOMEPAGE-VIDEO.md).

## AI perspective covers

The first supplied set maps to Muse (Meta), Grok and Gemini. Articles use complete uncropped WebP covers in `public/media/perspective-*-home-20261103.webp` and matching JPEG social images in `public/og/perspective-*-home-20261103.jpg`; explicit dimensions preserve space during loading. See [content/artwork records](../architecture/PROJECT-PERSPECTIVES.md#supplied-artwork-and-question--2026-11-03) and the separate artwork rights notice. The second supplied set adds ChatGPT and Claude; all five article covers and social images are now supplied.
