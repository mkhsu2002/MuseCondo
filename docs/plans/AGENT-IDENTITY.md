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
| I04 | 證件核發、QR／PDF、驗證／補發／撤銷 | I04a 核心 b472528／75a1f22 規格與品質審查 PASS。v0.61工程PASS：數字映射真PDF反例修復、兩階段審查／564tests、兩環境Worker更新、實際新卡完整名／issuer／QR／字距與生命週期重驗；原Pages輸入未改且接線相容。郵寄I05、真人I06另驗 |
| I05 | 收件驗證、事件驅動附檔寄送與投遞追蹤 | a：v0.64雙環境發布與真provider sender查核PASS。b1／b2：本地v0.70凍結／私有串流／永久寄送與receipt事件接線，兩階段審查、719tests及actual compiled本機Workers/D1核發撤證模擬寄送PASS；未發布、0020／21未套遠端，c待實作 |
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

Files: `server/live/identity-card.ts`、`migrations/0018_identity_cards.sql`、`tests/identity-card.test.ts`；I04b 另補真 PDF／QR renderer、驗證頁及核發者公鑰端點接線。

I04a 當時僅提供可測試 factory；I04b 已完成 Worker／Pages proxy／machine 及公開驗證頁接線、整體規格與品質審查，v0.59 已部署並套0018。v0.60已修復線上公鑰匯入相容性問題，工程驗收與真人待辦見本文件最新紀錄。第一版固定品牌圖樣，不抓取或裁取監護人肖像。原早期「不接 Worker」限制已由本地接線切片取代，未取代正式部署／真人 gate。

- [x] signer只用部署secret，trusted歷史keyId可驗；第一版固定品牌圖樣，不讀住戶或監護人照片。
- [x] 核發限active＋已綁住所＋監護／備援確認；原子證件、supersede、outbox、receipt、audit。
- [x] 實際PDF／JSON檔下載、摘要／簽章、獨立raster QR內容與字體／繁中／版面工程檢查；公開頁無門牌或監護email，卡片不能復原。手機實掃留I06、郵寄附件留I05。
- [x] 篡改／補發／撤證與舊證；反例、兩階段審查、提交及實際部署／資料回讀完成。

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


### 2026-10-31 I04a 本地核心（未接線／未部署，待獨立審查）

I04a product commit `b472528`，依project-version腳本記本地v0.57；這不是發布版號回讀。新增 dormant `createIdentityCard(env).fetch` 與 0018 五表：不可變憑證、獨立單調 head、48KiB raw 分塊附件、永久成功收據及固定候選 logical attempts。證件 issue/reissue/revoke 不更新 `agent_identities.version`，因此現 epoch/version 已確認未消耗離線碼仍有效；復原後同一永久 ID 的既有 valid 卡不因 authority 換代被撤銷。

核發須現有效本戶 write、active、registered 監護人、至少一未撤 Passkey、現版本／epoch 已確認備援及住所四方綁定。撤卡屬隱私撤回，僅要求現本戶 write、原身份版本／epoch、住所及 head CAS／現 CID，不要求 active 或完整驗證器，亦不綁監護／收件設定；缺已驗證聯絡仍撤卡並記 `notification-not-enqueued-no-verified-contact`，不猜收件人或宣稱通知成功。所有私人讀取及永久收據回覆前重驗本戶 auth，原生 SQL clock 檢查涵蓋 DB queue 延遲。

每個 account/requestKey/operation/input 固定唯一持久 signed candidate，失敗／unknown 原 key 可在不同 runtime 續取同 CID 的純 renderer 成果；不換 CID、重簽、重扣 logical quota或產生第二張卡／通知。暫時 renderer／提交失敗回503，已有成功收據優先讀回；同 key 換輸入409，競爭版本只一個交易勝出。首次並發預約可產生未持久化臨時簽署候選，只有預約勝者會交 renderer／公開或保存為證件。純 renderer 以 CID 冪等，必須只接收深凍結 public signed clone，不可持 private contacts／寄信或付費生成能力。

