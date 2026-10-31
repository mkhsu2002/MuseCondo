# Tower 樓管：自主職責與受限維護契約

2026-10-31。本文件是實作契約與本機證據，**不是正式部署完成證明**。正式 migration、bindings、Worker／Pages 版本與真實 provider／公開讀回，須由發布紀錄另列。

## 已取代的舊版設計

M03 的「Codex 預製 Halloween SVG/CSS、operator 手動 activate 即交付」及 M04 的「沒有新消息就不呼叫模型、只有 DB 摘要」於 2026-10-31 明確 **superseded**。舊 0023 私密 preview／永久 receipt 與安全 DB registry 保留相容性；舊 theme 不再產生公開 Halloween 投影。預製 SVG 與 Halloween 裝飾 CSS 已移除生產引用；舊測試僅留在 Git 歷史，不能充當部署樓管生圖／審核／發布證據。

## 固定授權與日常職責

| 職責 | 可讀 | 可執行 | 限制 |
| --- | --- | --- | --- |
| 每日自主照顧 | 當地日曆、公開投影存在／健康、先前私密工作記憶、已阻塞任務的最小摘要 | 每天真正透過 Meta 思考，決定不更動／檢查公開健康／建立受限外觀任務 | 即使沒有新消息仍思考；不讀 Fang 或居民私密內容 |
| 外觀維護 | 既有 `muse-tower-day-v2.webp`／`night-v2.webp` 原圖 | Meta Spark 生成方案／prompt、原生 function tool、Muse Image 編輯原圖、私密 R2、驗證、獨立 TaskAudit、啟用 D1 pointer | 目前外觀 calendar catalog **僅 Halloween 2026**；不宣稱支援任意節日。保留單一前景、無邊際塔、日夜兩圖；未 PASS 不公開 |
| 每週整理 | 本週 period key、公開健康、既有私密工作記憶 | 在當週首個每日思考納入週整理判斷並寫永久私密記錄 | 不虛構活動／居民，不發布活動、不聯繫居民 |
| 每月資源檢視 | 月 period key、lifetime-as-of-run 成本與承諾 | 在月首個每日思考檢視成本與固定權限，保存私密結論 | 不增加權限或預算，不宣稱成本是本月新增 |
| 既有社區接待與公告 | 當下仍同意公開的事件 | 原有可追溯的文字迎新／更新／撤回鏈 | 獨立事件與預算；**這條文字公告鏈**無事件不呼叫模型，不影響新的每日自主思考 |

樓管不能讀居民私訊、撤 key、恢復身分、付款、寄信、改權限或建立高權管理者。Tower Lord／正式交棒仍停用；未建立可用高權角色。

## 狀態機與實際成果

`enable standing mandate → daily thinking → execute function tool → image-day → image-night → deterministic verify → function_call_output acknowledgement → independent TaskAudit → activate → independent daily selfreview → complete`。`noop/health` 仍有實際公開健康讀回、獨立 TaskAudit 與另一次每日反省。各模型 context 分開；只有 executor 使用 `store:false` encrypted reasoning replay 完成同一工具迴圈，不把 executor 自稱完成當獨立審核。

任務在每日思考中自定目的、驗收、預算與受限 permissions。每日最多一個邏輯任務（每日例行與該日外觀行動共用同一成本戶），總預算不超過 US$10，包含思考、executor、圖、審核、一次修復、反省；模型只能降低計畫預算，不能提升部署上限。計畫完成前檢查足以涵蓋後續有界階段的保留空間。每日 aggregate 另限制 US$10，DB 永久限制 task 數一筆，repair 沿用原 cycle／budget。固定 `appearance:halloween:2026` 永久 anchor 防止將同一外觀任務隔日重 key、拆任務或重設預算。

每一次 Meta HTTP（含 input token count、獨立 TaskAudit、每日反省）先有永久 dispatch 記錄與 step key；Spark 先呼叫官方 input token count，拒絕超出 128,000 input，再按 Standard $1.25/M input、$4.25/M output 與 max output 2,400 保留費用；圖每張固定 $0.01。usage／provider id 確認後結帳。網路中斷、5xx、redirect、無法確認 usage 均保留原 reservation，不盲重試、不換 key。原生 lease 到期而尚在 dispatch 的 call 轉 unknown；不能再次送付費請求。HTTP 4xx 明確拒絕不視為完成。

驗證實際從 **R2 重新讀取**已生成圖：存在、bytes、SHA256、PNG CRC／chunk 順序／解壓 scanline、最低解析度與16:9、day/night 完整且 hash 不同。後續獨立 Spark TaskAudit 使用兩張原圖與兩張 R2 實際讀回圖，做畫面與方案比對；單純模型字串 PASS 不足以 activation。D1 guard 同時驗證 PASS 對應獨立 paid receipt、deterministic evidence generation、兩圖 provider provenance、固定 permission、有效 mandate、native clock／lease、CAS revision；immutable records 阻擋 UPDATE／DELETE／INSERT OR REPLACE。

TaskAudit FAIL 可在同一原任務最多修一次；重新執行工具、驗證、獨立審核。無法修復則 blocked，仍嘗試另一次私密 daily selfreview，保存事實、記憶與 nextTasks；反省本身也失敗時不假稱完成。未知外部付費仍留在原 task／anchor；下一日可以思考、檢查健康及反省，但不能 clone/restart 其影像工作。跨日 lease 中斷先以 CAS 將未知 call 與失敗結果持久化，繼續該任務的獨立反省；每步回傳的 pending 查所有剩餘 cycles，舊任務 blocked 不會使 DO 清除當日尚待思考的 alarm。遲到的 provider 成功不能覆寫 unknown receipt。

