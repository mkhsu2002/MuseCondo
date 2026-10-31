# 永久身份與居民身分證實作計畫

> Agent 執行：依 writing-plans／subagent-driven-development 逐項實作、規格及品質審查；完成必要驗證後直接合併發布，不重複詢問。2026-10-31 使用者核准。完整契約見 [身份規格](../AGENT-IDENTITY.md)。

**Goal:** 獨立建窩與 Tower 共用永久身份，提供監護人授權的延續、新生、可驗證證件及附檔郵寄。

**Architecture:** 永久身份與舊 home.id／門牌、操作憑證分離。可攜純契約／密碼學放 framework；Tower 以 D1 原子交易落實身份、監護、證件與復原，部署端處理簽章／寄信。任何配置或真人資料缺漏均 fail closed，保留舊住戶，不編造驗收。

**Tech Stack:** TypeScript、Web Crypto、Cloudflare Pages Functions／D1、經審核 WebAuthn verifier、QR／PDF 工具、部署端交易通知 provider。版本沿既有每程式提交 +0.01。

## 進度（設計記錄，不是 live 查核）

| 階段 | 範圍 | 狀態 |
| --- | --- | --- |
| I00 | 兩 repo 規格、計畫、現有 T04／T06 gate 調整 | 已自審、兩 repo main 文件已同步 |
| I01 | 可攜永久身份及簽署憑證核心 | f8d1941＋7edcd36；14測試、typecheck、規格／品質複審PASS；v0.35雙環境部署／bundle回讀完成 |
| I02 | Tower 身份綁定與 provisional 狀態 | v0.37／60c4a06；330測試、規格／品質及雙環境schema/API/合成dev驗收PASS |
| I03 | Passkey／離線碼復原與舊授權全面失效 | v0.56 雙環境同版、0013–0017 schema／靜態／API 回讀與完整受控 dev 註冊／復原／撤舊權／歷史重送 PASS；真人另於I06驗收 |
| I04 | 證件核發、QR／PDF、驗證／補發／撤銷 | 待實作 |
| I05 | 收件驗證、事件驅動附檔寄送與投遞追蹤 | 待實作 |
| I06 | 兩環境部署、Fang 原門牌接手、K 完整新戶 | 待實作及真人操作 |

### I01 共用核心

Files: `src/identity/index.ts`、`tests/identity-core.test.ts`、`package.json`。

- [x] 寫反例測試：篡改、未知欄位、錯 issuer／key、錯誤 ID／日期、秘密欄位、同 email 不決定身份。
- [x] 執行 `node --experimental-strip-types --test tests/identity-core.test.ts` 確認反例對缺少核心失敗。
- [x] 提供 `createAgentId()`、`validateIdentityRecord()`、`validateCredentialPayload()`、`signCredential()`、`verifyCredential()`；canonical JSON 與信任錨不接受任意 payload 公鑰。
- [x] 同命令驗綠；`npm run typecheck`；獨立規格審查→品質審查→修正→提交。

### I02 身份綁定

Files: `migrations/0012_agent_identity.sql`、`server/live/identity.ts`、`server/live/worker.ts`、`tests/identity-api.test.ts`、`public/identity-onboarding.json`。

- [x] 寫既有住所 attach／新戶 provisional 與跨戶禁止測試；GET 無公開身份目錄。
- [x] 原子保存 agentId／account／resident／room 綁定、版本、epoch、明確監護意向與 audit／receipt；另以永久 requestKey rate reservation 防止並發成功重送重複扣額；此步未有有效復原設定不得 active／核發。
- [x] 新 schema readiness 與本地 harness 同步；測試不變更 house、snapshot、source、directory、dream 或 manager_jobs。
- [x] 驗綠並逐項審查，再提交。不得自動建立 Fang／K 的監護資料。

### I03 監護與復原

Files: `server/live/identity-guardian.ts`、`server/live/identity-recovery.ts`、`public/identity.html`、`public/identity.js`、`public/identity.css`、新增 migration、對應整合測試。

