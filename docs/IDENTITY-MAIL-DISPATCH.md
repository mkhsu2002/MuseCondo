# I05b2a 私有 dispatch 與串流核心

2026-10-31 發布現況：I05b 串流派送、exact-event 接線及 I05c 投遞／管理控制已隨 `f7e9a965`／v0.76 同步部署 dev／正式；0020–0026 已套用，321 個來源 DDL 一致、FK 錯誤 0，私有 Worker bytes 與發布 bundle 已回讀。資格防線與寄送前的 sender／handler／最後交易 guard 已接入，不能以本頁早期 b2 切片描述推定目前仍缺 readiness。

正式 sender、自己的五事件 webhook 與實際簽章 handler probe 已查驗；歷史：19:49–19:50 UTC live mail flag 仍 false，19:52:11 UTC 正式配置已暫存 true、當時待下一部署生效，dev false。現況：v0.76 已完成雙環境部署，部署快照的寄送旗標為 production=true／dev=false；正式設定已生效。沒有真實郵件發出，provider 投遞及附件實際收件未驗收。真正 Meta 的同 cycle／r0 已於 20:02 UTC 通過獨立 TaskAudit 並公開啟用原日夜兩圖；原 Agent／真人身份、收件／復原、T09 及下一次 cron 實際觸發驗收仍待。最新整合分界見[整合紀錄](plans/RESIDENT-MANAGER-INTEGRATION.md)，現行寄送與恢復門檻見[郵件控制](IDENTITY-MAIL-CONTROL.md)。

## 歷史：b2a／b2b 本地切片邊界（2026-10-31）

> Archived：以下原切片的未 push／未部署、mock provider 與 I05c 待接線敘述保留當時工程範圍；目前完整接線及實際部署以上方現況為準。下述技術細節仍作實作記錄，不能把本機訊號當正式寄信或收件證據。

2026-10-31：b2a 私有串流核心與 b2b 三類成功交易／receipt exact-event 接線已在本地實作，provider 全為固定 mock。未 push、部署、遠端 migration、讀取 provider secret、呼叫真 provider 或寄信。signed webhook／真正投遞 readiness／reconcile 留 I05c；不可單獨發布或啟用這一片。歷史 b1 核心文件描述的是無 transport 的單獨 factory，不代表目前 Pages transport 仍沿舊直寄路徑。

`IDENTITY_MAIL_DELIVERY_ENABLED` 必須精確等於 `true` 才能執行寄送，預設關閉。即使有 key／FROM，缺 namespace、contact key、合法 origin 或 schema 仍不得呼叫 provider。同步 `configured()` 只檢查執行配置；`processOne` 在任何 provider HTTP 前實查必要 schema，DO 每個控制請求再查同一份 `identityMailSchema`。此開關與 schema 檢查均不是 signed webhook、live health 或收件驗證；I05c 必須補上真正驗證過的 delivery readiness，不能只設定布林即宣稱已完成。

## 私有介面

沿既有 `IdentityCardNamespace`／`IdentityCardCoordinator`；Pages 用 `mail:<eventId 首兩位>` 256 個固定 routing shards。D1 永久交易是權威，DO 記憶體、實例身分或單一 shard 不作防重保證。獨立 Worker 的公開 fetch 永遠 404，`workers_dev`／`preview_urls` 維持 false。Pages `/__internal/identity-mail/*` 明確 404，公開 card proxy 自身也只接受 exact card paths。

DO 私有 POST `/__internal/identity-mail/` 控制 JSON 最多 2048 bytes，只接收以下 exact shape：

| 動作 | 輸入 | 私有輸出 |
| --- | --- | --- |
| `prepare` | `{eventId}` | `{descriptor,recipient,from}` 小型 metadata |
| `claim` | `{eventId,bodyDigest}` | 完整 frozen JSON 的 Response.body stream，私有 `X-Identity-Mail-Lease` header |
| `suppress` | `{eventId,bodyDigest,reason}`，reason 只允許 bounce／complaint／manual | `{recorded:true}` |
| `finish` | `{eventId,leaseId,state,providerId,errorCode}` | `{recorded:true}`；exact replay 相同，衝突 409 |

from／recipient／body／lease 控制只在私有 binding 之間流動，不能回公開 API、公開 headers、console 或 audit。DO 只持有既有 contact key／公鑰 ring，加上普通 `IDENTITY_MAIL_FROM` 設定；沒有 provider key／SDK／任意 endpoint。發布時每環境 Worker 的 FROM 與 Pages 對齊，歷史 frozen envelope 仍保留原 FROM／bytes。既有 EdDSA／Ed25519 JWK metadata 嚴格驗證、移除 alg 後按明確 Ed25519 import 的語意由 `identityCardTrust` 原樣共用。

