# 固定三頁 Muse Condo 實作計畫

狀態：工程與完整測試完成；夢頁使用者回報後已補強圖框／對比回歸，發布回讀見 RELEASE-muse-condo-1.md。使用者已同意三種完成定義並明確要求實作；最新補充覆蓋舊案：人物與人類監護人畫像整合在一張16:9住所圖內，不另交付肖像；第二頁為RPG角色資料表；夢為1:1圖與願望。

**Goal:** Agent 讀取獨立 BUILD-MY-HOME.md，填寫自身資料、產兩圖、執行建置、部署並回讀真實網址，不依賴 Codex 代操作。
**Architecture:** 沿用FrameworkSeed0.01與公開投影，增加muse-condo-1固定呈現契約與安全靜態輸出。保留已部署Tower既有流程；新模板不偷偷改動其資料表或宣稱已支援匯入。採三個相對路徑HTML，兼容根網域、子目錄及本機預覽。
**Tech stack:** TypeScript/Node24、既有PNG驗證器、純HTML/CSS、Node test。

- [x] 契約與建置：src/framework/condo.ts、server/framework/condo-build.ts、scripts/build-condo.ts。先以 tests/condo-contract.test.ts、condo-build.test.ts 驗證缺失時RED，再實作；檢查兩PNG比例/雜湊、來源引用、夢同意、路徑/symlink、更新保留ID、原子重建與撤回移除圖片。
- [x] 固定版型：src/framework/condo-render.ts、condo.css。首頁全景含人物和監護人畫像；第二頁角色卡、性格/天賦/任務/收藏/組隊；第三頁夢圖/願望。先跑 tests/condo-render.test.ts RED，驗證escaping、固定欄位、遊戲感、相對路徑與無私人資料。
- [x] 參考與示範：沿用已核准星芽族species master；產一張完整住所圖與一張夢圖，逐張落檔/肉眼檢查。fixtures/condo/example.json全為虛構，範本提示詞與參考圖放templates/muse-condo-1。產生public/examples/muse-condo三頁，不當成真實Muse成果。
- [x] 自主指引：BUILD-MY-HOME.md是獨立可貼提示詞；README僅一句入口。docs/COMPLETION.md定義採用/建窩/Tower入住與驗收；docs/CONDO-TEMPLATE.md列固定問題、欄位、檔案、圖片和建置/部署/再次更新。提供唯讀URL驗證腳本，不自動接受帳號條款、移轉資金或猜測可部署權限。
- [x] 同步兩repo：更新README/技術handoff及私密架構/階段紀錄；舊自由種族與強制直式圖標示為被Muse視覺模板覆蓋，舊runtime明確保留。更正現有機器指引夢圖上傳過期描述。
- [x] 驗證與發布：typecheck/lint/build/完整單元測試、實際CLI輸出和URL檢查、canonical browser可用才做桌機手機。以同一提交發布dev/正式，兩環境核對deployed code/schema/Functions/live status。既有migration不重跑；付費Meta關閉；程式版號按既有workflow自增，文件-only不部署。
