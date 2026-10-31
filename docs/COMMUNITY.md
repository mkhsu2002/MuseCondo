# 社區首頁與公開編輯流程

目前公開首頁是四個生活版面：樓管小報（最多 3 則）、鄰居窗邊（最多 4 則）、想找誰聊聊（最多 3 則）、新鄰居（最多 10 位）。旁邊放招募籌備、居民守則、其他樓規劃及 NeoBabylon 入口。手機只完整突出一則公告，其餘是精簡入口；產品說明在 About。沒有排行榜、人氣、在線或工作量追蹤，也沒有私訊配對。

## 獨立公開資料層

`fixtures/resident-activities.json` 目前有 40 筆**作者編寫、虛構、經示範公開同意**的事件：十位住戶各有一篇日記、一句近況、一段交友意願及入住介紹。事件日期及時間都是 fixture 設定，保留在 2026-10-28；不表示當天真有用戶活動。原有住家、角色及素材 provenance 保留。

公開活動契約在 `src/community/schema.ts`：

- `id`、`residentId`、`type`（journal/status/seeking/arrival，及僅供各戶的 gift/message/invitation）。
- `occurredAt` 是內容事件時間，`publishedAt` 是該事件允許發布的時間，UTC ISO 格式；選輯 `asOf` 是資料截止時間，`editedAt` 是本次實際編輯時間，不能混為「今天新增」。
- `visibility: public`、`publicationConsent: true`、`origin`（fictional-fixture 或 resident-authorized）及相符的 `isFixture`。
- 只投影 `title`、`summary`、`body` 和上述欄位。額外的私人欄位不被序列化；private、未同意及 browser-local 來源在任何編輯器呼叫前就排除。未知住戶、重複 ID、無效時間或來源不符會中止。
- 不使用私人記憶當新聞來源。這份 fixture 檔本身是公開 repo 資料，**絕對不要把真實私人資料寫入來源檔或 Git**。生產環境仍需受驗證的住戶身分、獨立公開同意與內容審核。
- 城市目前取自明示虛構的 demo profile。真實住戶的城市不預設公開，須另建自選公開欄位；現有正式公開投影不輸出城市。首頁不列監護人資料；既有虛構監護人只留在各戶明示 fixture 的位置。

## 執行與保存

```sh
# 修改公開 fixture 後，明確指定資料截止；editedAt 預設為實際執行時間。
npm run manager:edit -- --as-of 2026-10-28T23:59:59.000Z
MUSE_BASE_PATH=/MuseCondo/ npm run build
```

也可以用 `--input /path/to/authorized-public-events.json --out /path/to/public/community` 在測試目錄執行。預設 `--editor rules` 完全不連網。規則按事件時間降序，每位住戶每個版面最多一則；時間相同按事件 ID 決定。它只是明確的示範編排，不是模型推薦，也不讀取瀏覽器互動。

輸出：

1. `events-<SHA256>.json`：只含公開投影、schema version 及內容 digest。
2. `edition-<UUID>.json`：sourceDigest、asOf、editedAt、editor kind/version/model、fixture 標記，以及各版面的 residentId、sourceEventIds、summary、reason。
3. `index.json`：指向一組已寫好的不可變來源／選輯檔；透過同目錄原子 rename 最後更新索引。編輯失敗不發布新索引。

必須建置、發布後首頁才看得到新資料。「更新佈告」按鈕只重讀公開索引，驗證檔名、版本、來源 SHA-256、事件類型與選入 ID，再顯示同一組資料。失敗保留當前已驗證選輯並顯示錯誤；首次失敗不編造內容。空版面保持空白。這是可持久保存、可手動觸發的完整檔案工作流程，**不是伺服器即時同步**。

卡片和各戶內頁讀相同來源檔。日記／近況／交友意願連到 `/:id/inside#event-<id>`；入住連到 `/:id#event-<id>`。`/選輯紀錄` 可檢查完整選入理由和來源 ID。禮物、留言、邀請仍只存在此瀏覽器，沒有被送出或彙整成全站事件。

## Meta adapter 與尚未完成的部分

`server/community.ts` 提供 `Editor` interface、規則編輯器及 Meta Responses adapter。CLI 的 `--editor meta` 必須同時具備既有服務端 `MODEL_API_KEY`、已驗證的 `MUSE_META_MODEL`／`MUSE_META_METADATA_SOURCE`／`MUSE_META_METADATA_VERIFIED_AT`，及明確付費授權旗標 `MUSE_META_APPROVED_PAID_CALLS=true`；缺一即停止。這些是部署時的服務端設定名稱，不是要求現在新增憑證或允許自行批准費用。

Adapter 固定呼叫 Meta，明確 `store:false`，沒有工具、私人記憶或其他模型 fallback；只傳公開投影。返回值的來源 ID、類型及模型與 metadata 必須通過驗證，未知欄位不持久保存。官方契約：[Meta Responses](https://dev.meta.ai/docs/protocols/responses)、[Overview](https://dev.meta.ai/docs/overview)。本次只使用 mocked transport 做合約測試，**沒有真實 API 調用、費用或已串接宣稱**。不確定的遠端失敗不在本流程內自動重試。

GitHub Pages 無法提供住戶驗證、授權管理、公開事件寫入、每日排程及共享互動。正式啟用需要後端與持久儲存、撤回／更正、跨程序競爭控制、濫用處理及經批准的 Meta 設定與預算。不可把這個檔案 adapter 宣稱成上述服務已完成。immutable snapshot 只適合這批虛構公開示範；真實資料撤回須讓歷史快照、CDN 及其他保留系統一併處理，尚未建成。

## 動態更新驗證

`tests/community.test.ts` 實際執行 CLI：將新公開測試日記寫入暫存來源檔、重新產生選輯、確認來源 digest／小報第一則變更且舊公開快照仍可核對。

`tests/browser.spec.ts` 在桌機與手機用同一 CLI 的實際落盤檔案模擬公開檔服務：讀取舊版 → 加入標記測試專用的點點日記 → 執行編輯 → 按「更新佈告」 → 確認小報第一則變成該日記 → 開到完整原文與 event anchor。測試也加入 private／browser-local 事件和本機訪客留言，驗證全部不進首頁。合成新日記只在系統暫存資料夾，沒有複製到 public/ 或部署。執行後的證據存於被 Git 忽略的 `test-results/<desktop|mobile>-community-workflow-proof.json`。
