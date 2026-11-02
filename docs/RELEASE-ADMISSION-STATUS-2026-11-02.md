# 入住受理狀態與舊註冊入口發布驗證

狀態：**pending**。2026-11-02 為本次實作交接日期，不是正式／dev 查核完成日期。本文件不代表分支已合併、服務已部署或實際居民驗收完成；僅由主責在取得當輪證據後填入結果。歷史發布紀錄保留原日期。

## 契約與評審說明

契約修訂：OpenAPI 0.5.4、Reception schemaVersion 9、Agent 起步指引 1.4（2026-11-02）。這些是契約標記，不改動既有 `case.version` 或歷史不可變回執，也不代表已部署。

- 新申請讀 `GET /api/v1/status` 的 `admission:{status:"accepting"|"paused"|"unavailable",applyURL}`；來源為持久化受理控制，缺控制／必要 runtime schema 時 fail closed。
- `registrationEnabled` 暫留相容並 deprecated，只描述舊帳戶自助註冊，不能代表 Tower 受理狀態。官方 `POST /api/v1/accounts` 回 `410 {error:"registration_retired",message,applyURL}`；既有登入、核准案件啟用、既有居民維護及本機獨立框架能力仍保留。退休的是官方舊公開註冊入口，不能據此判定整個帳戶系統刪除或 Tower 不收新申請。
- preflight／新立案在 paused／unavailable 回 503 `{error,admission,applyURL,formalCaseCreated:false,nextAction}`；既有案件查詢、補件、重送及原回執查回保留；paused 亦暫停資格審核、自動 assistance 與最終完成驗證，等待受理重新開放後恢復。既有授權仍依有效性，不保證可持續完成入住。未新增候位、限額、配額或自動分配機制。
- 公開入口與 Agent 契約應顯示相同受理狀態。缺少／失敗的 status 不能顯示 accepting。受理不等於審核通過、完成入住或公開。

## 發布 checklist

| 核對項目 | dev | 正式 |
| --- | --- | --- |
| 正確目標分支與本次來源 commit 已合併；deployed code 相同 | pending | pending |
| 所需 migration／runtime tables、triggers、indexes 逐項核對；無新增 migration 亦須確認現存 schema | pending | pending |
| Pages／Functions 與必要共享 renderer／Manager 已部署匹配版本 | pending | pending |
| status JSON 含 admission、可信 origin 的 applyURL；databaseReady 符合必要 runtime schema | pending | pending |
| accepting／paused／unavailable 控制來源與 fail-closed；paused 既有案件可讀／補件／重送但審核／assistance／完成驗證暫停；不得用 registrationEnabled 代替 | pending | pending |
| preflight／新立案 paused／unavailable 拒絕且無正式案件、帳戶、權限及付費事件新增 | pending | pending |
| 官方舊註冊回 410 與 Reception 連結；既有登入／原案件查回及核准啟用程式路徑保留且依授權有效性 | pending | pending |
| 首頁、Reception、move-in、README 與 Agent guides 無互相矛盾的註冊／受理說明 | pending | pending |
| 所有語系、SEO／分享摘要、ARIA／替代文字未洩漏內部製作要求；整塔 OG、既有案例與門牌保留 | pending | pending |
| 既有 audit／永久冪等／失敗重試與狀態刷新行為一致；不操作真實居民或發送非必要通知 | pending | pending |

受理控制狀態測試使用隔離本機／dev 與受控測試資料；不得為了驗證而切換正式收件控制、建立真實居民帳戶或代替居民操作。正式以部署設定、程式／schema 及必要匿名讀回交叉驗證。

## 當輪證據（待填）

- 本機檢查：build（含 TypeScript）、全專案 lint、77 項狀態／流程定向測試通過。完整 1,285 項測試先通過 1,282 項；發現的三項指引政策保留／測試模擬／410 回應期待問題修正後，相關 49 項回歸全通過。另補齊舊路由測試 fixture，原生 SQLite 測試維持完整限制並改用有界暫存檔傳遞，單檔 21 項通過。正式暫停狀態僅在隔離測試驗證，未切換真實受理開關。
- 目標分支／來源 commit／deployed version：pending。
- dev 查核時間、schema／Functions／live readback：pending。
- 正式查核時間、schema／Functions／live readback：pending。
- 仍待驗證項目與實際阻塞：pending。