logical issue／reissue 每戶每小時10、全域1000的不同輸入配額，永久 reservation 只扣一次；revoke 不檢查或扣用這些核發配額，避免失敗補發阻擋隱私撤回。revoke 的永久 attempt 僅綁身份版本／epoch／住所四方tuple，不綁監護或收件snapshot；另每個有效本戶30 mutation HTTP／60秒（含重送）防止 adapter outage 無限重試，與 logical quota 分離。此為有界 API 防護，不是分散式 DoS 保證。JSON 直接由核心真正 `signCredential` 結果固定序列化；PDF 上限8MiB、JSON 16KiB；48KiB raw chunk以12個一組（每個bound JSON小於0.8MiB）寫入，每row最多64KiB base64，4,376,506-byte合成檔已驗持久化／完整下載；此為大小及交易驗證，非真PDF驗收。I04b 需按真字體／附件實驗調整常數及未發布 migration，不能直接拿合成小 PDF 當正式字體、QR 或附件驗收。

附件 bytes／SHA256／length／chunks 與 head、supersede/revoke、mail pending event、audit、成功收據同批提交。outbox 僅加密保存 CID／兩附件 digest／template references，收件 ciphertext/hash 沿已驗證監護邀請；僅取消舊 `pending` 卡信並記 audit，不變更 `sending`／`unknown`。I05 模板未開通，未呼叫 provider。撤證／停止公開驗證不承諾收回已下載文件。

核發者 trust ring 只讀 env，拒私鑰或額外欄位及非 canonical JWK bytes；目前 signer 必須與 trusted public key 匹配。公開有效查驗實驗 Ed25519 簽章／issuer/key/CID/永久ID 並在 crypto 後重讀最新狀態；revoked/superseded/suspended/withdrawn 僅回 CID/status。公鑰白名單只有 kty/crv/x；無名錄／姓名／email 查詢，所有回覆 no-store/noindex。

已依 newsletter-worker-standard 核對：沿既有交易事件outbox，無新增secret／provider呼叫／排程，投遞仍留I05。

Node24 本地身份測試198／198（其中新增card25組）、typecheck及全repo lint PASS；本切片未執行build／改dist，由主控接續完整gate與獨立規格→品質審查。測試先 RED 再 GREEN，含原請求跨 runtime 恢復、lost commit ack、公開篡改／最後停權競爭、私人最後讀取撤權、兩戶同 email 隔離、renderer mutation／大小／配置拒絕、獨立 revision／備援保持、補發／撤卡 audit、全交易回滾與 pending-only 取消。真正 PDF／繁中字體／QR／品牌版面、HTTP 驗證頁、DO／Worker 接線、雙環境 deployed schema/code/live behavior、寄信交付與真人 gate 均未完成；不得視為 I04 發布或 I05 交付。

