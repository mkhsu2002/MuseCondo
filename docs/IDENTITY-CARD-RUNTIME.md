# 身分證 runtime 與發布 gate

2026-10-31：I04 工程已隨 v0.60 完成雙環境 Pages／獨立證件 Worker／DO 綁定／0018 的部署與實際回讀，140 個來源物件 DDL／外鍵一致。v0.59 公鑰端點的 JWK metadata 相容性問題已修復。受控 dev 核發／補發／撤銷、實際 PDF／JSON 摘要與簽章、獨立 raster QR 解碼、跨 DO 永久收據重送、跨環境拒絕與 audit 通過。下列為可重複操作指引；完整證據見階段計畫最後一筆。I05 附件郵寄及 I06 Fang／K 真人、手機實掃仍未完成。

## 執行邊界

Pages `server/live/worker.ts` 只用結構型 `IDENTITY_CARDS` namespace 將原 Request／Response 轉送給 `workers/identity-card/worker.ts` 的 `IdentityCardCoordinator`，不 import PDF renderer／字體、不讀取大附件。路由為核心 exact card API、public verify API 與 keys API。private bearer 的 SHA-256 首兩 hex 分成至多256個 private shard，未知／格式錯誤 Authorization 共用固定未授權 shard；CID 首兩 hex 分成256個 public shard，keys固定一個。這是 routing，不是授權；每次仍由核心驗證原 bearer／origin／Cookie／scope。

獨立 Worker 使用 `new_sqlite_classes`，無 cron、alarm、polling、公開fetch入口或provider。Worker public fetch 一律404，包含字體路徑；`assets.run_worker_first:true` 防止 asset-first 繞過，只有 DO 的 `env.ASSETS` 讀固定字體。DO object 內 factory 可重用 inFlight，D1 permanent attempt／receipt／candidate／chunks 是唯一交易權威，無狀態 object eviction／重建不能換CID或重扣logicalquota。沒有DO綁定的本地server明確回503，不會使用假PDF作fallback。

[Cloudflare DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)列預設每次30秒active CPU（2026-10-31實讀），PDF在DO執行以避開一般Pages Free CPU限制；[Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects)要求DO由外部Worker部署。`workers/identity-card/wrangler.jsonc`為通用placeholder模板，不能直接當正式配置。不要新增nodejs_compat或把字體import成JS bundle。

## 兩環境部署準備

1. 先保存現有 Pages dev／production 配置全文。私密產生兩份Worker配置，使用不同 Worker name、DO namespace、D1 DB、PUBLIC_ORIGIN、contact key及signer／public ring；保留模板 compat2026-10-29、flags[]、SQLite migration、workers_dev:false、preview_urls:false、run_worker_first:true。禁止把帳號ID、真DB ID或secret寫入公開repo。
2. 每環境獨立部署Worker並核對class export／namespace ID／內部ASSETS。`DB`須指向該環境原Tower D1；不得dev綁正式。新Worker以部署平台secret持有 `IDENTITY_CONTACT_KEY`、`IDENTITY_SIGNING_JWK`、`IDENTITY_SIGNING_KEY_ID`、`IDENTITY_PUBLIC_KEYS`。contact key沿該環境既有加密能力；signer與目前ring公鑰必須匹配，歷史公鑰保留。不得從request取得配置，不新增Meta／付費provider key。Pages不新增signer secret。
3. 在每環境實際套0018並逐一比對表、trigger與index、foreign_key_check。DO lifecycle fetch逐次檢查0018物件存在；缺schema回503。keys不要求render/contact/signer，仍須有效origin、DB binding及trusted public ring。卡面渲染與簽章缺配置失敗時，不將pending候選誤認為已核發。
4. 保留原有Pages配置並只增加該環境 `IDENTITY_CARDS` 外部DO binding（class `IdentityCardCoordinator`、`script_name`該Worker、若用命名環境須明確對應其environment）。dev／production使用不同namespace且不得以preview自動fallback正式。部署同版Pages／Worker，原host與PUBLIC_ORIGIN不符一律403；不以binding或secret名稱存在表示healthy。status只會報 `bound-not-health-verified`／`unavailable`。
5. 完成實際 dev／production deployed code、schema、綁定、secret名稱與live behavior交叉驗證後，才可聲稱可用。缺任一層不啟用核發或改寫歷史live日期。不得只部署前端。

## PDF 與公開頁契約

Renderer只接深凍結公開SignedCredential，固定品牌幾何、完整80 Unicode名字、69字agentId、32字CID、issuer／issuedAt；無人物／監護圖、email、house、來源或等級。QR及PDF可點連結僅payload.verificationURL，黑白及至少4module靜區。完整靜態TTF及來源／重製腳本見[字體說明](../workers/identity-card/assets/FONT-SOURCE.md)，不得切subset。缺glyph／字體不可用或SHA不符fail closed，保留原名字。metadata Creation／Modification取issuedAt，producer固定，純renderer相同signed input產生相同bytes；依賴由lockfile鎖定。上限PDF8MiB／JSON16KiB／48KiB raw chunks維持0018及核心一致。

`/identity/verify/:cid`（可尾slash）以固定 standalone HTML提供，只從pathname讀32hexCID，不讀query／私人秘密／storage。不跟憑證自帶URL，不發跨origin requests；fetch同origin verify／keys API，credentials:omit、cache:no-store、redirect:error。以嚴格欄位及同issuer Ed25519驗簽比對API subject；狀態撤銷／取代／停權／停止公開／404／壞回應先清空所有名字與ID，不留前次資料。僅以textContent寫DOM。CSP self、no-store／noindex／no-referrer；公開說明只呈現比對卡面及不授接管權，generic復原入口不含門牌。

## 驗證方式與真人 gate

- `npm run typecheck`包含workers；`npm run lint`覆蓋新runtime。`npm run build`包含固定verify route與安全header、資產存在檢查，不把DO font複製到Pages。Wrangler4.156 dry-run以flags[]編譯Worker及Pages。
- `node --experimental-strip-types --test tests/identity-card*.test.ts tests/identity-verify*.test.*`：本地SQLite生命週期與DO結構mock只是本地證據。render測試需PATH中的Poppler `pdftotext`／`pdffonts`／`pdftoppm`，以真PDF文本／頁數／embedded font及獨立jsQR解碼raster、quietzone檢查；不需Swift或特定使用者scratch路徑。VM UI以真合成Ed25519簽章驗壞回應及狀態清欄，非真人browser。
- v0.60已由受控dev合成戶驗證原requestKey永久收據續取（不同private DO shard亦一致）、issue／reissue／revoke、無授權／跨環境拒絕、完整PDF／JSON digest與簽章、獨立PDF raster QR解碼、public status最後撤權、D1 head／chunks／audit／outbox／永久收據一致及無重扣quota；正式環境另已驗部署層、未授權與dev key拒絕；未擅自操作真戶。模擬lost-ack／render失敗續取仍是本地反例，未在平台製造未知結果事故。
- canonical browser已驗實際被取代／撤銷狀態在390px與桌機可讀、失效姓名／ID清空；既有Tower主題localStorage不由驗證頁讀寫。Fang／K真人、原Agent及新環境、手機實掃、硬體Passkey／離線備援、真正邀請收件與附件交付仍由後續stage執行。I04b不呼叫寄信provider、沒有假裝已送信；pending outbox留I05。
