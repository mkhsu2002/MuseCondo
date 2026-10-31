# I05a 寄件網域診斷

2026-10-31 本地後續：b2a 私有 dispatch／Pages 串流核心見 [技術契約](IDENTITY-MAIL-DISPATCH.md)。尚未部署、未啟用投遞；下文原切片狀態為歷史範圍，不可據此沿用舊直寄路徑。

這個切片只提供部署端、operator 專用的 Resend 寄件網域 metadata 查核，不寄信、不建 webhook、不改 DNS。它不代表 I05 附件郵寄或收件驗收完成。`identity-card` 與 `security-notice` 事件仍沿原契約保持 pending；guardian 的既有寄送行為不變。無新增前台或排程，排程新增觸發數與空跑數皆為零。

## 私有入口

exact `POST /api/v1/operator/identity/mail-readiness`，同環境 `X-Tower-Operator-Key` 對應部署端 `TOWER_OPERATOR_KEY`。body 僅有 `{ "requestKey": "operator-chosen-key" }`，值必須是 8–96 字元 printable ASCII；UTF-8 JSON body 最多 1024 bytes，拒絕重複 key、額外欄位、query（含空 query）、錯 host／Origin、cross-site、Cookie 與非 POST。未授權或無效輸入不寫入、不呼叫 provider。此端點不接受 from、domain、收件人、key、URL 或內容。

`IDENTITY_MAIL_API_KEY` 僅由部署端 Pages Function 暫時使用，不取回本機／runner。`IDENTITY_MAIL_FROM` 直接來自該部署環境；解析限定單一 ASCII dot-atom mailbox，可帶無 RFC 特殊符號的文字顯示名稱，拒絕控制字元、地址清單、註解、未配對括號、無效 domain／IP。不符合支援格式時回 unknown，不能自行猜寄件人。只從該 FROM 提取精確的正規化 domain（DNS 大小寫不敏感），不嘗試父 domain。原 FROM 及地址不出現在回應或 audit。

## 固定 provider 讀取

Function 固定 GET `https://api.resend.com/domains?limit=100`；`has_more=true` 時用該頁最後一個 ID 作 `after`，最多 10 頁。找到精確 domain 後固定 GET `/domains/:id`，獨立檢查單域回應的 `status` 與 `capabilities.sending`。整次 provider 操作共用 15 秒 deadline（包含讀 body），成功 body 每次最多 128 KiB、錯誤 body 最多 4 KiB；使用 workerd 支援的 `redirect: manual`，在解析 body 前拒絕所有 3xx；不追蹤 Location、不轉送 Authorization。缺任一配置時不進行任何網路讀取。

只在完整、合法清單 traversal 結束時認定 domain missing。空但有後頁、重複 ID／循環、超過頁數、錯誤／過大／畸形／重複欄位 body、未知 status／capability 與 timeout 一律 unknown。匹配後的單域回應必須保持相同 ID／domain。其他 domain、ID、DNS records、原 provider body／message 及 secret 不輸出或保存。

provider 拒絕會保留原始 HTTP status，`providerErrorName` 只允許官方錯誤識別碼清單，例如 `restricted_api_key`。metadata 權限不足表示本次診斷 unknown，不代表 key 無效，也不據此要求重設或輪換。不得依 key prefix／長度猜測有效性。

## 回應與永久狀態

- `200 ready`：只有 domain verified 且 sending enabled 才有 `senderReady=true`；這僅證明當次 sender metadata。
- `200 not_ready`：完整合法清單查無該 domain，或域名未 verified／sending disabled；`senderReady=false`。
- `503 unknown`：新產生的 provider 拒絕、無法完成或資料不可信結果；`senderReady=null`。保留 `providerHttpStatus` 與允許的 `providerErrorName`，不能視為健康；配置缺失同為 `503 unknown`。
- `202 checking`：永久意圖已保留，操作尚未完成；重放不重查，不宣稱健康。
- `409 request_key_conflict`：同 key 的原 FROM 或 origin 已改變，包括只改顯示名稱／字母大小寫。
- `429 mail_readiness_rate_limited`：同環境不同 logical checks 已達 10／小時。
- `503 mail_readiness_unavailable` 或 `audit_unavailable`：診斷 schema／持久化不可用，不能視為通過。

