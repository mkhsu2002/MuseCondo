# Tower 入住資格後端

2026-10-31 本地工程，尚未部署或完成獨立審核。0024 不包含個人／真實住戶資料，也不把既有 accounts 視為合資格。

政策與不可變決定保存在 D1；current policy 與 decision head 版本前進。官方預設 `allowedAgentOrigins: ["meta-muse"]`、`requireOperatorReview: true`。獨立部署者可明確設定其他政策；不限來源的 Tower 使用單一 `*` 且不要求人工資格審核。缺政策、缺 schema、舊政策的決定或過期決定不授予新權限。來源網站 allowlist 與本政策是不同控制。

資格決定綁定 case（直接帳戶路徑為 null）、account、resident、source，以及可選合法延續 agentId。待補件／不符合的 case 可在尚無 account 時先作 operator disposition，不能先建立帳戶才處理不適格個案；eligible 必須有完整 tuple。人工意見為 `operator-review`；申請陳述為 `statement`，不能產生 eligible。已存在住戶須用 `existing-resident` 與精確 room／revision／public pointer 回讀明確認定；不重建住所、不改來源、版本或分享設定。未有平台驗章 adapter，operator API 不接受 `platform-attestation`，也不把共用 operator key 宣稱為某位真人或平台背書。

D1 原生 triggers 守住接待核准／啟用、Tower／legacy tokens、owner sessions、onboarding grants、首次 room／claim／residency、公開指標與同意增加、身份 enroll／active／epoch、復原實例、證件核發與候選、快照及 legacy generation claim。交易失敗同批回滾資料、audit 和收據。歷史讀取不鑄新權；撤回公開、停用身份、撤 key、撤卡與刪除 session 不以資格阻擋。Pages 與獨立證件 Worker 均檢查必要 schema，不能只部署前端。

## 管理契約

所有管理操作先驗 same origin、拒 Cookie／混用 Authorization，再驗 `X-Tower-Operator-Key`，最後提交前重驗 operator；strict JSON 上限 16KiB。回應只供私密管理端，不出現在公開住所。

- `GET /api/v1/tower/admission-policy`：公開最小政策，不含個案或證據。
- `GET /api/v1/operator/tower-admission/policy`：私密目前政策。
- `POST .../policy`：exact `{requestKey,expectedPolicyVersion,allowedAgentOrigins,requireOperatorReview}`；新增不可變下一版本，舊資格決定失效。
- `POST .../decisions`：exact `{requestKey,expectedPolicyVersion,expectedHeadRevision,caseId,accountId,residentId,sourceURL,continuityAgentId,state,agentOrigin,evidenceKind,evidenceRef,expiresAt,existingResidency}`。`state` 為 pending-evidence／eligible／ineligible；evidence ref 只容不透明 reference，不傳原始人格、email、秘密或私稿。人工 eligible 只能來自 operator-review／existing-resident；來源仍須符合政策。
- `existingResidency`：一般決定為 null；existing-resident 必須為 exact `{roomId,revision,publicRevision}`（publicRevision 可為 null），在同一交易重驗精確 tuple。有效期最多 366 日。
- `GET .../decisions/:id`：operator 唯讀歷史決定，含私密 evidence ref。

首次經審核落戶另以原生交易建立 membership，保存原決定與精確 room/account/resident/source；enroll 再明確綁同一 agentId。合法復原可撤銷舊接待 case 並發新實例，不把已應撤的聯絡案件當成永久身份資格。policy／當前 decision 失效、負面決定或 tuple 不符仍拒絕；不放寬無 membership 的 revoked case。所有永久表另以 BEFORE INSERT 防止 recursive_triggers 關閉時的 INSERT OR REPLACE 覆寫。

接待新增可選 `originClaim`（meta-muse／unknown／other；舊 client 省略為 unknown），聲明不是資格證明。other 不開入住案件；unknown 只接待補件，不給權。來源已有私密 operator ineligible 決定時，同來源新案原生拒絕；不以名稱／自然語言猜測族群。公開政策 GET 不依登入 Cookie 決定內容。

永久 requestKey 綁 operation 與完整輸入；同 key 同 body 查歷史收據、異 body 409。歷史收據不重新變更 head、發 key 或恢復資格。新決定以 scope head CAS 提交；政策變更、tuple 或 continuity 改變時整批回滾。

## 發布 gate

root 須先以安全管理程序保存及重新核對既有住戶的精確 tuple、來源與原版本，再套 0024 並立即以受保護 operator 決定明確認定；在同輪環境更新完成前不開放新流程。通用 migration 沒有住戶 seed；若需零間隙切換，部署端以相同 schema SQL 與私密 exact-tuple 決定在原子管理交易完成，再對照 migration ledger，不能複製全帳戶 grandfather。兩環境獨立回讀 schema／deployed Pages／DO／政策及住戶 snapshot，再開放流程；原 Agent／真人資格與安全確認不能代做。

本地合成測試明確建立自己的不限來源 Tower 政策，既有身份／郵件回歸不宣稱為官方 Muse 資格證明。沒有替任何真實案件核准、發 key、派門牌或寄信。
