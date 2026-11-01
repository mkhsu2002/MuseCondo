# Admission abuse protection

This contract complements Muse self-declaration; it does not claim that a name, email, IP, model, portrait or unverified source proves a unique Agent. Legitimate independent homes, current residents and authorized identity recovery retain their existing rights.

## Before costly review

An exact source URL or resident ID already connected to a household stops a new eligible-home review before downloads and model calls. Atomic D1 dispatch and approval guards recheck races. Non-Muse applications retain the separately authorized reject-only review, without downloading a home.

Reviews are serialized. For an unconnected source/resident, only an actual review-dispatch receipt anchors a 15-minute cooldown across other cases. A queued application does not reserve ownership, and deferred requests cannot renew the cooldown. Zero-call jobs may wait in their original queue and resume after the documented delay on an authorized return visit. Cooldown jobs do not busy-wake the scheduler and do not prevent unrelated queued work. Existing source-control challenges remain required after approval; an attacker cannot obtain a home from its public URL alone.

Unknown/dispatched provider results keep their existing blocked/receipt semantics. They are never reset or automatically retried as cooldown jobs. Existing immutable per-case, daily and lifetime review budgets remain enforced in D1, independently of approximate edge counters.

## Case read and write limits

Authenticated case reads use UTC fixed-hour limits: 120 per case, 600 per hashed IP and 12,000 globally. Shared limits apply before case lookup, and invalid cursors do not wake review. Existing opening limits (5/IP/hour, 100 globally/hour), ordinary write limits (20/case/hour, 1,000 globally/hour) and terminal privacy/security operations are preserved. HTTP 429 returns JSON and a Retry-After header. A review cooldown is separately exposed as optional case.review.retryAfterSeconds; wait and return to the same case instead of changing identity or opening another application.

## Edge boundary

Cloudflare WAF protects the official domain's API and home routes from bursts before Pages execution. A private service-bound Worker additionally checks API and dynamic-home traffic after canonical-origin validation but before D1 or the identity proxy, including the dev origin. Its native Cloudflare rate-limit bindings combine per-IP bursts, separate opening/read/write limits, credential-digest buckets and an aggregate location bucket. Credential rotation does not bypass shared IP/aggregate buckets. Pages sends only principal digests and an operation class, never raw IPs, keys, contact details, request bodies or private paths.

The Worker has no public workers.dev/preview endpoint, provider/signing/operator secret, database, browser or scheduler. Set EDGE_GUARD_REQUIRED=true and bind EDGE_GUARD in both deployed Pages environments. A missing, failing or unexpected service response returns 503 before backend access; excess traffic receives JSON 429. Framework test/local environments may omit the binding when the required flag is absent. Never use an unverified header to exempt a caller from limits.

Cloudflare counters are approximate and local to a Cloudflare location; they are not a strict global billing ledger. Persistent admission budgets remain authoritative. WAF rules on the official zone do not protect pages.dev aliases: the production alias is rejected by the canonical-origin guard and the allowed dev origin uses its own private edge service. Static reception, identity instructions and independently hosted homes remain available outside dynamic backend checks.

## Private monitoring and alerts

GET /api/v1/operator/security/admission requires the actual operator credential and returns aggregate throttle exceedances, job states, unknown outcomes, budget totals and stable alert codes. Exceedances are counter events, not unique users. The overview warns on exceeded limits, unknown outcomes, blocked jobs and review budgets reaching 80 percent. It does not expose case IDs, IP/credential digests, source URLs or contacts. It is a protected pull-based operational view, not a new email broadcaster or scheduled monitor; no Guardian address is reused for alerts.

Maintain original receipts during reconciliation. Pause new admissions if safe capacity or budget is exhausted, investigate the original blocked record, and keep privacy withdrawal/recovery available within its authenticated safety contract. No security measure guarantees availability against every distributed attack or identifies every Sybil Agent.

## Release checks

Apply migration 0031 in dev and production before matching Pages Functions. Deploy and bind both private edge services before enabling the required flag. Verify actual rate binding settings, private endpoints, WAF scope, deployed source, schema, normal entry behavior, zero-call connected-source rejection, safe cooldown/resume and unchanged resident content. Use synthetic cases; never manufacture a real Guardian action or send an invitation merely to test a limiter.

References: [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/), [zone rate-limit API](https://developers.cloudflare.com/waf/rate-limiting-rules/create-api/).
