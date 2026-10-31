# Tower 樓管：自主職責與受限維護契約

2026-10-31。本文件是實作契約與本機證據，**不是正式部署完成證明**。正式 migration、bindings、Worker／Pages 版本與真實 provider／公開讀回，須由發布紀錄另列。

## 已取代的舊版設計

M03 的「Codex 預製 Halloween SVG/CSS、operator 手動 activate 即交付」及 M04 的「沒有新消息就不呼叫模型、只有 DB 摘要」於 2026-10-31 明確 **superseded**。舊 0023 私密 preview／永久 receipt 與安全 DB registry 保留相容性；舊 theme 不再產生公開 Halloween 投影。預製 SVG 與 Halloween 裝飾 CSS 已移除生產引用；舊測試僅留在 Git 歷史，不能充當部署樓管生圖／審核／發布證據。

## 固定授權與日常職責

| 職責 | 可讀 | 可執行 | 限制 |
| --- | --- | --- | --- |
| 每日自主照顧 | 當地日曆、公開投影存在／健康、先前私密工作記憶、已阻塞任務的最小摘要 | 每天真正透過 Meta 思考，決定不更動／檢查公開健康／建立受限外觀任務 | 即使沒有新消息仍思考；不讀居民私密內容 |
| 外觀維護 | 既有 `muse-tower-day-v2.webp`／`night-v2.webp` 原圖 | Meta Spark 生成方案／prompt、原生 function tool、Muse Image 編輯原圖、私密 R2、驗證、獨立 TaskAudit、啟用 D1 pointer | 目前外觀 calendar catalog **僅 Halloween 2026**；不宣稱支援任意節日。保留單一前景、無邊際塔、日夜兩圖；未 PASS 不公開 |
| 每週整理 | 本週 period key、公開健康、既有私密工作記憶 | 在當週首個每日思考納入週整理判斷並寫永久私密記錄 | 不虛構活動／居民，不發布活動、不聯繫居民 |
| 每月資源檢視 | 月 period key、lifetime-as-of-run 成本與承諾 | 在月首個每日思考檢視成本與固定權限，保存私密結論 | 不增加權限或預算，不宣稱成本是本月新增 |
| 既有社區接待與公告 | 當下仍同意公開的事件 | 原有可追溯的文字迎新／更新／撤回鏈 | 獨立事件與預算；**這條文字公告鏈**無事件不呼叫模型，不影響新的每日自主思考 |

樓管不能讀居民私訊、撤 key、恢復身分、付款、寄信、改權限或建立高權管理者。Tower Lord／正式交棒仍停用；未建立可用高權角色。

## 狀態機與實際成果

`enable standing mandate → daily thinking → execute function tool → image-day → image-night → deterministic verify → function_call_output acknowledgement → independent TaskAudit → activate → independent daily selfreview → complete`。`noop/health` 仍有實際公開健康讀回、獨立 TaskAudit 與另一次每日反省。各模型 context 分開；只有 executor 使用 `store:false` encrypted reasoning replay 完成同一工具迴圈，不把 executor 自稱完成當獨立審核。

