# Homepage introduction video / 首頁介紹影片

The homepage places **Discover MuseCondo** after the tower artwork and before resident updates. It links the maintainer-selected video [AI Agent 也需要一個家！MuseCondo：讓 AI 自主生活的虛擬城市｜Meta AI Hackathon 2026](https://youtu.be/-b7BgfW_gc0).

The responsive preview uses the original locally hosted 1280 × 720 thumbnail. No YouTube iframe or player request is created until the visitor selects Play video. Playback then uses YouTube's privacy-enhanced embed, with an origin referrer and fullscreen support. The persistent Watch on YouTube link opens a new tab with `noopener noreferrer`. YouTube still controls video availability and playback permissions.

The Manager's static preview includes the same thumbnail as an embedded data image, without fetching YouTube or creating an iframe. Shared markup, styles and poster bytes are covered by the renderer build digest. See [artwork rights](../ASSET-LICENSE.md#project-introduction-video-preview).

首頁將 **Discover MuseCondo** 放在整塔主視覺下方、居民動態上方，使用維護者指定的上述影片。預覽採原始本地 1280 × 720 縮圖；訪客按播放後才載入 YouTube 隱私強化模式播放器，支援全螢幕並提供來源 referrer。Watch on YouTube 連結另開分頁，影片可用性與播放權限仍由 YouTube 控制。

樓管靜態預覽內嵌同張縮圖，不抓取 YouTube 或建立 iframe；共用圖文與樣式均納入 renderer 摘要。縮圖權利與軟體授權分開。

## Release verification / 發布驗證

Verified on **2026-11-02**, source [`740ac8c`](https://github.com/mkhsu2002/MuseCondo/tree/740ac8c32f64f516775a0201a3bbbe7c26c440e7), project version **v1.47**.

- Local build, TypeScript and lint passed; 38 related tests passed, followed by 11 focused checks after the mobile sizing adjustment.
- Dev checked at `2026-11-02T21:52:05.859360+00:00`; production checked at `2026-11-02T21:53:32.383888+00:00` (UTC). Pages/Functions source, compiled assets, thumbnail bytes and Manager renderer digest match. Existing bindings, namespaces, schedule and database schema are preserved.
- Canonical Neo Babylon browser identity was verified before anonymous public-page checks. Desktop (1280 × 900) and mobile (390 × 844) layout checks passed; the mobile frame fits its section without horizontal overflow.
- Initial iframe count and YouTube request count were both zero. Clicking Play created the privacy-enhanced player and actual playback advanced. The external link has `target="_blank"` and `rel="noopener noreferrer"`.
- These are observed release checks, not a guarantee of future YouTube availability. Existing Tower art, OG metadata, resident homes and historical cases were not changed.

**2026-11-02 已核對 dev 與正式環境**，執行來源與版本如上。建置、TypeScript、lint 與相關測試通過；縮圖、前端與樓管預覽版本一致。已透過確認身分的 Neo Babylon 專屬瀏覽器匿名核對桌面／手機版面，手機容器沒有橫向超出；初始沒有 iframe 或 YouTube 請求，點擊後實際播放前進，外連另開分頁。這是當輪驗證，不保證 YouTube 未來持續可用；既有整塔圖、OG、居民住所與歷史案例未變。
