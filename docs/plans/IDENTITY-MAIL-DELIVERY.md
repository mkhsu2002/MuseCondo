# I05b／I05c：身分證附件與投遞

2026-10-31 狀態更新：I05a已完成正式sender metadata查核；b1／b2及c1簽章投遞核心已通過本地驗收（v0.71），c2正式入口／provider配置／unknown查核仍待實作。下列b1原切片限制為歷史邊界；本地已接新transport，但尚未發布，0020–0022未套遠端、寄送預設關閉，不代表已寄信。沿既有身份／監護／outbox及newsletter-worker-standard，不建立行銷訂閱或平行寄送系統。provider key只在Pages部署端，沒有本機／runner key、分鐘polling或新排程。

## b1：凍結信件核心（本地切片）

- 僅私有server factory，處理既有guardian-invitation、identity-card及security-notice固定模板；不接公開HTTP、不租用寄送、不呼叫provider。
- 沿本戶身份／住所四方綁定、有效邀請或目前已驗證監護聯絡檢查收件資格，對原事件的ciphertext／hash與payload再次核對。首次確認碼只寄原指定地址；expired／cancelled／換聯絡皆不得利用舊內容。
- 卡信附已保存的完整PDF＋signed JSON，核對immutable manifests／chunk序號、長度、digest與signature資料，不重生卡或換檔。私人資料、等級、住家門牌及長期復原碼不進信。
- 第一次準備即固定寄件人、收件人、模板版本、文字、tags與附件refs及整個body的event／purpose-bound HMAC／length。小型envelope加密保存；附件仍引用immutable chunks，不把大base64放入32KiB解密封套或D1大row。完整body不保存明文SHA256，避免以收件地址字典離線猜測；PDF／JSON附件manifest仍使用SHA256。
- 同event永久重放原body，即使display FROM之後變動也不改已凍結bytes；origin變動或聯絡不再授權時fail closed。每次materialize重新核對目前資格與artifact完整性。失去資格不改歷史、不自動換收件人。
- 新0020僅新增最小envelope／prepared audit資料；transaction最後原生context guard、永久去重、並發或lost acknowledgement不產生第二封套。mail event仍pending，不將prepared當sent。

## b2：私有DO準備與事件寄送接線

- 重用獨立Coordinator及D1；DO只處理私有準備／body materialization，無provider key，公開Worker維持404。Pages只提供明確受保護操作與從已提交事件產生的dispatch；公開router不能代理internal mail RPC。
- 大body在DO組裝，Pages以stream轉送，避免在Pages序列化數MB附件。私有控制資訊只在部署端流動，不回傳給公開API或寫log。
- 發送前先讀provider／本地suppression、核對目前收件資格、取得原子event lease及audit，再以固定event ID／同body作provider idempotency。重複／併發／sending／unknown／accepted不盲重送，舊pending卡信維持既有取消規則。
- 卡片、監護接受與復原交易完成後立即dispatch該筆event；receipt重放可喚起同一pending event，永久帳本防止新寄送。不掃全信箱或靠CI／cron主送。
- 缺sender／delivery配置保留pending，accepted與delivered／使用者已取得分開；任何unknown保留證據交由受保護reconcile，不換key重寄。

## c：投遞回讀與驗證

- 由部署端管理固定本origin webhook設定並持久化setup intent／encrypted signing secret，不把whsec或provider key帶回本機。lost create result先list／retrieve同endpoint確認，不盲建第二個hook。
- Svix raw body簽章／時間窗、多signature、event ID＋body hash永久去重；只處理能和本案event tag／provider ID／凍結sender-recipient內容對應的通知，不存raw email或其他專案事件。
- delivery／bounce／complaint／suppression採持久、單向與負面狀態優先；webhook早於POST回應不能被accepted覆蓋。撤證不能假裝撤回已送信。
- known provider ID retrieve或有界list＋retrieve／tags確認未知結果；查無不代表沒寄，超過provider idempotency期限不以新key重寄。

## 驗收與發布

每片先RED再GREEN、規格→品質審查；新增schema／API／DO／Pages契約時兩環境一併套用及部署回讀。b1為未接線本地切片，0020在b2整合發布前保持未套用；尚未使用者流程不提前切換。

正式邀請／卡片僅在Agent明確接受本戶監護約定後發送；先完成免費工程及provider metadata／webhook設定，原Agent及真人安全動作留I06。驗收需真PDF＋JSON附件、digest與簽章可用、exact replay不新寄送、delivery audit及監護人實際取得；provider 200／accepted不足以宣告完成。Fang原房與門牌、K新居民流程及私密等級規則均保留。