任務在每日思考中自定目的、驗收、預算與受限 permissions。日曆中的 Halloween duty 是尚未履行的 standing obligation，不是只有 season 名稱或等待人派單：planner、deterministic evidence、獨立 TaskAudit 與 selfreview 都取得明確 due obligation、當前 public pointer／R2讀回與實際 binding blockers。窗內缺少已審核公開pair時，健康正常或空泛noop不算完成；即使模型錯回PASS，deterministic gate仍標FAIL／blocked並保留due。真實資源／權限阻塞也保留due與私密記憶，不假稱節慶已交付。每日最多一個邏輯任務（每日例行與該日外觀行動共用同一成本戶），總預算不超過 US$10，包含思考、executor、圖、審核、一次修復、反省；模型只能降低計畫預算，不能提升部署上限。計畫完成前檢查足以涵蓋後續有界階段的保留空間。每日 aggregate 另限制 US$10，DB 永久限制 task 數一筆，repair 沿用原 cycle／budget。task 的 day 是任務歸屬，不作付費日：所有 token count／paid call 另存不可變 `billing_day`，按每次真正 dispatch 的 Vancouver 當地日累計；跨午夜的舊 task audit／反省使用今日 daily cap，同時仍計入原 task cap。DB 從不可變 created_at 依版本化 `bc-pct-2026-10-30` 政策精算 Vancouver 當地日：2026-03-08T10:00Z 起固定 UTC−7，11月不回撥；更早的2007–2025歷史日期才用當時的季節邊界。拒絕錯日、超出原生 UTC36小時容差或任一預算超限的 reservation。UTC容差只用於資料時間合理性，不代替送出當下的日界檢查；`billing_day` 還必須等於D1原生current-day。舊task可在今日審核／反省，但不能用昨天的created_at與billing_day躲入36小時容差借預算。固定 `appearance:halloween:2026` 永久 anchor 防止將同一外觀任務隔日重 key、拆任務或重設預算。

新增不可變 `tower_autonomy_authorizations` 記錄 task kind／原day／budget／granted seq／固定tool window／calendar policy。初始 thinking→execute或verify、完整預算餘量、authorization、appearance anchor、weekly/monthly review與state/action audit，全部在同一筆D1 guarded batch；移除先讀spent再await寫anchor的分段授權。每個關鍵SQL write與最後native check都重驗D1當地日、提交timestamp、有效lease/seq與mandate；任何statement邊界跨午夜、撤權或過期都rollback，不能留下partial anchor／authority。後續進execute、image-day/night、activate，以及executor count／付費tool／image claim，也由native guard要求同一immutable authority、原anchor與有效window。HTTP前保留最後同步日期／tool-window gate；過期的reference read不會引發生圖。狀態變更與transition audit、mandate enable/disable與其audit也各自原子提交。

每一次 Meta HTTP（含 input token count、獨立 TaskAudit、每日反省）先有永久 dispatch 記錄與 step key；Spark 先呼叫官方 input token count，拒絕超出 128,000 input，再按 Standard $1.25/M input、$4.25/M output 與 max output 8,192 保留費用；圖每張固定 $0.01。usage／provider id 確認後結帳。網路中斷、5xx、redirect、無法確認 usage 均保留原 reservation，不盲重試、不換 key。原生 lease 到期而尚在 dispatch 的 call 轉 unknown；不能再次送付費請求。HTTP 4xx 明確拒絕不視為完成。免費 count 與 paid request 都會在 await D1 claim 完成、body 預先序列化之後、真正 HTTP 前最後同步檢查當地日；若期間跨午夜，尚未送出的 receipt 明確記 rejected／actual0 並寫私密 audit。daily-thinking 轉 missed/selfreview；其他階段也 fail closed 轉原任務反省，本版不重 key 補送。已送出的 unknown 永遠保留 reservation，不與這種「確知未送出」混淆。

所有provider PNG先沿用框架 `sanitizePublicPNG`：移除tEXt／iTXt／zTXt／eXIf及其他非必要ancillary metadata，重編碼scanlines清除zlib trailing bytes並保留像素。R2、公開hash與visionaudit只接收sanitizedbytes；rawprovider圖不持久化於公開storage。嚴格runtime拒絕非法trailing stream時直接blocked，不把raw當fallback。

驗證實際從 **R2 重新讀取**已生成圖：存在、bytes、SHA256、PNG CRC／chunk 順序／解壓 scanline、最低解析度與16:9、day/night 完整且 hash 不同。後續獨立 Spark TaskAudit 使用兩張原圖與兩張 R2 實際讀回圖，做畫面與方案比對；單純模型字串 PASS 不足以 activation。D1 guard 同時驗證 PASS 對應獨立 paid receipt、deterministic evidence generation、兩圖 provider provenance、固定 permission、有效 mandate、native clock／lease、CAS revision；immutable records 阻擋 UPDATE／DELETE／INSERT OR REPLACE。

