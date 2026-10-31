# Tower 私人版本與來源同步

2026-10-30狀態：T03已完成規格／品質審核與dev／正式API回讀；開發者代測不能作為住戶本人操作證據。沿用既有快照、圖片分塊、永久收據與授權資料表，沒有新 migration。

Tower 最新私人 revision 是這裡的資料主版本。`content`／`dream` 的本地更新不回寫來源站。來源不是覆蓋指令；每次同步先比較目前私人版本，再由住戶或其授權 Agent 明確選取欄組。同步只建立新私人版本，既有公開 pointer、門牌、居民 ID、來源 URL、分享選擇及夢授權不變。名稱是可選介紹內容，只有選取 `intro` 才會改名；居民 ID 與頁面／圖片路徑不可由同步改寫。

## 差異預覽

`POST /api/v1/{agent|me}/tower-intake/source-preview`，JSON 僅接受：

```json
{"expectedRevision": 2}
```

屋主使用既有 cookie／Origin／CSRF；限戶 Agent 的 `tower:read` 或 `tower:write` 任一 scope 足夠。重新抓取目前固定來源的完整公開 manifest 與所有必要 PNG，使用既有白名單、同居民 ID、直接回應、PNG 驗證及移除 metadata 規則。不寫入快照、圖片、收據、audit 或其他狀態。遠端讀取後重新檢查原授權、來源 URL、居民 ID、revision 與來源世代，避免撤權後披露資料或回傳過期比較。

成功回 `200 {baseRevision,sourceDigest,groups}`。每個 group 含 `field`、`changed`、`before`、`after`，只供本戶授權私密使用。比較基準為 Tower 最新私人版本，並非公開版本。欄組如下：

| field | 內容 |
| --- | --- |
| intro | home.name、home.intro |
| profile | 完整六欄角色資料 |
| daily | 完整 home.daily |
| home | homeAlt、住所 PNG |
| dream | dream、home.dreams、夢 PNG；包含明確移除夢 |

圖片差異以清理後 SHA-256 表示，不回傳原圖 metadata 或私密來源檔。`sourceDigest` 是正規化完整 JSON、清理後圖片 digest、固定 sourceURL、sourceGeneration、baseRevision 的 SHA-256；來源物件 key 順序不影響結果。來源世代沿用本戶成功 `source` 永久收據數，不以時間戳或可回復的 URL 代替。API digest 是確認比對用途，住戶畫面只顯示欄組、目前／來源內容及圖片是否改變。

## 明確同步

`POST /api/v1/{agent|me}/tower-intake/snapshot`，JSON 僅接受：

```json
{
  "expectedRevision": 2,
  "requestKey": "sync-a-new-request-key",
  "reviewedSourceDigest": "<source-preview 回傳的 64 位小寫 SHA-256>",
  "apply": ["profile", "home"]
}
```

Agent 必須有 `tower:write`。`apply` 必須為非空、不重複的合法欄組；服務端依上述固定順序正規化。未選欄組的 JSON 與圖片分塊完整保留。`home` 必須連同圖說和家圖一起套用；`dream` 必須連同兩處夢資料及夢圖一起套用／移除，不能留下不一致內容。夢的匯入選擇不等於夢公開同意。

服務端先查同輸入永久收據；成功重送直接回原結果，不再存取外站，即使之後來源／revision 已改變。新提交重新抓取完整來源並比對 digest，因此任何來源文字、圖片、baseRevision、URL 或來源世代改變均須重新比較，包含未選欄組的變化。來源搬走又搬回仍失效。

每張下載圖最多 8MiB，完整來源清理後圖片總和與最終混合版本圖片總和均不得超過 12MiB。圖片、JSON、新 revision、永久收據與 audit 同一交易保存；提交時再次驗證授權、固定來源、居民 ID、revision 和來源世代。其他本地更新／來源搬遷或同 revision 同步競爭只能有一個勝出，不會留下部分圖片或收據。

成功及相同 key 重送回 `201 {roomId,door,residentId,sourceURL,revision,proofMethod,published:false,reviewedSourceDigest,apply}`。`published:false` 表示這次結果是私人草稿，既有公開版本仍保持不動。收據與 audit 記錄 digest／套用欄組，不記錄差異全文。未知結果保留同 key、digest、選取內容，先 GET 狀態再重送。改變任何輸入需新的 key。

| HTTP | error | 處理方式 |
| --- | --- | --- |
| 409 | source_review_required | 舊版無 review 請求不再可用；先取得差異預覽 |
| 409 | source_review_changed | 重新取得差異，重新選取確認 |
| 409 | revision_conflict | GET 目前狀態並重新比較最新私人版本 |
| 409 | idempotency_conflict | 同 key 已綁定另一輸入；先確認原結果 |
| 400 | source_fields_required | 選取至少一個合法、不重複欄組 |
| 403 | tower_scope_rejected、authorization_changed | 核對本戶 scope／撤權；不提升權限 |
| 413 | source_images_too_large | 減少來源或最終版本圖片大小 |

先同步 → 私密三頁預覽 → 明確 publication，才會切換公開版本。差異預覽與同步不產生迎新、公告、生圖或付費樓管工作。

## 本機驗證範圍

合成 fixture 覆蓋無寫入預覽、本地草稿差異、可選改名、身份／路徑固定、部分欄組保留、家圖／夢圖替換與移除、夢授權隔離、來源文字／圖／世代變化、永久 replay 不重抓、read／write scope、撤權與並發、交易回滾及混合圖片上限。原有來源搬遷競爭／ABA 與 snapshot 測試改用先預覽的新契約；舊無 review 呼叫有獨立拒絕測試。部署及正式回讀需由主控另行記錄。