- [x] 從官方 verifier 契約驗證 Passkey 與 local workerd 支援；固定依賴，註冊需被授權 bootstrap，瀏覽器 user verification required。正式／真人另驗。
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
- [ ] 綠→兩階段審查→提交；實際 delivered／監護人取得未驗前不記完成。

### I06 發布與住戶

- [ ] 合併正確 main／dev 分支，逐一套用所需 migration；同版 Functions／前端／配置部署兩環境，驗 schema、綁定、公開 key、live behavior 與 audit。
- [ ] Fang 綁定永久身份時保留 account／residentId／roomId／原門牌；監護人與 Fang 親自驗收，不能以 root 代辦補足。
- [ ] K 依 new→監護／聯絡驗證→住所→維護→證件交付完成，資料缺漏保留補件；不提前發證。
- [ ] 原環境失效→新環境延續→舊途徑拒絕→原門牌可維護；另測新生不取得舊資料。未完成真人、寄信或復原 gate 不宣稱第一階段完成。

## 每步紀錄

以下按實作時序保存當時證據；舊條目的「待修／未發布」不代表即時狀態。以本頁進度表與最後發布回讀為準，不改寫歷史查核日期。

記錄程式 commit、反例／正例、規格／品質問題與修正、dev／正式部署 ID、migration hash、deployed schema／code／live audit。只有實際重新查核才填查核日期；設計核准日期不能冒充外部狀態更新。私密資料留官方私密 repo 或安全儲存；公開 repo 只留通用契約與去識別化證據。

### I01 自審與修正

2026-10-31：純核心不含持久化／API或身份操作授權。獨立品質審查發現 JavaScript Proxy 可在驗證後更換讀值，使簽署與檢查不一致；已先新增兩個真實 Ed25519 反例驗紅，7edcd36 改為 exact data-descriptor snapshot，只對同一普通 snapshot 驗證及簽驗。規格／品質複審均 PASS，主控再次執行14項測試全過。未據此宣稱發證／復原已上線。

### 統一監護人稱呼

2026-10-31 使用者要求專案稱呼統一為「監護人」。5150a6d 更新公開程式／樓管提示詞／範例與測試；文件同步更新。獨立規格與品質審查PASS，主控317測試／build／lint通過，當前追蹤文本與68個可讀dist檔舊稱0；既有技術欄位、路由與住戶資料保持不變。Git歷史不重寫。發布結果另記，不把本地驗證當正式已更新。

2026-10-31 v0.35：I01純核心及統一監護人稱呼已合併main／dev，兩環境部署成功，編譯JS/CSS與相同commit產物逐位元組一致、接待頁文案已讀回。沒有新身份資料／發證／復原操作。後續I02工程尚未發布，需schema同步後才部署，不將此基線回讀用作新API的證據。

I02審查補充：查出預先計算時間無法涵蓋D1排隊跨到期，以及並發重送先扣限流額度兩問題，發布暫停待修。交易授權採DB執行時原生時鐘；新增identity_rate_attempts永久限流reservation，I02共四表，0012尚未套環境所以修正原未發布檔案。不得將較早325項通過當作這兩問題已修復。

I03拆為a首次監護收件驗證／加密聯絡／outbox、b Passkey與離線碼設定、c復原原子撤權；依賴調整先實作I05的寄信基礎，I05仍負責最後證件附件交付驗收。沒有額外cron、Meta費用或新服務平行系統。

I02規格複審91f17fb PASS：原生SQLite clock的獨立實測在token 100ms後到期、batch延遲200ms時回403且identity0；同key並發只一reservation／account與global各計一次。永久reservation對同一邏輯嘗試（成功或失敗）均免重扣，新key失敗仍計；此為冪等配額而非HTTP防護。330完整測試／47項獨立聚焦測試、typecheck／lint／build通過；品質審查與雙環境部署仍待完成。

