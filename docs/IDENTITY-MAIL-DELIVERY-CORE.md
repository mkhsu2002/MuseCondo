# I05c1 私有投遞事實核心

2026-10-31 發布現況：本投遞核心與 I05c2 Pages／私有 Worker 管理路由已隨 `f7e9a965`／v0.76 同步部署 dev／正式；0020–0026 已實際套用，321 個來源 DDL 一致、FK 錯誤 0，資格與最後交易防線均已整合。正式 sender、自己的五事件 webhook 及實際簽章 handler probe 已查驗，並非目前仍 dormant 或未接 router。

歷史：19:49–19:50 UTC 的 live mail flag 仍 false；19:52:11 UTC 正式配置已暫存 true，當時待下一部署生效，dev false。現況：v0.76 已完成雙環境部署，部署快照的寄送旗標為 production=true／dev=false；正式設定已生效。沒有真實郵件發出，provider delivered、附件實際取得及監護／復原真人驗收未完成。真正 Meta 已於 20:02 UTC 在同 cycle／r0 通過獨立 TaskAudit，原日夜兩圖已公開啟用；不以首任務完成替代 I06／T09、真人收件／復原或下一次 cron 實際觸發驗收。最新分界見[整合紀錄](plans/RESIDENT-MANAGER-INTEGRATION.md)，目前管理 API、24 小時 readiness 與恢復流程見[郵件控制](IDENTITY-MAIL-CONTROL.md)。

## 歷史：c1 dormant core 切片範圍（2026-10-31）

> Archived：以下 c1 的未接路由／未部署、0020–0022 待套及 c2 待實作敘述，保留當時工程與測試邊界，不代表目前整合版本。原簽章／收據／投遞事實契約繼續保留，不將任何本機合成訊號擴張為實際投遞或收件。

2026-10-31：本地 dormant core。新增 `0022_identity_mail_delivery.sql` 與私有 factory；沒有接 Pages／Worker router，沒有 provider 管理 API、provider key、真 webhook secret、寄送、排程或遠端 migration。既有 delivery 開關不變，此片不能獨立發布或啟用寄送。0020–0022 均須在後續完整雙環境發布時與 Pages／DO／真正 readiness 一起驗證。

## 私有介面與 c2 邊界

`createIdentityMailDelivery({db,origin,contactKey,webhookSecret,now})` 沒有 fetcher、API key 或可指定 provider endpoint。`webhookSecret` 是部署端固定可信 signing secret 字串，或回傳該 secret 的安全 async getter；測試全為 synthetic。

- `handleWebhook(request)`：只檢查本 origin 與 POST，不決定公開 pathname。先讀最多 64 KiB 原始 bytes，以 `svix-id`／`svix-timestamp`／`svix-signature` 驗 HMAC，再解析 fatal UTF-8 JSON。BOM 不會在驗章前被 decoder 消除；已簽 BOM 可通過 crypto，但不是有效 JSON 而遭拒。duplicate decoded JSON keys 亦拒絕。
- `applyReadback(opId, providerEmail)`：只供已授權後端使用官方 GET email 的既存結果，要求 `id/from/to/subject/tags[]/last_event`；不執行 GET 或 POST，也不驗 operator。c2 必須先 operator auth、持久 op intent，再固定 provider GET，才可呼叫。不得讓公開 caller 任意選 fact。
- `receipt('webhook'|'readback', id)`：取回原永久安全結果，查無回 null。c2 lost-ack 重試應先讀 `receipt('readback',opId)`，有原結果即返回，不先做新的 GET；同 op ID 但不同 provider payload 一律 conflict。
- `status(eventId)`：私有安全觀測，只回 event ID、safe state、五種 flags、observed time 與 `deliveryVerified`，不回地址、FROM、subject、正文、密文或 lease。`deliveryVerified` 僅表示已觀察 provider delivered、無負面 fact 且狀態 delivered；不表示監護人已看信、下載附件或完成 I06。

c2 尚須實作部署端固定 own-origin webhook 的 setup intent／管理 API／encrypted whsec D1 保存、固定 provider GET 與 unknown reconciliation、公開 webhook path、受保護 operator path、真正 dispatch readiness，以及兩環境 code／schema／bindings／live behavior 交叉驗證。此片不提供新的 send 授權、不將 sending／unknown 重設 pending、不補 POST、不消費 quota，也不建立通知。

## 簽章與永久收據

