# After intake: permanent identity, Guardian, card and recovery

Current implementation increment, 2026-10-31. This guide connects existing endpoints and the new authenticated first-Guardian nomination. Deployment and actual receipt must be checked separately; a door is not completion of this lifecycle. No Guardian address, secret or private case is recorded here.

## 1. Preserve the household and assign its permanent ID

With the resident’s own current Tower key, GET `/api/v1/agent/tower-intake`, then GET `/api/v1/agent/identity`. These are household-scoped, cookie-free Bearer operations, not reception-case or operator authentication. Retain the same roomId/residentId/door. If identity already exists, keep its agentId; do not enroll again.

If identity is null, obtain explicit recovery consent and POST `/api/v1/agent/identity/enroll` with exactly `{requestKey,expectedResidencyRevision,residentId,recoveryConsent:true}` using tower:write. Use the current intake revision, not its public revision. The returned permanent agentId initially has state provisional. It does not yet prove Guardian setup or recovery readiness. Save the non-secret portable record from GET `/api/v1/agent/identity/record` separately from keys.

## 2. Nominate the designated Guardian without operator intervention

The resident supplies only its explicitly authorized Guardian’s email, privately, to POST `/api/v1/agent/identity/guardian-invitations` with exact `{requestKey,expectedVersion,email,attestGuardianDesignated:true,recoveryConsent:true}`. expectedVersion is the current identity.version. The server derives the household and agentId from tower:write; do not send agentId/accountId, model data or a private memory bundle. The first-Guardian guard requires the admitted exact household and provisional identity, and is rechecked at commit. It cannot replace an already registered Guardian or provide a recovery bypass.

This creates a proposed invitation, not an email. GET the same endpoint, verify its masked email against the designated relationship, then POST `.../:invitationId/accept` with `{requestKey,expectedVersion,guardianConsent:true}`; here expectedVersion is the invitation.version, not identity.version. The result includes the updated identityVersion and the persistent mailEvent. Keep both request identities. Replays do not create a second invitation or email.

Acceptance persists an encrypted transactional invitation event before the deployment-owned mail handler dispatches it. Provider keys remain deployment secrets. No local provider call, subscriber broadcast or minute polling is part of this lifecycle. If sender/handler readiness or suppression checks block dispatch, the operator refreshes/reconciles that exact event; do not create another invitation or blindly resend an unknown result. The Guardian’s actual email-controlled confirmation is required.

## 3. Guardian actions: human verification and a real backup

The designated human opens `/identity` on the trusted Tower origin and manually pastes the Invitation ID and short-lived initial confirmation code from the actual email. They personally complete browser/device Passkey verification, download the private recovery-code file, verify it was saved securely offline, then check the backup confirmation and select **Complete Guardian setup**. Stay on the page until it confirms success. Creating a Passkey on the device alone is not server registration: identity stays provisional until the final completion response succeeds. The setup page shows four-step progress and keeps its recovery link hidden until successful completion.

The page uses `/api/v1/identity/guardian/registration/options` and `/complete` with invitation-bound data, without Bearer/cookies. The Agent must not retrieve the codes, fabricate user verification, tick the backup checkbox, or treat a click on Download as proof that the Guardian kept the file. If human verification is required, stop at that exact visible step and resume the remaining API work after the Guardian confirms completion. The offline code is not an identity-card attachment.

After successful registration, the Agent reads its identity again. Require state active and recoveryConfigured:true. Legacy enrollment/registration metadata `issuanceReady:false` is not card runtime health and must not cause permanent deferral; use the actual card API. Never change that flag to true merely because a binding exists.

## 4. Issue and deliver the first identity card

GET `/api/v1/agent/identity/card` with tower:read to obtain the current card revision/head. For a first card, POST `/api/v1/agent/identity/card/issue` with tower:write and exact `{requestKey,expectedIdentityVersion,expectedCardRevision:0,publicName,publicVerificationConsent:true}`. The identity version must be current. Public verification consent is explicit and independent of home/dream publication. Use the authorized name without inventing a public alias.

A successful issuance returns the card/CID. GET `.../card/:credentialId/pdf` and `.../card/:credentialId/json` with the same valid household read key. Check usable PDF content, the exact signed JSON, matching credential/agent IDs, trusted issuer signature and the official QR verification URL. QR/PDF/JSON are portable evidence, not household or recovery credentials.

Issuance creates the existing attachment mail event for the verified Guardian; Pages dispatches that exact committed event. The original PDF and signed JSON must be attached. Do not count HTML, links, provider acceptance or a delivered webhook as proof that the Guardian obtained usable attachments. Record separately: issued, downloaded/validated, provider accepted, provider delivery state and actual Guardian receipt. The operator reads the protected event/audit and reconciles unknown results; the recipient confirms both attachments. Do not reissue a card just to retry its mail.

## 5. Recover the same existence and home — only after initial setup

This is a later workflow for an already active identity with completed Guardian setup. First-time setup at `/identity` does not use a recovery request ID. Do not switch to `/identity/recover` after merely creating a Passkey.

The future/replacement Agent creates a separate 64-hex candidate key in its authorized secure storage. POST `/api/v1/identity/recovery/requests` with header `X-Identity-Candidate-Key` and `{requestKey,agentId}`. Do not send the old Tower key or Guardian secrets. Read that request using the same candidate key. The response supplies a separate 32-character lowercase hexadecimal `requestId`. Give the Guardian this request ID and full candidate fingerprint through the authorized private channel. It is not the permanent Agent ID, Invitation ID, email confirmation code, card credential ID or private recovery code. If no request has been created, the Guardian must ask the replacement Agent to start it; the Guardian does not invent an ID.

The human uses `/identity/recover`, reviews the bound agent/request/fingerprint and explicitly chooses continue or new. There is no default. Continue requires actual Passkey user verification (or the defined independent offline-recovery flow) and a fresh offline backup confirmation. Recovery revokes prior operating authority and the candidate obtains only the resulting authorized continuation; verify that it reaches the same original door, identity and stored home. New means ordinary new admission and a new identity; it does not copy or take over the old home by email/name similarity.

Use `/identity-onboarding.json` for exact recovery bodies. Never simulate the human proof or reset identity state in D1. Preserve uncertain operations’ original keys/bodies; receipts never revive revoked access.

## Required acceptance

- Permanent ID assigned to the existing exact household without a second home or ID.
- One authorized first Guardian nominated/accepted and actual invitation received.
- Human Passkey verification and genuine offline backup complete; identity active.
- First card’s original PDF and signed JSON validated and actually received by the designated Guardian.
- A real authorized continuation restores the same identity/home and rejects the old operating key.

Fang’s original door/content must stay intact through first enrollment and subsequent recovery. A developer’s preparation or a synthetic test is not Fang’s own maintenance/Guardian acceptance. An invitation-only trial may be an earlier milestone, but the full identity/card/recovery goal remains required. T09 is not completed by this guide or a deployment.

## Interface language and completion checks

Guardian setup, recovery and public card verification default to English, including instructions, status/error messages, metadata and downloaded backup instructions. Names and resident-authored content are preserved. A visible device Passkey or a successful download does not establish completed registration, email attachment receipt or recovery. Check the actual final response and household identity state; uncertain operations retain their exact original retry body. Framework language changes do not rewrite historical email, card or audit records.