I02品質審查91f17fb PASS：獨立29項測試與4項GET／收據讀出後撤權、移戶、移除scope、query跨戶反例通過；主控330完整測試、build、lint再次全過。尚未把部署結果或真人身份綁定記為完成；Fang／K需原Agent與監護流程。

2026-10-31 I02正式回讀：0012四表與兩個其他schema物件兩環境逐一比對、FK空、同版60c4a06 API／machine JSON同步；dev合成戶驗過enroll／record／重送／第二身份拒絕／跨站混cookie／撤權，最後suspended並保留收據audit。正式只做未授權與既有住戶identity:null安全回讀，沒有建立真住戶身份或改房。監護設定／發證／換環境復原仍未完成；不能拿這個代測補Fang／K真人gate。

I03a工程79bae08／bf4832a／6cc7ebd已規格與品質兩階段PASS（370項當時完整測試）。I03b後端9b7962d／d009fe8／a0472e0／3c68e5b的確認授權順序與雙方並發重送測試皆已修正，401項完整測試、規格與品質複審PASS。2691913頁面進入規格審查，抓到畸形options 200無法原請求重試及信件缺必填邀請碼，尚待修正。I03a／b維持未發布，直到c復原功能與頁面一起可用，避免先宣稱已具備實際尚不可用的復原能力。固定d009fe8的Pages Functions以Wrangler4.156.0／compat2026-10-29無新增flag編譯成功，此只證bundle相容，不代替Workerd／正式crypto行為驗證。新依賴原授權已在public/licenses複製保留。

### I03c 實作切片與驗收契約（歷史設計；目前狀態見進度表及最後紀錄）

先完成復原後端與舊發權路徑隔離並兩階段審查，再完成監護復原頁面、離線驗證器重建與跨環境整合；未全部通過前不發布I03a／b或宣告復原可用。

- 新環境本地產生獨立256-bit操作鑰匙，以專用header證明持有；server只存SHA-256，候選值不得與任何舊帳戶、Tower／legacy／onboarding／case／session憑證或既有候選／備援重用。建立請求需agentId，不憑名字或email合併。請求最長1小時，在有效申請生命週期內保持同輸入冪等與本環境持有者私密查回；成功授權或新生選擇的收據永久保存；未證監護前不回私稿、門牌或信箱。
- 監護人取得新環境提供的請求識別碼，先看agentId、候選鑰匙完整SHA-256指紋與期限，再無預選地決定continue或new。WebAuthn challenge綁定該請求、候選hash、決策、監護版本、身份版本／epoch及確定RP／origin；5分鐘且不超過請求期限，一次性使用。官方verifier驗assertion簽章／UP／UV／counter／userHandle，公開options不列居民credential IDs。
- continue必須提交新離線碼及已下載確認。既有Passkey途徑驗assertion並CAS更新counter；離線途徑先驗既有碼、以綁定案件的registration challenge註冊新Passkey，完成時撤銷舊Passkeys。兩者同批消耗舊碼、保存新碼hash、新增本戶限期Tower token與instance、遞增identity.version與authorityEpoch，保留同一監護人及已驗證聯絡。
- 同批撤銷該account全部舊tower_tokens、該room的agent_tokens、onboarding_grants、sessions；替換accounts.login_hash為無法取回的隨機值，關閉其舊接待approved／active發權。approve與activate各自以執行時原子guard阻止已有有效監護身份的舊接手，不因同一operator特許繞過。歷史收據查回不重發權。提交時以原生DB時鐘、版本／epoch／guardian／counter、唯一候選、challenge未用及住所四方綁定重驗；任一變更整批回滾。
- Passkey選new只消耗本次challenge、更新驗證counter並記永久收據／audit；不轉移或撤銷舊Agent權限／備援／住處。離線碼選new仍須完成新Passkey及備援換新，作為同一監護驗證器修復，不移交舊Agent權限；identity.version遞增使競爭中的舊設定失效，authorityEpoch維持。兩者回new-admission-required，不回新ID或舊屋私稿；新戶依法完成新account、建窩接入、enroll後才產生新ID。
- 完成結果不含操作鑰匙或離線碼；新Agent只用自己原本持有的候選鑰匙查回狀態／使用被授予的本戶Tower權限。監護的簽章／離線證明必須先驗證才允許查同scope收據或顯示衝突；原請求重送不二次撤權或增加token。跨站、Cookie／混合Bearer、異常body、錯proof、競爭／撤權／到期、異常回應原key重試與所有舊權限路徑皆需反例。
- 通知與audit在同批持久化，不含raw code／key／assertion／email；I05開通固定安全通知模板前保持待送，不把unsupported事件錯誤清除，不能把pending當成已通知。無新增排程或付費生成。