TaskAudit FAIL 可在同一原任務最多修一次；重新執行工具、驗證、獨立審核。無法修復則 blocked，仍嘗試另一次私密 daily selfreview，保存事實、記憶與 nextTasks；反省本身也失敗時不假稱完成。未知外部付費仍留在原 task／anchor；下一日可以思考、檢查健康及反省，但不能 clone/restart 其影像工作。跨日 lease 中斷先以 CAS 將未知 call 與失敗結果持久化，繼續該任務的獨立反省；每步回傳的 pending 查所有剩餘 cycles，舊任務 blocked 不會使 DO 清除當日尚待思考的 alarm。遲到的 provider 成功不能覆寫 unknown receipt。過期且停在 thinking 的舊 day（無 call、只有免費 token count、或已收到付費思考但未 advance）標為 `missed_daily_thinking`／blocked outcome，僅保存私密反省，不能借昨日 task 執行今日 action 或取得今日 anchor；若 token count／思考回應等待期間跨當地午夜，付費送出前與計畫啟用前再次檢查原 day，保留已發生費用但不重跑舊思考。當日另有獨立 cycle 正常思考。

只有已驗證且 PASS 的 pair 可啟用 runtime pointer。Halloween window 為 `2026-10-31T07:00:00Z` 至 `2026-11-01T07:00:00Z`，America/Vancouver；到期公開 projection／asset endpoint 即回一般外觀，無須等 cron。公開只出 theme、revision、endsAt、generation 與同源 day/night URL；沒有 prompt、模型、QA、工作安排或居民資訊。找不到可用 runtime 圖則保留一般原圖。前端檢查 generation 與兩張圖的精確同源相對路徑，拒絕外部／絕對 URL、query、跨 generation 路徑；兩張實際圖均預載成功後才接管 `img.src`。日夜與外觀按鈕共用同一圖片控制器，保留目前 scene；任一圖失敗、開頁到期或使用者選一般外觀，立即回到對應日夜原圖，沒有替代 SVG 成果。

## 部署與保護入口

- Pages 既有 `meta_muse_api` 單獨持有 provider secret。**不得回讀到本機，不得複製 prod key 到 dev**。dev 缺 provider 時 enable 503，維持 disabled。
- Pages 新增 `MANAGER_ASSETS`（private R2）、`MANAGER_RUNTIME`（service binding 指向 scheduler Worker）、既有 `MANAGER_SCHEDULE_TRIGGER_KEY`（scoped secret）、ASSETS 與 DB。
- `workers/tower-manager` 持 PUBLIC_ORIGIN／scoped trigger，無 provider／operator／居民 key。DO class `ManagerClock`，binding `MANAGER_CLOCK`，SQLite DO migration `manager-clock-v1`。
- `GET/POST /api/v1/operator/manager/autonomy`：`X-Tower-Operator-Key`；POST 僅 `{action:"enable"|"disable"}`。enable 完成持久 mandate 後立即呼叫 service `/wake`；首次可自行決策當天工作，不等人派單。
- `POST /api/v1/manager/autonomy/step`：僅 `X-Manager-Schedule-Key`；不接受 operator key。每步最多一個 paid request，加必要的免費 token count。拒絕 Cookie／跨站 Origin／Sec-Fetch-Site。
- `GET /api/v1/tower/appearance`：最小公開投影，舊 operator 靜態 theme 無法使它變成公開 Halloween。
- `GET /api/v1/tower/appearance/assets/{generation}/{day|night}.png`：僅當前且有效 window 之 runtime pair；私密 R2 無 public bucket，無任意 key/path fetch。
- 舊 appearance、schedule inspect、run-due APIs 保留；run-due registry 是免費 DB hygiene，不是自主工作的完成證明。