新結果使用 503 表示診斷依賴不可用，避免 502 經 edge 錯誤頁處理後遺失應用層 JSON。Cloudflare [Custom Errors 官方文件](https://developers.cloudflare.com/rules/custom-errors/)說明 Error Pages 不適用 503；實際部署回應仍須另行回讀驗證，不能只靠本地通過。此變更不將錯誤改成 200、不修改 zone 設定，也不重寫歷史收據：已保存 `response_status=502` 的結果仍在應用層逐字重播原 JSON 與原 502；永久 audit、quota 與 checkedAt 均不變。0019 已允許 503，不需修改 migration。

所有診斷結果都保持 `deliveryVerified=false`。PDF＋JSON attachment、permanent frozen envelope、事件 exact dispatch、簽署 webhook 的 delivery／suppression 與 unknown reconcile 均屬後續 I05 切片；不得把 `senderReady=true` 改寫成可寄送或投遞驗收完成。

`0019_identity_mail_provider_checks.sql` 新增 `identity_mail_provider_checks`、`identity_mail_provider_audit` 及四個永久／不可變 triggers，不借用需要 account 的 `tower_audit`、不冒造 global account。requestKey 與原 FROM／origin 只保存用途分離 SHA-256 hash；domain 可保存，無 raw FROM、收件地址、secret 或 raw provider body。

reservation、`rate_limits` 的 `identity-mail-provider:global` 10／小時 counter 及 intent audit 同一 D1 batch 提交，之後才讀 provider；去敏結果與 completed audit 再同批提交。同 key／同 input 永久重放相同結果及原 HTTP status，不扣額度、不呼叫 provider。並發同 key 僅一個 logical check；unknown 不自動重查。中斷的 checking 保留，不透過重放搶回。完成 audit 寫入失敗時回 unknown；若 commit acknowledgement 遺失，之後只讀永久收據，仍不重查。

同 requestKey 回傳的是當時 `checkedAt` 的歷史 snapshot，不代表 provider 的目前狀態。要重新查核（包括權限／DNS／provider 配置修正後）必須使用新 requestKey，並重新計入每小時配額；相同 key 不能充當 refresh。checking 與 unknown 都表示尚未證實健康。

## 發布界線

新增診斷 schema 缺失時僅此端點 fail closed；不把它加入全平台 `requiredTables`，不阻塞無關 API。發布仍必須在 dev／正式各自實際套用 0019、比對兩表四 triggers、外鍵與 deployed Pages code／bindings，再用同環境 operator key 驗證未授權、配置缺失、查核／重放、去敏 audit 與 quota。dev 刻意無 mail provider 配置時應保持 unknown/no network。此文件不是已套 migration／已部署／已完成 live readback 的聲明。

官方契約已於本切片實作時重新查閱：[List Domains](https://resend.com/docs/api-reference/domains/list-domains)、[Retrieve Domain](https://resend.com/docs/api-reference/domains/get-domain)、[Resend OpenAPI](https://github.com/resend/resend-openapi/blob/main/resend.yaml)。安全架構沿用全域 `newsletter-worker-standard`，沒有另造寄送機制。

## 官方實踐回讀

2026-10-31 v0.64已兩環境部署、0019／146來源DDL比對與實際診斷驗收。正式sender的provider metadata已回verified＋sending enabled；dev保留無配置／unknown。永久snapshot重放、quota與intent/completed audit通過；未寄信，deliveryVerified=false。這是官方本次已查證結果，其他部署者仍需自行執行上述gate，不能沿用此結果宣告自己的寄件能力。歷史v0.62的502與後續修復範圍見[階段紀錄](plans/AGENT-IDENTITY.md)。