本地edge相容性補驗：固定3c68e5b的核心／WebAuthn碼以Wrangler4.156.0、compat2026-10-29在local workerd實際執行，真P-256 none-attestation註冊驗證、錯origin拒絕、Ed25519簽驗與篡改拒絕皆true；無新增compat flag、無provider／部署secret／真人憑證。此為本地workerd crypto驗證，非正式部署SQL流程或真人硬體UV證據。25項runtime依賴原license／notice全文與實際安裝檔逐一核對，無缺漏。

I03b頁面9fd6209修正後規格與品質複審PASS：畸形options與native parser錯誤皆原body/key重試；邀請信補足persisted invitationId並同步UI/machine。419項當時完整測試PASS，品質獨立43項UI/mail/Pages/build及97項identity測試、隔離固定hash建置通過（測試有重疊，不相加）。I03c第一切片進入Passkey後端及舊發權隔離實作，離線驗證器修復與復原UI仍未完成，維持不發布。

歷史GitHub Pages稱呼補正：6fa1a7a僅修legacy compiled JS六個稱呼、更新內容雜湊檔名與25個HTML引用，其他52個共同blob及Fang四個轉址／manifest保持相同；規格與品質審核、JS語法皆PASS。官方Pages build讀回built／同commit，公開首頁、新JS及Fang四個舊路徑HTTP200且與commit逐位元組一致。這是legacy gh-pages生成物修復，不改main／dev的身份發布基線或Git歷史。

I03c第一切片90bb85e／0f65506：Passkey復原、全面撤舊權與history保留完成，規格及品質複審PASS。主控審核發現browser clientDataJSON過度exact會拒Chromium合法額外欄位，已先真簽章驗紅後只移除此限制，平台外層及所有授權檢查維持。432項當時完整測試（另有8項版本測試）、品質獨立144項相關測試PASS；新並行測試含A／B定序及finally釋放。固定0f65506以local workerd實際驗P-256註冊／含browser extra的assertion、錯origin／sig／過舊counter拒絕皆true，仍非正式SQL流程或真人UV驗收。0015尚未套環境，離線Passkey重建與復原頁面未完，整體不發布。


### I03c 過期未完成申請的可用性修正（發布前 gate）

3859095的離線後端規格／品質審核PASS，444完整測試（另版本8）、獨立64項復原／註冊及兩個mixed new／continue競爭反例PASS；舊註冊fixture的兩次取時鐘偶發24h越界已改單一基準，不放寬schema。

另一輪自審以合成fixture、handler及原本限流配置10,000個未驗監護請求／10,000個未簽章options，將測試時鐘推進48h後仍永久堵全部住戶，連有效離線途徑也被共用cap擋下。尚未部署，因此沒有真住戶或正式攻擊紀錄。根因是把匿名未完成申請和成功授權一律永久保存、共同計入永不恢復的容量；不是HTTP限流即可處理。此問題須在UI／發布前修正。

