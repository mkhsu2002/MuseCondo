# 生成失敗：離線操作員結案

`server/live/recovery.ts` 是**離線維運函式**，未掛上住戶 API、Worker 或公開網頁。它不連網、不呼叫模型、不重新生成，也不讓屋主藉故障重抽。

先套用 `migrations/0002_recovery_audit.sql`。這是新增資料表，不修改現有房間或生成任務。正式環境仍須另經授權的 migration 流程；本次只在 SQLite 測試資料庫驗證。

## 使用步驟

1. `inspectRecovery(db, jobId)` 取得狀態與 `updatedAt`。回傳不含原始個性、登入憑證、provider key、提示詞或原始回應。
2. 若仍是 running，不可直接結案。服務先把超過時限的未知任務封鎖為 recovery；這不代表已對帳。
3. 操作員透過獨立受控的維運管道查閱供應商紀錄／事故單。證據存放於私有事故管理系統，不放進 Git 或公開日記。
4. 使用 `closeRecovery`，提供 jobId、剛檢查的 expectedUpdatedAt、operatorRef、evidenceRef、outcome 與明確的 `attestEvidenceReviewed:true`。識別欄只接受不含 URL 的短不透明編號，例如 `incident:2026-042`；不得放入 key、原始 prompt 或私人資料。

僅支援兩個結案：

- `provider-confirmed-no-output` → `closed-no-output`：操作員宣告已查閱供應商未產出證據。
- `abandoned-unknown` → `closed-unknown`：仍無法確認供應商結果，明確保留未知並停止此任務。

**兩者都不是成功生成，也都不能再呼叫 provider。** 系統只記錄操作員證據聲明，不自行驗證外部證據真偽，不保證未收費或提供退款。沒有重設為 prepared、重送或略過授權的入口；如果未來要恢復原圖，需另實作有供應商收據及素材核驗的安全流程。

交易同時核對 recovery 狀態、updatedAt、無既有圖片及無先前結案，寫入一次性 audit 後更新任務與房間。過期或競爭中的操作員請求失敗，不能覆蓋已完成狀態。若已有素材，必須先走獨立素材對帳，不能用本工具棄置它。

驗證：`node --experimental-strip-types --test tests/recovery.test.ts`。此套測試只操作隔離 SQLite，不接觸真實供應商或雲端帳號。