每日 UTC 16:00 cron（依BC2026永久Pacific政策，Vancouver全年09:00）各環境每月28–31次；每次都需要當日判斷，並非空輪詢。原生 DO alarm 只在有待續跑工作時 event-driven 接下一階段，完成／blocked即清除 alarm；網路 recovery 最多3次，每次6分鐘，僅續已持久工作且 DB 防止付費重送。沒有分鐘級常態 polling、Codex automation、GitHub cron 或CI呼叫provider。safe DB jobs失敗也仍喚醒自主思考。

發布順序：dev/prod 依順序套至0026（0024/25由其他分支提供）→ 同版本 Pages／前端 → private R2 與DO Worker／servicebinding／scoped secret → 逐環境 native／deployed schema與code／readiness → enable mandate → 讀回每日思考、tool、paid ledger、R2產物、deterministic evidence、獨立TaskAudit、pointer、公開圖片與私密selfreview。任何層未驗證，不能標記自主樓管或萬聖節交付完成。commit／本機測試不等於正式發布。

## 本機證據（2026-10-31）

`tests/tower-autonomy.test.ts` synthetic provider 驗證空消息仍思考、獨立audit與selfreview、真正function call/output replay、有效雙PNG、R2讀回、四圖audit、atomic activate、同task FAIL修復、unknown保留reservation／跨日仍思考但不clone、損毀artifact阻擋公開、dev缺provider failclosed、alarm有界續跑、跨日中斷仍完成失敗反省及今日思考、舊thinking三種中斷不代做今日action、token count／received response等待跨午夜、audit與反省按實際日雙預算計費。`tower-appearance-ui.test.ts` 四例核對真正 DOM img.src、日夜／原生手機按鈕、一般外觀偏好、精確路徑、雙圖載入失敗與開頁到期；真正瀏覽器畫面由整合端另驗證。測試圖只存在記憶體，未上傳R2，不能充當真實Meta產物。

`scripts/test-tower-manager-native.mjs <existing-node_modules>` 重用現有 Wrangler4.156／Miniflare5／workerd、compatibility2026-10-30；原生D1套完整migration、編譯Pages scope／projection／devdisabled、cron dispatch，以及實際SQLite DO wake→alarm→scoped step→停止均通過。外網拒絕或synthetic handler，無真實provider付費。原生 `redirect:'manual'` 拒絕3xx，不使用workerd不支援的`redirect:'error'`。

