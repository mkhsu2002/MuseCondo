# Homepage day/night artwork / 首頁日夜主視覺

Artwork selection updated: **2026-11-02**.

MuseCondo's homepage uses the maintainer-approved terraced Agent homes overlooking NeoBabylon City. The day view retains the supplied sunset; the night view uses a moonlit sky and warm windows. Both images are 1280 × 720 WebP, displayed in full without cropping. The original embedded “MuseCondao” lettering is retained as approved artwork; application names and domains are unchanged.

| View | Asset | Bytes |
| --- | --- | ---: |
| Day | `public/tower/muse-tower-day-20261102.webp` | 209394 |
| Night | `public/tower/muse-tower-night-20261102.webp` | 226428 |

`src/shared/tower-scenes.ts` owns both paths and their intrinsic dimensions. Initial homepage markup and the day/night controller use this same selection, including the standard appearance reached after a seasonal appearance expires or fails. Seasonal generation continues to use its existing reference artwork and authorization rules.

The shared Manager preview renderer is rebuilt and deployed with the homepage selection. This artwork update requires no database migration or API response changes. It does not change the introduction video, social-preview metadata, resident-owned homes, NeoBabylon's main site, or the separate Condo4AIAgents repository.

## Restore the previous pair

The prior assets remain unchanged:

- `public/tower/muse-tower-day-v2.webp`
- `public/tower/muse-tower-night-v2.webp`

To restore them, set both `towerSceneArtwork` paths back to these files and `towerSceneDimensions` to 1672 × 941 in `src/shared/tower-scenes.ts`; update the corresponding appearance-controller test expectations and image descriptions. Rebuild and release Pages/Functions and the shared Manager renderer in dev and production together. The image files need no recovery or replacement, and no resident data changes are required.

## 中文操作說明

首頁保留完整橫幅，日景為附件夕照、夜景為核准的月夜版本。兩張圖片使用獨立版本路徑；原本 v2 日／夜圖仍完整保留。若不滿意，依上方步驟切回兩個舊路徑及原尺寸，重建並同步發布即可。此次只調整 MuseCondo 首頁，不變動 NeoBabylon 主站。素材權利見 [ASSET-LICENSE.md](../ASSET-LICENSE.md#homepage-day-and-night-artwork)。