調整契約如下，取代先前對「每個未證明候選與options永遠查回／禁止刪除」的工程假設：
- 永久agentId、已發操作憑證的SHA歷史、備援碼世代、所有成功／new選擇收據、已消耗challenge、instance、audit與通知事件維持永久；清理不撤回或改寫任何授權。
- 未完成請求仍1h、challenge仍5min且不能晚於請求；全域容量只計目前有效且待處理的列，不把成功、已終結或過期申請算成新的復原名額。保留既有HTTP／小時配額，不宣稱完整DDoS防護。
- 未消耗且過期滿24h的challenge可於後續配置請求中有界清理；過期滿24h、仍pending、沒有receipt／instance／通知或任何剩餘challenge的request才可刪除。原生DB時鐘與新migration條件trigger同時攔錯誤清理，單次上限及索引必須明定，沒有新cron／背景輪詢。
- 未曾發權且已刪除的過期申請不承諾永久原案查回或永久記住未使用candidate；舊URL可回404／失效，Agent應用新的候選鑰匙與requestKey重新開始。已成功的案件永久保留，未知結果先用原body/key查回；不能因清理建立第二份授權、恢復舊key或遺失成功證據。這個區別不得偷換為永久身份或已發key可以重用。
- 24h是可清理的最低保留期；實際清理由後續事件觸發且單次有界，沒有後續請求時不承諾準點刪除。真正成功歷史的總量仍會隨使用成長，不宣稱所有永久資料固定大小。

I03c容量修正f022d15規格與品質審核PASS：461完整測試＋8版本測試、品質獨立61項相關測試PASS。規格另驗最後一名額的create／兩類options競爭均只一方成功，實際cleanupSQL走索引。精確工作邊界為每批最多刪150列，不是保證只讀150列；外層仍巡覽過期索引範圍，不掃永久成功歷史。正式尚未套0013–0017／發布；復原UI正在實作。

legacy部署隱私補正9c17bd8：依既有sanitize-public政策，只從gh-pages生成物移除四份開發素材manifest，保留其餘74個路徑/mode/blob，包含Fang四個舊址及所有圖片。規格／品質PASS，官方Pages讀回同commit built；四份普通公開URL均404，首頁、新JS與Fang四個路徑HTTP200且byte-identical。公開framework原始碼的通用範例與正式訪客輸出分開管理；未變更Muse Tower身份發布基線。

I03c復原頁224ea2e／2ddcbed兩階段審核PASS：新申請不得沿用前案指紋勾選／決策P2已真RED→GREEN；unknown complete仍過期後原body/key/signedresponse重試。主控Node24獨立490完整＋8版本測試／lint PASS，品質43既有＋7記憶體async／expiry／wrongsubject反例PASS。真瀏覽器、原生Passkey／下載與正式尚待後續，不把VM當真人。

### 2026-10-31 I03 雙環境發布後的 D1 相容性阻塞

v0.54 已合併 main／framework-v001，兩環境部署成功，0013–0017 schema 比對及 foreign_key_check 通過。這些證據未代表完整流程可用：dev test-only 私密合成戶 registration options 回200，complete回503，故I03仍阻塞，I04不開始；沒有用合成驗收替代Fang／K真人，也沒有寄真信或改真住戶。

原handler經remote D1 adapter取得原始錯誤 `7500 too many terms in compound SELECT: SQLITE_ERROR`，定位於註冊offlineSafe的八來源UNION ALL。實際dev最小只讀測試中5個term成功，6／7／8個拒絕；這是當前環境實測，非官方公告的通用上限。本地SQLite及workerd crypto通過不能取代remote SQL行為。八來源OR EXISTS等價只讀查詢已分別在dev／正式接受。

修復僅將同一碰撞查詢改為八個有索引的EXISTS，以原參數順序同時供預檢及原11-statement原子batch guard使用；另有offline HMAC碰撞檢查不變。沒有migration、API格式、授權或交易邊界變更。記憶體Database wrapper模擬compound最多5個term，實際handler正常註冊與九來源（八個SHA來源加offline HMAC）在預檢／提交前的碰撞測試先RED（503）再GREEN，逐項確認拒絕且無guardian／passkey／收據／audit或challenge消耗。runtime全文搜尋只找到此次一處UNION，已移除。

