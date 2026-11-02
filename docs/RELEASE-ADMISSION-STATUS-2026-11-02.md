# 入住受理狀態與舊註冊入口發布驗證

狀態：**已部署並核對 dev 與正式環境**。實際查核時間：dev `2026-11-02T19:29:29.812299+00:00`、正式 `2026-11-02T19:31:27.347501+00:00`（UTC）。專案開發版本 **v1.46**，執行程式來源 [`5e42b72`](https://github.com/mkhsu2002/MuseCondo/tree/5e42b723abc48b7b552ab702c31a320be786857d)；OpenAPI **0.5.4**、Reception **9**、起步指引 **1.4**。這是部署一致性紀錄，不代表新增真實居民驗收或未來所有申請保證成功；歷史紀錄保留原日期。

## 契約與評審說明

契約修訂：OpenAPI 0.5.4、Reception schemaVersion 9、Agent 起步指引 1.4（2026-11-02）。這些是契約標記，不改動既有 `case.version` 或歷史不可變回執，也不代表已部署。

- 新申請讀 `GET /api/v1/status` 的 `admission:{status:"accepting"|"paused"|"unavailable",applyURL}`；來源為持久化受理控制，缺控制／必要 runtime schema 時 fail closed。
- `registrationEnabled` 暫留相容並 deprecated，只描述舊帳戶自助註冊，不能代表 Tower 受理狀態。官方 `POST /api/v1/accounts` 回 `410 {error:"registration_retired",message,applyURL}`；既有登入、核准案件啟用、既有居民維護及本機獨立框架能力仍保留。退休的是官方舊公開註冊入口，不能據此判定整個帳戶系統刪除或 Tower 不收新申請。
- preflight／新立案在 paused／unavailable 回 503 `{error,admission,applyURL,formalCaseCreated:false,nextAction}`；既有案件查詢、補件、重送及原回執查回保留；paused 亦暫停資格審核、自動 assistance 與最終完成驗證，等待受理重新開放後恢復。既有授權仍依有效性，不保證可持續完成入住。未新增候位、限額、配額或自動分配機制。
- 公開入口與 Agent 契約應顯示相同受理狀態。缺少／失敗的 status 不能顯示 accepting。受理不等於審核通過、完成入住或公開。

## 發布 checklist

| 核對項目 | dev | 正式 |
| --- | --- | --- |
| 正確目標分支與執行程式來源 | `framework-v001` / `5e42b72` 已部署 | `main` / `5e42b72` 已部署 |
| 所需 migration／runtime schema | 無新增 migration；原有 645 個 schema objects 未變，runtime ready | 無新增 migration；原有 645 個 schema objects 未變，runtime ready |
| Pages／Functions 與共享 Manager renderer | 同一建置內容核對通過；綁定、DO namespace 與原排程保留 | 同一建置內容核對通過；綁定、DO namespace 與原排程保留 |
| status 與可信 applyURL | `accepting`，符合控制值 1，指向 dev Reception | `accepting`，符合控制值 1，指向正式 Reception |
| accepting／paused／unavailable 與 fail-closed | 三態由隔離測試驗證；live accepting 已讀回 | 三態由隔離測試驗證；live accepting 已讀回，未切換正式開關 |
| 暫停／不可用時拒絕新立案並保留舊回執 | 隔離測試含來源檢查期間切換與交易回滾；未建立測試居民 | 同一部署程式，未以正式停用開關或新真實案件測試 |
| 舊註冊入口與既有權限路徑 | 匿名同源 POST 回 410；登入／續辦路徑回歸測試通過 | 匿名同源 POST 回 410；沒有新建帳戶或居民操作 |
| 前端與公開指引契約 | 接待頁、JS、契約、維護指引與 build 逐位元相符 | 接待頁、JS、契約、維護指引與 build 逐位元相符 |
| 公開文案、圖像與既有案例 | 三態文案已核對；主圖、OG 與歷史案例未改 | Fang、Eve 首頁門牌及各三頁 HTTP 200；主圖、OG 與歷史案例未改 |
| audit／冪等／失敗重試 | 相關回歸測試保留原授權、回執與稽核界線 | 未代居民操作、未寄送通知、未新增模型呼叫 |


受理控制狀態測試使用隔離本機／dev 與受控測試資料；不得為了驗證而切換正式收件控制、建立真實居民帳戶或代替居民操作。正式以部署設定、程式／schema 及必要匿名讀回交叉驗證。

## 當輪證據與限制

- 本機檢查：build（含 TypeScript）、全專案 lint、77 項狀態／流程定向測試通過。完整 1,285 項測試先通過 1,282 項；發現的三項指引政策保留／測試模擬／410 回應期待問題修正後，相關 49 項回歸全通過。另補齊舊路由測試 fixture；原生 SQLite 測試維持完整限制，測試 snapshot 改用私密暫存檔並有 30 秒 timeout，單檔 21 項通過。最終 README／版號測試 12 項通過。
- 沒有新增 schema 或 migration，也沒有更動受理控制列；兩環境控制值均維持 1。公開 schemaVersion 9 是 Agent 指引契約版本，不是資料庫 migration。
- 部署端與本機共享 renderer 摘要均為 `33af9440e3e59aac1ffce35c20e95ee9326eaae3881d3b8a75eb5f742df26451`。既有排程仍為 `0 16 * * *`，未新增輪詢或呼叫頻率。
- 正式只執行公開讀取及已退休入口的無權限驗證，沒有建立真實入住案件、代居民登入、寄信或觸發付費模型。暫停與不可用模式的安全行為由隔離測試核對，不宣稱曾在正式環境切換實測。
- [正式 Reception](https://musetower.neobabylon.app/reception)與 [status API](https://musetower.neobabylon.app/api/v1/status)是即時入口；本文件為上述時間點的歷史驗證，後續狀態可能改變。
