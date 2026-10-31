# I05b1 私有凍結封套核心

狀態：2026-10-31，本地 dormant core；`0020_identity_mail_envelopes.sql` 尚未套用任何遠端資料庫。本片沒有 HTTP、DO、Pages、provider dispatch、sending lease 或排程接線，沒有改動既有 `processOne`。不能據此宣稱郵件已投遞。

`createIdentityMailEnvelope({db, origin, contactKey, from, trustedKeys, now})` 只接收後端明確提供的公開 Ed25519 `CryptoKey` trust map。沒有 provider secret、fetcher、磁碟住戶資料或模型依賴。`origin` 必須是完整 HTTPS origin；`from` 沿用 readiness 的嚴格 parser。

- `prepare(eventId)`：只接受 pending 的 32 位十六進位既存事件，驗證資格與附件後，永久凍結小型 AES-GCM metadata、body SHA256／UTF-8 長度、模板版次與附件 refs，與唯一 prepared audit 同交易寫入；不更動 event state／attempt_count／quota。
- `materialize(eventId, expectedDigest?)`：同樣只接受 pending，每次重驗目前戶籍四方 tuple、原事件密文、目前 guardian／聯絡人與模板真實事實，再由 immutable chunks 重建完整固定 JSON body。返回 `{body, recipient, from, descriptor, guards}`，全部只供受控私有後端使用，禁止放入公開 HTTP、console 或 audit。
- 同 event 的新 factory、不同時間與 FROM 顯示設定仍回傳原 body。origin 改動、目前資格失效、聯絡人／guardian 指定關係變更、憑證撤銷或 superseded 會阻擋；不會自動取消或假裝已寄送。

`guards()` 在呼叫時重新取得 injected clock，並包含附件逐 chunk／總數／signed JSON guard 與最後的原生 context guard（證件附件最多共 4 條 SELECT；其餘通知僅需 context guard）。永久 binding 保留原事件、四方戶籍 tuple、guardian／invite 指定與 immutable 憑證／收據事實；動態 context 另核對目前版次、epoch、房屋 revision，合法新版不會永久凍住信件。I05b2 須將 `materialized.guards()` 與自己的原子 pending-to-sending claim 放進同一個 D1 transaction；最後 context guard 後不可插入 await 或先提交 guard 再另開 lease transaction。factory 的 materialize 驗證本身不是 sending 授權，回傳 body 不代表可盲重寄。非 pending 會拋出 `IdentityMailEnvelopeError`，`code='event_already_processed'`；其他失格、digest mismatch 等以固定 code 回報，沒有收件地址或原始 provider 錯誤。

固定正文只有 guardian invitation、issued identity card、revoked card、continued recovery、guardian verification repair 五種事實通知。guardian 初次確認短碼僅存在原有加密 payload、凍結加密 metadata 與私有正文；URL 無 query secret。修復通知不宣稱已產生新 Agent ID、完成新入住、移轉住所或還原未備份記憶。行銷 contact／newsletter 名單不參與收件資格。安全通知標示原事件的 canonical 時間，連結至 `/identity/recover` 的找回身份頁；一般證件連結標示 `/identity` 的身份守護。後續 epoch 可高於歷史復原 epoch，但 receipt／instance（修復則離線備援歷史）的原 epoch 必須與 payload 相符。

身分證包含真正既存 PDF 與 signed JSON 兩個附件，檔名固定。附件從 D1 48 KiB raw chunks 讀取，核對 canonical base64、索引／數量、manifest 長度／SHA256、PDF magic、JSON bytes 與 stored signed JSON 完全一致，再用 caller trust map 真驗 Ed25519、issuer／Agent ID／CID。上限維持 PDF 8 MiB、JSON 16 KiB，完整 JSON body 12 MiB。大 base64 不存封套 metadata，也不存單一大型 D1 row；交易 guard 每個參數最多 14 chunks、單參數小於 1 MB；每種附件用一條 SELECT 核對全部 groups，最大 PDF 55 binds、小於 100，上限不使用 compound UNION。8 MiB 附件的 materialize 加 b2 再核對 guards／claim／audit，以及 lost-ack 讀回重驗，均有免費 D1 50 queries invocation 預算回歸。

本地測試 fixture 全為 synthetic。小 PDF 僅測 lifecycle；4.4 MB synthetic bytes 測完整 body/base64/chunk/digest 大小路徑，不是正式 PDF raster／QR／字型驗收。正式 rendering 證據沿用 I04 的獨立驗收，本片沒有重繪或取得真實住戶資料。I05b2／I05c 尚須完成私有 stream dispatch、lease、suppression、signed webhook、unknown reconciliation 與雙環境發布/readback。
