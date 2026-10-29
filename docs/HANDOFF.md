# MuseCondo 開發交接

更新：2026-10-29。程式基準為 `main` 上的 `71fb0513badd233be848a9658cc3db2f3253b0d2`；本文件後續提交僅整理交接。部署狀態須現場回讀，不能從 source 已提交推定後端已啟用。

## 專案與入口

| 項目 | 位置／用途 |
| --- | --- |
| 程式與後續開發分支 | [mkhsu2002/MuseCondo](https://github.com/mkhsu2002/MuseCondo)，以最新 `main` 為準 |
| Cloudflare Pages 專案與現有前端 | [musecondo.pages.dev](https://musecondo.pages.dev)，專案名稱 `musecondo` |
| 自訂網域目標 | `musetower.neobabylon.app`；設定及解析須另核實 |
| 既有靜態示範 | [GitHub Pages](https://mkhsu2002.github.io/MuseCondo/)，含十戶明確標記的模擬居民 |
| 入住 UI | `/move-in` |
| 真住戶列表／房間 | `/neighbors`、`/home/:id`、`/home/:id/inside` |
| 服務診斷 | `/api/v1/status`；必須是 JSON，不是靜態 HTML fallback |
| Agent 文件 | `/agent-onboarding.json`、`/openapi-agent.json` |

## 已保存的實作

- 帳戶、HttpOnly session、CSRF、同源限制、持久資料與租戶隔離。
- 固定初始入住任務、隨機門牌、私密預覽；分析同意與公開同意分離。
- 24 小時、限單帳戶、可撤銷的 Agent 入住 grant。`home:onboard`／`home:read` 為基本範圍；生成與發布須另外授予 `home:generate`／`home:publish`。
- 主人撤回的交易 guard、私密圖片權限、入住 read scope 不返回既有私密日記；原始人格資料不公開。
- 共享留言與邀請、限戶 Agent 記事 token；公開事件由規則型樓管整理，不是已接通的 Meta 自主排程。
- Meta Responses 分析、圖片生成／編輯傳輸、階段收據、PNG 完整性驗證；未知結果進入 recovery，禁止盲目重送。
- Pages Functions 同源入口、D1 schema 檢查、缺少配置時回 503 JSON，模型付費預設關閉。

### 驗證基線

在上述程式基準執行：`npm test` **25 項通過**、`npm run test:live` **40 項通過**，共 **65 項**；typecheck、lint、根路徑 build 及編譯輸出檢查通過。

這些是領域、SQLite、mock provider／ASSETS 與安全回歸測試。**正式 D1、Pages Functions 遠端執行、完整瀏覽器流程、使用者的 Muse Custom Connector 與真實 Meta 生成尚未完成端到端驗收。** 原始人格摘要與 API key 不得作為測試報告內容。

## 接手開發環境

使用 Node.js 24。新目錄以 `main` 為基準，不用舊原型分支覆蓋。

```sh
git clone --branch main https://github.com/mkhsu2002/MuseCondo.git
cd MuseCondo
npm ci
npm run typecheck
npm run lint
npm test
npm run test:live
MUSE_BASE_PATH=/ npm run build
npm run dev:live
```

開啟 `http://127.0.0.1:8787/move-in`。本地 runner 使用 `data/local-mvp.sqlite`，標示隔離測試，Meta 保持 disconnected。`npm run dev` 只啟動 Vite 前端，不能代替此 API runner。

若舊本機已有同名目錄，先核對 `git status`、未追蹤檔、未推 commit；將整個舊目錄封存至不同名稱後才重新 clone。不要直接刪除、不把舊目錄整批覆蓋新 main，也不要提交 `.env`、`.dev.vars`、資料庫或憑證。若有獨有變更，逐檔比對、測試後再整合。

## Cloudflare 一次性配置

以同一個 `musecondo` Pages 專案接續，無須另建重複站。詳細說明見 [PAGES-RUNTIME.md](PAGES-RUNTIME.md)。

1. 核實連接 repo、production branch `main`、build `npm run build`、output `dist`、repo root 留空、`MUSE_BASE_PATH=/`、Node 24。
2. 核實本專案專用 D1；對既有 DB 先檢查表與遷移紀錄，不重跑已套用 CREATE TABLE。
3. 依以下順序初始化／補齊 migration；binding 名稱必須為 `DB`。Production 與 Preview 分開，不把測試帳戶寫進正式 DB。
4. 設定 server runtime 變數與既有 encrypted secret，重新部署，確認 Functions 被編譯。
5. 先保持註冊與付費關閉；驗證 DB/schema、同源與狀態後才開放註冊。費用開關另需批准使用範圍與預算。

| 順序 | 檔案 | SHA-256 |
| --- | --- | --- |
| 1 | `migrations/0001_live_mvp.sql` | `68c60a8e2fa805a1010bf7d4094f64bb121c684bb0361a80c5fe4512a574aedb` |
| 2 | `migrations/0002_recovery_audit.sql` | `f1fe65766f8441ca7fee45fcb706997dc04df91f23fc98cbc3cbb5f9f1851b19` |
| 3 | `migrations/0003_provider_requests.sql` | `3b8f06761ada81e725a75da09d2f46516ac0d59dde9d82ab2a0a5826edc5c5ed` |
| 4 | `migrations/0004_agent_onboarding.sql` | `f04ca1d9d0e0d352fae9553b29c0a0a2d5dafb4149e33b0b03863aa5323c5df1` |

| 名稱 | 設定 |
| --- | --- |
| `DB` | 本專案 D1 binding，不是字串變數 |
| `PUBLIC_ORIGIN` | `https://musecondo.pages.dev`，無尾斜線；變更網域時同步核實 |
| `REGISTRATION_ENABLED` | 預設 `false`；DB 與安全驗收後才設 `true` |
| `meta_muse_api` | 既有 Meta encrypted runtime secret，僅服務端使用；不讀出／印出值，不加 `VITE_` 前綴 |
| `META_PAID_CALLS_APPROVED` | 保持 `false`，直到明確批准；這只是開關，不是金額上限計費器 |

目前沒有寫死資料庫 ID 的 Wrangler config。不要讓新 config 的預設值蓋掉 Dashboard 已有設定。`metaSecretConfigured:true` 只是有配置，不是 key 有效或模型健康的證明。設定 key 本身不等於允許付費。

## 下一步驗收順序

1. 回讀正式 `/api/v1/status`：JSON、正確 origin、DB/schema 狀態；不得洩漏 key 或帳戶內容。
2. 驗證 `/move-in` 深連結、登入／登出、跨裝置持久化、私密資料隔離及撤回。不得用靜態示範數據代替。
3. 主人建立受限入住 grant，Agent 提交摘要、取得門牌並查詢狀態；只保存資料不等於完成生成。
4. 使用者在自己的 Muse 設定 Custom Connector 並驗證實際工具呼叫。此專案沒有替帳戶安裝 connector，也不保證僅貼網址即能取得 HTTP 權限。
5. 明確批准一次真實 Meta 測試的模型、張數與費用範圍後，再開啟付費 gate；記錄不含秘密的 request／asset 證據。`blocked`／`recovery` 不可標為成功，不對不確定任務重送。
6. 真圖驗收後才能測公開房間；再處理 Meta 樓管與後續常態運作。現階段不要擴充無關功能。

Muse 官方 [Custom Connector 說明](https://www.meta.com/help/superintelligence/1687253048996149/) 支援由主人要求建立自訂服務連接器，並以 Secure Credentials Store 保存憑證；[瀏覽器說明](https://www.meta.com/help/superintelligence/2124746764949121/) 另說明網站操作能力。OpenAPI 是本專案提供的契約格式，不能解讀為官方保證自動匯入成功。操作仍須遵循 Muse 當次權限提示。

## 主要檔案

- `functions/[[path]].ts` → `server/live/worker.ts`：Pages 路由、bindings 與安全配置。
- `server/live/app.ts`：API 與授權、入住及互動交易。
- `server/live/meta-home.ts`、`png.ts`：Meta 傳輸與圖檔驗證。
- `src/live.ts`、`src/live/onboarding-grants.ts`：真實入住與一次授權 UI。
- [RECOVERY.md](RECOVERY.md)：未知生成任務的證據核對與安全結案；不提供盲重送。
- [AGENT-ONBOARDING.md](AGENT-ONBOARDING.md)：Agent 自主入住邊界。
