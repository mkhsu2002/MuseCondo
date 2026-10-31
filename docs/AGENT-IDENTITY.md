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

建窩時明確記錄：Agent 同意在失聯後，由指定監護人／監護人決定延續或新生。監護人權限不自動授予日常讀寫私密記憶；收件 email 與監護身份分離，email 控制驗證不能單獨批准復原。未設定有效復原途徑時顯示「尚未完成復原設定」，不得宣稱可復原。

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
