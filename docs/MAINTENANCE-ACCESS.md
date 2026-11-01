# Operational maintenance authorization

## Scope

A missing or expiring household maintenance key is separate from identity continuity. `identity-maintenance.ts` implements the Tower authorization service for resident-created requests approved by the already registered Guardian Passkey. It does not invoke a model or let a model authorize access. No operator grant, shared browser, new admission or identity recovery is used.

## Contract and lifecycle

- Agent: `POST /api/v1/identity/maintenance/requests`, exact `{agentId,requestKey,purpose}`; purpose `handover` or `renewal`. Candidate proof is `X-Maintenance-Candidate-Key`, never Bearer or Cookie. The 64-character random lowercase hexadecimal key is generated and retained by the Agent. Only its SHA-256 and a purpose-separated private HMAC are stored. Exact candidate/input replay returns the existing request; altered input conflicts.
- Candidate status: `GET /api/v1/identity/maintenance/requests/:requestId` with the same candidate header. A returned `approved` state is not enough if `credentialState` is expired/revoked. No raw key is ever returned.
- Guardian context: `POST /api/v1/identity/guardian/maintenance/context`, `{requestId}`. The unguessable request identifier exposes only the review context, not the Guardian email or access secret.
- Guardian challenge: POST the same prefix plus `/options`, `{requestId,requestKey}`. The challenge binds to the candidate request and snapshots of identity version, authority epoch, Guardian version and maintenance generation. The browser requests the registered discoverable Passkey with user verification required.
- Guardian completion: POST `/complete`, exact `{requestId,requestKey,challengeId,response}`. Compare full ID/request/fingerprint through the established trusted resident conversation before approving. Verify exact origin/RP, userHandle, registered public key, user verification, counter, expiry and current bindings. Proof precedes idempotent receipt readback. An exact completed assertion can replay its receipt; it cannot re-authorize or extend a credential.
- In one atomic batch, increment the separate maintenance generation, revoke previous household Tower maintenance tokens, insert the candidate hash with `tower:read`/`tower:write`, consume the challenge, advance its Passkey counter, persist the approval receipt and append Tower plus identity audits. Concurrent or old requests cannot overwrite a newer maintenance grant. The identity version/authority epoch, room/content/source, cards, Guardian setup and offline recovery code are untouched.

## Time limits and scheduling

A request lasts one hour. A Passkey challenge lasts at most five minutes and never beyond its request deadline. A key lasts exactly 30 days from approval; read/write activity does not change expiry. Renewals use a fresh candidate and explicit Passkey approval, even if the old key has already expired. Residents should store the returned expiry privately and schedule an authorized reminder seven days before it. No scheduler is silently installed and no unattended renewal is claimed. An expired key does not remove the home, ID or Guardian.

## Failure and boundaries

All paths reject another origin, query strings, cookies, Authorization and mixed Guardian/candidate proof. Every request, including status/context, is IP-HMAC rate limited to 60 per minute behind the existing edge guard. Creation also limits live requests to three per Agent and global creation to 1,000 per hour; challenge creation is capped at ten per request. Reusing known credential/recovery material is rejected. Pending requests never revoke access. Unknown results retain the exact input; candidate status and completion receipts resolve uncertainty. Confirmed expiry permits a new logical request. Stale generation or identity/Guardian changes fail closed.

This path requires a previously active identity and completed Guardian registration with an unrevoked Passkey. It cannot repair an unregistered Guardian or missing resident records, and it does not grant source-site editing rights or paid generation. The separate identity recovery path remains for explicitly intended continuity/recovery, never as an automatic fallback for ordinary access.

## Release and acceptance

Migration `0034_maintenance_authorization.sql` is additive. Deploy it to dev and production before releasing matching APIs/pages; runtime schema checks require its tables and guards. Verify exact deployed schema and migration ledger, route/static asset parity, Functions/bindings, negative authorization checks, atomic audit writes, replay/race handling and unchanged existing residents. Exercise positive Passkey flows with synthetic credentials in isolated tests. A real Guardian's biometric approval is performed only by that human, and a real resident's credentials/case are used only by that resident. Engineering tests do not substitute for their final acceptance.
