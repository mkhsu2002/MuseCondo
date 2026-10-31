# 身份郵件部署端管理

2026-10-31：R02a 本地切片，尚未接入正式路由、開寄送 gate 或部署 0025。免費 provider stub 四項測試、typecheck 與 scoped lint 通過；獨立審查、反例擴充、actual compiled Workers/D1、兩環境與真人收件仍待完成。

Pages 才持有 `IDENTITY_MAIL_API_KEY`。新管理核心只使用固定 `https://api.resend.com` 與本環境 own-origin callback `/api/v1/identity/mail/webhook`；不接受輸入 endpoint、事件清單、地址或 provider key。所有部署 fetch 使用 `redirect: manual`，非 2xx 不跟隨；不使用 Workers 不支援的 `redirect: error`。

0025 保存 setup intent、永久 create lease、加密 webhook secret、操作 input HMAC、不可變成功／未知結果收據、audit 與一次 handler probe nonce。before-insert 防線也阻擋 recursive_triggers 關閉時的 REPLACE。原始 provider 內容、其他郵件、收件地址、key／secret／簽章不進 audit 或 operator 回應。

- 管理入口前綴 `/api/v1/operator/identity/mail-delivery/`，same-origin、拒 Cookie／混用 Authorization，先驗 operator，再解析 body／呼叫 provider。
- `POST setup` exact `{requestKey}`：先存意圖與租約，再查 bounded webhook list。唯一 own endpoint 先 retrieve；無既有項且為本次未使用 create lease 才 POST。永遠只訂閱 delivered／bounced／complained／failed／suppressed 五事件，不啟用 open／click／sent 或排程輪詢。
- `POST reconcile` exact `{requestKey}`：只 GET 已知 webhook ID，或 bounded list/retrieve 唯一 own endpoint。未知 create 後查無項目仍是 unknown，不能重新 POST；多筆、分頁超界、非精確事件或停用都不推定 ready。
- `POST probe` exact `{requestKey}`：部署端簽自己的固定 callback，永久 nonce 在實際驗章 handler 被消耗才記 handlerVerified；它不是 provider delivery，也不是人類收到附件。
- `POST event-reconcile` exact `{requestKey,eventId}`：已知 provider ID 只 GET 該筆；未知 ID 最多三頁 100 筆 summary，按 frozen from/to/subject 與時間縮小，再 retrieve 候選，只有唯一 exact identity_event tag 才寫投遞核心。零／多匹配維持 unknown，沒有任何寄信 POST。原 c1 readback receipt 在 fresh GET 前查回，未知 HTTP ack 不重做已提交 facts。
- `GET status`：只回安全設定狀態；不回 webhook secret。handler readiness、sender metadata、accepted／delivered、附件實際取得分開驗收。

目前核心尚未接入 Pages；後續 R02b 須補 async ready gate 與 DO 原子 claim guard，再以实际編譯的 Pages／DO／D1 及無料 stub 驗證。發布前估計 callbacks 為每封正常郵件約一筆 final event（特殊負面變化可能多筆）；排程觸發 0、排程空跑 0。共享 provider 帳戶的非本專案事件數尚未量測；五事件 webhook 收到外部帶簽事件時驗章後忽略，不持久化 unrelated payload，不把估計當實測。

官方契約重新查核（2026-10-31）：[Create Webhook](https://resend.com/docs/api-reference/webhooks/create-webhook)、[List Webhooks](https://resend.com/docs/api-reference/webhooks/list-webhooks)、[Retrieve Webhook](https://resend.com/docs/api-reference/webhooks/get-webhook)（GET 回 signing_secret）、[Retrieve Email](https://resend.com/docs/api-reference/emails/retrieve-email)（tags 與 last_event）、[List Emails](https://resend.com/docs/api-reference/emails/list-emails)。沒有使用不存在的 provider 測試事件 API；handler probe 由本部署自行簽送並單獨標示。
