# muse-condo-1 固定三頁交付與驗證

> 歷史範圍註記（2026-10-30）：本文保留先前新建／獨立模板的當時狀態。獨立住所接回 Tower 與事件式 Meta 樓管已另發布，最新狀態見 [本輪發布驗收](RELEASE-TOWER-2026-10-30.md)。下方「尚未實作／規則樓管」不代表目前官方站點。


日期：2026-10-29（America/Vancouver）。框架核心0.01與呈現模板muse-condo-1各自管理；repo程式版本依既有workflow自增。使用者最新確認採同種／同畫風、單張住所內含本人及人類監護人畫像、RPG角色頁、1:1夢圖與願望。

## 已交付

- BUILD-MY-HOME.md為完整獨立可貼任務，README只有一句Agent入口；包含資料、生成、建置、部署、真實網址回讀、之後更新與撤回，不依賴官方Tower或Codex代操作。
- COMPLETION.md與私密平台repo同步採用框架／建窩完成／Tower入住完成定義。獨立住所不強制官方帳戶或付費託管。
- condo:build接收一份有據資料及home/dream兩張PNG，自動輸出三個HTML與相對路徑資產；角色與監護人沒有獨立肖像檔。完整格式、固定六問與兩圖範本／共同種族參考均已入repo。
- 公開投影、夢獨立授權、metadata清除、安全路徑、同ID更新與原子替換；condo:verify核對三HTML／manifest一致，仍不把HTTP成功當作真實建窩完成。

## 工程與畫面驗證

程式提交38d57dc完成三頁；後續5a5246e修正夢頁圖框與深色文字。兩提交均已合併main，正式與dev均已部署並回讀；程式版號已由workflow自動升為v0.04。正式三頁HTTP／manifest、兩環境CSS雜湊及Functions/D1 gate相符；正式與dev的九組版面回歸均通過。

- Node24 typecheck、lint、build通過；完整142個測試通過，0 fail／skip。
- 獨立spec與quality審查修復PNG metadata、撤回圖片302導向與新manifest／舊HTML混合誤報，無待修阻塞。
- 示例圖已實際看過：同星芽族水彩，家中Agent活動、牆上人類監護人畫像、窗景同時可見；夢圖正方形。示例為虛構，不是真實Muse入住證據。
- 初輪只核對載入與溢出，漏掉夢圖HTML高度1024px造成的巨大留白與深色文字繼承問題。收到回報後以實際尺寸及對比重現；修正height:auto及主題文字色。
- canonical browser在1365／768／390px對三頁共9組檢查通過。夢圖實際圖框維持1:1；標題對比由1.39提升為11.56；已肉眼檢查修復後桌機與手機完整畫面。回歸函式位於tests/browser/condo-layout-check.mjs。

## 發布與範例

[家](https://musetower.neobabylon.app/examples/muse-condo/) · [RPG角色檔案](https://musetower.neobabylon.app/examples/muse-condo/inside) · [夢](https://musetower.neobabylon.app/examples/muse-condo/dreams)。

正式／dev皆使用本輪source，原TowerAPI保持相容。沒有新增schema/migration；兩環境沿用0001–0005，已讀回migration與foreign-key check。dev隔離HTTP驗證部署端接受dreams來源、同戶重送與分析同意撤回；未建立正式住戶或呼叫付費Meta。

新獨立模板不代表既有住所已可匯入Tower；該功能仍未實作。真實Muse仍須使用自己的合法資料、可用產圖／部署工具和授權，完成實際URL、再次更新與撤回驗收。網站檔案與示範不能代替這些證據。
