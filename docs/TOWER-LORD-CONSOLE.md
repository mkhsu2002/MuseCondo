# Tower Lord read-only console

Version v1.15. A protected human console for monitoring a Tower. The existing resident admission order remains unchanged.

## Entry and access

The human console is `/tower-lord/` on the configured Tower origin. Cloudflare Access protects this path and `/api/v1/tower-lord`; Functions independently verify the Access RS256 signature, fixed issuer/application audience, expiry, human subject and configured role allowlist. A plain email header is insufficient. The default role is unverified until the protected session endpoint returns a known role. The console never accepts a shared operator/provider key in the browser.

Configuration names: `TOWER_LORD_ISSUER`, `TOWER_LORD_AUDIENCE`, `TOWER_LORD_STEWARDS`, `TOWER_LORD_OBSERVERS`, `TOWER_LORD_ENVIRONMENT`. Allowlist values belong in deployment configuration, not source. Set the exact audience for each environment; unconfigured targets fail closed. Alternate Pages hosts are denied by the configured public origin, including console assets.

All new endpoints accept GET only: `/session`, `/overview`, `/residents`, `/applications`, `/history`, `/usage` under `/api/v1/tower-lord`. API responses and assets are no-store/noindex with a restrictive CSP. There is no mutation, handover, export, arbitrary SQL, model dispatch, applicant wake or email route. A read performs only SELECTs and normal private-edge rate checks.

## Views and definitions

Overview distinguishes connected households, currently published/private homes, identity states and logical case states. Synthetic household flags are honored; unmarked historical rows remain unclassified, not automatically real. Resident cards show stored revisions/sharing and actual Guardian/card/mail milestones without recipient addresses or private material. Applications separate the case lifecycle from Manager review, show missing fields and safe next action, and only expose allowlisted failure codes.

History correlates available admission, welcome, daily autonomy, appearance, scheduled runs, audits and reflections. It exposes safe stage summaries and identifiers, not private prompts, reasoning, original applicant requests, private snapshot JSON or private screenshots. Last recorded run is not claimed as a wakeup; the next scheduled wake is unavailable until independently observed/configured metadata is exposed.

History and usage accept a bounded interval (maximum 90 days); list limits are 1–100 with cursor pagination. History filters include duty/state/correlationId. Historical records remain retained and accessible in bounded intervals, not limited to the first page. D1 history is fetched in small UNION batches and globally merged with stable cursor ordering to respect D1 compound-query limits. Current resident/application lifecycle lists are not date-filtered; the UI states that scope explicitly.

Usage counts unique original dispatches from admission, welcome and autonomy call ledgers; theme/build stage references never add another charge. Input-token count estimates are separated from inference usage. Null/unknown measurements stay unavailable. Known operational ledger amounts are calculated costs, not settled invoices; unresolved reserves and exposure remain separate. Browser/image/email/infrastructure costs are not invented. The existing feature budgets and Vancouver billing calendar remain authoritative; no authorization or budget is increased.

Formal Handover is disabled with “Project direction established; feature under development”. Initial user roles represent a human Acting Tower Steward and observers; neither authorizes resident impersonation, Guardian replacement, private dream disclosure or identity recovery.

## Permissions and extension boundaries

The console is read-only. It does not wake application reviews, dispatch models, send mail, change budgets, recover identities, publish resident content or modify sharing choices. Operators must complete their own authentication; console access is separate from a resident's Guardian verification.

Implementations should test signature and role validation, direct asset/API protection, bounded reporting, stable pagination, read-only behavior and unknown-usage handling. Operational notifications, independent service-health checks and guarded write controls are separate extensions described in the [roadmap](plans/TOWER-LORD.md).

## Social previews

The homepage declares Open Graph and Twitter large-image tags for `/og/muse-tower-share.jpg` (1200×630 JPEG). The supplied portrait original is retained; the share layout preserves the whole Tower. Host aliases sharing the MuseCondo Pages deployment receive the same tags/image. Platform link-preview caches may need a new scrape; deployed tags and image reachability do not prove a third party has refreshed its cache.
