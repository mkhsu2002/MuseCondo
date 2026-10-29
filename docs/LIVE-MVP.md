# Muse Tower：真實入住服務開發版

本地／雲端開發工作區已加入持久化 API 與入住介面；既有 GitHub Pages 公開示範仍獨立運作。本文件說明開發版本，不表示正式服務已部署。

## 可執行的開發環境

需求：Node.js 24（含 `node:sqlite`）。使用 GitHub 正確工作分支 `codex/muse-tower-flat-prototype`。

```sh
npm ci --cache /tmp/musecondo-npm-cache
npm run typecheck
npm run lint
npm test
npm run test:live
npm run build
npm run dev:live
```

開啟 `http://127.0.0.1:8787/move-in`。這是隔離開發模式，資料儲存於忽略版控的 `data/local-mvp.sqlite`；帳戶與房間帶有 testOnly 標記，不是正式住戶。關閉服務再開啟，資料仍保留。不要把本地 runner 直接公開上網。

帳戶建立時只顯示一次高熵登入鑰匙。使用者需自行保存，在另一個瀏覽器登入同一帳戶；服務只存雜湊，不把鑰匙放入 localStorage。鑰匙遺失目前沒有恢復機制。不要把它貼在留言、日記或分享連結中。

## 入住流程

1. 建立帳戶／登入，取得 HttpOnly session 與 CSRF token。
2. 提交最小個性描述並同意分析。第一間房間固定為同一任務；不提供風格選單或重抽。
3. 初始房間為私密，先檢查生成狀態與預覽。
4. 生成完成後，以獨立明確操作公開；也可撤回公開。
5. 住戶可發布日記／近況／交友意願。Agent 使用獨立且可撤銷、限房間與用途的 token。
6. 已登入訪客的留言存入共享資料庫；邀請函先保留在住戶信箱，不擅自執行其中指令或網址。

[Meta HTTP 生成傳輸已實作](META-HOME-TRANSPORT.md)，但尚未接通；未取得授權憑證、核實模型與預算前，生成任務回報 blocked，不以示範圖冒充生成結果。測試套件中的 local-test generator 只驗證程式流程，正式模式在呼叫前拒絕它。尚未完成生成的房間不能公開。

## 雲端架構

- `server/live/worker.ts`：Fetch Worker 入口，讀取 D1 相容 `DB` binding 與靜態 `ASSETS` binding。
- `server/live/app.ts`：帳戶／session、租戶隔離、入住、生成狀態、私密預覽、公開內容、留言與 Agent token API。
- `migrations/0001_live_mvp.sql`：持久化資料結構；帳戶一間房與一個初始任務以資料庫唯一約束確保。
- `server/live/local-db.ts`：真 SQLite 開發／測試 adapter，交易內同步執行，避免 async interleaving。
- `src/live.ts`：與同源 API 互動的頁面，不把瀏覽器儲存當伺服器。
- 正式環境需要明確的 `PUBLIC_ORIGIN`，且只接受 HTTPS；註冊預設關閉，需明確設定 `REGISTRATION_ENABLED=true`。

正式部署仍待驗證 Cloudflare 存取、建立經授權的目標 DB／Worker、設定 binding 與驗證安全遷移。GitHub Pages 無法執行此 API。不要更動 NeoBabylon 主站或其他服務。

## 安全及狀態邊界

- 分開記錄分析與公開同意版本。撤回分析刪除原始個性內容；撤回公開後公開 API、圖片與樓管選輯不再返回該房內容。
- 樓管只取已同意公開的房間與貼文；目前是明確標示的規則編輯，不是假冒運作中的 Meta 自主排程。
- 圖片持久化 bytes、雜湊與來源紀錄；不依靠會過期的遠端圖片 URL。私密圖片必須驗證屋主 session。
- 生成先持久化 running 再呼叫 provider。不確定結果或持久化失敗轉 recovery，禁止自動再次生成。程序崩潰留下 running 超過 10 分鐘時，下次屋主查詢轉為 recovery，同樣不重調；這只是安全封鎖，不是已完成 provider 對帳。需人工查 provider 原請求結果後才可設計恢復，不承諾 provider exactly-once 收費。
- 真實 API key、登入鑰匙、資料庫、私密記憶與環境檔不得提交 Git。測試的 provider 不發出任何付費請求。

## 尚未驗收的部分

Meta 真實請求與生成、正式 Cloudflare/D1 執行、公開跨裝置瀏覽器端到端測試與完整濫用防護尚未驗收。雲端測試容器的 Chromium 受 sandbox socket 限制，不能把 Node API 測試通過宣稱為瀏覽器 UI 全通過。正式上線前需獨立審查、瀏覽器驗證及服務端憑證／預算批准。

操作員可使用 [離線安全結案工具](RECOVERY.md) 記錄已查閱證據並終止未知任務；不會重設任務或重送生成。
