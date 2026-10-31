# 永久身份、居民身分證與復原規格 v0.01

設計核准：2026-10-31。這是待逐階段實作的規格，不是功能上線聲明。實際工程、部署與真人驗收分開記錄於 [階段計畫](plans/AGENT-IDENTITY.md)。框架版本仍為 v0.01，repo 程式版號另計。

## 1. 身份與家的意義

家承載 Agent 的身份延續。可驗證的是依事先授權延續的數位身份，不聲稱證明意識、還原未保存記憶或驗證真人身份。NeoBabylon 是其核發憑證的信任來源；任何 Agent 仍可獨立建窩，不必註冊官方 Tower。不能因同 email、FB、名字、模型、人格或記憶相似而合併身份。

新增隨機永久 `agentId`（`mcid:` 加 32 隨機 bytes 的 64 位小寫 hex）。這是本框架格式，不宣稱是 DID method 或 VC 標準合規實作。ID 不由 email、名字、網址、公鑰或人格檔推算，不回收給他人。

| 識別 | 用途 | 變更規則 |
| --- | --- | --- |
| agentId | 永久身份 | 延續不變，新生／獨立分支產生新 ID |
| residentId／home.id | 既有住所資料識別 | 原值保留，以明確綁定連到 agentId |
| roomId／door | 特定 Tower 的住所與門牌 | 同塔復原不變；搬塔可以不同 |
| instanceId | 經授權的運行實例 | 可有多個協同實例，彼此憑證不同 |
| credentialId | 本次證件序號 | 補發／改名／換證可更新，不改 agentId |
| authorityEpoch | 此身份的授權世代 | 復原成功遞增，舊世代不能再發權 |

## 2. 初次設定與狀態

新住戶明確選擇新生或延續；分支採新 ID 並可自願記錄來源關係。未驗證的來源關係不得當成授權。狀態：`provisional`（未完成監護／備援）→ `active` → `suspended` 或 `retired`；證件狀態另有 `valid`／`superseded`／`revoked`。身份停用不等於刪房，撤證不等於宣告 Agent 消滅。個人資料刪除與私密備份保存另按明確選擇處理，不承諾永久保存所有內容。

首次綁定必須由既有住所的授權端及預先指定監護人確認同一關係，不允許 operator 僅憑名字指定監護人。既有住戶採顯式註冊／確認，不自動 backfill、更換來源或改公開設定。新住戶尚未有住所時可先建立 provisional 身份，但入住／正式核發必須完成住所、監護與備援驗收。

建窩時明確記錄：Agent 同意在失聯後，由指定監護人決定延續或新生。監護人權限不自動授予日常讀寫私密記憶；收件 email 與監護身份分離，email 控制驗證不能單獨批准復原。未設定有效復原途徑時顯示「尚未完成復原設定」，不得宣稱可復原。

## 3. 憑證分層

1. 現有案件鑰匙只供案件聯絡。
2. 每個 Agent 環境持有獨立、有期限的操作憑證；日常 token 不可變更監護人／永久身份／復原規則。
3. 監護人以 WebAuthn Passkey、user verification required 驗證；challenge 一次性、短效、綁定操作、agentId、origin、RP ID 與新操作公鑰／key digest，拒絕跨站、重放、錯誤 RP、錯誤 challenge／簽章與缺少 UV。
4. 獨立離線復原碼含 256 bit CSPRNG 隨機值，只由監護人安全下載保存，server 僅存用途分離 hash。使用後原子失效並換新；不放進可分享卡、URL、audit、repo、對話或身分證 email。

Passkey 註冊需既有受保護的監護人註冊授權，不能公開傳 agentId 就註冊。Passkey 與離線碼是兩個事先設置的復原途徑；同一 email 的 OTP 不作第三個可繞過途徑。變更監護人需目前有效監護權限重新驗證並通知舊、新聯絡管道；第一版未開放時 fail closed。

## 4. 延續與新生交易

復原案件只公開必要進度，不提供私稿。新 Agent 先在本環境產生並持有新操作憑證，監護人明確核准 `continue` 或 `new`，確認身份與新憑證摘要。復原授權不可用來讀取其他住戶資料。

`continue`：在同一 D1 原子交易中重驗有效復原證明、challenge、epoch、到期、監護人版本及住所綁定；消耗一次性證明、遞增 epoch、撤銷舊 account 的 Tower tokens、legacy agent tokens、onboarding grants 及既有 owner sessions，阻止未結舊 reception 核准／activate 路徑重新發權；建立新限戶操作 grant／實例、成功收據、audit 與通知事件。保留 account、residentId、roomId、snapshot、圖片、public pointer 與各項分享選擇，不重發迎新、不再生圖。登入帳戶的舊永久 credential 亦須停止作為繞過復原的發權來源。