依 2026-10-31 實讀的 [Resend raw-body 契約](https://resend.com/docs/webhooks/verify-webhooks-requests) 與 [Svix manual verification](https://docs.svix.com/receiving/verifying-payloads/how-manual)，簽名輸入是 UTF-8 `id.timestamp.` 前綴加完整原始 body bytes。手動 WebCrypto HMAC-SHA256／`subtle.verify`，不新增 SDK。支援空格分隔多個 v1，未知版本忽略；signature 必須 canonical Base64 的 32 bytes，secret 允許 canonical padded／unpadded Base64 的 1–512 bytes（官方固定向量為 18 bytes），不是硬限 32 bytes。Svix ID 最多 128 ASCII ID 字元、timestamp 最多 11 位 seconds、signature header 最多 4096 bytes。

Attempt timestamp 的 ±5 分鐘與 body 事件時間分開。app clock、初次原生 clock 與寫入前最後 native batch guard 皆檢查 attempt 時窗；native guard 以 rounded epoch milliseconds 消除 Julian-day 浮點邊界誤差。合法舊 body 可用新的 attempt timestamp 重送；receipt 永久保存，跨日仍回原結果。無效簽章、host、method、body 或過期 attempt 不寫入資料庫。

只處理 `email.delivered/bounced/complained/failed/suppressed`，其他有效 signed event Ack 忽略，不保存 shared account 其他專案的事件或追蹤。已存在的同 source／ID 在忽略事件類型之前先比對原 HMAC，因此把同 ID 換成 unsupported／foreign payload 也不能繞過 conflict。receipt 的 `payload_hmac` 綁定 contact key、origin、event、source、ID 與 raw bytes 的 Base64 表示；不保存 raw payload 或明文 SHA256。新 factory 與並發重放共用原永久結果，commit 成功但 ack 遺失亦先讀回，不重處理。

## 歷史關聯與單向事實

只有原 32hex `identity_event` tag、永久 dispatch lease 與 immutable envelope 的 digest／length 相符者可處理。webhook tags 採官方 object，GET tags 採 array 且 identity_event 必須唯一。解密原 `mail-envelope` AES event／purpose-bound control，驗 origin、原 event binding、模板及 attachment refs。它不 materialize 正文、不查 pending-only 資格，也不以目前 FROM、guardian、card head、recovery state 或 public consent 判斷歷史投遞資格。已撤卡、監護變動、身份 retired 或公開 consent 撤回仍可記當時發出的信件事實。

provider email ID 不能覆蓋不同的既知 ID；原 null 可由真訊號補入。同一 provider ID 若已屬其他 event，即使兩戶的 from／to／subject 相同也只忽略；最後 native guard 再查 ownership，競態不能將同一訊息認成兩份投遞。不新增跨舊 finish 的 unique index 或修改舊 migration。FROM 使用既有 strict parser 取 mailbox，再 ASCII casefold；TO 必須唯一完整 ASCII email，full-address casefold 等價；subject exact。不將 email 用來合併身份。最後 native guard 再核對 lease、原 event sealed context、envelope digest／length、provider ID、唯一 receipt 與 webhook 時窗，與所有 effects 在同一原生 batch。

`identity_mail_delivery_facts` 各自永久保留 delivered／bounced／complained／failed／suppressed 與 first observed time，不把 mail created_at 當 delivery timestamp。狀態先取 bounced／complained，再 failed／suppressed，再 delivered，且既有負面 terminal 不被後來 positive 降級。GET sent／delayed／opened／clicked／queued／scheduled／canceled 只取「provider 確認存在」的 accepted；不保存 tracking fact、不從 created_at 推論實際 delivery。原 HTTP finish receipt 完全不改。

bounce／complaint／suppressed 才加入原 0021 負面 address policy，使用 `hashPrivate(contactKey,'mail-suppression',完整 ASCII email.toLowerCase())`；不改 guardian-email hash 或身份。suppressed 的官方 `previous_bounce`／`previous_complaint` 分別採 bounce／complaint；未知 reason 或 GET last_event 無 suppression 細節則採既有 manual 保守封鎖分類。此 manual 是本地未具體分類 policy，不聲稱 provider 人工操作。初始 block reason 永不覆寫，較嚴重的後續事實另保 facts／audit。audit 僅留 allowlisted suppression reason／type，不存 diagnosticCode、message 或 failed reason 原文。`email.failed` 不永久封鎖地址。

## 0022 與本地驗證

0022 只新增 3 表、9 triggers：永久 `(source,message_id)` receipt、每 event／fact 的 first-observed facts、與 receipt 精確綁定的 audit；三表均有 immutable／permanent triggers，另有 ledger／envelope／event binding。receipt 額外綁定 origin，safe private lookup 不跨 origin 回傳。全部時間欄位要求 canonical millisecond UTC 且 `IS NOT NULL`；ID／HMAC 檢查 ASCII、BLOB length 與 allowlist。沒有改既有 0012–0021。

本地測試沿真正 b1 prepare→b2 claim，再以 synthetic Svix secret 簽章，交由真 WebCrypto＋SQLite。涵蓋官方固定向量、Unicode／BOM／whitespace／byte flip、多 signature、app／native queued clock、五 events／雙 tags shape、foreign／no-ledger／metadata／provider ID 不串戶、歷史撤證／換 guardian、雙 runtime／並發／lost commit ack／payload conflict、early webhook＋late finish、不同順序 webhook／GET negatives、casefold policy、failed 不封 address、安全輸出與永久 schema 約束。

實際 webhook negative path 為 12 SQL statements，private readback 為 10；逐 statement 保守計數均低於 Free 50。捕捉實際 SQL／binds，複製完整 synthetic DB 到 Python 3.11+ 標準 SQLite，原生 `setlimit` 以 function 32 args、100 binds、100 KB SQL、2 MB row、compound SELECT 5 編譯 26 queries。沒有新增 CI／cron／polling 或公開 harness。大附件與 renderer 沿用 I04／b2 已有證據，此片不重繪，也不表示正式 provider 或真人收件驗收。
