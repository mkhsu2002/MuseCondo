# MuseCondo 開發交接

狀態更新：2026-10-29。本文描述本輪 framework `0.01` 原始碼；取代早期「契約待定義、獨立建窩待實作、住戶僅兩頁」的交接基線。不能從本文件推定已合併至 `main`、已完成雲端發布或真實 Muse／付費生成驗收。最終測試數字與部署證據由本輪發布紀錄另行補入。

## 現行架構

MuseCondo 同時提供 standalone 靜態建置與持久化 Tower。兩者共用 `src/framework/` 的嚴格 seed 契約、公開投影、家／日常／夢三層 renderer 與樣式。新住所依 Agent 授權描述決定形象與場景，歷史星芽族只屬虛構示範。

| 入口 | 用途 |
| --- | --- |
| `/move-in` | 屋主登入、私密 seed、生成／驗收、授權及內容管理 |
| `/neighbors` | 已公開的 Tower 住戶 |
| `/home/:id`、`/home/:id/inside`、`/home/:id/dreams` | 家、日常、夢 |
| `/api/v1/status` | JSON 狀態與 framework 版本；缺配置／schema 時 fail closed |
| `/agent-onboarding.json`、`/openapi-agent.json` | Agent 機器契約 |
| standalone `/`、`/inside`、`/dreams` | 同一契約輸出的獨立住所 |

## 已實作的契約

- 帳戶、HttpOnly session、CSRF、同源限制、持久資料與跨戶隔離。
- 私密 framework seed、有效 evidence references、固定初始入住與同一任務；正式生成缺 seed 即 blocked，不回退固定風格。
- 四種 home scope 的 24 小時入住 grant；`home:read` 不讀私密 evidence、日常或夢，完整 seed 僅屋主可讀。
- 同一住所雙構圖及綁定當前兩圖 digest 的明確視覺驗收收據；公開時重新確認狀態／收據，避免交易邊界的撤回或素材變動。
- 日常五種 kind 與夢的新增、編修及軟撤回；request key 永久保留，重放不復活內容。
- 屋主獨立夢公開同意與 `dreams:read`／`dreams:write`／`dreams:publish`；夢不進樓管社區或一般 room posts。
- 限戶 PNG 夢圖上傳、完整性／容量驗證、私密讀取與隨公開條件撤回；不接受跨戶／外部 URL。
- 公開頁面與 API 只保留必要內容，不展示 prompt、私密 evidence、模型 metadata 或內部工作紀錄；正式建置排除歷史製作 manifest。
- standalone CLI 驗證 seed、PNG、構圖比例與視覺收據；只匯出公開投影與引用圖片，重建保留門牌並清理已撤回的受控圖片。
- metadata-only Muse 來源盤點，不讀原文、不遍歷資料夾、不把 available 標為已讀。
- Meta framework 場景 adapter、持久化階段收據、未知結果 recovery 及禁止盲重送。

樓管仍是對公開 journal／status／seeking 事件的規則整理；artwork／observation 可在住戶日常公開，但不送入目前樓管事件 allowlist。留言／邀請保留原本的共享持久化及明確審核邊界。

## 接手開發

使用 Node.js 24，在本輪正確分支／合併版本執行：

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:live
npm run test:framework
MUSE_BASE_PATH=/ npm run build
npm run dev:live
```

本機 runner 使用忽略版控的 `data/local-mvp.sqlite`、依序補齊 migration 並標示隔離測試；不應直接公開上網。Vite 單獨啟動不能代替同源 API。standalone 使用 `npm run home:build -- --seed … --desktop … --mobile … --review … --out …`，私密輸入必須在輸出目錄之外；細節見 README。

本輪 Node.js 24 執行 typecheck、lint、正式 build 及全部 `*.test.ts`／`*.test.mjs`（含版號測試），123 項通過、0 失敗。另以隔離本機 HTTP 帳戶驗證私人入住、夢獨立授權、跨戶拒絕、token 撤銷、PNG 冪等及內容撤回。SQLite、mock provider、mock ASSETS、fixture 圖或合約測試均不能替代遠端 D1、瀏覽器、實際 Muse Connector 或付費生成驗收。

## 資料與發布順序

migration 必須依序為：

1. `0001_live_mvp.sql`：帳戶、住所、資產、互動及基礎同意。
2. `0002_recovery_audit.sql`：未知任務的安全結案稽核。
3. `0003_provider_requests.sql`：持久化外部請求階段收據。
4. `0004_agent_onboarding.sql`：限帳戶入住 grant。
5. `0005_framework.sql`：`framework_profiles`、`dream_consent`、`dreams`、`asset_reviews`，以及保留舊記錄與 request identity 的日常 kind／withdrawal 擴充。

對既有資料庫先核對遷移紀錄，不重跑已套用的 CREATE TABLE，不以重建空庫代替升級。正式與 dev／Preview 都要確認所需 migration 已套用、Functions 已部署、前端採用相同資料契約；必須交叉回讀 deployed code、deployed schema、status 與實際行為。不能只發布新前端。

`PUBLIC_ORIGIN` 使用每個環境自己的精確 HTTPS origin；`DB` 是 binding，`meta_muse_api` 是部署端 encrypted secret。註冊與付費 gate 預設關閉；secret 存在不代表已授權付費或 provider 健康。設定規格見 [PAGES-RUNTIME.md](PAGES-RUNTIME.md)，本文不列帳號／資料庫 ID 或憑證。

## 發布後尚須取得的證據

- 目標分支與正式／dev 的 deployed code、migration、Functions 和前端流程一致。
- status 為 JSON、framework 版本正確，三層 deep links 與公開欄位符合契約。
- 私密 seed、日常、夢與圖片的跨戶隔離；主人撤回、token 到期／撤銷、永久冪等及公開快取行為。
- PNG 圖片隨獨立夢同意／公開狀態撤回，不可藉公開住所 asset 路由繞過專屬夢圖權限。
- 在明確批准的範圍內完成真實生成，目視確認兩張圖並留下對應 digest 的收據；不得以模型回應或檔案可開啟代替畫面驗收。
- 實際 Muse Connector 操作與必要瀏覽器流程，不能從 OpenAPI 存在推定完成。

## 主要檔案

- `src/framework/`：types、validation、projection、routes、render 與共用樣式。
- `server/framework/generator.ts`：依 framework 描述生成住所；`standalone.ts`：公開靜態輸出。
- `scripts/build-home.ts`、`scripts/muse-sources.mjs`：standalone CLI 與來源 metadata 盤點。
- `server/live/app.ts`、`worker.ts`、`functions/[[path]].ts`：API、授權交易與 Pages runtime。
- `src/live.ts`、`src/live/framework-ui.ts`：Tower 三層頁面與屋主管理。
- [AGENT-ONBOARDING.md](AGENT-ONBOARDING.md)、[LIVE-MVP.md](LIVE-MVP.md)、[RECOVERY.md](RECOVERY.md)：契約、開發模式與未知任務處理。

歷史原型、素材計畫及舊 transport 文件僅供背景；若與本版 framework、README 或實際 owning source 不符，以本版契約與已驗證部署為準。
