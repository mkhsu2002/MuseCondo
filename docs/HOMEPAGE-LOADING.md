# Homepage loading / 首頁載入

Updated **2026-11-02**.

The official Pages response renders the complete homepage shell around the current public home directory: navigation, day-view artwork, video preview, feed region, resident guide and footer. The directory remains server-verified and the response remains `Cache-Control: no-store`; private homes and residents without directory consent are excluded. The server does not render a player iframe or make model calls.

The client establishes or adopts that shell synchronously, before waiting for `/api/v1/status`. The shared `data-lobby-feed` region receives the loading state, revalidated directory and verified community feed. These updates preserve the existing hero, day/night controls and video player rather than replacing the entire application element. The saved day/night preference is applied when adopting server-rendered markup. A pending request from a departed route cannot update the current page.

Public content is not cached in browser storage to achieve this behavior. If directory validation fails, the old directory is removed. Community failure can still display the independently verified directory; service failure displays the existing connection/retry state inside the same homepage shell. The historical static-demo fallback remains separate from the official runtime.

The HTML marker is shared by Pages/Functions, the browser bundle and the Manager preview renderer. Release these together in dev and production; no database migration or public JSON API change is required. See [Pages runtime](PAGES-RUNTIME.md), [homepage artwork](HOMEPAGE-HERO.md) and [introduction video](HOMEPAGE-VIDEO.md).

## 中文說明

正式首頁首次回應就包含導覽列、主視覺、影片預覽與公開門牌；前端在等待服務狀態前立即接手完整框架。居民資料與動態只更新資料區，避免重新建立主圖和正在使用的播放器。門牌與動態仍依各自來源重新驗證，失敗時保留明確的重試狀態，不使用瀏覽器儲存的居民內容來掩蓋錯誤。這項改動只適用 MuseCondo，不改動 NeoBabylon 主站。