`prepare` 用 b1 重驗並凍結；小型 `metadata()` 再獨立 qualify、核對 encrypted binding／原 email／template 與最後的原生時間 guard，不重建附件。Pages 針對這個地址 GET 固定 `https://api.resend.com/suppressions/<URLencoded exact email>`，redirect manual；404 才准繼續。200 必須符合 cached 官方契約的 object／id／email／origin／source_id／created_at，核對完整 email（只在 suppression policy 層忽略大小寫），並把負面原因傳回 DO 永久阻擋。負面結果即使另一實例已將事件 claim 或取消，也會從原 immutable encrypted envelope 核對 event／bodyDigest、取原地址派生 policy key 後持久化；此專用 suppress 路徑不授權 sending、不回 body／地址。任何未知、錯誤 shape、redirect、timeout／HTTP 失敗都保留 pending，不 claim。不列 contacts／全帳號 suppressions，不讀行銷訂閱狀態。

DO `claim` 再執行 b1 materialize 的目前資格、完整 chunks、signed JSON、signature 與 event/purpose HMAC；`materialized.guards()` 取得最後時鐘後，沒有中間 await，直接和 pending／attempt=0／無 ledger／local negative block guard、永久 lease insert、sending update、audit 放入同一個 D1 batch。只有成功的該次 response 可回 body；lost claim acknowledgement 留 sending，沒有 body recovery RPC。Pages 不對此 body 呼叫 text／json／arrayBuffer／JSON.stringify，直接 POST body stream 到固定 `https://api.resend.com/emails`，Idempotency-Key 永遠 event ID、redirect manual。

## 0021 持久資料與 I05c 契約

只新增 `0021_identity_mail_dispatch.sql`，不改 0012–0020。兩個環境未套用。永久表：

- `identity_mail_dispatches`：event_id 主鍵、唯一 lease_id、body_digest（b1 event/purpose HMAC）、body_length、canonical created_at。insert trigger 要求原 pending／attempt0／envelope digest+length 相符；不可更新／刪除。此 event 永久不再授權第二次 POST，即使狀態被其他程式改回 pending。
- `identity_mail_finish_receipts`：event_id 主鍵、同一 lease_id、固定欄位順序的小型 payload_json、canonical created_at。immutable／permanent；相同結果重放成功，不同結果 409。I05c reconcile／webhook 不能重寫此原始 HTTP finish receipt，須以自己的永久事件／audit 記錄後續事實。
- `identity_mail_suppressions`：`hashPrivate(contactKey,'mail-suppression',完整 ASCII email.toLowerCase())` 作 recipient_hash 主鍵，初始 reason 與 canonical created_at。永久負面 block，不存 raw email，不默默解除。它與 guardian-email 的大小寫保留 HMAC 是不同用途；不改既有 contact、不合併身分。I05c 使用相同 purpose／normalization 補入 webhook negative block；後續更嚴重原因應另存 event audit，不覆寫初始證據。

prepared、sending、suppressed、dispatch-finished audit 都不含地址、FROM、token、body 或明文 body SHA。0021 對後三類提供唯一與不可更新／刪除的保護。HTTP finish 保留 state／providerId／allowlisted errorCode；只允許 accepted＋合法 provider ID、unknown＋固定 unknown code，或確定非模糊 4xx 的安全拒絕碼。3xx、timeout、408／409／425／429、5xx 都是 unknown。

finish 不會把已有 accepted／delivered／bounced／failed／cancelled 降為其他 HTTP 結果，也不覆寫不同的非 null provider ID。早到 webhook 已寫 ID 而 HTTP timeout 不知道 ID（null）時，仍保存 exact unknown finish receipt，保留已知 ID 與終態。provider accepted 仍不等於 delivered。已 sending／unknown／accepted／delivered／bounced／failed 都不再 lease。撤證不表示召回已寄信。

## 本地驗證與未完成範圍

五個模板走真正 b1 factory＋D1 stored chunks＋私有 transport；4.4 MB／8 MiB PDF 為 synthetic bytes，signed JSON 真簽驗，POST bytes 與 frozen body 相同。這不是 PDF raster／收件或真 provider 驗收。回歸另涵蓋雙實例單 lease／POST、last-guard／local suppression 競態、lost claim ack／provider timeout、finish exact replay／ID conflict／early terminal、公開 router 隔離、預設 gate false／配置與 schema 缺件，以及不洩漏私人 payload 的既有 operator status/process。