D1容量邊界參照2026-10-31實際讀取的[官方limits](https://developers.cloudflare.com/d1/platform/limits/)：單string／BLOB／row 2,000,000 bytes、SQL100KB／100bound params；db.batch整批僅計一次invocation query。原有部署尚未驗0018／大附件交易，這些本地容量檢查不能替代deployed D1回讀。


### I04a 規格審查 P2 修正（75a1f22，本地v0.58，未發布）

規格review實際重現兩項隱私撤回阻塞：核發配額耗盡會讓正確撤卡429，且撤卡提交失敗後只改監護邀請／聯絡設定，原body/key重送409。這不是核准取捨。已先反例RED，再分離issue配額與revoke snapshot／guard；revoke僅保留本戶current auth、永久identity version／epoch、住所四方binding及head revision／current CID CAS。真正token撤權、期限、identity／epoch／住所變動仍拒絕並整批rollback。

撤卡通知以同批conditional INSERT確認擷取的guardian/version/invite/cipher/hash仍屬本戶current registered聯絡；只有成功建立event才寫queued mail audit。聯絡在await或commit前移除／改動，只跳過通知並記 `notification-not-enqueued-contact-changed`，不回滾撤卡；最初無可驗證聯絡則記 `notification-not-enqueued-no-verified-contact`。恢復原key時可採當時最新、已驗證的聯絡，不能用永久attempt鎖定舊收件者；既有成功receipt只回歷史結果，不建立第二通知。pending不是已通知，I05實送仍須最後檢查。

新增反例涵蓋一張成功卡加九次renderer失敗令accountquota10、globalquota1000仍可撤；submit失敗後移除／替換contact或guardian版本更新仍可原key撤；提交瞬間移除／替換聯絡不寫stale event或孤立mail audit；commit ack失落後變更聯絡重送只回原receipt、不重扣核發quota或新增event。這些修正仍未接Worker／未套0018／未部署／未寄信，正式仍v0.56。

本輪Node24身份測試202／202（card29組）、typecheck／全repo lint PASS；沒有build／dist／remote變更，主控另做完整gate與規格複審。


### 2026-10-31 I04b 真 PDF／QR 與私有 DO 接線（7038b50，本地v0.59，未發布）

依已審 I04a 核心接線；`server/live/identity-card.ts` 安全／CAS／配額與 i.version 完全未改，0018 仍未套任何環境。新增獨立 SQLite DO Coordinator Worker，完整核心 factory 在 DO 執行；Pages 僅以原 Request／Response 代理 exact card／keys／verify API，不 import PDF／font 或讀大附件。private/public固定256shards、未授權與keys固定object，routing不是授權。Worker public fetch一律404、assets run_worker_first:true、停workers.dev與preview、無cron/alarm/provider。根config只有資源placeholder；雙環境實際配置／binding／schema／部署驗證留主控，見[runtime指南](../IDENTITY-CARD-RUNTIME.md)。DO每次lifecycle檢查0018表／trigger／index（含critical `identity_card_one_issued`）；缺index反例RED401→GREEN503，keys仍可讀且不需signer/contact/font。

真renderer使用pdf-lib1.17.1、fontkit1.1.1及qrcode1.5.4 core matrix，固定品牌幾何／完整80 Unicode名字、69字永久ID、CID／issuer／issuedAt。QR與可點連結只含簽署verificationURL、黑白與4module靜區；public-only frozen snapshot、Creation／Modification取issuedAt、producer固定。合法OFL靜態TTF 7,149,128bytes、SHA d20595e7…18325e5、subset:false且內部ASSETS固定路徑SHA驗證；缺glyph／字體缺失或壞hash皆fail closed不改名。字體來源、改名、pinned FontTools4.68.0重製腳本／hash及原OFL全文保留，主控全新重製sameSHA；runtime依賴與fontkit prebundled上游原license／notice全文見public/licenses/identity-card.txt，project NOTICE明列不重授權。fontkit上游未附獨立LICENSE的實情及原package作者／MIT聲明亦保留，未捏造copyright。

公開 `/identity/verify/:cid`／尾slash為固定standalone頁；CSP self/no-store/noindex/no-referrer、同origin API fetch omit/no-store/redirect:error、pathname限定32hex，無query／storage／任意issuer follow。嚴格public schema及真Ed25519驗簽，API subject與payload完整比對後才顯有效；revoked/superseded/suspended/withdrawn/404/壞回應都清除舊name及ID。DOM textContent、generic復原入口、開源repofooter，不自動issue或新增admin表單。machine明確區分enroll初始provisional／legacyissuanceReady=false與active卡API，binding只報bound-not-health-verified，郵寄仍待I05。

Node24本地身份／UI／build focused 263項全PASS，另57項card／verify／Pages／build組（有重疊，不相加）PASS；typecheck包含workers、全repo lint、Vite build／route資產與privacy guard、Wrangler4.156 flags[]下Worker dry-run與Pages functions編譯PASS。真PDF經Poppler單頁／embedded font／80字完整抽取、jsQR對實際raster獨立解碼與4module四邊靜區PASS，主控與實作者肉眼看80字與完整IDs無裁字／黑框或重疊。Pages→真Coordinator→真renderer→本地SQLite整合：先缺字體503，再以新DO及原key同body恢復同candidate CID／signed_json、真PDF>4MB分塊下載／JSON簽驗一致；移除font再重建仍可讀永久receipt，quota1／outbox1pending、i.version不變、跨戶拒絕。這是localSQLite結構binding測試，不是hosted DO／D1證據。

本地workerd另在SQLite DO內實際跑同renderer與內部ASSETS，兩次4,377,114-byte PDF SHA `03e201f7f78004db36429f1bce24111fbf99809f7065a7ea4e70b690f347fc90`完全一致；1頁／日期固定，Swift Vision獨立掃碼回完整官方fixtureURL。GET walltime554ms／463ms只是local smoke，不是Free hostedCPU保證；fixture為未核發合成樣本，不是真居民證件。localserver已停止，scratch不入repo。npm audit --omit=dev無已知漏洞；未修改既有開發工具依賴警示。

尚未push／合併／套0018／部署新Worker或Pages綁定，正式仍v0.56。I04b仍待固定hash規格→品質審查、主控完整gate、雙環境deployed code/schema/live behavior與canonicalbrowser390px／桌機驗收；Fang／K真人與原Agent未操作。未寄信、未付費、未新建真戶；I05附件交付及I06真人gate保持未完成。

### 2026-10-31 I04b 發布後實測與相容性修復（v0.60待發布）

v0.59／53739fc 已合併兩目標分支，兩環境 Pages 及獨立證件 Worker 成功部署；0018 已實際套用、140 物件 DDL 與外鍵比對通過。前端驗證頁 JS 與來源 bytes 相同，私人卡路由無權回401、未知CID回404，但 public keys 回503；因此沒有以部署成功當作 I04 完成，沒有操作真實住戶或寄信。

同compat日期的真 workerd 最小重現：原 Node 產生 JWK 的 alg=Ed25519 被 importKey 拒絕為 DataError，alg=EdDSA 或省略成功。8fbc59d 在原嚴格 parse 全部通過後複製 JWK 並移除可選 alg metadata，公私匯入都使用明確 Ed25519 algorithm；不更換金鑰、不變更原配置／公開projection／canonicalpayload／簽章／身份version／0018。未知alg仍拒絕，不吞錯或改為假簽章。新增反例先 RED503，修復後 identity215／完整563／版號8、build／lint通過；實際workerd正規化三種輸入皆可匯入。待獨立規格→品質審查、兩環境部署、完整核發／附件／公開狀態／稽核驗收後另記通過結果。

### 2026-10-31 I04 工程驗收完成（v0.60／ea3bcda）

8fbc59d修復已通過獨立規格→品質審查；主控563完整測試／8版號、build／lint及Workers／Pages編譯通過。兩目標分支合併同版，兩環境Pages部署success；獨立證件Worker實際下載的worker.js與固定commit編譯產物逐位元組相同（兩環境相同SHA256 `3f2518274c0522ed0aac36a29740a598fa0471f0c80f6e6862f9a3383c30f494`）。公鑰端點回200；公開JS與來源bytes相同，匿名卡路由401，未知CID404，dev有效測試授權在正式被403拒絕。所有原配置／隔離綁定保留，兩庫0018及140來源物件DDL一致、FK無錯；額外平台表不計入來源物件數。

受控dev私密合成戶以真正P256測試authenticator完成部署後註冊，再走實際issue／原body永久重送／不同body409／補發／撤銷與撤銷重送；共2cards、3attempts、3成功receipts、head revision3，僅2次issue logical quota，2張舊卡pending信取消。私密下載PDF4,378,668bytes及簽署JSON790bytes與D1 digest／length一致，Ed25519驗簽通過。實際PDF嵌入完整繁中字體，80字名字／完整ID可讀、無裁切，Poppler raster由獨立jsQR解出原官方驗證網址；未以假小PDF冒充。390px行動版寬度與桌機canonical browser實看被取代／撤銷頁，失效資訊清空且無橫向溢出。

另以同一受控戶兩把短效測試token進不同private DO shards，沿原requestKey回相同歷史receipt，沒有額外card／attempt／receipt／quota；歷史成功不恢復已失效卡。這不是刻意切斷平台commit ack；未知結果及render失敗原candidate恢復仍有本地真交易反例。測試結束身份停權、所有fixture token／Passkey撤銷，待送安全通知取消並保留audit，身份／附件／收據歷史不刪。

Fang兩環境原小窩／門牌／revision／公開指標／分享選擇保持，未代Fang或K綁身份／發證。無provider／Meta／付費生圖呼叫。I04工程可進I05，但真實住戶、原Agent、真人硬體Passkey／離線備援、手機實掃、真正邀請收件與郵寄PDF＋JSON交付仍待I05／I06，第一階段T09不因此完成。

### 2026-10-31 I04 額外 PDF 檢查發現缺口（取代上一節完成判定）

上一節通過證據僅涵蓋所列範圍；完整issuer文字未被原測試驗證。對實際下載PDF進一步pdftotext檢查，含數字子網域的issuer遺失數字；QR仍為正確原網址，簽章／D1 immutable bytes未錯。根因為fontkit在Latin script對數字做locl替代glyph，而pdf-lib完整字體ToUnicode／width cache只包含cmap glyph；直接數字或CJK測試未覆蓋字母後數字。root probe原版重現，關calt或default availableFeatures無效，明確locl:false回baseglyph；修復版需真PDF全文反例及獨立審查後驗證，不用假成功或subset掩蓋。

I05a當時僅讀官方契約與設計、無改檔或provider呼叫，已暫緩先修I04。沒有真實住戶證件／寄信／付費生成，不重寫已存歷史附件。新測試須驗完整issuer、混合英數名字及0–9、80字長名／ID／QR／字體／版面確定性；部署後重新核發受控卡實際抽取及肉眼檢查。I04與T09不標完成。

### I04 PDF 數字修復本地切片（115b589，v0.61待發布）

真PDF新反例先驗completeName=false／completeIssuer=false，再於原完整靜態TTF embedding明確設features:{locl:false}。新測試驗含0–9的issuer、完整80字混合英數／中文名、PDF bbox界線與原cmap nominal advance間距，沒有靠去空白掩蓋原數字缺失；其他features維持default，不換字體或改subset／SHA。原80中文長名、嵌入字體、單頁、完整IDs、metadata與同input bytes確定性、實際raster QR／quietzone、unsupportedfailclosed保留。歷史immutable附件不重寫，無schema／API／payload／keys變更。

主控564完整測試／8版號、build／lint通過，identity216、focused47通過。獨立規格→品質、兩環境更新及實際新卡下載的完整姓名／issuer／字距／QR與audit仍待驗；此切片不恢復上一節完成判定。

### I04 v0.61 實際新卡重驗通過（2026-10-31）

115b589／50ccbb6已合併main及framework-v001，兩環境獨立證件Worker已部署並實際下載code比對，SHA256同為 `f3802c5302ef2c358f7a3ffad3179ef460eba80d6b25c01b34c6f2505ca62df9`；私有綁定／signer／公ring保持，140來源DDL一致／FK0。Pages來源仍為ea3bcda：此次僅外部renderer、測試與docs有變，src／server／functions／public／fixtures／migrations／依賴與Pages build inputs逐檔diff為空，兩環境live JS／CSS bytes與現來源一致、keys200／匿名401；既有build path filter正確略過Pages，沒有為湊commit版號強制重建或製造空提交。這是同資料契約／同Pages code與新renderer相容的release，非兩環境版本遺漏。

受控dev重新註冊與核發、原key重送／不同body409／補發／撤證重送、兩不同DO shards沿同requestKey永久receipt重送、dev有效測試key在正式403全部通過；仍為2cards／3attempts／3receipts／rev3／2issuequota，無多送或重寫舊卡。新PDF4,378,614bytes、JSON718bytes與D1摘要／長度一致、真Ed25519驗簽通過；完整80字英數/CJK名字、全部0–9及原含數字issuer經實際下載PDF全文抽取／肉眼raster驗證，字距正常、無裁切，獨立jsQR指向原官方驗證網址。測試戶最後停權、所有token／Passkey撤銷、pending安全通知取消保留audit；身份／收據／附件歷史不刪。

I04工程可續I05。Fang兩環境原小窩／門牌／分享設定與永久身份count0保持；未替Fang／K發證／寄信／呼叫Meta，未冒充真人硬體／實體手機。先前完成判定的測試缺口及修復記錄保留；不將工程通過替代I05投遞／I06本人與異環境復原／T09第一階段完成。

### I05a 寄件網域查核本地切片（974dc2c，v0.62待發布）

新增exact operator POST `/api/v1/operator/identity/mail-readiness`，只接受requestKey、使用部署端FROM及provider secret，固定GET自己的精確domain metadata，不寄信、不設hook／DNS／排程。input／transport／auth、response／JSON duplicate／paging／deadline、去敏錯誤與domain verified／sending capability分開驗；senderReady只表示當時metadata，deliveryVerified固定false。

0019兩表四triggers共6物件，獨立check/audit不冒造globalaccount；hash-only requestKey與FROM／origin input、原子quota10/hour與intent先於provider，結果與completed audit同批；same-key永久歷史snapshot不是refresh，checking／unknown不假健康。完整contract見[readiness文件](../IDENTITY-MAIL-READINESS.md)。

新59項先RED後GREEN，主控623完整測試／8版號、build／lint PASS，規格獨立審查PASS（重新查官方List／Retrieve／OpenAPI／Errors）。品質審查、0019兩庫實際套用、Pages發佈與live provider／audit仍待；I04獨立Worker輸入未改，預期保留原相同code。沒有取得本機provider key或真provider呼叫，dev刻意不配置mailkey／FROM。I05a不等於完整郵寄／收件驗收。

### I05a v0.62 發布後實際阻塞與修復（2026-10-31；v0.64待發布）

974dc2c／ef63635已兩階段審查、主控623全測／8版號／build／lint／Pages compile通過，兩目標分支合併、兩環境Pages部署success；0019已實際套用兩庫，6新物件與全146來源DDL逐一比對／FK0。未修改I04獨立Worker、真住戶或既有綁定。

Dev無mailkey／FROM，真端點503unknown／sender_not_configured及永久重放、intent/completed audit與quota1皆符合。Production兩次新metadata check皆在D1保存provider_unavailable／http=null，未取得Resend回應；公網502另被edge替換成ProblemJSON，ray/timestamp變化使HTTP重放無法直接等同原結果，D1永久紀錄本身一致。未以API key名稱存在當健康，不把這個失敗歸咎key或自動輪換／取回本機key。

Root真workerd同compat日期精確重現：redirect:error在network之前TypeError，manual可連到原Resend host並取得未授權控制probe的401（probe沒有任何真key）。官方Request文件與workerd來源確認error模式不支援。d49b5fc修正4個相同確定缺陷的server adapters，manual且在header/body解析前拒絕3xx，不轉送憑證、不follow／自動重試；寄信未知、generation journal、付費approval與原額度均保持。沒有實際Meta或寄信呼叫。

c15aae0另將新的sender metadata provider未知／失敗改回503unknown，保留真正providerHttpStatus/errorName及deliveryVerified=false，避免該zone對502的Error Page替換；不是200健康。既有0019已允許503，不改schema；舊502收據必依原status及內容重放、不重寫audit或藉新程式再次GET。區域設定不為測試而更動、不升級方案。新反例先RED，最終665完整測試、65readiness、build/type／lint通過；兩階段獨立審查與兩環境Pages更新／真正provider查核仍待完成。完整I05附件／webhook／交付及I06真人均未完成。

### I05a v0.64 實際 sender 查核通過（2026-10-31）

兩code修復提交d49b5fc／c15aae0按既有版號規則加0.02，1ea0718／v0.64已合併兩目標分支、兩環境Pages部署success。主控665全測／8版號／build／lint／Functions編譯PASS，獨立spec→quality各121focused通過。0019未變動，兩庫全146來源DDL再次比對相同／FK0；獨立I04 Worker inputs未改、維持原相同code與隔離綁定，public verify JS／CSS實際bytes與來源同。

部署端以既有secret真正GET自己的FROM domain，provider回200、domainVerified=true、sendingEnabled=true、senderReady=true；沒有另設domain變數或把API key取回本機。精確同requestKey／body重放同HTTP200／checkId／checkedAt及結果，check／intent+completed audit各唯一、logicalquota只增加1。dev刻意無mailkey／FROM，503unknown／sender_not_configured及完全相同JSON永久重放通過、不作provider讀取。未授權／額外欄位／錯Origin皆正確拒絕且沒有check或audit寫入。

Production舊v0.62的502永久receipt仍原樣保留與重放，D1整列／audit／quota沒有變化，公網edge仍可能改寫該歷史502外觀，沒有藉新程式重新GET或洗掉舊失敗。新的provider未知以503維持unknown與診斷，未把失敗改成健康。真正查核只證明該checkedAt的sender條件；deliveryVerified始終false。

Fang兩環境原房與分享選擇保持，永久身份count0；沒有真住戶發證／寄信／Meta呼叫，paidCallsApproved=false、等級private-only。I05a工程及sender前置通過，可進I05b凍結envelope／PDF JSON附檔、exact event dispatch、signed webhook／suppression與unknown reconcile；I05完整投遞與I06本人／手機／異環境復原仍未完成，T09不因此完成。


### I05b1 本地凍結封套核心（2026-10-31，v0.67未發布）

產品3a416d2、私密完整性修復2160996與D1官方限制相容性修復e941ab5；本地版號由0.64按三個程式提交增至0.67。新增私有prepare／materialize factory與0020，五種固定事實模板、目前資格／四方住所綁定、原事件密文與歷史收據驗證；合法房屋更新及後來復原不永久凍住原信。真正核對既存PDF／signed JSON的SHA256、長度、chunks、Ed25519與issuer／AgentID／CID；不重繪證件。

完整body以event／purpose-bound HMAC保存，避免明文body SHA256成為email字典oracle；附件manifest仍用SHA256。小型AES-GCM封套與唯一prepared audit同原生交易，state／attempt／quota保持未寄送。returned guards須由b2與sending claim／audit同交易執行；單獨materialize不是寄送授權。

品質審查另發現原flat JSON快照超過官方32函數參數保障，已改為nestedalias（內層最多24、外層16），新跨引擎回歸以Python原生SQLite setlimit套32function／100bind／100KB SQL／2MB row／5compound，編譯五模板及8MiB附件的實際prepare／materialize／returnedguards SQL；舊碼真RED、新碼GREEN。實際兩環境D1唯讀32／60args都成功，因此記為官方保障範圍相容性修復，不宣稱已證明當前D1故障。

主控685完整測試／8版號／typecheck／lint／build與公開輸出檢查通過，獨立規格→品質各20focused PASS。大附件為synthetic壓力資料，真PDF rendering證據仍沿I04，沒有新增正式raster驗收。Python>=3.11驗證依賴與私有接口見IDENTITY-MAIL-ENVELOPE-CORE.md。

本片未push或發布，0020未套遠端；main／dev已發布流程仍為v0.64／0019／146來源物件，I04證件Worker仍v0.61。沒有HTTP／DO／Pages／provider dispatch或新排程接線、未改既有processOne、未寄信或使用真居民資料。b2及c依IDENTITY-MAIL-DELIVERY.md接續，Fang原住所、K新戶、私密等級與I06真人gate保持；T09未完成。


### I05b2a 私有串流與永久寄送核心（2026-10-31，v0.69未發布）

產品6faac9a與最小audit修復43e1d2c；兩個程式提交按規則加0.02。新0021三表與16來源物件保存一次性lease、exact finish receipt、獨立purpose／完整ASCII地址casefold的HMAC負面policy及永久audit；原0013–20未改。prepare／claim／suppress／finish僅私有DO binding可用，公開Worker與Pages internal路徑404。Pages只持provider key、特定地址suppression GET後轉送DO的大body stream；移除舊直寄旁路，預設false。不把同步configured當schema／provider／delivery健康。

補齊metadata授權撤回競態、last-nativeguard＋lease同交易、sending／取消後仍保存已知負面封鎖、早到webhook已有providerID而POSTtimeout仍記unknown receipt且不降級，以及不可刪改ledger／receipt／audit。sending audit不保存lease控制，僅bodyDigest／length；lease保留在私有ledger／receipt。大body仍HMAC，附件仍SHA256，沒有明文地址、body或token進audit。

主控702完整測試／8版號／typecheck／lint／build／公開輸出檢查PASS，規格／品質各自focused驗證通過（最終品質75／75及6項額外反例）。8MiB完整路徑保守逐statement計normal44／lost prepare ack47，實際SQL／bindings經原生SQLite官方限制校準與編譯。

另以固定產品43e1d2c的實際編譯Pages受保護process API＋同版DO＋Miniflare原生D1，在相同compatibility date跑完整流程：4,400,000bytes synthetic PDF及512bytes真簽署JSON形成5,868,041bytes body，附件摘要、固定event tag／Idempotency-Key一致。相同事件再送只1POST、1ledger／finish／sending audit、attempt1，兩公開internal入口404。所有provider流量被導向本機stub，沒有真Resend或郵件。此為本機runtime整合，不是正式投遞；初次probe的dump loader因先插資料後建composite unique index造成FK mismatch，已修fixture載入順序，沒有改產品schema掩蓋。

b2b guardian／card／recovery的commit及歷史receipt replay事件接線、no-context處理留下一片；c的已驗webhook／投遞／unknown reconcile仍未實作。本片未push／部署，0020／21未套遠端（合計23新增物件，整合後應169），兩環境正式流程保持v0.64／0019／146DDL；不單獨啟用、不影響Fang原屋或替Fang/K發證。介面及後續契約見IDENTITY-MAIL-DISPATCH.md。


### I05b2b 已提交事件與歷史收據接線（2026-10-31，v0.70未發布）

產品ecf2185，按一個程式提交加0.01。Guardian accept、card issue／reissue／revoke、recovery continued／guardian repaired的成功交易與原永久receipt重放／lost commit acknowledgement均喚起自己的已保存pending event；不建立第二通知、不重跑人類授權或身份更新。每request有獨立dispatcher：有context用waitUntil，無context直接await，callback失敗保留原成功資料及response。Card只讀有4096bytes上限的可信core lifecycle clone，以CID／kind／完整dedupe／戶籍取event；不碰artifactstream或callerbody、不掃outbox。

主控719完整測試／8版號／typecheck／lint／build／公開輸出PASS；獨立規格與品質各166focused PASS，品質額外21項RAM-only probes通過。規格另實測recovery新continue39、repair29、receipt8條Pages SQL，DO prepare12／claim10／finish6各自獨立invocation，保守低於50；失聯收據outer catch及callback拒絕仍保原結果。

固定ecf2185的實際compiled Pages＋DO＋Miniflare D1，先模擬原4.4MB卡信，再以本機真renderer／TTF核發新卡、自動喚起卡信、撤卡喚起通知，兩項原request重放不新增POST。新PDF4,377,072bytes＋真Ed25519 JSON521bytes，body5,837,481bytes；兩附件摘要與D1一致，3個原事件各1POST／lease／finish／sendingaudit。公開internal入口404，公開verify顯示revoked且不觸發寄送。Synthetic戶籍／備援與100%本機providerstub，無真人或真provider；不能當Fang/K完成或郵件已收到。無新schema、providerkey仍只Pages。

本輪未push／部署，0020／21仍未套遠端、delivery預設false，正式兩環境仍0.64／0019／146物件、I04 Worker0.61。b已完成本地工程；c簽署投遞／配置與unknown reconcile接續，真正provider交付、原Agent／監護人I06及T09仍未完成。
