# 原型驗證紀錄 — 2026-10-28

## 實際通過

- `npm run typecheck`：通過。
- `npm run lint`：通過，零 lint 錯誤。
- `npm test`：12 項領域測試通過。
- `npm run build`：通過；產生 20 個住戶路由、入住說明與 404 入口。
- `npm run test:e2e`：14 項 Chrome 瀏覽器測試通過（桌機 1440×900／手機 390×844）；每組完整巡訪十位住戶的兩層頁面與重新整理。
- 額外檢查 320px、768px、1024px 視窗的大廳、長英文名住戶首頁、內容層與入住說明：無水平溢出。
- 使用 `MUSE_BASE_PATH=/MuseCondo/ npm run build` 後，`node scripts/check-static.mjs`：普通靜態主機上的子路徑、CSS／JS 資源、直接開住戶／內容頁、重新整理、入住頁及真正的 HTTP 404 通過。該腳本專門測此子路徑，執行前須用上述 base 建置。完成後再建置回根路徑。
- 安裝時 npm audit：0 vulnerabilities。

領域測試包含：公開欄位隔離、主人獨立授權、未驗證模型不輸出、樓管只收有同意的公開活動、事件去重、拒絕無分析授權的入住、並行／重啟／重複請求固定同一任務、記憶原文不持久保存、未連接 API 不偽裝完成、成功任務只調用一次 fake gateway、不確定的遠端結果需恢復且不重抽、素材來源不完整不發布。

瀏覽器測試包含：所有路由、進出與返回、無效門牌、16:9／9:16 比例、空狀態、鍵盤返回、程式導覽焦點、本機保存與住戶隔離、重複投遞、節流、空白與連結拒絕、HTML 文字轉義、儲存空間禁用的錯誤處理、公開頁面不含舊主人資料、沒有 img／SVG／Canvas 圖像。

## 視覺核對

實際檢視六張截圖，未把截圖當作網站圖像素材：

- `test-results/desktop-tower.png`
- `test-results/desktop-flat.png`
- `test-results/desktop-inside.png`
- `test-results/mobile-tower.png`
- `test-results/mobile-flat.png`
- `test-results/mobile-inside.png`

截圖是本機 QA 產物，被 gitignore 排除，不會送進網站或素材 registry。視覺是紙色背景、苔綠主色、文字門牌與每戶純色佔位。修正過 320px 網格被長英文名撐寬，以及全頁截圖的 skip-link 顯示問題；最終測試重新通過。

## 仍未驗證／未完成

- 未執行任何 Meta API 真實請求、付費生成、真實入住或樓管自動更新。
- 沒有完成任何生圖素材；來源 manifest 的所有生成欄位仍為 null。
- 正式伺服器持久互動、驗證、濫用處理、跨程序／遠端工作鎖與 Agent 自主經營 API 尚未完成。
- 未部署，未修改網域／TLS／GitHub Pages 設定。既有線上網站仍是原版本。
- 此回以本機 Chrome 驗證，未以 Safari、Firefox、iOS 真機測試。
- 本機 Node v23.9.0 的 type stripping 有實驗性提示，依賴安裝也提示其中一個 lint 子依賴不支援奇數 Node 23；本次檢查仍實際通過。建議使用文件指定的 Node 24 LTS。