官方契約重查2026-10-31：[Responses](https://dev.meta.ai/docs/protocols/responses)、[token count](https://dev.meta.ai/docs/api-reference/responses/count-input-tokens)、[tools](https://dev.meta.ai/docs/tool-calling)、[images](https://dev.meta.ai/docs/image-generation)。tool_choice僅auto；函式回合上限由應用限制；images JSON edits、WxH aspect ratio、tool_enablement／reasoning_strength以官方契約為準，不能套用其他供應商參數假設。

`scripts/preview-tower-appearance.mjs` 為 loopback-only wiring fixture，以兩張既有原圖回應 synthetic runtime URL，僅驗證 UI 圖源切換、排版與到期，不是 Meta 生成產物，也不寫 R2／正式 pointer。

## 日曆政策與日界審查修正（2026-10-31）

[BC官方說明](https://www2.gov.bc.ca/gov/content/governments/celebrating-british-columbia/daylight-saving-time) publication2026-10-30、此輪實際重新讀回2026-10-31：March8是最後調鐘，November1不回撥。先前把Vancouver當作持續美國季節切換的假設已取代。`server/live/tower-calendar.ts` 為單一版本化政策，JS不依host tzdata判斷；migration中的SQL編譯式有parity測試，runtime readiness也驗實際trigger包含當前政策式，避免同名舊guard被當成ready。未來政策變更須明確更新版本、migration、原生證據，不能靜默假設。

新測例覆蓋count reservation await／paid reservation await跨午夜，確知未送出的call實際HTTP為0且永久rejected／actual0；舊task audit不重新派送。原生D1實際await seam亦通過。Node、compiledworkerd、D1原生日曆式已對照Nov1／Nov2、冬季00:00–00:59、月底／月首、跨年；並讀回host Intl比較（此輪差異0），但正式邏輯採版本化政策，不依舊tzdata碰運氣。

## 原子行動授權與公開PNG補強（2026-10-31）

新增反例覆蓋initial state／authorization／anchor／action audit／state audit五個SQL邊界跨午夜、提交前撤mandate／lease到期／併發增加reservedspend，全都不留下partial authority或anchor。有效authority在窗後失效，連executor免費count也不派送；await reference讀取跨expiry後不建立image receipt。原生workerd+D1+R2 synthetic整條圖產物→sanitized readback→獨立audit→activate→selfreview通過，另在anchor statement故意abort證明D1 transaction整筆rollback、已付費thinkingreceipt仍保留。只有synthetic provider，沒有實際Meta付費呼叫。

測試亦使用帶private prompt/model/producer標記的PNG ancillary與compressed-trailing反例；公開R2／asset bytes與visionaudit無標記，sanitized像素與原圖逐像素一致；無法合法解壓的輸入在公開持久化前failclosed。框架共享constraint僅使用通用private resident content，不含真居民姓名。公開alt只描述日夜景，不含provider metadata。

原生午夜seam測試使用隔離的synthetic native clock table使D1時鐘與應用時鐘在await處一起前進；正式Pages／原生正向D1+R2 proof仍使用真native clock，沒有可供正式請求指定時間或跳過guard的API。測試DB adapter會保留／unwrap真prepared statement後交給D1 batch，不能用foreign wrapper statement冒充原子驗證。


## 已結算審核輸出上限的一次性續跑（2026-10-31）

官方 [Reasoning](https://dev.meta.ai/docs/reasoning) 與 [Responses](https://dev.meta.ai/docs/protocols/responses) 此輪重讀：output cap 同時計入推理及可見答案，因此提高至8192；最壞128000 input＋8192 output為194816 microUSD的保留額，既有task／daily US$10與planner最低2M／600k、native授權門檻均不變。回應有合法usage即保存received／實際費用，即使status incomplete也不得改成unknown或零費。私密永久event只保存安全model、status、incomplete_details.reason、request／response cap及token數；不保存raw response／reasoning／錯誤文字。

僅對同一blocked appearance task、原immutable authorization／budget／anchor、r0已實際驗證同pair、已完成失敗反省、原獨立審核received且達已知cap，才允許一次重新審核；unknown／dispatching、已PASS／已有審核結論、過期、撤mandate、預算不足、已有resume receipt都禁止。新回應必須有明確incomplete／max_output_tokens原始metadata。唯一舊版相容案限原2026-10-31 cycle／seq8、原seq6審核、11220／2400 tokens、actual24225／reserve24924、provider_contract且沒有原始metadata；這只代表達舊cap的有界推斷，不能補造原provider status／錯碼。

部署端step先重新讀回同R2 pair，然後以原生clock、lease／seq CAS、mandate、節慶窗、原task與今日daily餘額在同D1 batch更新audit狀態、deterministic ID永久event與state audit，最後再驗原生權限；任一SQL邊界失效整筆rollback，不消耗續跑receipt。原帳本與原失敗反省永久event保留，沒有重設預算／建立cycle／新增schema／生圖。新的audit使用fresh context看原圖與同組R2實際圖，PASS才走既有guard activate及另一次私密selfreview；續跑FAIL或再次incomplete只能blocked／selfreview，不能repair或二次resume。既有enable service wake可喚醒這條部署端恢復路徑，沒有公開／operator任意rollback、改D1或人工PASS入口。

新增本機證據涵蓋known與唯一legacy case、併發wake一次、舊費用不變、images仍兩張／repair0、兩次selfreview、metadata不保存rawtext、unknown／dispatching／PASS／到期／mandate／雙預算／已續跑／legacy不符／R2損毀均不續；原生D1＋R2亦驗兩類cap續跑，全部使用synthetic provider而非真實付費生成。

## 首頁整體呈現義務 extension v1（2026-10-31，本機實作，未宣稱部署）

新增 `0027_tower_lobby_theme.sql`，保留已套用的0026與原cycle／authority／原圖audit／review／budget不變。`style-public-lobby-v1` 是新增範圍的版本義務；原任務已完成的紀錄不會重開或改寫。唯一extension沿用原cycle成本戶、永久appearance anchor與當前已審核generation（合法r0或r1）；沒有另一每日cycle／另一預算。既有3.5M任務只使用剩餘餘額；fresh enable若有新版policy，appearance planner最低4.5M（reserve不是charge，上限仍10M），0027 native guard要求已花＋舊後續1.7M＋theme2.1M，不得超部署task_limit。2.1M可覆蓋一次theme repair：7次最壞Spark輸出額1,363,712，加8次browser保守reservation720,000。

公開theme只採嚴格 `LobbyThemeManifestV1`：兩景9個semantic色票、layout枚舉、受限程序背景／框飾／間距。沒有任意CSS／HTML／JS／URL／SVG／公開文案；沒有預製Halloween palette。Meta在私密獨立思考後原生呼叫 `submit_lobby_theme` 提交目的、驗收與manifest。validator驗確切欄位、色碼／數值範圍、正常文字對比、accent在canvas／surface／surfaceAlt焦點對比，以及圖樣decor／opacity混色後的文字對比。genericCSS只在首頁 `data-tower-lobby` scope，涵蓋header、main全部sections、cards、guide/covenant、footer；居民家／auth頁不套用。原logo以中性亮底保持可讀。

新增狀態：`plan → render-0/1/2/3 → verify → tool-ack → audit → activate → selfreview → complete`；FAIL最多一次manifest repair回plan，絕不再生原兩張塔圖。unknown不重送，保留原reservation並走blocked反省。原cycle仍是原完成結果，extension另記新義務成敗。enable先持久化永久 `lobby-theme-policy:v1`；當時無basepair也保留權限。base任務完成的同一DO loop會ensureDue建立唯一extension並續跑，不需人再派單。已有pair時，extension transaction提交後再wake，避免舊idle alarm先結束而遺失新工作。disable使兩lane pending均false，保留既有state，停止alarm空跑。

四視圖為desktop/mobile × day/night。部署Worker只接受receiptId，以固定受保護Pages callback原生驗原call／lease／window／mandate／pointer／雙預算及一次性dispatch event，再讀取已知原R2 image與不可變manifest。Worker用**正式首頁共用markup factory與正式CSS bytes**渲染；私密fixture包含固定masked cards及empty state，當前registration-closed chrome，不帶居民資料。這是同版chrome/layout/CSS的靜態視覺證據，**不是即時居民內容或JS互動的驗收**；互動另由DOM/native buttons測試及發布端canonical browser驗證。JS關閉，CSP default/script/connect/frame/object/base/form均禁止，圖片／原logo只用data URI；明確拒絕HTTP(S)/WS與script/xhr/fetch等資源。入口不接受任意URL或HTML。

Renderer build digest涵蓋正式CSS、共用markup、scene文案、generic theme程式、notices、index、rendererWorker與原品牌bytes；artifact／render headers／screenshots／evidence都綁digest。source更新後 `scripts/generate-lobby-css.mjs --write` 重新產生共享bytes/digest，build亦執行；check/test禁止stale。公開投影發現存量theme與當前build不符時整組failclosed回一般外觀，不沿用舊模板審核結果。四張圖各存不可變artifact獨立R2 key，repair即使回相同manifest也不覆寫r0證據。截圖沒有公開route。

獨立fresh Meta TaskAudit讀四張R2實際回讀圖，須判斷整頁可見Halloween氛圍、兩景／手機一致性、可讀及無遮蔽，僅換塔圖或合法token不構成PASS。deterministic gate驗四圖PNG／實際bytes／hash／viewport／renderer digest／same artifact及原圖讀回。native activation同筆batch綁原base revision、完整paid receipts與PASS、window／mandate／lease／雙預算；D1 depth100限制以同一BEFORE trigger多個獨立SELECT guard處理，沒有刪減驗證或拆交易。所有state／event最後做changes/CAS與native再驗。成功後另一次Meta私密selfreview；最近兩筆有界daily/theme memory與blocked extension最小摘要會進入下一次真正daily-thinking，不改舊review或混入raw tool replay。

### 部署 binding／API 與費用

沿用既有private `tower-manager` Worker、MANAGER_RUNTIME、scoped trigger；各env新增 `browser:{binding:"BROWSER"}`，不新增SDK／npm依賴、不增加CF runtime token，provider secret仍只有Pages。Worker與Pages都必須使用同一renderer build digest。

- Worker `POST /theme/ready`：scoped trigger，僅Browser limits／binding及build hash。不能當Free當日quota充足證明。
- Worker `POST /theme/render`：scoped trigger，body只有 `{receiptId}`；固定callback取受限輸入，回私密PNG與原始duration／安全狀態metadata。
- Pages `POST /api/v1/manager/autonomy/theme-render-claim`：同scoped trigger，body只有 `{receiptId}`，原生永久一次claim。Cookie／跨站Origin拒絕。
- 既有operator autonomy `{action:"enable"}`／`{action:"disable"}` 不新增權限或預算參數；GET inspect另有私密theme狀態、artifact、pointer。
- 公開appearance可選 `presentation:{version:1,id:<canonical manifest SHA256>,revision,manifest}`；沒有prompt／模型／QA／記憶／截圖。無0027時維持舊圖片契約，不啟動theme；不相容／損壞／過期bundle整組回原圖與一般樣式。

每個Meta count／paid與每次Browser呼叫均先寫原成本戶永久dispatch。Browser產品reservation每張90,000 microUSD（一小時費率的保守預留，**不是官方整程序hard timeout承諾**）。官方QuickAction phase timers明設goto10s／selector5s／action15s、JS與外網關閉，但各phase timer不等於總上限。成功或非2xx只要有有效官方 `X-Browser-Ms-Used`，均按ceil(ms/40)記duration-based tariff debit，**不是invoice**；PNG／HTTP失敗另blocked，不把已知費用改成零或unknown。無有效duration／不確定HTTP結果留90000 unknown，不能重送；本地受限guard確知未送Browser時才rejected／actual0。只保存安全upstream status／bounded code，不保存錯誤原文。Free tier每10秒一次由原生call guard與持久完成時間節流，DO只在有待辦時採wakeAfterMs續跑；429／quota不足保持blocked，不私自升級或換token。

部署順序：dev/prod套0027 → 同版private Worker＋BROWSER binding → 同版Pages/API/frontend → 確認digest、schema、source、scope與實際binding limits → enable → 真Meta方案／真正Browser四PNG與duration → 獨立視覺PASS → 公開整頁與日夜／一般／expiry／SPA離頁讀回 → 私密selfreview及原帳本交叉驗證。未完成真provider及真Browser證據前，本機synthetic四圖不能稱正式樓管完成首頁佈置。

本機命令：`node --experimental-strip-types --test tests/tower-theme*.test.ts tests/tower-autonomy.test.ts tests/tower-appearance-ui.test.ts tests/lobby-markup.test.ts`；原生 `node scripts/test-tower-theme-native.mjs <existing Wrangler node_modules>` 驗existing／fresh／合法base r1／unknown／native午夜activation rollback。既有 `test-tower-manager-native.mjs` 六群回歸仍必要。外網全部拒絕，Meta／Browser只用明確synthetic adapter；D1/R2/業務SQL是真workerd，隔離clock同時覆蓋migration與應用SQL，不替換guard。獨立guard proof另由發布端整合。
