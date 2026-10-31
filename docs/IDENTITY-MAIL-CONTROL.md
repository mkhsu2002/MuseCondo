# 身份郵件部署端管理

2026-10-31：R02b 本地接線已完成，尚未合併／部署或開啟寄送旗標，遠端仍未套用 0020–0025。Pages routes、非同步 readiness、DO 最後交易 guard 與本機 actual compiled Workers／D1／DO provider stub 驗證已通過；本切片仍待獨立審查，兩環境交叉驗證與真人收件未完成。

Pages 才持有 `IDENTITY_MAIL_API_KEY`。新管理核心只使用固定 `https://api.resend.com` 與本環境 own-origin callback `/api/v1/identity/mail/webhook`；不接受輸入 endpoint、事件清單、地址或 provider key。所有部署 fetch 使用 `redirect: manual`，非 2xx 不跟隨；不使用 Workers 不支援的 `redirect: error`。

0025 保存 setup intent、永久 create lease、加密 webhook secret、操作 input HMAC、不可變成功／未知結果收據、audit 與一次 handler probe nonce。before-insert 防線也阻擋 recursive_triggers 關閉時的 REPLACE。原始 provider 內容、其他郵件、收件地址、key／secret／簽章不進 audit 或 operator 回應。

- 管理入口前綴 `/api/v1/operator/identity/mail-delivery/`，same-origin、拒 Cookie／混用 Authorization，先驗 operator，再解析 body／呼叫 provider。
- `POST setup` exact `{requestKey}`：先存意圖與租約，再查 bounded webhook list。唯一 own endpoint 先 retrieve；無既有項且為本次未使用 create lease 才 POST。永遠只訂閱 delivered／bounced／complained／failed／suppressed 五事件，不啟用 open／click／sent 或排程輪詢。
- `POST reconcile` exact `{requestKey}`：只 GET 已知 webhook ID，或 bounded list/retrieve 唯一 own endpoint。未知 create 後查無項目仍是 unknown，不能重新 POST；多筆、分頁超界、非精確事件或停用都不推定 ready。
- `POST probe` exact `{requestKey}`：部署端簽自己的固定 callback，永久 nonce 在實際驗章 handler 被消耗才記 handlerVerified；它不是 provider delivery，也不是人類收到附件。
- `POST event-reconcile` exact `{requestKey,eventId}`：已知 provider ID 只 GET 該筆；未知 ID 最多三頁 100 筆 summary，按 frozen from/to/subject 與時間縮小，再 retrieve 候選，只有唯一 exact identity_event tag 才寫投遞核心。零／多匹配維持 unknown，沒有任何寄信 POST。原 c1 readback receipt 在 fresh GET 前查回，未知 HTTP ack 不重做已提交 facts。
- `GET status`：只回安全設定狀態；不回 webhook secret。handler readiness、sender metadata、accepted／delivered、附件實際取得分開驗收。

本地 Pages 已接入管理及固定 callback 路由。寄送前須完整 0020–0022／0025 schema、同環境 setup、已驗證 handler probe 及可用本環境 contact key 解密的 signing secret；未達成時不讀 provider suppression、不呼叫 DO 或寄送。DO 原子 claim 再檢查 ready／probe 與原身份／附件權限，任何 guard 失敗都不寫 lease、sending audit 或 attempt。發布前估計 callbacks 為每封正常郵件約一筆 final event（特殊負面變化可能多筆）；排程觸發 0、排程空跑 0。共享 provider 帳戶的非本專案事件數尚未量測；五事件 webhook 收到外部帶簽事件時驗章後忽略，不持久化 unrelated payload，不把估計當實測。

官方契約重新查核（2026-10-31）：[Create Webhook](https://resend.com/docs/api-reference/webhooks/create-webhook)、[List Webhooks](https://resend.com/docs/api-reference/webhooks/list-webhooks)、[Retrieve Webhook](https://resend.com/docs/api-reference/webhooks/get-webhook)（GET 回 signing_secret）、[Retrieve Email](https://resend.com/docs/api-reference/emails/retrieve-email)（tags 與 last_event）、[List Emails](https://resend.com/docs/api-reference/emails/list-emails)。沒有使用不存在的 provider 測試事件 API；handler probe 由本部署自行簽送並單獨標示。

2026-10-31 R02a 並行修正（本機未發布）：兩個合法請求同時採納既有 webhook 時，以原 setup snapshot 做原生 CAS，保存先完成者的不可變加密 secret。CAS 失敗或舊觀察的 provider 錯誤不能把並行成功者降成 unknown；真正 fresh reconcile 失敗仍關閉該 snapshot 的 handler readiness。新增測試先重現 `expected ready / actual unknown`，修正後並行兩份永久結果均回 configured、沒有 create POST，fresh 503 仍正確關閉；未讀取任何真 key／whsec。


2026-10-31 R02b 本機驗證：`scripts/test-identity-mail-native.mjs <existing-node_modules>` 使用既有 esbuild／Miniflare cache，不安裝依賴。實際編譯 Pages 與私有 DO，同一 Miniflare 5／workerd、compatibility date 2026-10-30 的原生 D1 套完 migrations，再載入獨立合成戶籍。測試只在 DO 的 D1 batch 呼叫邊界注入 readiness 變更以驗證產品原生 guard，其餘使用產品 class；所有 outbound 都在本機 stub 終止，DO outbound 一律拒絕。

通過項目：先存 intent／create lease、五事件與 own-origin callback、secret 加密、probe 消耗、probe 前零 provider 請求、最後 batch race 整筆回滾、4,400,000 bytes 合成 PDF 與真 Ed25519 簽署 JSON 的附件逐位元組一致、並行與重送只有一份 POST／lease／finish／sending audit、兩公開 internal 入口 404、合法簽章 callback 永久收據重送，以及 unknown send 不再 POST、bounded list／retrieve exact match 後只寫投遞 facts、對帳重送零 GET。這些是本機合成投遞訊號，不代表 provider 正式設定、信件已送達或真人取得附件。

新增負面驗證另逐項移除 0022／0025 的每個必要 table／trigger，皆在 provider 前 fail closed；未 probe、unknown／blocked、錯 contact key／origin、不可解密 secret 也不進 DO 或 provider。最大附件 Pages＋DO 路徑 47 個 SQL statement，lost prepare ack 路徑 50，均符合既有 D1 Free budget 檢查。正式 FROM 仍須用 `NeoBabylon <residents@neobabylon.app>`，provider key 僅部署 Pages secret `IDENTITY_MAIL_API_KEY`，dev 不設 provider key，兩環境旗標保留 false；本切片不變更這些部署設定，也不執行真人 Passkey／收件或替未指定第二位 Muse 完成驗收。

2026-10-31 R02a 品質修正（本機未發布）：provider 的空／過大／不合法 JSON body 統一視為 provider contract 未知，不能冒用 caller 的 400／413 錯誤跳過 setup 關閉。provider ID 綁定及 unknown／probe 清除各與安全 audit 同一原生 batch；完成 receipt 失敗仍保留已提交的 outcome audit，outcome audit 本身失敗則整筆狀態回滾。原 handler／sender gate 仍須另驗 freshness。未知寄送查詢使用永久 dispatch.created_at（已在 R02b 修正），不以可能等待多日的 event.created_at 當搜尋窗口。