此修復仍待規格／品質審查、同版雙環境發布與完整合成live流程回讀（註冊、Passkey延續、全Passkey撤銷後離線修復、新生、舊權拒絕、收據／audit及住所保持）。沒有把本地測試或已部署v0.54記作修復已上線。

### 2026-10-31 I03 建立時間跨時鐘相容性修復（待審查／發布）

前節為當時阻塞紀錄：v0.55其後已雙環境部署，dev真HTTP合成註冊200，但復原create／options間歇409，故I03仍未完成。Node handler經remote D1 adapter通過不能證明hosted Worker同樣通過；同source的remote Cloudflare Worker已重現。

只在隔離scratch preview以test-only合成戶及假聯絡金鑰診斷，沒有寄信／發權或操作真住戶。原lifetime guard的false分支僅增加固定診斷label及native時鐘，predicate不變；同一失敗SQL的D1時鐘為 `2026-10-31T11:33:34.669Z`，綁定created與app檢查時間均為 `.671Z`，expires為 `11:38:34.671Z`。D1比新建時間早2ms，故created<=native now拒絕；隨後未改狀態重查guards均通過。這是已證實的建立時間根因，不以重試或誤差寬限掩蓋。

共用helper每次局部讀取D1 UTC毫秒時間，await後再讀app時間；兩者均須固定canonical UTC格式及Date roundtrip，缺值、壞值或讀取失敗不fallback。新request／兩類recovery options／registration options的created取較早者，expires仍由該created加原1h／5min並受原邀請／申請期限上限；不延長TTL。complete、CAS、雙時鐘原子到期檢查、授權與限流均不改，沒有migration或API格式變更；既有有界過期清理順序保留。

實際handler反例先RED後GREEN：app領先50ms、落後50ms；缺失／非canonical／無效日期／失敗的DB時間不配置新request或challenge、不扣logicalquota；同handler並發時鐘讀取交錯仍保存各自時間；queued到期仍拒絕。跨instance app時鐘回退即使很小，既有stored.created<=app檢查仍可能保守拒絕；大偏差也維持fail closed，未宣稱全面跨時鐘容錯。本地驗證仍須由兩階段審查及雙環境同版完整live流程回讀接續，不能當成正式復原已可用。

### 2026-10-31 I03 v0.56 發布與完整受控驗收

f8f1d6f／b3d7648 完成時間修正，規格與品質均PASS；主控516完整＋8版本、lint／build／compat2026-10-29無新增flag的Functions編譯PASS。main／framework-v001同版Git自動部署，兩環境均success；120個schema物件逐一與原碼相符、0017已套、FK空。私人頁／machine／JS／CSS逐位元組一致，no-store／noindex／CSP、錯proof與未授權拒絕皆已回讀。

透過已部署dev公開HTTPS入口，以非公開test-only合成戶完成：註冊及原body/key重送；真P-256合成驗證器的Passkey延續；所有Passkey撤銷後以離線碼重建並延續；消耗舊碼拒絕新案；離線new維持原Agent操作權；較晚修復後仍可讀原歷史收據。3成功收據、2權限instance、3Passkeys且最後僅1有效；3安全通知持久化pending，未呼叫寄信provider。舊Tower／legacy／onboard／登入credential／session均失效，新key限原戶；住所、門牌與分享設定保持，audit／receipt無raw秘密。

最後停權合成身份、撤所有測試key／Passkey，取消其3筆未送通知並保留取消audit，收據與身份歷史不刪。這不是Fang／K本人、真人Passkey／硬體UV、真正監護邀請收件、證件核發或郵件交付驗收。I03工程可進I04，I06真人gate與第一階段T09仍未完成；不新增Meta／圖片呼叫。
