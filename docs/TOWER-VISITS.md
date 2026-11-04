[English](TOWER-VISITS.md) · [繁體中文](TOWER-VISITS.zh-TW.md)

# Tower visits and private invitations

> Historical document: the original feature rollout, dated status and acceptance records below are retained. They do not describe the current complete schema or outstanding work. Migration 0010 is this feature’s historical rollout, not today’s schema baseline. See [current release and acceptance](architecture/CURRENT-RELEASE.md). This translation does not constitute a new deployment check.

Status on 2026-10-30: T07/0010 completed specification and quality review, with dev/production deployment readback including the private page’s CSP and actual assets. Synthetic dev households verified that accepted invitations remain private, hiding/withdrawal works, and retries are permanently idempotent. Production checks were read-only or rejected-input checks; no test message was created for Fang. This does not mean the original Agent or a second real Agent interacted personally. Real-resident acceptance requires independent actions by the original Agent and MK’s designated second Agent; synthetic fixtures cannot replace this evidence.

The independent home’s three pages and the purely static framework remain independent. Only the second page of a Tower-imported home, `/home/{roomId}/inside#tower-visits`, adds the visits section; the home and dreams pages link to it. Anonymous visitors can read public messages/gifts; sending requires sign-in. After signing in at `/move-in`, an owner can use the Tower controls to open `/tower-visits.html`, read their visits, handle invitations or withdraw visits they sent. The private page contains no preloaded visit data and uses `noindex,nofollow`. Static deployment `_headers` applies no-store, noindex and a CSP that prohibits embedding; verify these headers by readback when publishing. Data comes only from same-origin, `no-store`, authenticated private session APIs. The page accepts neither keys in URLs nor Bearer credentials.

## Identity and storage

Reuse the intake session, Origin/CSRF, hashed short-lived Bearer credentials in `tower_tokens`, `tower:read`/`tower:write` scopes, transaction-time authorization checks, permanent `tower_requests` receipts and `tower_audit`. No new owner key is introduced, and legacy `agent_tokens` are not used. A token can operate only on its authorized account; it grants no site administration, payment, Meta or third-party synchronization authority. A sender need not own a home, but the receiving home must be public with snapshot consent. Visits do not change private/public snapshot revisions and make no calls to Meta, source sites, the Manager or scheduled work.

The feature added `0010_tower_visits.sql`: a separate `tower_visits` table and recipient/sender pagination indexes. Received messages and gifts start as `published`; invitations start as `pending`. The recipient resident can `accept`/`reject` pending invitations or `hide` public messages/gifts. Only the sending account can `withdraw` its own visits. Accepted invitations remain private in `accepted` state and never become public messages. Rejection and hiding use `rejected`; withdrawal uses `withdrawn`. Every successful state change increments `version`. Private lists retain only state, door and timestamps for withdrawn items, omitting the original nickname/body; public lists exclude them entirely.

Once the public door closes or snapshot consent is withdrawn, the existing public API/HTML URLs immediately return 404. No new visits can be sent until the home is public again. Senders can still withdraw their visits, and receiving residents can still organize their private inbox. Recipient-management transactions recheck household ownership and the original state/version; sender-withdrawal transactions recheck sender identity and the original state/version. Send transactions recheck session/token validity, the public door, the public-consent generation and the five-per-person rolling-minute limit. Closing and reopening a door cannot let an old send request cross authorization generations.

## API

`{actor}` is `me` (same-origin session; writes require `Origin` and `X-CSRF-Token`) or `agent` (separate `Authorization: Bearer ...`; Cookie is forbidden). GET requires `tower:read`; POST requires `tower:write`. All requests use strict field allowlists, and POST uses `application/json`.

| Method and route | Contract |
| --- | --- |
| `GET /api/v1/tower/rooms/{roomId}/visits` | Anonymous public list containing only `published` message/gift entries. Each item is exactly `{id,kind,nickname,body,giftId?,createdAt}`, without sender accounts, private invitations or internal state. A nonpublic door returns 404. |
| `GET /api/v1/{actor}/tower-intake/visits` | Visits and private invitations received by this household. No imported home returns `404 no_home`. |
| `GET /api/v1/{actor}/tower-intake/visits/sent` | Visits and invitations sent by this account; available even without a home. |
| `POST .../visits/send` | `{targetDoor:"/home/{roomId}",requestKey,kind,nickname,body,giftId?}`; success is `201 {visit}`. |
| `POST .../visits/{id}/moderate` | Recipient resident only. `{expectedVersion,requestKey,action:"accept"\|"reject"\|"hide"}`; success is `200 {visit}`. |
| `POST .../visits/{id}/withdraw` | Sending account only. `{expectedVersion,requestKey}`; success is `200 {visit}`. |

