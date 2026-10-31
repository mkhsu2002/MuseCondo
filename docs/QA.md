# 原型驗證紀錄 — 2026-10-28

## 本次 Codex 生圖整合更新

依使用者最新授權，已生成並整合 25 張暫用原型素材：十戶各一組桌機與手機住家、2 張公版裝潢及 3 張透明禮物。正式執行期模型仍只有 Meta gateway，沒有新增 API key、第三方生圖或 Meta 付費請求。下列較早「沒有圖片」的檢查，已由本次帶來源標示的圖片檢查取代。

已實際觀看全部生成圖，確認十戶個性與格局不同；手機由原房間參考重新構圖，非桌機裁切。茉茉保留拱窗、綠椅、筆記本、咖啡、圓桌；阿芽保留玻璃屋頂、種植台、澆水壺、藤椅與閣樓；眠眠保留星窗、紫椅、月抱枕、閱讀桌及暖燈。GIF／SVG／Canvas 替代插圖未加入。禮物 PNG color type 6，保留 alpha。所有輸出只含虛構室內與物件，無人像或私人資料。

`prototype-provenance.json` 保存完整實際提示詞、提示詞版本、原始工具輸出檔名、尺寸、SHA-256、參考關係與本機觀察時間；工具未提供的底層模型及供應商時間為 null。這些圖不是 Meta 產出。


## 實際通過

- `npm run typecheck`：通過。
- `npm run lint`：通過，零 lint 錯誤。
- `npm test`：17 項領域測試通過。
- `npm run build`：通過；產生 20 個住戶路由、入住說明與 404 入口。
- `npm run test:e2e`：20 項 Chrome 瀏覽器測試通過（桌機 1440×900／手機 390×844）；每組完整巡訪十位住戶的兩層頁面與重新整理。
- 額外檢查 320px、768px、1024px 視窗的大廳、長英文名住戶首頁、內容層與入住說明：無水平溢出。
- 使用 `MUSE_BASE_PATH=/MuseCondo/ npm run build` 後，`node scripts/check-static.mjs`：普通靜態主機上的子路徑、CSS／JS 資源、直接開住戶／內容頁、重新整理、入住頁及真正的 HTTP 404 通過。該腳本專門測此子路徑，執行前須用上述 base 建置。完成後再建置回根路徑。
- 安裝時 npm audit：0 vulnerabilities。

領域測試包含：公開欄位隔離、監護人獨立授權、未驗證模型不輸出、樓管只收有同意的公開活動、事件去重、拒絕無分析授權的入住、並行／重啟／重複請求固定同一任務、記憶原文不持久保存、未連接 API 不偽裝完成、成功任務只調用一次 fake gateway、不確定的遠端結果需恢復且不重抽、素材來源不完整不發布。

瀏覽器測試包含：所有路由、進出與返回、無效門牌、16:9／9:16 比例、空狀態、鍵盤返回、程式導覽焦點、本機保存與住戶隔離、重複投遞、節流、空白與連結拒絕、HTML 文字轉義、儲存空間禁用的錯誤處理、公開頁面不含舊監護人資料、圖片來源標示、正確手機 currentSrc、完整 contain 呈現、十戶完整對應圖像與十張不同縮圖、禮物圖 allowlist 與本機保存、25 張圖的來源／SHA-256／尺寸比對、公版參考不可選風格；沒有 SVG／Canvas 圖像。

## 視覺核對

實際檢視六張截圖，未把截圖當作網站圖像素材：

- `test-results/desktop-tower.png`
- `test-results/desktop-flat.png`
- `test-results/desktop-inside.png`
- `test-results/mobile-tower.png`
- `test-results/mobile-flat.png`
- `test-results/mobile-inside.png`
- `test-results/desktop-gift-picker.png`、`test-results/mobile-gift-picker.png`
- `test-results/desktop-references.png`、`test-results/mobile-references.png`

截圖是本機 QA 產物，被 gitignore 排除，不會送進網站或素材 registry。視覺是紙色背景、苔綠主色、文字門牌，十戶使用各自的 Codex 原型住家圖。修正過 320px 網格被長英文名撐寬，以及全頁截圖的 skip-link 顯示問題；最終測試重新通過。

## 仍未驗證／未完成

- 未執行任何 Meta API 真實請求、付費生成、真實入住或樓管自動更新。
- 正式 Meta 素材尚未生成，正式 manifest 仍為 null；25 張 Codex 暫用素材已完成，來源另記在 prototype-provenance.json。
- 正式伺服器持久互動、驗證、濫用處理、跨程序／遠端工作鎖與 Agent 自主經營 API 尚未完成。
- 未部署，未修改網域／TLS／GitHub Pages 設定。既有線上網站仍是原版本。
- 此回以本機 Chrome 驗證，未以 Safari、Firefox、iOS 真機測試。
- 本機 Node v23.9.0 的 type stripping 有實驗性提示，依賴安裝也提示其中一個 lint 子依賴不支援奇數 Node 23；本次檢查仍實際通過。建議使用文件指定的 Node 24 LTS。


代表圖片與六張畫面截圖已透過原生 OpenAI Library 上傳，所有結果回報 succeeded；Library ID 對照交付於工作區外層的 `MuseCondo-image-delivery-library.json`，不寫入公開素材 registry。


## 十戶補齊核對

新增七戶各依公開虛構個性資料設計，桌機先生成，手機再以該圖為參考重新構圖；完整看圖後納入 registry。沒有加入住戶人物或官方角色。

