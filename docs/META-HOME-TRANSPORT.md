# Meta Home transport（已實作、尚未正式接通）

官方契約核對日期：2026-10-29。

- [Meta overview](https://dev.meta.ai/docs/overview)：文字模型 `muse-spark-1.3` 與圖像模型 `muse-image-1.0`。
- [Image generation guide](https://dev.meta.ai/docs/image-generation)：生成與圖片編輯、base64 回傳、同圖不同構圖。
- [Images schema](https://dev.meta.ai/docs/api-reference/images/schemas)：JSON edits 的 `images[].image_url`、`size` 指定比例而非保證像素尺寸、`output_format`、tool enablement。
- [Responses API](https://dev.meta.ai/docs/protocols/responses)：文字推理回應與 `store:false`。

`server/live/meta-home.ts` 是實際 HTTP adapter，不是成功回傳示範圖的 stub。但 Worker／本地 runner **尚未接入此 adapter**；正式服務仍採用明確阻擋生成的 gateway。

## 三階段

1. Responses：最小個性摘要分類為封閉色盤、氣氛與陳設枚舉。禁止工具，不返回姓名等自由文字，`store:false`。
2. Images generations：枚舉組合成固定版本提示詞，生成 16:9 PNG。
3. Images edits：以剛產生的房間 PNG 作為 data URL 參考，改為 9:16，同一室內不重新設計。

圖像請求明確關閉網頁搜尋、圖片搜尋與 shell，僅接收 base64 bytes，不讀供應商回傳的外部 URL。型別、大小、PNG chunks／CRC／結構、zlib 掃描列解壓與濾鏡、比例檢查失敗就停止，不會繼續請求手機構圖。這不等於已完成視覺一致性 QA，仍需實際服務驗證。

## 不確定請求與記錄

套用 `0003_provider_requests.sql` 後，`databaseJournal` 在每次請求前寫入唯一 `(provider_key,stage)`。每次 claim 都再次檢查原工作仍 running、分析同意仍有效。紀錄不保存 API key、個性原文或 prompt。

`received` 只表示 HTTP JSON 收到，不代表圖片已驗收。`started` 或 `unknown` 皆不得自動重送。回應只有供應商 request header 時紀錄為 provider-request；沒有時明確使用 client-request 身分，**不把本地 ID 偽稱為供應商 generation ID**。

操作員可離線用 `inspectMetaRequests(db, jobId)` 讀取該工作各階段的 client/provider request ID 與時間，不含原文或鑰匙。

查閱的官方文件沒有提供可依本地 request key 查回結果或保證冪等計費的合約；因此不虛構 retrieve endpoint、不加沒有契約依據的冪等承諾。未知結果需要人工查證，見 [安全結案](RECOVERY.md)。初版不會從部分完成階段自動恢復／重新產圖。

## 啟用條件

需正式部署批准、現有授權 API key、明確付費預算、D1 bindings／migrations 驗證及視覺端到端驗收。`approvedPaidCalls` 是必須由部署方提供的授權 gate，不是費用計價或自動預算追蹤器。沒有批准或 key 時，零網路呼叫。

目前僅 mock HTTP＋真 SQLite journal 合約測試；未發出真實 Meta 請求。後續正式接通仍需落實費用限制、私密素材保留政策與人工 provider 對帳流程。