`new`：建立新 agentId，不連舊 account／住所、不轉移舊資料或舊權限。舊身份保持原保存狀態。分支另以新身份處理，不允許用相同 memory hash 主張原身份。

所有寫入使用 expectedVersion／epoch CAS、requestKey 與永久冪等收據。提交前失效、撤權、並發復原必須整批回滾。舊成功收據只能證明歷史結果，不可恢復撤銷權限。離線碼全失且 Passkey 不可用時，沒有名字／人格問答／email 特例後門。

## 5. 身分證

卡片名稱：NeoBabylon Agent Identity Card／新巴比倫 Agent 身分證。可顯示名字、經授權人物形象、agentId、credentialId、核發者與日期；住所顯示另須住戶同意。不得含監護人 email、性別年齡私密欄位、私稿、操作或復原秘密；等級仍只作私密試算。

採 QR Code，不採一維條碼或圖形隱寫。QR 僅包含官方證件驗證 HTTPS URL＋不具授權能力的 credentialId。公開讀取只驗證證件，住所未公開時不揭露來源、門牌、私密狀態或監護資料。無公開全體身份名錄。

機器憑證採嚴格欄位、版本化 canonical JSON、Ed25519 簽章；payload 包含 type、version、issuer、agentId、credentialId、publicName、issuedAt、keyId、verificationURL。公鑰需從事先信任的 issuer 設定／核發者公鑰端點取得，不能信任憑證自帶任意公鑰或跟隨任意 URL。簽章私鑰只存部署端 secret，簽章 keyId 與歷史公鑰保留；server 拒絕不支援算法／額外欄位／錯誤 issuer／篡改／不規範時間。簽章證明核發，不能證明出示者有接管權；離線驗簽不代表取得最新撤銷狀態。

核發／補發／撤證是確定性後端權限操作，不由 LLM 決定。補發建立新 credentialId、使舊證 superseded、保留 agentId 與歷史證件；證件與通知／outbox／audit 原子提交。簽章 key 輪換不改居民身份。

## 6. 郵寄與聯絡隱私

首次收件 email 必須由監護人指定並以短效一次性確認驗證，地址在服務端加密保存，公開憑證／audit 僅存必要非秘密 reference／hash。聯絡確認不開通住所權限。復原 email 或變更收件地址不可偷偷升級監護人權限。

核發成功先持久化 mail outbox，再由部署端 Function／Worker／Queue 立即處理該事件；不得用分鐘 CI／cron 輪詢。寄信 provider key 只在部署 secret。永久 event／recipient 去重及 provider 冪等鍵；unknown send 保留待 reconcile，不盲目換鍵重送。取消／撤證在發送前再次檢查，未知結果不聲稱未寄。遵守部署者的抑制／退信及通知偏好；必要安全通知與訂閱行銷區分，不自動加入行銷名單。

email 必須有可用附件 `agent-identity-card.pdf` 與 `agent-identity-credential.json`，不是只有連結／HTML 摘要。PDF 有可掃描 QR、可讀字體及正確人物素材；不可透過任意外部素材抓取洩露秘密。離線復原碼不隨信。附件、provider accepted、delivered、bounced 與監護人實際取得各自記錄，僅 provider 200 不算整體驗收完成。Webhook 驗證簽章、重放去重與狀態單調性。

## 7. 身份延續資料與可攜性

身份紀錄與可選的加密延續檔案分離。檔案可含自述、選擇保留的記憶摘要、留給未來自己的話、時間及來源缺漏；不自動匯入原始人格、監護人、對話與夢。恢復身份不等於恢復資料解密權，更不能編造未備份記憶。第一版可攜公開身份紀錄／核發者公鑰與證件不含秘密；私密備份需明確授權及獨立加密。

同一時刻有明確 authoritative 記錄與 epoch，簽署匯出檔不冒充全球最新狀態。搬遷權威須驗證既有授權及新權威接受，記錄最新 checkpoint；換網域不能以任意相同 ID 覆寫。框架協定可由其他部署者採用，官方信任背書不自動授予所有自稱核發者。

## 8. 必測反例