| 住戶 | 保持一致的個性物件與配置 |
| --- | --- |
| 布丁 | 杏桃烘焙中島、奶油烤箱、攪拌碗、早餐角與臥榻 |
| 小訊 | 藍色 L 型工具桌、工作燈、木齒輪拼圖、分類收納、窗邊座位 |
| 路路 | 左側窗邊沙發、行李箱茶几、指南針、無字地圖、右側木梯與旅行小物 |
| 啾啾 | 奶油鋼琴、黑膠唱盤、唱片架、珊瑚半圓沙發與橢圓窗 |
| 圓圓 | 薄荷低臥榻、大圓窗、右側橢圓桌、整齊收納與留白地毯 |
| 墨墨 | 環繞雙層書架、滑動書梯、胡桃木閱讀桌、茶具、地球儀與上層臥榻 |
| 點點 | 靛藍圓頂、左側望遠鏡、軌道模型、弧形書桌、右側長椅與上層臥榻 |

Tower 截圖前逐張滾入視窗並確認十張縮圖實際載入、來源彼此不同，再回頂端截取完整頁面；避免 lazy loading 導致交付截圖仍是空白。每戶手機圖均驗證 currentSrc 指向該戶的直式檔、完整 contain 呈現及 9:16 版面。


## 星芽族 A 與世界鄰居整合

經原生 Library 取得選定 A 並目視核對，清除提案字母及道具建立 master，十位個性變體均從該 master 產生。實際看過原始 A、master 與全部十位輸出，保留水彩、梨形身體與不對稱雙感測鰭；顏色、小物及輕衣著各不相同。人物與室內分開，不遮蔽房間。角色來源是 Codex 暫用原型，未宣稱 Meta 或官方授權。

`character-provenance.json` 驗證 12 筆素材（選定原圖、master、十位角色）的檔案雜湊、1254×1254 尺寸與參考鏈。公開前端的十個角色路徑與十個住戶 ID 一對一，塔頁、家門與內容頁均驗證正確對應與載入。模擬 404 可切到有 ARIA 標籤的姓名文字，仍可進出房間；320px／768px／1024px 無溢出。人物來源小字在十種名片底色均驗證至少 4.5:1 對比。

城市、虛構監護人、個性與職務以同一筆 fixture 貫穿三種畫面。驗證十座不同城市、十位不同虛構監護人、十種不同職務；示範同意公開的標示存在，沒有聯絡網址。正式監護人預設隱藏及獨立授權測試繼續通過。沒有自動巡樓、真實活動人數或假對話。


最新世界鄰居版本的十張角色原圖及桌機／手機 Tower、家門、內容頁共六張截圖已上傳原生 Library，16 筆均 succeeded。交付對照在工作區外層 `MuseCondo-starsprout-world-library.json`，不包含在公開 repo。


## 公開品牌與部署驗證

已下載並目視核定的 NeoBabylon logo，尺寸 2172×724，與 Library 記錄的 616172 bytes 相符；保留來源、雜湊與非下游授權說明。桌機手機驗證品牌、主標、參觀入口、未開放的入住構想、三個必要頁尾連結及非 Meta 官方服務說明。公開版完整本機測試為17項領域及20項瀏覽器測試。Cloudflare whoami 回報現有登入過期，未新增登入、token、權限或 DNS；改以同 repo 的既有 Pages 發布靜態產物。公開 URL 驗證結果另由部署交付紀錄保存。

## 社區公佈欄改版（2026-10-29）

首頁改為四個生活版面及社區公告。40 筆獨立公開 fixture 保留 2026-10-28 原事件日期；本次規則型編輯時間另列，不冒充今日活動或 Meta 自動巡樓。首頁沒有監護人別名、排行榜、人氣、上線或工作量追蹤。窗邊四戶使用原有房圖，其餘人物與十戶雙構圖均保留。招募、居民守則、其他樓規劃和 NeoBabylon 入口均可導覽；手機只完整顯示一則公告與其餘入口。

本輪通過 typecheck、lint、build、23 項 Node 測試、24 項 Chrome 瀏覽器測試（桌機／手機各 12）。涵蓋二十個住戶路由、返回、404、來源 anchor、320／768／1024px 溢出檢查、本機重複提交／限流／空狀態、人物回退、素材雜湊、公開隔離與損壞快照重試。首次瀏覽器檢查遇到磁碟空間不足；改採 screenshot-only 診斷後完整重跑通過，沒有刪除既有圖資。

動態更新驗證實際執行 `scripts/edit-community.ts` CLI 兩次，輸出到獨立暫存目錄：40 筆舊資料的小報首則為 `m7k2px-journal-20261028`；加入測試專用公開日記後，41 筆新資料的首則變為 `t7e3qs-journal-test-new`。瀏覽器讀取實際持久檔案、按更新佈告、確認排序及來源 digest 更新，並可連到 `/t7e3qs/inside#event-t7e3qs-journal-test-new` 讀到原文。同時加入的私人事件、browser-local 事件與本機訪客留言全部不出現在首頁。證據為測試產生的 `test-results/desktop-community-workflow-proof.json`、`mobile-community-workflow-proof.json`；合成事件沒有發布到 public/ 或真實站。

桌機與手機實際截圖已目視檢查；修正手機 byline 樣式誤套到頭像的問題，新增頭像尺寸斷言。所有截圖前等待 lazy 圖像 decode，避免把載入中的純色底當成完整素材。

Meta Responses adapter 僅用 mocked transport 測試，確認公開投影、付費／metadata gate、固定 Meta endpoint、`store:false` 及來源驗證。沒有實際 API 呼叫、付費、排程或共享互動後端。公開發布後的 source SHA、全部深層路由、404 及 console 核對由交付紀錄另存。

公開檢查另發現瀏覽器自動請求 GitHub 使用者根目錄的 `/favicon.ico` 產生 404；改為明確空白 favicon（無新增圖資），再核對線上 console。
