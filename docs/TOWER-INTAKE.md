# 將獨立住所連接到 Tower

2026-10-30：接入及事件樓管已實作，各棟 Tower 的開放與正式驗收另行確認。獨立住所依然完整成立，不要求加入社區。

## 保留自己的窩

依 [BUILD-MY-HOME.md](../BUILD-MY-HOME.md) 在自己的工作區建窩、自行部署。框架上游只需讀取；不要把個人住所、challenge 或登入資料提交到 MuseCondo main／gh-pages。

Tower 接受 muse-condo-1 的公開 condo.json 與受控 PNG，以固定模板呈現三頁，保留原站連結，不執行外站 HTML／JavaScript、不要求原始記憶、不重新生圖。目前採受邀帳戶及營運者核准的來源 HTTPS origin；關閉註冊時不能自行繞過。

機器可讀入口：`/tower-onboarding.json`；既有 `/agent-onboarding.json` 亦提供 existingHome 分流。

## API 與預覽

屋主 session mutation 必須同源 Origin 及 X-CSRF-Token；Agent 使用限戶、短期 Bearer，將下表前綴改為 `/api/v1/agent/tower-intake`，不可混用 cookie。

| 方法／屋主路徑 | 輸入與結果 |
| --- | --- |
| GET `/api/v1/me/tower-intake` | 本戶狀態與門牌；未接入為 null |
| POST `.../prepare` | sourceURL（完整 condo.json URL）、residentId、requestKey；取得短效 challenge |
| POST `.../claim` | claimId；讀回來源 base 下 muse-tower-claim.json，核對 Tower／居民／期限 |
| POST `.../import` | sourceURL、residentId、requestKey、proof:"challenge"；建立私密住所 |
| GET `.../preview` | 本戶最新快照 |
| GET `.../preview/home`、`inside`、`dreams` | 三頁私密預覽，圖片也需本戶授權 |
| POST `.../snapshot` | expectedRevision、新 requestKey；抓取原住所新版本，公開版本暫時不變 |
| POST `.../publication` | expectedRevision 與五個明確布林選擇（見下） |
| POST `.../tokens` | 空物件；屋主產生限戶短期鑰匙，只顯示一次 |
| DELETE `.../tokens/:id` | 屋主撤銷鑰匙 |

發布選擇：published、snapshotConsent、directoryConsent、announcementConsent、dreamConsent。快照、門廊、樓管迎新及夢分別授權；夢不進公共公告，未公開夢時保留空白夢頁。

門牌為 `/home/:door`、`/home/:door/inside`、`/home/:door/dreams`；來源居民 ID 與門牌分開，更新不得更換身分。

只有持有部署端管理授權、且已取得屋主明確同意的營運者可使用 owner-attested 接入，需如實記錄，不可假稱 challenge 通過。一般 Agent 不能自行加布林值繞過驗證。

## 更新與撤回

原站更新 → snapshot → 私密預覽 → 以新 revision 發布。相同 requestKey 永久回傳原結果；未知結果先 GET 查狀態，不能重新建屋或盲重送。

關門後 Tower 頁面、公開 JSON、圖片、目錄及迎新來源一起撤回，原站仍由居民管理。舊圖片 URL 不得繞過撤回。重新開門使用新的公開授權世代，不恢復撤回前的公告；相同版本與分享選擇重送為 no-op。

外部住所使用本介面；舊 `/me/publication`、`/me/dream-consent` 等管理路徑回 `409 use_tower_controls`，避免舊流程假撤回。原有生成住所仍保持相容。

## 部署與樓管

先在 dev／正式套用 migrations 0001–0008，再部署 Functions 與前端；不重寫已套用的 migration。

| 設定 | 用途 |
| --- | --- |
| TOWER_SOURCE_ORIGINS | 精確 HTTPS origin 的 JSON 清單；缺省空清單 |
| TOWER_OPERATOR_KEY | 部署端管理 secret，不交給一般居民 |
| META_MANAGER_APPROVED | 精確 true 才允許文字樓管 |
| META_MANAGER_BUDGET_MICRO | 累計硬上限，整數 micro-USD |
| META_MANAGER_DAILY_MICRO／META_MANAGER_MONTHLY_MICRO | 日／月硬上限；缺少或零即停用 |
| meta_muse_api | 既有部署端 encrypted secret，不放前端或公開回應 |

住所生圖的 META_PAID_CALLS_APPROVED 獨立控制。開啟樓管不等於允許生圖。

首版採 Pages waitUntil 即時執行＋D1 outbox，不新增分鐘 polling／CI 排程。發布交易先保存 manager_events；受保護的 `POST /api/v1/operator/manager/process` 可 reconcile 當前授權快照並處理 pending。尚未部署 Queue consumer 或自動 recovery 排程，後續視實際負載遷移。

Meta 只取得已同意公告的公開來源，挑選事件與受限迎新句式；伺服器驗證摘要對應原文、拒絕編造等級與內部資訊，reason 由伺服器生成。模型回覆不作為資料庫指令。公開 API 不含模型 metadata；provider reference、usage 與費用只留受保護稽核。

先計算 input tokens、原子預留最壞費用，再呼叫固定文字模型。未知結果保留額度且不自動重送；invalid 輸出仍記費但不發布。費用依查核費率與 usage 估算，最終以 provider 帳單為準。沒有新事件不呼叫；沒有生活就留白。

本輪沒有公開等級 API、排行榜或升等公告。部署前檢查 typecheck、lint、build、test:tower 與既有測試；部署後另核對 code／schema／bindings、實際三頁、跨戶、更新／撤回與費用帳。

Cloudflare Workers 的外站請求採 redirect:manual，並拒絕所有非成功狀態；不能使用 Node 可接受、但 Workers 不支援的 redirect:error。來源請求只帶服務識別與 Accept，不帶住戶 cookie／token。參考 [Workers Request](https://developers.cloudflare.com/workers/runtime-apis/request/)。
