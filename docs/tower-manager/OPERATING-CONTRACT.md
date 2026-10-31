# Tower 樓管：職責與受限維護契約

2026-10-31。此文件描述本分支的實作契約；不是正式環境已部署證明。既有文字迎新／公開更新與撤回仍採事件驅動，不因本功能改成排程。

| 職責 | 可讀 | 可寫 | 權限／限制 |
| --- | --- | --- | --- |
| 首頁外觀維護 | 固定主題、外觀歷史、公開投影 | 私密預覽、啟用、到期、回復、audit | 營運者或明確授權的外觀維護工具；固定 token，不收 CSS/HTML/JS/URL |
| 社區接待與公告 | 當下仍同意公開的事件 | 可追溯來源的公告 | 沿用既有事件鏈、撤回檢查與獨立預算；無事件不呼叫模型 |
| 每日照顧 | 外觀日曆、公開投影健康、待處理案件數 | 到期清理、私密摘要 | 不閱讀居民私密內容；不自動聯繫居民 |
| 每週社區整理 | 有來源的公開事件計數 | 私密回顧／自願活動草稿 | 不虛構居民、參與者或活動，不自動公開新活動 |
| 每月資源檢視 | 公告工作狀態／成本合計、權限設定是否存在 | 私密成本／權限檢視草稿 | 不增加預算、不修改權限 |

樓管不能撤 key、改／恢復身分、查看居民私密資料、變更付款或自行建立高權管理者。Tower Lord 後續另案；未來人類角色固定「樓主暫時代理人」，「正式交棒」保持停用，標示「專案既定方向，功能開發中」。本輪不建立此高權角色或可用交棒介面。

## 有界實作與驗證

M01 為本契約。M02 為 migration 0023、固定主題 core、不可變 requestKey／payload、CAS revision、持久 audit、受保護 operator API 與公開最小投影。預覽不影響公開指標；啟用必須引用已有預覽。回復引用歷史快照，仍經期限與 CAS 檢查。每次成功變更具永久 receipt，可重送但不可重綁。

M03 保留既有單棟塔日夜原圖與原頁面入口，加入可關閉 Halloween inline SVG 裝飾；不使用外部素材或新生成圖片。明確採 America/Vancouver 日曆：Halloween 2026-10-31 00:00（2026-10-31T07:00:00Z）至 2026-11-01 00:00（2026-11-01T07:00:00Z），到期立即以一般外觀投影，即使每日清理尚未執行。瀏覽器不依 host timezone 推測節日，也不自行啟用主題。

M04 固定每日／每週／每月 job registry，部署原生每日一次 tick 在同一時區計算 due；永久 period key、runs ledger、有限重試、無工作快速退出。只有 safe local DB 工作可重試；不建立付費、寄信或住戶事件輪詢。unknown 外部付費結果沿用既有不盲重送政策。預設一個月 28–31 次 tick；每日工作 3 個、週工作 1 個、月工作 1 個，無新消息的摘要不呼叫模型；每日 tick 無到期時 appearance job 為 no-op。部署／cron 綁定由整合發布負責，未部署前不宣稱 scheduled live。

不改 v0.65，不改圖片授權清單。發布須先套 dev／production migration，再部署一致的 API／前端及 scheduler，核對 deployed schema、code、live behavior 與 audit；正式驗證記錄另附，不用本機測試替代。

## API 與每日部署入口

- `GET /api/v1/tower/appearance`：唯讀 `{theme, revision, endsAt}`，不帶 actor、preview、授權資訊或內部日曆。0023 缺少表／trigger 時 503，前端自行回到一般外觀。
- `GET/POST /api/v1/operator/manager/appearance`：沿用 `X-Tower-Operator-Key`，拒絕 Cookie、跨站 Origin／Sec-Fetch-Site，body 上限 2 KiB。POST 僅固定欄位；preview 可填 theme、startsAt、endsAt、timezone。activate 使用 previewKey＋expectedRevision；rollback 使用 targetRevision＋expectedRevision。每次帶不可重綁 requestKey。
- `GET /api/v1/operator/manager/schedule`：私密 registry／最近 50 筆 runs。
- `POST /api/v1/manager/run-due`：僅 `X-Manager-Schedule-Key`，不接受 operator key 替代；body 僅 scheduledTime，與執行時間差不可超過 36 小時。每次五個 registry 檢查；同日重送只處理尚未完成且未超過兩次安全嘗試者。

