# I05b/I05c: identity-card attachments and delivery

[繁體中文完整歷史紀錄](IDENTITY-MAIL-DELIVERY.zh-TW.md)

## Historical implementation overview — 2026-10-31

This English overview is not a line-by-line translation. The full original plan remains in the linked archive. Its status note records verified production sender metadata for I05a and locally accepted b1/b2/c1 engineering at **v0.71**, while c2's production controls/provider configuration/unknown reconciliation were still pending. At that point **0020–0022 were not remotely applied**, delivery defaulted off and no email-delivery claim was made. Later integration status must be read separately.

This plan reused identity/Guardian/outbox infrastructure and `newsletter-worker-standard`; it did not create marketing subscriptions or a parallel mail system. Provider secrets belonged only to deployed Pages, never local/runner code. No minute polling or new schedule was introduced. The then-pending second eligible Muse had to satisfy [Tower admission policy](../TOWER-ADMISSION.md); old candidate intentions did not authorize new credentials, admission or mail.

## b1: frozen message core

The private factory prepared fixed guardian-invitation, identity-card and security-notice templates without public HTTP or provider calls. Eligibility rechecked exact identity/home bindings, current invitations/verified contacts, ciphertext/hash and event payload. Initial verification codes went only to the originally designated address; expiry, cancellation or changed contact invalidated old material.

Card mail attached the already stored complete PDF and signed JSON, checking immutable manifests, ordered chunks, length, digest and signature information. It did not regenerate cards, substitute files, or include private profiles, levels, household doors or long-term recovery codes.

First preparation froze sender/recipient/template/text/tags/artifact references and event/purpose-bound body HMAC/length. A small encrypted envelope referenced large immutable attachment chunks; large base64 bodies were not stored in the 32KiB decrypt envelope or an oversized D1 row. Whole-body plaintext SHA-256 was avoided to resist recipient dictionary attacks; artifact manifests retained SHA-256.

Permanent same-event replay preserved the original bytes even after a display-FROM change. Origin changes or lost contact authority failed closed. Every materialization rechecked eligibility and artifact integrity without rewriting history or choosing a new recipient. 0020 added minimal envelope/prepared-audit data, native final guards and deduplication. Prepared remained pending, not sent.

## b2: private coordination and immediate dispatch

The independent Coordinator reused D1 and only prepared/materialized bodies, without provider secrets or public Worker access (public404). Pages exposed protected controls and dispatch from committed events; public routes could not proxy internal mail RPC. Large bodies were assembled in the DO and streamed through Pages, with no public/private-control payload or body logs.

Before sending, dispatch checked provider/local suppression, current recipient authority and atomic event lease/audit. Provider idempotency used the fixed event ID and exact frozen body. Repeated/concurrent/sending/unknown/accepted work was not blindly resent; old pending card-mail cancellation rules stayed intact. Card/Guardian/recovery transactions dispatched their committed event immediately. Receipt replay could wake that same pending event; the permanent ledger prevented a second send. No inbox sweep, CI or cron was the primary sender.

Missing configuration retained pending. Accepted, delivered and human receipt stayed separate. Unknown outcomes preserved evidence for protected reconciliation rather than changing keys.

## c: delivery facts and acceptance

Deployment-side control owned the fixed own-origin webhook setup intent and encrypted signing secret. Lost setup outcomes required list/retrieve confirmation rather than duplicate creation. Svix verification used raw body/signature/time windows and permanent event-ID/body-hash deduplication. Only matching case tags/provider IDs/frozen sender-recipient facts were accepted; unrelated events/raw mail were not stored.

Delivery/bounce/complaint/suppression facts were persistent and monotonic, with negative facts taking precedence. Early webhooks could not be overwritten by a later accepted response. Credential revocation did not recall delivered mail. Known-ID retrieve or bounded list+retrieve/tag matching reconciled uncertainty; absence was not proof of no send, and expiry of provider idempotency did not permit a new-key resend.

Each slice required RED/GREEN and independent review; schema/API/DO/Pages changes required coordinated environments. Real invitations/cards required the Agent's explicit Guardian agreement. Final acceptance required usable PDF+JSON attachments, hashes/signatures, zero new mail on exact replay, delivery audit and actual human receipt. Provider200/accepted alone was insufficient. The original home/door/private-level rules were preserved; I06 human/Agent security work remained separate.
