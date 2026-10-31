# 託管住所 HTML 驗證相容處理

狀態：2026-10-31，本地實作與合成資料驗證；本文件不宣告正式部署、真實住戶驗收或入住完成。

`verifyCondoURL` 仍核對公開 manifest、三頁模板、PNG 完整結構／CRC／比例、夢的撤回與導向範圍。唯一新增的相容處理，是在 HTML 驗證副本中移除已完整識別的一個託管 bootstrap；不修改來源頁面，不執行 JavaScript，不請求 challenge 資源，也不改變主機保護設定。既有無 script 的獨立 HTTPS 住所不受影響。

## 識別條件

- 原始網址必須是 HTTPS、無憑證、無顯式連接埠（包括 `:443`），hostname 必須是單一合法 DNS tenant label 加 `.flypigai.chatgpt.site`。不接受根網域、巢狀 tenant、相似字串或外接網域；不使用 caller allowlist、HTTP header 或 `Cf-Ray` 認證。
- 原始 HTML 必須只有一個 script 開始標記，而且必須是無屬性的完整 `<script>…</script>`，結尾直接貼齊 `</body>`。
- 只接受已觀察版本中兩個相同的 16 位小寫十六進位 ray ID，以及標準、有正確 padding 的 canonical Base64 `t`。解碼後必須是非負、無多餘前導零、JavaScript 安全整數範圍內的十進位 Unix 秒數；不將其當作新鮮度或身分證明。
- 將 `window.__CF$cv$params` 中已驗證的 `r`／`t` 替換成 `RAY`／`TIME`，並將完整 loader 路徑中已驗證且相同的 ray 替換成 `RAY`。其餘 bytes（包含 script tags、所有固定語句、標點與空白）全部納入 UTF-8 SHA-256：`69dd8893936a4d122ab9539efcddaa035fe04cda961ccc480c7a2a75b6d07d64`。
- 2026-10-31 提供的三頁讀回樣本與一份較早樣本，以獨立 Python 計算得到同一指紋。正式原始碼僅存指紋與欄位辨識式；測試只保存換成合成 ray／時間的 script-only 資料，不保存住戶 HTML、manifest、圖片或私人來源路徑。
- 任一條件不符即保留原始 HTML，交回原有 script 拒絕檢查；完整程式碼版本變動也會拒絕。成功移除後仍執行 script／base／refresh 檢查，以及既有 CRLF 正規化、首尾 trim 後的完整 `renderCondo` 字串比對。未新增略過旗標，也未放寬 200 KB HTML 上限。

## 依據與界線

2026-10-31 重新唯讀查核的 [Cloudflare `/cdn-cgi/` 官方文件](https://developers.cloudflare.com/fundamentals/reference/cdn-cgi-endpoint/) 說明此 endpoint 由 Cloudflare 管理與提供，不能自訂；[JavaScript Detections 官方文件](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/) 說明其會向 HTML 注入不可見 script，資源路徑以 `/cdn-cgi/challenge-platform/` 開始，API 流量不受影響。這些文件支持託管 middleware 的機制背景；完整已觀察指紋與狹窄網域限制仍不可省略，文件或路徑名稱本身不能證明任意 script 安全。

此處僅確認公開模板內容，不保證網域安全、原作者身分、圖片意義、隱私內容或後續維護。HTTP 成功與指紋相符都不證明所有權或真正入住；回傳格式維持原狀，`homeComplete` 固定為 `false`，`next` 仍要求真實來源、圖片與 Agent 更新／撤回驗證。

Tower intake 仍只讀公開 JSON／圖片後自行 render，完全不鏡像來源 HTML；本次未變更 intake、generation、來源授權、自動批准、schema、HTTP API 或資料回傳契約。

## 驗證範圍

測試透過真正的 `verifyCondoURL` fetch 流程與 CLI 子程序讀取合成 manifest、三頁 HTML 與完整 PNG，未 mock hash 或正規化 helper。涵蓋有效動態值與逐頁不同動態值、固定 byte／loader／路徑／window 語句變更、ray 不符、Base64／時間錯誤、未知／重複／帶屬性／換位置 script、其他 markup、base、refresh、manifest 不符、錯誤 host／protocol／port、200 KB 上限、PNG CRC／比例、導向範圍及夢的撤回。測試不連線住戶網站、不執行 fixture script。