`workers/tower-manager` 為獨立部署原生排程模板，每日 UTC 16:00 一次（Vancouver 夏令 09:00、冬令 08:00），無公開執行入口／D1／provider／operator key。僅持 `PUBLIC_ORIGIN` 與部署端 `MANAGER_SCHEDULE_TRIGGER_KEY`；Pages 持相同 scope-specific trigger secret。每月 28–31 次 Worker invocation；若 prod/dev 均啟用則各自計數。無分鐘 polling、無 CI／Codex automation。週/月工作於當地第一個 tick 產生本期私密草稿；首次啟用也只建當期，不補發歷史。

run key 固定 job＋當地 day／Monday week／month。claim lease 五分鐘，同一 period 最多兩次；完成不重跑，外部 HTTP 不盲重送。失敗只保留固定 error code，不儲存例外原文；本期兩次失敗後留待營運檢視，下期不是前期成功補帳。三種摘要不讀取私人內容：案件只算未到期待處理數，週稿只算目前公開 edition 中有效公開且非 fixture 事件，月稿明示 lifetime-as-of-run 的公告成本與有效 delegation 數，不假稱當月新增或自動改權。

發布順序：兩環境套 0023 → Pages code／前端 → 各自 scoped trigger secret → 獨立 cron Worker（先 dev 後 prod）→ 正式 operator preview／activate → public projection／audit／一次 native tick readback。未知付費工作不在此 registry；不變更現有 Meta 模型或價格假設，測試全為 synthetic／免費 DB 操作。

## 目前操作介面與視覺預覽界線

目前私密 API preview 是**配置預覽**（固定 token 快照與永久 receipt），尚無可操作的樓管後台或公開 previewKey／query 預覽入口。畫面驗收使用 canonical lane 的本機受控 synthetic projection；正式啟用仍只能由受保護 operator command 引用預覽、核對 expectedRevision。訪客的外觀按鈕只控制自己瀏覽器是否顯示目前已核准節慶裝飾，不能啟用未授權或過期的主題。關閉偏好可於本機儲存；儲存與 appearance service 失效均保留一般外觀、日夜按鈕、指南與公約。開著的分頁也在期限到達後收起裝飾，不等下次 reload 或 cron。

裝飾以固定本地 SVG 與 CSS 呈現暖燈、南瓜與小蝙蝠；裝飾層 aria-hidden／pointer-events none，切換為原生 button，尊重 reduced-motion（本版無動畫），所有素材不額外請求外部 URL、不生成新圖、不修改47圖授權。公開文案只有「萬聖夜，留一盞暖燈。」及外觀操作，不宣稱活動或居民參與。

## 本機驗證紀錄（2026-10-31，非正式部署）

原生 SQLite Tower focused suite 160/160；外觀 UI 三例含開頁到期、網路失敗、非allowlist輸入、原生按鈕，另有 build-output／既有 Pages runtime 回歸。`scripts/preview-tower-appearance.mjs` 僅綁 loopback，GET／HEAD、記憶體資料庫與固定 synthetic projection，不代理正式站、不收 key／POST；可由 `TOWER_PREVIEW_EXPIRY_SECONDS` 調整本機視覺到期秒數。視覺驗收 screenshot／最終結論由整合發布另記。

`scripts/test-tower-manager-native.mjs <existing-node_modules>` 可重用已有 Miniflare／esbuild cache，不安裝或變動專案依賴。2026-10-31 以 Wrangler 4.156.0 對應的 Miniflare 5／workerd、compatibility date 2026-10-30，在隔離原生 D1 batch 實際套完 migrations 後，編譯 Pages API 的 preview／activate／永久重送／衝突／公開投影／scheduler scope／五個 period ledger／不可刪 audit 均通過；另編譯 cron Worker，public 404 與 scheduled 一次 scoped dispatch 通過。原生 proof 阻斷所有外網；不代表 Cloudflare 正式 D1 或 Cron 已部署。

native proof 找到 Node mock 無法揭露的 redirect 契約差異，scheduler 已改 `manual` 並拒絕非2xx（含redirect），不追隨其他host。模板 compatibility date 固定為已驗證的2026-10-30，不隨 host 當天自動調整。
