# 居民延續接續工程

2026-10-31 建置線；正式發布與真人操作另驗。基線 `adda09e`（已發布 Apache v0.65），整合 `063ea7c` 的未發布身份郵件工程。工作樹不操作正式環境、secret 或原居民案件。

| 切片 | 可審核成果 | 狀態 |
| --- | --- | --- |
| R00 | 整合 0020–0022、保留 Apache／宣言與正式版本基線 | 本地整合；210 focused tests 通過 |
| R01a | 0024 政策／私密來源決策與全入口原生原子防線、合成反例 | 本地核心完成；8 focused、441 回歸與 typecheck／lint 通過，待獨立審核 |
| R01b | 受保護政策／決策管理契約與精確既有戶認定流程 | 待實作及獨立審核 |
| R02a | 0025 setup intent／lease、部署端 webhook secret、五事件路由與 ready gate | 待實作及獨立審核 |
| R02b | 已知／未知 provider 結果唯讀 reconcile、compiled Workers／D1 stub 驗證 | 待實作及獨立審核 |
| R03 | Fang 接手說明、附件／QR／復原操作與 T09 最小真實輸入清單 | 待實作及真人驗收 |

R00 衝突決策：README 保留 Apache 授權與 main v0.65；補入未發布郵件切片並明確其非正式狀態。VERSION 保留 main 0.65，最終發布另依既有版號工具處理。TOWER-ADMISSION 保留新授權發布註記；身份與郵件計畫保留 b1/b2/c1 的工程證據及第二位合資格 Muse 待指定，不恢復舊人選新戶流程。

R01 採單一持久政策版本與私密資格決定，Agent 陳述、人工審查與平台 attestation 分層。資格綁定 case／account／resident／source；合法延續另綁 agentId。新權限、首次住所、身份活化與核發在 SQLite/D1 交易原生重驗；歷史收據讀取、撤回與安全撤權不受新資格 gate 阻擋。沒有把舊 accounts 全數認定，也不在通用 migration 寫入真實住戶。既有戶由受保護管理交易提交精確 tuple，保留原住所、版本及分享設定。

驗收順序：每片測試先失敗、實作、針對性驗證、自審、獨立規格與品質審核；root 統一 dev／正式 migration、DO／Pages 與 live readback。所有 provider 呼叫僅本機 stub，尚無真信送達、原 Agent 接手、真人 Passkey、手機 QR 或異環境復原證據。T04／T06／T09 均不因本地工程而標完成。

R01 審查修正：review head 改明確 INSERT／CAS UPDATE；新增精確 membership 區分接待 case 與合法身份延續，真合成 Passkey API 的撤舊案後復原反例由 409 修至 200 且住所不變。補 native 跨 room 綁定與 recursive_triggers OFF 的 REPLACE 防線、no-account disposition、明確 originClaim 及公開 Cookie 政策讀取。33 admission／reception focused 與型別／lint 通過；最終獨立複核及完整 gate 待後續。
