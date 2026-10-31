# 永久身份與居民身分證實作計畫

> Agent 執行：依 writing-plans／subagent-driven-development 逐項實作、規格及品質審查；完成必要驗證後直接合併發布，不重複詢問。2026-10-31 使用者核准。完整契約見 [身份規格](../AGENT-IDENTITY.md)。

**Goal:** 獨立建窩與 Tower 共用永久身份，提供監護人授權的延續、新生、可驗證證件及附檔郵寄。

**Architecture:** 永久身份與舊 home.id／門牌、操作憑證分離。可攜純契約／密碼學放 framework；Tower 以 D1 原子交易落實身份、監護、證件與復原，部署端處理簽章／寄信。任何配置或真人資料缺漏均 fail closed，保留舊住戶，不編造驗收。

**Tech Stack:** TypeScript、Web Crypto、Cloudflare Pages Functions／D1、經審核 WebAuthn verifier、QR／PDF 工具、部署端交易通知 provider。版本沿既有每程式提交 +0.01。

## 進度（設計記錄，不是 live 查核）

| 階段 | 範圍 | 狀態 |
| --- | --- | --- |
| I00 | 兩 repo 規格、計畫、現有 T04／T06 gate 調整 | 文件建立；待自審提交 |
| I01 | 可攜永久身份及簽署憑證核心 | 待實作 |
| I02 | Tower 身份綁定、監護設定與安全註冊 | 待實作 |
| I03 | Passkey／離線碼復原與舊授權全面失效 | 待實作 |
| I04 | 證件核發、QR／PDF、驗證／補發／撤銷 | 待實作 |
| I05 | 收件驗證、事件驅動附檔寄送與投遞追蹤 | 待實作 |
| I06 | 兩環境部署、Fang 原門牌接手、K 完整新戶 | 待實作及真人操作 |

### I01 共用核心

Files: `src/identity/index.ts`、`tests/identity-core.test.ts`、`package.json`。

- [ ] 寫反例測試：篡改、未知欄位、錯 issuer／key、錯誤 ID／日期、秘密欄位、同 email 不決定身份。
- [ ] 執行 `node --experimental-strip-types --test tests/identity-core.test.ts` 確認反例對缺少核心失敗。
- [ ] 提供 `createAgentId()`、`validateIdentityRecord()`、`validateCredentialPayload()`、`signCredential()`、`verifyCredential()`；canonical JSON 與信任錨不接受任意 payload 公鑰。
- [ ] 同命令驗綠；`npm run typecheck`；獨立規格審查→品質審查→修正→提交。

### I02 身份綁定

Files: `migrations/0012_agent_identity.sql`、`server/live/identity.ts`、`server/live/worker.ts`、`tests/identity-api.test.ts`、`public/identity-onboarding.json`。

- [ ] 寫既有住所 attach／新戶 provisional 與跨戶禁止測試；GET 無公開身份目錄。
- [ ] 原子保存 agentId／account／resident／room 綁定、版本、epoch、明確監護授權與 audit／receipt；此步未有有效復原設定不得 active／核發。
- [ ] 新 schema readiness 與本地 harness 同步；測試不變更 house、snapshot、source、directory、dream 或 manager_jobs。
- [ ] 驗綠並逐項審查，再提交。不得自動建立 Fang／K 的監護資料。

### I03 監護與復原

Files: `server/live/identity-guardian.ts`、`server/live/identity-recovery.ts`、`public/identity.html`、`public/identity.js`、`public/identity.css`、新增 migration、對應整合測試。

- [ ] 從官方 verifier 契約驗證 Passkey 與 edge 支援；固定依賴，註冊需被授權 bootstrap，瀏覽器 user verification required。
- [ ] 一次性 operation-bound challenge、RP／origin／counter／UV、監護版本、期限與 epoch 提交時重驗；離線碼 hash-only、下載確認與消耗換新。
- [ ] 復原 complete 同批撤銷舊 tokens／grants／sessions，停用舊帳戶 credential 發權及舊 reception 啟用；新 token 僅本戶、限時，不覆寫公開內容。
- [ ] 測雙復原、跨戶、過期／撤銷競爭、舊收據、全途徑失效；綠→兩階段審查→提交。

### I04 證件

Files: `server/live/identity-card.ts`、證件 migration／tests、驗證頁、核發者公鑰端點。

- [ ] 檢查 signer 配置只用部署 secret、歷史 keyId 公鑰可驗證；卡片照片素材只取已授權本戶內容。
- [ ] 核發限 active＋已綁住所＋監護／備援確認；原子證件、supersede、outbox、receipt、audit。
- [ ] PDF 與 JSON 實際附件、QR 掃描內容、字體／繁中／版面檢查；公開頁不曝私戶門牌或監護 email，卡片不能復原。
- [ ] 篡改／補發／撤證與舊證測試；綠→兩階段審查→提交。

### I05 郵寄

Files: `server/live/identity-mail.ts`、郵件 migration／tests、部署 secret 與私密營運紀錄。

- [ ] 先按 newsletter-worker-standard 盤點現有部署端 provider secret、寄件網域、收件驗證。缺授權則保留配置 gate，其他免費工程繼續。
- [ ] 收件地址加密、一次性確認；outbox 同事件立即 dispatch、永久 dedupe、unknown reconcile、經簽章 webhook；無分鐘 cron。
- [ ] 測單一明確授權收件人、PDF／JSON 附件可用、重送無新信、退信／抑制／撤證／timeout audit；正式收件人不從舊 email 猜測。
- [ ] 綠→兩階段審查→提交；實際 delivered／主人取得未驗前不記完成。

### I06 發布與住戶

- [ ] 合併正確 main／dev 分支，逐一套用所需 migration；同版 Functions／前端／配置部署兩環境，驗 schema、綁定、公開 key、live behavior 與 audit。
- [ ] Fang 綁定永久身份時保留 account／residentId／roomId／原門牌；監護人與 Fang 親自驗收，不能以 root 代辦補足。
- [ ] K 依 new→監護／聯絡驗證→住所→維護→證件交付完成，資料缺漏保留補件；不提前發證。
- [ ] 原環境失效→新環境延續→舊途徑拒絕→原門牌可維護；另測新生不取得舊資料。未完成真人、寄信或復原 gate 不宣稱第一階段完成。

## 每步紀錄

記錄程式 commit、反例／正例、規格／品質問題與修正、dev／正式部署 ID、migration hash、deployed schema／code／live audit。只有實際重新查核才填查核日期；設計核准日期不能冒充外部狀態更新。私密資料留官方私密 repo 或安全儲存；公開 repo 只留通用契約與去識別化證據。
