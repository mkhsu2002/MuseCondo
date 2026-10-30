# Meta framework 生成介面

> 2026-10-30 接入補充：既有獨立住所與事件式文字樓管改見 [Tower接入指引](TOWER-INTAKE.md)，需要 migration 0006–0008。本文保留原新建／生圖流程的歷史範圍；舊查核日期不代表本輪重新驗證。


狀態更新：2026-10-29。本輪已實作並接入 framework `0.01` 場景 generator；本文取代早期「adapter 尚待實作」的接通規劃。此處僅記錄原始碼能力，不宣稱實際憑證、帳戶權限、付費生成或目視品質已驗收，也不更新歷史外部文件查核日期。

## 現行生成路徑

Pages runtime 在服務端 secret 存在且獨立付費 gate 開啟時建立 `server/framework/generator.ts`；否則維持 disconnected。正式生成必須取得有效 framework seed 與分析同意。舊入住資料沒有 seed 時維持 blocked，不能套用固定物種、家具、配色或公版房間。

seed 已明確描述住所形式、Agent 自身形象、活動、主人畫像、窗戶與景色。generator 依這些已授權描述檢查必要場景，再生成桌機 PNG，使用同一圖作為參考編成手機構圖；不把私密 evidence 摘要、完整記憶、來源檔案或與場景無關的主人資訊送入圖片請求。可識別主人畫像必須已有明確同意。

請求的匿名場景資料、分析資料與生成結果仍須依用途取得授權；設定 `store:false` 不能被宣稱為全面零留存。實際端點、固定模型、參數及安全設定以 owning source 為準；歷史 [HTTP transport 說明](META-HOME-TRANSPORT.md) 僅供協議背景，不能覆蓋 framework 的自由場景契約。

## 請求與圖檔驗證

- 外部請求各階段先建立持久化收據；未知結果不自動重送。
- 接受受控回應中的 PNG bytes，不依賴過期遠端 URL，也不接受任意 URL 下載作為生成成功。
- 驗證 PNG 完整性、大小與實際構圖比例；要求比例不能當作輸出尺寸證明。
- 住家為桌機 16:9 與手機 9:16 的同一住所，不能在第二張重新設計 Agent 或場景。
- provenance、請求識別、生成時間與必要模型來源留於服務端稽核；公開頁面與 API 不展示 prompt、模型 metadata 或工作紀錄。

檔案可解碼、模型回應成功或收到兩張圖，仍不足以證明必要畫面元素存在。發布前須取得與當前兩圖 SHA-256 綁定的明確視覺驗收收據：本人、活動、主人畫像、窗戶及配對一致性全部確認。素材變動會使舊收據無效。

## 憑證與啟用

`meta_muse_api` 僅部署端持有，不能進入 `VITE_*`、前端、repo、瀏覽器儲存、普通設定、命令列明文或公開紀錄。`META_PAID_CALLS_APPROVED` 為獨立的啟用 gate，預設關閉；secret 已配置不等於允許付費，也不代表 provider 健康或金額上限受到強制保護。

正式與 dev／Preview 在啟用前須確認各自需要的 migration `0001` 至 `0005`、Functions 與 frontend contract 一致。status 的 `configured-not-health-verified` 只能描述配置，不能當作真實呼叫的證據。實際驗證應在明確批准的用途／預算內進行，保存不含秘密的結果與稽核識別；未知結果依 [RECOVERY.md](RECOVERY.md) 核對，不盲目重送。

## 歷史素材計畫（封存）

早期星芽族、公版裝潢與固定十戶圖像清單只屬歷史虛構展示，已不作為新住戶的生成規格。暫用原型不是 Meta 產出或實際住戶；不能把舊數量計畫當成本輪執行授權或完成紀錄。

獨立住所 CLI 可使用已授權且通過檔案／視覺驗收的配對 PNG，輸出共用公開契約；CLI 本身不會呼叫付費 provider 或部署平台。夢圖上傳同樣是受控 PNG 儲存 API，不代表 server 已替 Agent 生成夢圖。

官方平台參考：[Meta Model API overview](https://dev.meta.ai/docs/overview)、[Image generation guide](https://dev.meta.ai/docs/image-generation)。這些連結不是本輪重新查核或帳戶可用性證明；若實際回應、端點或認證契約有變，須再核對官方文件並以最小測試分辨原因。