只有已驗證且 PASS 的 pair 可啟用 runtime pointer。Halloween window 為 `2026-10-31T07:00:00Z` 至 `2026-11-01T07:00:00Z`，America/Vancouver；到期公開 projection／asset endpoint 即回一般外觀，無須等 cron。公開只出 theme、revision、endsAt、generation 與同源 day/night URL；沒有 prompt、模型、QA、工作安排或居民資訊。找不到可用 runtime 圖則保留一般原圖。前端檢查 generation 與兩張圖的精確同源相對路徑，拒絕外部／絕對 URL、query、跨 generation 路徑；兩張實際圖均預載成功後才接管 `img.src`。日夜與外觀按鈕共用同一圖片控制器，保留目前 scene；任一圖失敗、開頁到期或使用者選一般外觀，立即回到對應日夜原圖，沒有替代 SVG 成果。

## 部署與保護入口

- Pages 既有 `meta_muse_api` 單獨持有 provider secret。**不得回讀到本機，不得複製 prod key 到 dev**。dev 缺 provider 時 enable 503，維持 disabled。
- Pages 新增 `MANAGER_ASSETS`（private R2）、`MANAGER_RUNTIME`（service binding 指向 scheduler Worker）、既有 `MANAGER_SCHEDULE_TRIGGER_KEY`（scoped secret）、ASSETS 與 DB。
- `workers/tower-manager` 持 PUBLIC_ORIGIN／scoped trigger，無 provider／operator／居民 key。DO class `ManagerClock`，binding `MANAGER_CLOCK`，SQLite DO migration `manager-clock-v1`。
- `GET/POST /api/v1/operator/manager/autonomy`：`X-Tower-Operator-Key`；POST 僅 `{action:"enable"|"disable"}`。enable 完成持久 mandate 後立即呼叫 service `/wake`；首次可自行決策當天工作，不等人派單。
- `POST /api/v1/manager/autonomy/step`：僅 `X-Manager-Schedule-Key`；不接受 operator key。每步最多一個 paid request，加必要的免費 token count。拒絕 Cookie／跨站 Origin／Sec-Fetch-Site。
- `GET /api/v1/tower/appearance`：最小公開投影，舊 operator 靜態 theme 無法使它變成公開 Halloween。
- `GET /api/v1/tower/appearance/assets/{generation}/{day|night}.png`：僅當前且有效 window 之 runtime pair；私密 R2 無 public bucket，無任意 key/path fetch。
- 舊 appearance、schedule inspect、run-due APIs 保留；run-due registry 是免費 DB hygiene，不是自主工作的完成證明。

每日 UTC 16:00 cron（Vancouver 夏令09:00／冬令08:00）各環境每月28–31次；每次都需要當日判斷，並非空輪詢。原生 DO alarm 只在有待續跑工作時 event-driven 接下一階段，完成／blocked即清除 alarm；網路 recovery 最多3次，每次6分鐘，僅續已持久工作且 DB 防止付費重送。沒有分鐘級常態 polling、Codex automation、GitHub cron 或CI呼叫provider。safe DB jobs失敗也仍喚醒自主思考。

發布順序：dev/prod 依順序套至0026（0024/25由其他分支提供）→ 同版本 Pages／前端 → private R2 與DO Worker／servicebinding／scoped secret → 逐環境 native／deployed schema與code／readiness → enable mandate → 讀回每日思考、tool、paid ledger、R2產物、deterministic evidence、獨立TaskAudit、pointer、公開圖片與私密selfreview。任何層未驗證，不能標記自主樓管或萬聖節交付完成。commit／本機測試不等於正式發布。

## 本機證據（2026-10-31）

`tests/tower-autonomy.test.ts` synthetic provider 驗證空消息仍思考、獨立audit與selfreview、真正function call/output replay、有效雙PNG、R2讀回、四圖audit、atomic activate、同task FAIL修復、unknown保留reservation／跨日仍思考但不clone、損毀artifact阻擋公開、dev缺provider failclosed、alarm有界續跑、跨日中斷仍完成失敗反省及今日思考。`tower-appearance-ui.test.ts` 四例核對真正 DOM img.src、日夜／原生手機按鈕、一般外觀偏好、精確路徑、雙圖載入失敗與開頁到期；真正瀏覽器畫面由整合端另驗證。測試圖只存在記憶體，未上傳R2，不能充當真實Meta產物。

`scripts/test-tower-manager-native.mjs <existing-node_modules>` 重用現有 Wrangler4.156／Miniflare5／workerd、compatibility2026-10-30；原生D1套完整migration、編譯Pages scope／projection／devdisabled、cron dispatch，以及實際SQLite DO wake→alarm→scoped step→停止均通過。外網拒絕或synthetic handler，無真實provider付費。原生 `redirect:'manual'` 拒絕3xx，不使用workerd不支援的`redirect:'error'`。

官方契約重查2026-10-31：[Responses](https://dev.meta.ai/docs/protocols/responses)、[token count](https://dev.meta.ai/docs/api-reference/responses/count-input-tokens)、[tools](https://dev.meta.ai/docs/tool-calling)、[images](https://dev.meta.ai/docs/image-generation)。tool_choice僅auto；函式回合上限由應用限制；images JSON edits、WxH aspect ratio、tool_enablement／reasoning_strength以官方契約為準，不能套用其他供應商參數假設。

`scripts/preview-tower-appearance.mjs` 為 loopback-only wiring fixture，以兩張既有原圖回應 synthetic runtime URL，僅驗證 UI 圖源切換、排版與到期，不是 Meta 生成產物，也不寫 R2／正式 pointer。