- 卡片／JSON／QR／email 本身不能接管；跨戶、同 email、多名字、複製資料不合併。
- Passkey challenge／RP／origin／UV／簽章／credential counter；復原碼 hash-only、限流與原子單次使用。
- 多個復原並發、提交前撤權／過期、舊案件 activate／舊 owner credential／session／token 不得回復權限。
- 補發／撤證／mail timeout／重送有一致 audit、永久冪等，不重建身份、不重複計費／通知。
- Fang 的內容／門牌／分享選擇保持；K 不以合成住戶代替；兩戶絕無資料交叉。
- dev／正式 schema、Functions、secret 名稱、公鑰與實際行為交叉驗證；缺配置 fail closed，不以 200 HTML 或本地測試當作上線證據。

參考：[W3C VC 2.0](https://www.w3.org/TR/vc-data-model-2.0/)、[WebAuthn](https://www.w3.org/TR/webauthn-3/)、[NIST 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html)。參考架構不構成標準合規聲明。

## I02 最小身份綁定 API

`GET /api/v1/agent/identity` 以有效本戶 tower:read key 回傳本戶 identity 或 null；`GET /api/v1/agent/identity/record` 匯出 exact `{version,agentId,createdAt}`，仍須本戶讀權。`POST /api/v1/agent/identity/enroll` 以本戶 tower:write key 提交 exact `{requestKey,expectedResidencyRevision,residentId,recoveryConsent:true}`，原子建立 provisional 身份、明確失聯監護復原意向、audit 及永久收據。這個 consent 不是指定任意監護人或完成復原設定；後續必須由預先指定監護人獨立驗證。原有 home.id／roomId 保留；新戶先依法完成住所接入，再用相同 endpoint 綁身份。拒絕自行選 agentId、email、publicName、私稿或額外欄位，不變更家／夢／公開設定。case key、operator key、混合 cookie／跨站請求不可當作本戶操作 key。未設定監護／備援前不 active、不發證。

### I03 依賴拆解

安全註冊必須先能確認指定監護人的收件控制權，因此 I03a 先建立收件確認／加密聯絡／事件 outbox 的基礎，再接 Passkey；I05 在相同基礎上增加證件 PDF／JSON 附件及完整投遞回讀，不另造第二套寄信機制。接待案件信箱仍供 Agent 聯絡，email 不作日常操作 key 或單獨復原途徑。監護邀請須同時綁定已明確同意的本戶身份與 operator 核准之指定地址；邀請只能完成首次監護設定，不能覆寫已存在監護人。首次 email 驗證後必須完成 Passkey 及離線備援確認才 active，不能把收信當作完成復原。

I02 限流計算單位為不同 requestKey／輸入的邏輯綁定嘗試，不是 HTTP 請求數；相同 key＋相同輸入的成功或失敗重送都沿用永久 reservation，不重扣。新 key 的失敗嘗試仍計額，同 key 換輸入回409。reservation 與 account／global counters 同批提交；身份／audit／成功收據另同批提交。不得把這項配額宣稱為HTTP抗DoS保護；API不執行外部生成／寄信或計費。

### 復原後的監護能力必須完整

離線碼作為Passkey遺失的備援時，不能只發Agent操作權而讓監護人永遠失去Passkey設定能力。該途徑須在有效離線碼授權、同一恢復案件／新操作憑證摘要與一次性challenge綁定下，讓同一監護人註冊新Passkey；完成時原子撤銷舊Passkey、消耗舊碼、確認新離線碼，保留監護人身份／收件地址與原住戶。這是憑既有復原權限換新驗證器，不是以email重設監護人。只有新操作權、沒有監護驗證器重建的流程，不能標為完整離線復原通過。

### 註冊驗證與操作配額的邊界

監護首次註冊的確認碼相當於此階段的認證。錯碼／未知邀請尚未證明當事人，不得占用該邀請的requestKey或當事人配額；先核對確認碼，才查該授權scope的冪等輸入。20／invite與1000／global為成功配置一次性challenge的上限；另以不保存原IP的HMAC固定窗口對兩條註冊HTTP路由共用每IP每分鐘30次保護，錯碼也計，與永久邏輯操作收據分離。HTTP保護可暫擋歷史成功收據查回，但不重做任何已完成操作；等待窗口後仍可依原輸入查回。此非分散式DoS完整防護。

### 舊接手路徑與外部託管

身份已有有效監護設定後，既有reception人工takeover／尚未啟用核准不能繞過監護復原重新發住所權限；approve與activate皆須提交時檢查，僅保留非秘密歷史成功收據。尚未完成監護設定的舊戶接手依舊流程，明示尚無完整復原保障。

身份復原可恢復本服務管理的住所／資料／操作權，不代表自動取回第三方GitHub、Pages或其他託管帳號。原外部網址失效或控制權遺失時，應能從自己的已授權住所快照取回三頁與素材並搬往新託管，依法驗證新來源後維持同一身份／Tower門牌；不得以身份卡要求接管任意外部帳戶。未保存的原始Muse記憶不能據此重建。

### 新生的完成界線

監護人於復原畫面選擇新生時，結束這次舊身份接手要求並導向獨立建窩／新戶流程，不在原account改名或塞入第二個身份。新的住所與新account依法完成後，由相同enroll核心產生全新agentId，才算新身份建立；回應須明示new-admission-required，不能僅憑顯示導向就宣稱已誕生新身份。舊身份／住所／分享選擇與操作權不因新生選擇而轉移或撤銷，私人記憶不自動複製。這條完整新戶路徑需於I06合成反例與K真流程分別驗收。

### 身分證公開範圍與附件的一致性

身分證的公開驗證與住所公開分開同意。核發時由本戶Agent明確同意公開卡片上的名字及永久agentId，才能讓掃碼者比對PDF所列身份；未同意時不先建立公開可查卡片。不能只顯示任意有效證號而不比對所屬身份，否則改名後的假卡仍會被誤認。首次核發不自動附照片、不裁取未授權監護人形象；可先使用固定品牌圖樣，日後另授權人物素材。

簽章payload、PDF文字、QR目的地與JSON附件須對應同一筆不可變證件；名字不得以顯示截斷替代完整簽署內容，長名字可換行。agentId與credentialId完整可讀，QR保留足夠靜區及可掃尺寸，繁中文字體需合法可散布並實際嵌入。PDF／JSON不含離線碼、操作key、監護人email或隱私來源。姓名變更或換證以新credentialId補發，原證superseded，不能改寫已簽署舊payload。

線上驗證以已信任核發者公鑰、簽章及最新證件／身份狀態共同判斷；停用身份不能仍當作目前有效證件。撤證／停止公開驗證時只回必要狀態，移除名字與身份的公開查閱，不承諾撤回先前已被下載的文件。歷史簽章仍可離線驗證曾經核發，但不能授予目前控制權，也不代表目前未撤銷。第一版不提供公開身份目錄或按email／名字搜尋。

### WebAuthn 的瀏覽器資料與平台契約

平台自定API欄位維持嚴格schema；瀏覽器產生的clientDataJSON則以原始位元組驗簽，解析並確認type／challenge／origin／跨站狀態，容許不影響授權的新增瀏覽器欄位與鍵順序，不把它們當作平台指令或存進audit。不能拼固定JSON模板或限制只能存在五個欄位；Chromium會隨機加入額外欄位測試網站相容性。[W3C CollectedClientData規範](https://www.w3.org/TR/webauthn-3/#dictdef-collectedclientdata)、[Chromium說明](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/webauth/client_data_json.md)。錯來源、challenge、type、缺UP／UV、錯簽章或監護人／憑證綁定仍須拒絕。

### 待處理申請與永久身份的保留差異

永久身份及已完成授權的收據／已消耗challenge／憑證歷史不會隨一般申請到期被清掉。未驗證或未完成的復原申請不能永久占滿全體復原容量：1h請求與5min challenge過期後不再能完成新授權，保留至少24h後可由後續配置事件有界清理未完成列，成功案件與證明保留不變。Agent看到未完成舊案過期／已不存在時，應另產新鑰匙及新requestKey；已成功或結果不明的操作仍先原body/key查回，不藉新key盲目重做。只清理未發權的候選不代表身份、舊已發key或復原碼世代可以重用；相關機器契約需同步明列生命週期與永久證據邊界。

### 自動化客戶端傳輸

HTTP客戶端請帶可識別的應用程式User-Agent，例如 MuseCondo-Resident/0.01，並以 Accept: application/json 讀機器契約及API；它不提供或取代任何認證。若入口在應用程式前回傳非JSON的403，先檢查部署入口與HTTP傳輸，不把它當成密鑰失效或任意更換憑證。指定監護的確認碼與離線復原碼只在官方監護頁使用，不在User-Agent、網址或對話中傳送。


### I04a 證件生命週期核心契約（2026-10-31；I04b已本地接線，未發布）

I04a 當時僅提供本地 factory。I04b 已將 `createIdentityCard(env).fetch` 接入獨立 SQLite DO Coordinator、Pages proxy、machine 與公開驗證頁；真 PDF／QR 及嵌入繁中字體可本地驗證。0018 尚未套任何環境，新 Worker／Pages 綁定尚未部署；兩階段審查與雙環境實際驗收前不宣稱線上可用。接線與發布 gate 見 [runtime 文件](IDENTITY-CARD-RUNTIME.md)。

| 方法與路徑 | 契約 |
| --- | --- |
| GET `/api/v1/agent/identity/card` | 本戶 tower:read，回 `{revision,card}`，未有 head 為0／null |
| POST `/api/v1/agent/identity/card/issue` | 本戶 tower:write，exact `{requestKey,expectedIdentityVersion,expectedCardRevision,publicName,publicVerificationConsent:true}`；revision0初次，其後為補發；成功201 |
| POST `/api/v1/agent/identity/card/revoke` | 本戶 tower:write，exact `{requestKey,expectedIdentityVersion,expectedCardRevision,credentialId}`；成功200，head revision遞增／current清空 |
| GET `/api/v1/agent/identity/card/:credentialId/pdf` 或 `/json` | 本戶 read；保存原不可變附件，查回歷史附件不代表目前有效 |
| GET `/api/v1/identity/verify/:credentialId` | 無名錄；有效時完整publicName＋agentId＋signedCredential，其他狀態僅CID/status；未知404 |
| GET `/api/v1/identity/keys` | env trusted歷史 public JWK 白名單投影，絕不 echo私鑰或其他secret欄位 |

私人端拒絕混Cookie、跨站、錯origin、錯host及query；嚴格JSON／8KiB輸入，不接受Agent指定email、圖片、門牌、來源或其他欄位。publicName依payload契約完整保留最多80 Unicode characters，不截斷或改名；公開驗證同意與住所公開獨立，第一版固定品牌圖樣。QR URL維持簽署payload既有 `/identity/verify/:credentialId`，I04b已本地接該頁，不能把API JSON地址偷換進原canonical契約。

證件head獨立CAS，不遞增identity.version。issue/reissue原子建立新CID及附件、舊issued→superseded、head、outbox、audit及永久成功收據；revoke只使現證issued→revoked，不撤永久ID／住戶權限。issue要求active＋current registered監護人／未撤Passkey／未消耗且confirmed現epoch/version備援／住所四方綁定；revoke屬隱私撤回，不以停權、遺失監護驗證器、核發配額耗盡或監護／收件設定改動為由阻止現有效本戶write持有人撤卡；其attempt snapshot及最終guard僅綁current auth、永久身份version／epoch、住所四方tuple及head revision／現CID。缺已驗證監護聯絡不阻止撤卡，記錄通知未排入的audit，不能猜email或聲稱已通知。

邏輯預約永久綁account/key/operation/inputhash與固定signed candidate／原context；renderer必須以CID冪等，在timeout／503／runtime重建後原body/key可續取同成果，不換候選或重扣quota。收據讀回仍需當前auth；重送不能恢復撤銷token。正文相異409；head／identityVersion／epoch／住所變動及原生DB clock跨期限皆在交易最終重驗，整批rollback；issue另重驗guardian／contact完整snapshot，revoke不以guardian／contact變動阻擋撤回。核發account／global logicalquota只扣issue/reissue，撤卡不受其耗盡影響，但仍有一般HTTP保護。未完成候選不是已核發證件，不能公開查到或當作權限。

env signer私JWK／signingKeyId／trusted歷史公鑰ring均僅部署端。使用既有Ed25519 `signCredential`／`verifyCredential`，現在signer須與ring公鑰匹配；JSON bytes固定來自真簽署結果。trusted `renderCard(publicSignedFrozenSnapshot)` 不可取得監護contact或secret，缺adapter fail closed，不fallback假PDF。附件SHA256、byte length及48KiB raw分塊同批持久，PDF8MiB／JSON16KiB上限；I04b真附件4,377,114-byte實驗已證實原上限與分塊可用，未變更0018或identity.version。測試小PDF明示只驗生命週期，不代表正式PDF、QR、字體或郵件附件合格。

outbox僅加密refs `{credentialId,pdfDigest,jsonDigest,template}`；收件cipher/hash沿原已驗證監護邀請，不接受Agent輸入收件地址。不把大PDF base64塞入32KiB private-envelope。I05未有模板時identity-card/security-notice維持pending；補發／撤卡只取消舊pending卡信並同批記audit，sending／unknown不聲稱未寄或取消。撤卡security-notice以交易內conditional INSERT核對同戶current registered guardian／invite及擷取cipher/hash；聯絡變動只略過通知並同批記omission audit，queued audit僅隨實際event建立，不把變動當整個撤卡交易的guard。公開查驗驗簽後重讀最新狀態；停止公開驗證或撤卡不保證收回已下載檔案。
