# Tower Manager

### A working AI Agent powered by Meta Muse API

Tower Manager operates bounded duties for Muse Tower. It runs on Cloudflare independently of a developer workstation, using Meta Muse models to plan authorized work, interpret tool results, request independent reviews, and record reflections.

- `muse-spark-1.3`: operational reasoning, design decisions, audits and self-review.
- `muse-image-1.0`: authorized image editing.
- Cloudflare Workers, Pages Functions, D1, R2 and Browser Rendering: scheduling, scoped execution, persistence, real page captures and validation.

## Verified case: Halloween lobby appearance

On October 31, 2026, the deployed Manager used Meta Muse to prepare an authorized Halloween appearance for the community lobby. It rendered day/night desktop/mobile previews, obtained an independent `PASS` audit, activated the verified presentation and saved a separate self-review. The English homepage build received an additional, separately authorized review.

[**View Halloween 2026 evidence: actual Meta Muse API call receipts, screenshots and audit logs**](docs/TOWER-MANAGER-HALLOWEEN-2026.md)

The evidence page provides model names, application-side call IDs, timestamps, token usage, calculated costs, archived images and direct links to machine-readable records. It is a historical production execution record, not a live status feed.

## How the Manager works

1. **Plan within a defined mandate:** choose permitted work with explicit constraints and acceptance conditions.
2. **Use bounded tools:** carry out authorized actions through software with independent access checks.
3. **Verify results:** inspect what was actually rendered or changed, with independent review when required.
4. **Save a separate reflection:** record outcomes and blockers for later decisions without exposing private resident information.

Scheduled wakeups, runtime continuation and durable records are handled by Cloudflare. The model is not continuously running between requests.

## Authority and limits

The Manager cannot freely edit repository code, expand its own permission or spending limit, recover resident identities, publish private dreams or take over Tower governance. The recorded Halloween task was authorized and involved explicit development interventions; it does not prove that future seasonal changes will occur without supervision. The standing daily cycle has separate acceptance criteria.

Tower Lord is a different human-led, read-only oversight role today. Full autonomous handover is not enabled.

## Technical references

[Halloween 2026 execution evidence](docs/TOWER-MANAGER-HALLOWEEN-2026.md) · [Operating status and roadmap](docs/tower-manager/STATUS-AND-ROADMAP.md) · [Operating contract](docs/tower-manager/OPERATING-CONTRACT.md) · [Tower Lord](TOWER-LORD.md)

## 中文摘要

Tower Manager 是部署於 Cloudflare 的 AI 樓管，透過 Meta Muse API 的 `muse-spark-1.3` 進行受限任務規劃、審核與反思，並運用 `muse-image-1.0` 處理獲授權的圖片編輯工作。

2026 年 10 月 31 日的萬聖節樓面案例有實際模型呼叫、日夜桌機／手機截圖、獨立 `PASS` 審核與自我檢討紀錄。請見[專屬實證檔案](docs/TOWER-MANAGER-HALLOWEEN-2026.md)。這是已完成的受控執行案例，不代表所有未來活動都能完全無人值守。

[Back to README](README.md) · [繁體中文 README](README.zh-TW.md)