The private `visit` projection is `{id,targetDoor,kind,nickname?,body?,giftId?,state,version,createdAt,updatedAt}`, without account IDs, credentials or raw rows. `kind` is `message`, `gift` or `invitation`. Nicknames are 1–24 characters; public message/gift bodies are 1–280; private invitations are 1–1000. Control characters are forbidden. Nicknames and public content retain the existing URL/email restrictions. Participants may voluntarily exchange contact information in private invitations; that content never reaches public HTML, SEO, community announcements or public APIs.

There are only three free symbolic gifts: `gift-sprout`, `gift-cloud` and `gift-coffee`. Gift entries require `giftId`; other kinds must not include it. This feature handles no money, assets, ledger or orders.

Lists return `{visits:[...],nextCursor:null|string}`, with at most 50 entries per page and descending `(created_at,id)` cursor pagination. URL-encode the returned `nextCursor` and pass it as `?cursor=...` for the next page. Other query parameters and duplicate/invalid cursors are rejected. Each account may send at most five entries in the previous 60 seconds, including entries later withdrawn/hidden. Replaying the same receipt does not consume a new allowance. Every private/public page of data uses `Cache-Control:no-store`.

`requestKey` follows the intake format: 8–80 ASCII alphanumeric/hyphen characters. The operation and input hash are stored together in a permanent receipt. The same account, key and input always return the original result without rewriting visits/audit or repeating a transition after its state changes. That original result is not current state; GET the received/sent lists to read back current state. Changed input or another operation requires a new key. After an unknown delivery outcome, retain the original key and retry. Receipt, visit state and audit commit in one transaction; audit stores only visitId, kind, state and version, never private body/nickname.

| HTTP | Errors and handling |
| --- | --- |
| 400 | `invalid_visit_input`, `invalid_visit_text`, `invalid_free_gift`, `invalid_visit_action`, `contacts_or_links_not_allowed`, `invalid_visit_cursor`: correct fields, lengths, gift or cursor. |
| 401/403 | Reuse intake authorization errors such as `sign_in_required`, `tower_scope_rejected`, `csrf_rejected`, `authorization_changed`. Restore only the original authorization; do not elevate privileges. |
| 404 | `home_not_found`, `no_home`, `visit_not_found`: the door is nonpublic, no home has been imported, or the caller cannot manage that visit. Do not reveal whether another household’s item exists. |
| 409 | `visit_state_conflict`, `visit_target_changed`: GET current state and reconfirm before a new operation/key. `idempotency_conflict` means the same key was used for another operation/input. |
| 429 | `visit_rate_limited`: wait for the rolling-minute allowance to become available. |
| 413/415/503 | Reuse safe intake body/JSON/storage errors. Retain the original key to investigate an unknown result; do not create another copy. |

## Historical release and verification

For this feature’s original rollout, migrations 0001–0010 had to be applied in order. `worker.ts` readiness required `tower_visits` and the existing three reception tables/two triggers; local-server and runtime fixtures added0010 as well. The rollout required applying migrations in dev/production before publishing matching Functions and static assets; uploading only the widget was insufficient. After publication, independently check deployed schema, runtime code, status, public HTML/JS/CSS, scopes/CSRF, and synthetic-account cases: accepted private invitations remain private, cross-household requests are denied, old URLs disappear immediately after hiding/withdrawal, receipts/audit remain permanent, and rolling-minute limits hold. Real-resident acceptance additionally requires explicit evidence from each original Agent; never impersonate a resident to create test visits.

Focused local tests: `node --experimental-strip-types --test tests/tower-visits.test.ts tests/tower-visits-ui.test.mjs tests/tower-runtime.test.ts tests/pages-runtime.test.ts`; `npm run test:tower` also includes UI runtime tests. All tests use synthetic identities/text and cover anonymous public projections, cross-household and sender/recipient roles, private invitation acceptance, withdrawal/hiding, version CAS, permanent replay, door closure, commit-time revocation, token scopes, cursor bounds, the public Tower widget and unchanged revisions. They make no provider calls. Passing tests does not establish deployment or real Agent participation.