最大 8 MiB 路徑捕捉實際 Pages＋DO prepare／claim／finish SQL 與 bindings，逐 statement 保守計數為正常 44、lost prepare acknowledgement 47，不超過 Free 50；每 query 最多 100 binds、SQL <100 KB、單參數 <1 MB。完整 synthetic DB 經 stdin 交給 Python 3.11+ 標準 SQLite，以原生 setlimit 對 function 32 args、100 binds、SQL 100 KB、row 2 MB、compound SELECT 5 編譯實際 SQL。沒有依賴寬鬆 Node SQLite 預設或只對 helper 字串計數。

此片已移除 production 直寄舊路徑；b2b 的三類成功／receipt 接線如下。監護人 accept 的既有 `mail.configured()` 前置條件仍保留，因此預設 delivery gate 關閉時新 accept 仍回原 503，並不消耗接受交易；已完成的歷史 receipt 不受此新交易門檻攔截。這項配置檢查不代表已投遞，真正 readiness 留 I05c。

## b2b 已提交事件的接線

`identityMailEventDispatcher` 每個 Pages request 各自捕捉自己的 environment 與 context。有 context 時，將同一 event 的 `processOne` promise 傳給 `waitUntil`；沒有 context 時直接 await 同一 process。所有錯誤都由 dispatch 邊界捕獲，不能把成功戶籍／卡片交易改回 503、撤銷或重跑。它不列舉 outbox、不新建 event、lease 或 idempotency key；sending／unknown／accepted 等永久結果仍由 b2a ledger 決定，不會第二次 POST。

- 監護人 accept：新 commit 與 `prior()` 的 exact permanent receipt（含 lost commit acknowledgement 讀回）都從已提交結果取原 invitation ID／mailEvent ID；再以本次授權 account、原邀請、kind 與完整 dedupe key 核對既存 event，才安全 await callback。propose／cancel／錯誤與不同 scope 沒有 dispatch。callback 可回 void 或 Promise，reject 不影響原 receipt／response。
- 復原：新 commit 與 central receipt（含 inner batch catch、authenticatedRetry outer catch）只在原 proof／input hash 已授權後，用該 request ID＋`security-notice`＋`identity-recovery:<requestId>` 查原事件；join 原 request、其 Agent 與既有 receipt，`LIMIT 2` 且必須恰有一筆。passkey 的 new-admission-required 原分支沒有 event，不補造通知；offline repair 會喚起原 security notice。保留原 epoch、token、instance、Passkey 與離線碼永久結果。
- 卡片：Pages 只在 exact POST issue／revoke 且可信 Coordinator response 成功後讀 clone；JSON 上限 4096 UTF-8 bytes，拒絕超限／非 JSON／非法 shape。CID 僅取自 core `card.credentialId` 或 `revokedCredentialId`，從未讀 caller body 選 event。SQL 以 CID、kind、`card:identity-card:<CID>`／`card:security-notice:<CID>`、pending 與 credential／本戶四方 tuple 查原 event，`LIMIT 2` 且必須恰有一筆。issue／reissue／revoke 舊 receipt 成功時沿同一路徑喚起原 pending event；條件式撤證未排通知時不建 event。公開 verify、keys、metadata、PDF／JSON GET 與失敗寫入皆不讀 lifecycle clone／dispatch。

沒有把 per-request callback 掛入長存的 card factory 或 in-flight cache；core／DO 仍沒有 provider key。公開 HTTP body、status、headers 與永久 receipt shape 不變，沒有加入 mail 控制、raw 地址、lease、正文或 provider raw result。default false、缺配置、schema／provider dependency 失敗均保留既存 pending；provider accepted 與真正 delivered 仍分開。

b2b 本地測試先重現監護人重播漏 callback、復原漏 callback、卡片 0 POST／0 waitUntil、real-render 卡信仍 pending，再驗證成功 dispatch。整合含 synthetic 戶籍／監護人資料、本機真正 Coordinator renderer＋repo TTF 產生超過 4 MB PDF、真 Ed25519 signed JSON、凍結附件→Pages stream→固定 provider stub；這是本機 real-render 證據，不是 Fang／K／真人住戶、正式平台、真 provider 或收件驗收。另以小 synthetic PDF adapter 的真 card core 驗證 issue／reissue／lost-ack revoke 各原 receipt 單 POST；復原 continue／repair 在 Pages＋實際 Coordinator 上驗證 default false、suppression 503 仍成功且 pending，再由原 receipt 喚起單次 POST。callback reject、new／lost-ack／historical receipts、跨戶／不同 body、無通知分支、有 context／無 context、並發單 lease 及非 lifecycle routes 均有回歸。

local-server migration inventory 已含 0018–0021，仍沒有 provider config／namespace／寄送。後續發布必須先完成 I05c 必要閘門，將兩環境的 0020／0021、普通 FROM、DO、Pages 與 deployed schema／code／live behavior 一起核對；不可只發前端或其中一環境。本片新增 cron／polling／CI 寄送觸發數與空跑數皆為零。
