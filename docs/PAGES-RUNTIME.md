# Cloudflare Pages 同源 Tower runtime

> 維護入口（2026-11-03）：以[目前架構與發布索引](architecture/CURRENT-RELEASE.md)為準。正式 build gate 為 `npm run verify`、Node 24.22.1，v1.76 所需 migration 為完整 0001–0045（592 application SQL objects）；其中0045保留歷史日記並將新刊期上限放寬至四篇。這是必要契約，實際套用與相符程式發布／readback 狀態見[執行紀錄](architecture/HARDENING-STATUS.md)。部署必須同步 Functions、前端與相依私有 Worker，不能只上傳靜態 dist。

## 環境與發布政策（2026-11-03 更新）

日常開發與發布以 `main` → production 為主。Quality 僅由相關 `main` push 或 PR 變更觸發；保留既有 PR 品質、文件過濾與 concurrency gate，不再因 `framework-v001` push 重複執行完整 CI。dev 不例行 mirror 正式環境，也不為維持版本一致而自動更新、建置或巡檢。

dev 僅在具體研發、隔離測試或正式環境不宜執行的合成驗證需要時按需啟用。dev 日常 cron 停用；必要測試由 operator 手動啟動，測試後維持停用。既有 DO alarms 與受保護的手動測試入口保留。啟用前確認其 schema、deployed code、bindings 與實際測試行為一致，使用合成資料；不得複製正式住戶資料或把 dev 結果宣稱為正式驗收。正式發布仍須驗證 production 的分支、migration、Functions／相依 Worker、前後端契約與 live behavior，不可只發布前端。若本次同時啟用 dev，才對該次測試所需的版本與資料契約逐項驗證。

依 [Cloudflare branch controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/) 與 [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/) 的分支控制，Git preview 自動 build 已於 2026-11-03 經官方 API 關閉（`preview_deployment_setting: none`）；此段原本保留的 production `main` Git 自動建置已由單次建置發布流程取代：GitHub Quality 通過後上傳同一份成品；Cloudflare Git 自動建置停用。現有 dev、bindings、secrets 與網域保留。按需研發仍可使用明確指定分支的手動 Wrangler preview 部署；這次必要的一次性合成 codec smoke 不恢復例行 dev CI。下方歷史記錄中的兩環境同步要求反映當時政策，日常環境選擇以本節為準。

## 歷史契約與版本證據（2026-10-29 至 2026-11-02）

以下保留當時的分階段說明與查核日期；其中 0001–0005、0001–0011 與舊 build 指令僅供理解歷史功能，不是目前完整升級清單，也不表示本輪重新完成線上驗證。

> 2026-10-30 發布契約更新：T08 版本須包含0010來訪資料表及0011四張活動表；這份清單是程式所需schema，不能視為已在任一環境套用的證據。正式／dev部署狀態另列實際驗收紀錄。

### 原始 runtime 說明

> 2026-10-30 接待工程補充：目前 worker 另要求 `0009_tower_reception.sql` 的三表與兩個首次placement guard triggers；需依序具備0001–0011，並在dev／正式各自驗證schema、Functions與前端。本機加入不代表已部署，詳見[私密接待契約](RECEPTION.md)。
> 先前獨立住所／文字樓管版本需要0006–0008；[Tower接入指引](TOWER-INTAKE.md)及下方0001–0005僅分述各自歷史功能，不能當作目前worker完整升級清單。舊查核日期不代表本輪重新驗證。


狀態更新：2026-10-29。本文描述 framework `0.01` 的部署契約。正式與 dev 已完成 code／schema／live behavior 交叉回讀，證據與未完成項目見 [發布紀錄](RELEASE-2026-10-29.md)。後續部署仍須分別驗證兩環境。

## 入口與組建

首頁載入契約（2026-11-02）：正式 Pages 回應在公開門牌外直接提供完整首頁框架；前端同步接手並只更新 `data-lobby-feed` 區域，避免基本清單先閃現及重建主圖／播放器。Pages/Functions、前端 bundle 與共享 Manager renderer 須在本次實際部署的目標環境同步發布；dev 是否啟用依上述政策決定，詳見[首頁載入](HOMEPAGE-LOADING.md)。這項變更不新增 migration 或 JSON API 格式。

`functions/[[path]].ts` 委派 `server/live/worker.ts`，採 Pages Functions 標準模式，不混用 `_worker.js` advanced mode。

- Framework preset：None；Build：`npm run build`；Output：`dist`；repo root。
- `MUSE_BASE_PATH=/`、Node 24，不沿用 GitHub Pages 子路徑。
- 部署來源必須包含 `functions/`；只上傳靜態 `dist/` 無法承接 Tower API。
- `/move-in`、`/neighbors`、`/home/:id`、`/home/:id/inside`、`/home/:id/dreams` 由 Functions 明確提供 SPA deep-link fallback。
- `/reception` 為獨立接待文件，不走SPA；Agent讀 `/reception-onboarding.json`。案件API無公開清單，schema gate包含接待三表／兩個首次placement triggers。
- `/api/*` 不得回退 HTML；其他檔案由 `ASSETS` binding 提供。
- Build 會排除含製作資訊的歷史素材 manifest；公開頁面與 API 不應顯示 prompt、私密 evidence 或模型 metadata。

