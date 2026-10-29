# Cloudflare Pages 同源入住服務

目標：`https://musecondo.pages.dev` 的頁面與 `/api/v1/*` 使用同一來源，讓 HttpOnly cookie、CSRF 與住戶資料正常共享。這是部署規格與可測試適配器，不表示已完成雲端部署或真實 Meta 生成。

## 程式入口與組建

採 Pages Functions 標準模式：repo 根目錄的 `functions/[[path]].ts` 交由 Pages 打包，委派 `server/live/worker.ts`。沒有另外的 `_worker.js`，也不混用 advanced mode。不需要新增 runtime 套件。

- Framework preset：None。
- Build command：`npm run build`。
- Build output directory：`dist`。
- `MUSE_BASE_PATH=/`，不可沿用 GitHub Pages 的 `/MuseCondo/`。
- Node：24。
- Git 連接部署必須使用包含 `functions/` 的 source 分支。只把 `dist/` 當成純靜態檔拖曳上傳，不會得到這個 API。

`/move-in`、`/neighbors`、`/home/:id` 與內容子頁由 Functions 明確回傳 SPA 首頁（ASSETS 使用 pretty path `/`，不請求會重導的 `/index.html`）；`/api/*` 不得改寫成 HTML。其他檔案由 Pages 的 `ASSETS` binding 提供。

## 一次性的資料庫配置

先核實已授權的 Pages 專案與既有 D1 清單，只選擇本服務專用資料庫；如尚未建立資料庫，建立前須取得相應授權。本文件不提供臆造的 database ID。

1. 對確認的空白／正確版本資料庫依序套用 `0001_live_mvp.sql`、`0002_recovery_audit.sql`、`0003_provider_requests.sql`、`0004_agent_onboarding.sql`。不是每次啟動都執行 migration，不對已有資料重跑 CREATE TABLE。
2. Pages 專案 → Settings → Bindings → Add → D1 database，binding name 設成 **DB**，選擇該資料庫。
3. Preview 與 Production 分開設定，不能把測試註冊與正式資料混用。
4. 儲存 binding 後重新部署，使 Functions 收到它。

未綁定 DB、schema 不完整或 DB 查詢失敗時，API 回 **503 JSON**，不會假裝 sharedDatabase ready，也不會建立假住戶。

## 環境變數與秘密

| 名稱 | 類型 | 預設與用途 |
|---|---|---|
| `PUBLIC_ORIGIN` | runtime variable | 明確設為 `https://musecondo.pages.dev`，無結尾斜線；Preview 須使用自己的精確 origin |
| `REGISTRATION_ENABLED` | runtime variable | 缺省 false；只有字串 `true` 才允許註冊 |
| `META_PAID_CALLS_APPROVED` | runtime variable | 缺省 false；只有已授權預算與執行範圍時才可設為字串 `true` |
| `meta_muse_api` | **encrypted runtime secret** | 現有已授權 Meta key；只在服務端讀取，不放入 `VITE_*`、README、Git、命令列、回應或 log |

這份適配器不搬移、建立或讀出真實 secret。設定 secret 必須由具權限的操作者使用 Pages 的 Encrypt 功能；不能把「已設定 key」當成付費批准。

只有 secret 存在 **且** 獨立 paid-call gate 開啟時，才建立正式 Meta adapter。否則維持 disconnected。`/api/v1/status` 只回傳 secret 是否存在的布林值與配置狀態；**configured-not-health-verified 不等於模型連線已測通**。這個 gate 是啟用開關，不是金額上限計費器，有限預算仍需另行監控／限制，不能藉此宣稱已強制總花費上限。

此 repo 尚無正式 Wrangler config，以免未核實 ID 或 defaults 覆蓋 Dashboard。若未來轉用 Wrangler，先從已確認專案下載 config並審查，再把它作為配置來源；不將 secret寫入vars。若採本地 `.dev.vars`，先確認它被 `.gitignore` 排除；本輪不建立此檔。

## 驗收

`node --experimental-strip-types --test tests/pages-runtime.test.ts` 驗證 binding 缺漏、schema、同源拒絕、預設註冊／付費關閉、secret 布林診斷與 SPA fallback。這是隔離 SQLite／mock ASSETS 測試，不代表 Cloudflare D1 遠端或 Meta 生圖通過。

部署後另核對 `/api/v1/status` JSON、註冊與登入 cookie、跨瀏覽器持久化、私密圖片與撤回，以及 frontend deep links。未完成以上，不把靜態首頁成功當成服務全功能上線。

## 官方依據（核對 2026-10-29）

- [Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/)：檔案式路由及 catch-all。
- [Bindings](https://developers.cloudflare.com/pages/functions/bindings/)：D1、ASSETS 與 encrypted secrets。
- [Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)：`_worker.js` 是另一種模式，本案不混用。
- [Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)：Dashboard 與 config 來源管理。