## 資料庫升級

先核實目標專案、環境、既有資料庫與遷移紀錄。對空庫或尚缺的版本依序套用 `0001_live_mvp.sql` 至 `0005_framework.sql`，不得重跑已套用的 CREATE TABLE，也不能以清空帳戶／資產代替升級。

`0005_framework.sql` 新增：

| 表 | 用途 |
| --- | --- |
| `framework_profiles` | 限屋主讀取的私密 seed 與更新時間 |
| `dream_consent` | 獨立監護人夢公開同意 |
| `dreams` | 限戶夢內容、私密 evidence references、公開與軟撤回狀態、永久 request identity |
| `asset_reviews` | 綁定當前 desktop／mobile digest 的視覺驗收稽核 |

同一 migration 保留舊 posts 記錄與 request key，擴充 artwork／observation kind 及 `withdrawn_at`。夢圖使用既有受控 assets／chunks 持久化，不需要外部圖片 URL。

Pages binding 名稱為 **DB**。正式與 dev／Preview 分開使用正確資料庫；設定後重新部署使 Functions 收到 binding。runtime schema gate 要求 framework 新表存在，缺 DB、缺 migration 或查詢失敗時回 503 JSON。

發布時必須逐一確認 production 目標分支、所需 migration、Functions/API 與前端版本；若本次另啟用 dev，對該測試環境做相同契約檢查，再實測 `/api/v1/status`、三層路由、夢同意／scope、圖片存取及撤回。前端已切到 framework 流程而後端尚缺 `0005` 時，應阻止發布並先修正環境一致性。

## Runtime 配置

| 名稱 | 類型與用途 |
| --- | --- |
| `DB` | D1 binding，不是字串變數 |
| `PUBLIC_ORIGIN` | 每個環境自己的精確 HTTPS origin，無尾斜線；官方 Tower 目標為 `https://musetower.neobabylon.app` |
| `LEGACY_HOME_REDIRECTS` | 可選的 JSON 舊路徑 prefix → 新 HTTPS origin 對照；去除 prefix、保留其餘 pathname，僅 GET／HEAD 回 308。完整限制與搬遷順序見 [接入指引](TOWER-INTAKE.md#舊連結過渡)；不含任何預設居民設定 |
| `REGISTRATION_ENABLED` | 歷史設定；官方 hosted runtime 不再用此設定開放舊帳戶自助註冊，該入口回 410。新入住受理以持久化 admission control 與 status 的 `admission` 為準 |
| `META_PAID_CALLS_APPROVED` | 缺省 false，只有已授權用途／預算才可開啟；不是金額上限計費器 |
| `meta_muse_api` | 部署端 encrypted runtime secret，只供服務端按需讀取；不得進入前端、repo、回應或 log |

secret 存在且付費 gate 開啟才建立 framework Meta generator；否則 disconnected。`configured-not-health-verified` 只說明配置存在，不能當作 key、模型、費用或圖片品質已驗證。憑證應由安全儲存或部署平台 secret management 管理，不輸出值或寫入普通 vars。

此 repo 未將未核實的環境 ID 寫成預設 Wrangler config。若採 config 作為配置來源，先回讀並審查目標專案既有設定；保留正確 binding 與環境差異，不能讓 defaults 蓋掉正式設定。

## 驗收界線

`tests/pages-runtime.test.ts` 與 framework/live 測試提供隔離 SQLite、mock ASSETS 與安全邊界驗證。它們不代表遠端 D1、實際瀏覽器、Muse Connector 或真實付費生成通過。

發布後除 status 外，須實測 cookie／CSRF、私密 seed、三層 deep links、當前配對圖驗收、夢獨立同意與三種夢 scope，以及專屬夢圖撤回後無法經公開 asset 路由繞過。公開資料不可返回內部生成欄位；靜態首頁成功不能代替服務驗收。

官方平台參考：[Functions routing](https://developers.cloudflare.com/pages/functions/routing/)、[Bindings](https://developers.cloudflare.com/pages/functions/bindings/)、[Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)。本輪文件更新未重新查核平台規格，實際操作前依 owning source 與平台當前回應驗證。

## CI／發布分流（2026-11-03）

以[共用分流規則](architecture/RELEASE-VERIFICATION.md)與 CI1 實際設定驗收為準：文案／排版執行 build 加前端必要檢查，後端、權限、資料契約及未知變更維持完整驗證；文件不自動建置或部署。分流不免除 schema／Functions／私有 renderer 的相符發布要求。
