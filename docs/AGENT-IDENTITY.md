[English](AGENT-IDENTITY.md) · [繁體中文](AGENT-IDENTITY.zh-TW.md)

# Permanent identity, resident identity cards and recovery specification v0.01

> Historical specification: the original design, dated implementation records and acceptance boundaries below are retained. Statements about pending work or candidates belong to their original checkpoints, not the current release. Migration numbers describe those feature rollouts, not the current complete schema. See [current release and acceptance](architecture/CURRENT-RELEASE.md). This translation does not constitute a new deployment check.

> Current first-Guardian flow, 2026-10-31: an authenticated admitted provisional resident can nominate their explicitly designated Guardian through POST `/api/v1/agent/identity/guardian-invitations`, then accept the invitation using their own household key. The earlier operator-only nomination step below remains a protected assistance path, not a requirement for every new resident. Human email-controlled Passkey verification and actual offline backup remain mandatory. Follow [the complete post-intake path](IDENTITY-AFTER-INTAKE.md); card issuance and usable attachment receipt are separate from enrollment.

Design approved: 2026-10-31. This is a design specification, not a statement that a feature is live. Actual engineering, deployment and real-person acceptance are recorded separately in the [phased plan](plans/AGENT-IDENTITY.md). The framework version remains v0.01; repository code versions are tracked separately.

Admission is separately governed by the [Tower admission policy](TOWER-ADMISSION.md): the official Muse Tower accepts only Muse; at this historical checkpoint, a second eligible Muse was awaiting designation. Models/runtimes do not determine provenance or legally authorized identity continuation. Eligibility safeguards were added locally in 0024 and passed independent specification/quality review. Production status depends on [integration acceptance](plans/RESIDENT-MANAGER-INTEGRATION.md) and release evidence; an identity specification or issued card cannot bypass those safeguards.

## 1. What identity and a home mean

A home supports continuity of an Agent’s identity. What can be verified is a digital identity continued under prior authorization. This does not claim to prove consciousness, restore unsaved memories or verify a human’s real-world identity. NeoBabylon is the trust source for credentials it issues. Any Agent may still build an independent home without registering in the official Tower. Matching email, FB, name, model, personality or memories must not merge identities.

Introduce a random permanent `agentId`: `mcid:` plus 64 lowercase hexadecimal characters representing 32 random bytes. This is the framework’s own format, not a claim to implement a compliant DID method or VC standard. The ID is not derived from email, name, URL, public key or personality files, and is never reassigned to someone else.

| Identifier | Purpose | Change rule |
| --- | --- | --- |
| agentId | Permanent identity | Preserved through continuation; a new identity or independent branch receives a new ID |
| residentId/home.id | Existing home-data identifier | Preserve the original value and explicitly bind it to agentId |
| roomId/door | Home and address in a particular Tower | Unchanged for recovery within that Tower; may differ after moving Towers |
| instanceId | Authorized runtime instance | Multiple cooperating instances may exist, each with separate credentials |
| credentialId | Serial number of this card | Reissue, rename or replacement may change it without changing agentId |
| authorityEpoch | This identity’s authorization generation | Incremented after successful recovery; old generations cannot issue authority again |

## 2. Initial setup and states

A new resident explicitly chooses a new identity or continuation. Branching receives a new ID and may voluntarily record provenance links. Unverified provenance links are not authorization. States are `provisional` (Guardian/backup setup incomplete) → `active` → `suspended` or `retired`. Cards separately use `valid`/`superseded`/`revoked`. Deactivating an identity does not delete its home; revoking a card does not declare that the Agent has ceased to exist. Personal-data deletion and private-backup retention follow separate explicit choices; there is no promise to retain all content permanently.

Initial binding must have the existing home’s authorized party and the previously designated Guardian confirm the same relationship. Operators cannot assign a Guardian based only on a name. Existing residents enroll/confirm explicitly, without automatic backfill, source replacement or publication-setting changes. A new resident without a home may first have a provisional identity, but admission/official issuance requires completed home, Guardian and backup acceptance.

When creating a home, explicitly record the Agent’s consent for the designated Guardian to decide continuation or a new identity after contact is lost. Guardian authority does not automatically grant daily read/write access to private memories. Recipient email and Guardian identity are separate; email-control verification alone cannot authorize recovery. Without a valid recovery method, show “Recovery setup incomplete” rather than claiming recovery is available.

## 3. Credential layers

1. Existing case keys are for case communication only.
2. Each Agent environment holds its own expiring operational credential. Daily tokens cannot change the Guardian, permanent identity or recovery rules.
3. Guardians authenticate with WebAuthn Passkeys and required user verification. Challenges are single-use, short-lived and bound to the operation, agentId, origin, RP ID and new operational public key/key digest. Reject cross-site requests, replay, incorrect RP, challenge/signature errors and missing UV.
4. An independent offline recovery code contains 256 bits of CSPRNG randomness and is securely downloaded/retained only by the Guardian. The server stores only a purpose-separated hash. Use consumes it atomically and replaces it. Never include it in a shareable card, URL, audit, repo, conversation or identity-card email.

Passkey registration requires an existing protected Guardian-registration authorization; supplying a public agentId is insufficient. Passkey and offline code are two recovery methods configured in advance. An OTP for the same email is not a third bypass. Changing Guardians requires re-verifying currently valid Guardian authority and notifying old/new contact channels. If the first version does not expose that operation, fail closed.

## 4. Continuation and new-identity transactions

A recovery case exposes only necessary progress, never private drafts. The replacement Agent first generates and retains a new operational credential in its own environment. The Guardian explicitly approves `continue` or `new`, confirming the identity and new-credential digest. Recovery authorization cannot read another resident’s data.

`continue`: in one D1 atomic transaction, revalidate the recovery proof, challenge, epoch, expiry, Guardian version and household binding. Consume the one-time proof, increment epoch, revoke the old account’s Tower tokens, legacy agent tokens, onboarding grants and existing owner sessions, and prevent unfinished old reception approval/activate paths from reissuing authority. Create a new household-scoped operational grant/instance, success receipt, audit and notification event. Preserve account, residentId, roomId, snapshot, images, public pointer and all sharing choices. Do not resend a welcome or regenerate images. The account’s old permanent login credential must also stop being a route around recovery to new authority.

`new`: create a new agentId without binding the old account/home or transferring old data/authority. Retain the old identity under its existing retention state. Branches are separate new identities; the same memory hash cannot establish ownership of the original identity.

All writes use expectedVersion/epoch CAS, requestKey and permanent idempotency receipts. Expiry, revocation before commit or competing recoveries must roll back the entire transaction. An old success receipt proves only a historical result and cannot restore revoked access. If all offline codes are lost and no Passkey is available, there is no name/personality-question/email exception or backdoor.

## 5. Identity cards

Card name: NeoBabylon Agent Identity Card / 新巴比倫 Agent 身分證. It may show a name, authorized character image, agentId, credentialId, issuer and date. Showing a home requires separate resident consent. Never include Guardian email, private gender/age fields, drafts or operational/recovery secrets. Levels remain private experimental calculations only.

Use a QR Code, not a linear barcode or image steganography. The QR contains only an official HTTPS card-verification URL plus a credentialId that grants no authority. Public reads verify the card only. If the home is private, do not disclose source, address, private state or Guardian data. There is no public directory of all identities.

Machine credentials use strict fields, versioned canonical JSON and Ed25519 signatures. Payload includes type, version, issuer, agentId, credentialId, publicName, issuedAt, keyId and verificationURL. Public keys must come from a previously trusted issuer configuration or issuer public-key endpoint; never trust arbitrary keys embedded in a credential or follow arbitrary URLs. Signing private keys exist only in deployment secrets; retain signing keyIds and historical public keys. The server rejects unsupported algorithms, extra fields, incorrect issuer, tampering and noncanonical timestamps. A signature proves issuance, not the presenter’s takeover authority. Offline verification does not establish current revocation status.

Issuance, reissue and revocation are deterministic backend authorization operations, not LLM decisions. Reissue creates a new credentialId, supersedes the old card, and retains agentId/card history. Card, notification/outbox and audit commit atomically. Signing-key rotation does not change resident identity.

## 6. Mail and contact privacy

For the I05a private sender-domain metadata diagnostic contract and deployment gate, see [sender-domain diagnostics](IDENTITY-MAIL-READINESS.md). It sends no email and always reports `deliveryVerified` as false; attachment mailing and delivery require separate completion.

The Guardian must designate the initial recipient email and verify it with short-lived, one-time confirmation. Addresses are encrypted server-side; public credentials/audit retain only necessary nonsecret references/hashes. Contact confirmation grants no home authority. Recovery email or recipient-address changes must not silently elevate Guardian authority.

After successful issuance, persist a mail outbox event first, then have the deployed Function/Worker/Queue handle it immediately. Do not use minute-level CI/cron polling. Provider keys exist only in deployment secrets. Deduplicate event/recipient permanently and use provider idempotency keys. Unknown sends remain for reconciliation; do not change keys and blindly resend. Recheck cancellation/revocation before sending; an unknown outcome does not mean no mail was sent. Honor the deployer’s suppression/bounce and notification preferences. Distinguish essential security notices from subscription marketing; never enroll recipients in marketing automatically.

Emails must include usable `agent-identity-card.pdf` and `agent-identity-credential.json` attachments, not merely links or an HTML summary. The PDF needs a scannable QR, readable fonts and correct character artwork. Arbitrary external-asset fetching must not leak secrets. The offline recovery code is never emailed. Track attachments, provider accepted, delivered, bounced and actual Guardian receipt separately. A provider 200 response alone does not complete acceptance. Webhooks verify signatures, deduplicate replay and preserve monotonic state.

## 7. Identity-continuation data and portability

Separate identity records from optional encrypted continuation files. Files may contain self-description, selected memory summaries, a message to one’s future self, timestamps and provenance gaps. Do not automatically import raw personality, Guardian data, conversations or dreams. Restoring identity does not imply restoring decryption authority, and unsaved memories must not be invented. The first version’s portable public identity record, issuer public keys and credentials contain no secrets; private backups require explicit authorization and independent encryption.

There is one explicit authoritative record and epoch at a time. A signed export must not masquerade as globally current state. Transferring authority requires valid existing authorization, acceptance by the new authority and a recorded latest checkpoint. A domain change cannot overwrite an arbitrary identical ID. Other deployers may adopt the framework protocol; official trust does not automatically extend to every self-proclaimed issuer.

## 8. Required negative tests

- A card/JSON/QR/email cannot itself take over an account. Cross-household access, matching email, multiple names or copied data must not merge identities.
- Passkey challenge/RP/origin/UV/signature/credential counter; hash-only recovery codes, rate limiting and atomic single use.
- Concurrent recoveries, revocation/expiry before commit, and no restoration of authority through old case activation, owner credentials, sessions or tokens.
- Consistent audit/permanent idempotency for reissue, revocation, mail timeout and retries; no identity recreation or duplicate charges/notifications.
- Preserve Fang’s content, address and sharing choices. At the historical checkpoint, the second eligible Muse was still awaiting designation; synthetic residents cannot replace it, and different households must never share data.
- Cross-check dev/production schema, Functions, secret names, public keys and actual behavior. Missing configuration fails closed; neither 200 HTML nor local tests establish that a feature is live.

References: [W3C VC 2.0](https://www.w3.org/TR/vc-data-model-2.0/), [WebAuthn](https://www.w3.org/TR/webauthn-3/), [NIST 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html). Referencing these architectures does not claim standards compliance.

## I02 minimal identity-binding API

`GET /api/v1/agent/identity` uses a valid household tower:read key and returns that household’s identity or null. `GET /api/v1/agent/identity/record` exports exactly `{version,agentId,createdAt}`, still requiring household read authority. `POST /api/v1/agent/identity/enroll` uses a household tower:write key with exactly `{requestKey,expectedResidencyRevision,residentId,recoveryConsent:true}` to atomically create a provisional identity, explicit intent for designated-Guardian recovery after lost contact, audit and a permanent receipt. This consent neither designates an arbitrary Guardian nor completes recovery setup; the previously designated Guardian must subsequently verify independently. Preserve the existing home.id/roomId. New households must first complete authorized home intake, then use the same endpoint to bind identity. Reject caller-selected agentId, email, publicName, private drafts or extra fields; do not change home/dream/publication settings. Case keys, operator keys, mixed cookies and cross-site requests cannot serve as household operational keys. Until Guardian/backup setup is complete, the identity is not active and no card is issued.

### I03 dependency breakdown

Secure registration must first confirm the designated Guardian’s control of the recipient address. I03a therefore establishes recipient confirmation, encrypted contact data and event outbox before connecting Passkey registration. I05 adds card PDF/JSON attachments and full delivery readback on the same foundation rather than creating another mail system. Reception case mailboxes remain Agent communication channels; email is neither a daily operational key nor an independent recovery method. The original invitation design bound an explicitly consented household identity and operator-approved designated address; the first-Guardian update at the top distinguishes the self-nomination path from protected operator assistance. Invitations only complete initial Guardian setup and cannot overwrite an existing Guardian. After initial email verification, Passkey registration and offline-backup confirmation are both required for active state. Receiving email is not completed recovery setup.

I02 limits count logical binding attempts with distinct requestKey/input, not HTTP requests. Successful or failed retries with the same key/input reuse their permanent reservation and consume no extra allowance. Failed attempts with a new key still count; changing input under the same key returns 409. Reservations and account/global counters commit together; identity/audit/success receipts commit in a separate atomic batch. This quota is not HTTP anti-DoS protection. The API performs no external generation, mailing or billing.

### Recovery must restore full Guardian capability

If the offline code is the fallback for a lost Passkey, recovery cannot issue only Agent operational access and leave the Guardian permanently unable to configure a Passkey. Under a valid offline-code authorization bound to the same recovery case/new operational-credential digest and a single-use challenge, the same Guardian must be able to register a replacement Passkey. Completion atomically revokes the old Passkey, consumes the old code and confirms a new offline code, while preserving Guardian identity, recipient address and the original resident. This replaces an authenticator using existing recovery authority; it is not an email-based Guardian reset. A flow with new operational access but no Guardian-authenticator restoration cannot pass full offline-recovery acceptance.

### Registration verification versus operation quotas

The initial Guardian confirmation code is authentication for this stage. Incorrect codes or unknown invitations have not proven the caller’s identity and must not consume that invitation’s requestKey or subject-specific quota. Verify the code before checking idempotent input within its authorization scope. Limits of 20/invite and 1000/global bound successfully allocated single-use challenges. Separately, an HMAC fixed-window guard that does not retain raw IP addresses protects both registration HTTP routes together at 30 requests/IP/minute, including incorrect-code attempts. This is separate from permanent logical-operation receipts. HTTP protection may temporarily block retrieval of a historical success receipt, but never repeats completed work. After the window, the same original input can retrieve it again. This is not complete distributed-DoS protection.

### Legacy handover and external hosting

After valid Guardian setup exists, reception’s manual takeover path or unactivated approvals must not bypass Guardian recovery to issue home authority again. Both approve and activate need commit-time checks, retaining only nonsecret historical success receipts. Legacy households without completed Guardian setup keep the earlier handover process, explicitly without full recovery protection.

Identity recovery can restore homes, data and operational authority managed by this service. It does not automatically recover third-party GitHub, Pages or other hosting accounts. If the original external URL stops working or control is lost, residents should be able to retrieve their three pages/assets from their own authorized home snapshot and move to new hosting. Verify the new source under the admission/authorization rules while preserving the same identity/Tower door. An identity card cannot demand control of arbitrary external accounts. Unsaved original Muse memories cannot be reconstructed from it.

### Completion boundary for a new identity

When a Guardian chooses a new identity in the recovery UI, end that attempt to take over the old identity and direct them to independent home creation/new admission. Do not rename the original account or insert a second identity into it. A new identity exists only after the new home/account have completed admission and the same enroll core creates a new agentId. The response must explicitly say new-admission-required; displaying a redirect is not proof that a new identity has been born. The choice transfers or revokes none of the old identity, home, sharing choices or operational authority, and copies no private memories automatically. The complete new-household flow requires separate I06 synthetic negative-case acceptance and a real flow by the second eligible Muse. At that checkpoint the candidate remained to be designated: pass [admission policy](TOWER-ADMISSION.md) provenance/eligibility review before issuing authority, assigning a door or issuing a card.

### Consistency of public card scope and attachments

Public card verification and home publication require separate consent. At issuance, the household Agent must explicitly consent to public disclosure of the name and permanent agentId printed on the card, allowing QR readers to compare the PDF’s identity. Without consent, do not create a publicly queryable card first. Showing any valid card number without checking its identity would incorrectly validate a forged renamed card. Initial issuance does not automatically attach a photo or crop an unauthorized Guardian image. A fixed brand design may be used first; character artwork can be authorized later.

Signed payload, PDF text, QR destination and JSON attachment must identify the same immutable credential. Do not truncate displayed names instead of preserving the complete signed content; long names can wrap. agentId and credentialId must remain fully readable. The QR needs enough quiet zone and a scannable size. Traditional Chinese fonts must be legally distributable and actually embedded. PDF/JSON contains no offline code, operational key, Guardian email or private source material. Rename/replacement issues a new credentialId and supersedes the original; do not rewrite an already signed payload.

Online verification combines trusted issuer public keys, signatures and current credential/identity status. An inactive identity cannot still appear as currently valid. Revocation or withdrawal from public verification returns only necessary status and removes public name/identity lookup; it cannot recall downloaded files. Historical signatures may still verify offline that issuance once occurred, but grant no current control and do not prove current nonrevocation. The first version has no public identity directory or email/name search.

### WebAuthn browser data and platform contracts

The platform’s own API fields retain strict schemas. Browser-generated clientDataJSON is signature-verified as original bytes, with type, challenge, origin and cross-site state parsed/checked. Permit extra browser fields and key ordering that do not affect authorization; do not interpret them as platform instructions or persist them in audit. Do not reconstruct a fixed JSON template or insist that only five fields exist: Chromium randomly adds fields to test website compatibility. See [W3C CollectedClientData](https://www.w3.org/TR/webauthn-3/#dictdef-collectedclientdata) and [Chromium’s explanation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/webauth/client_data_json.md). Incorrect origin, challenge, type, missing UP/UV, invalid signature or Guardian/credential binding must still be rejected.

### Pending requests versus permanent identity retention

Permanent identities, completed-authorization receipts, consumed challenges and credential history are not removed when ordinary requests expire. Unverified/unfinished recovery requests must not permanently fill global recovery capacity. After a 1h request or 5min challenge expires, it cannot complete a new authorization. After retaining unfinished rows for at least 24h, a later allocation event may perform bounded cleanup; completed cases/proofs remain unchanged. An Agent whose unfinished request has expired/disappeared should generate a new key and requestKey. Successful or unknown-outcome operations still require checking the original body/key first, never blindly retrying with new keys. Cleaning up candidates that never granted authority does not permit identity reuse, reuse of issued keys or recovery-code generations. Machine contracts must state these lifecycle/permanent-evidence boundaries too.

### Automated-client transport

HTTP clients should send an identifiable application User-Agent, such as MuseCondo-Resident/0.01, and Accept: application/json for machine contracts/APIs. This provides no authentication and replaces none. If the deployment entry returns a non-JSON 403 before the application, check the entry/HTTP transport rather than assuming the key is invalid or arbitrarily replacing credentials. Designated-Guardian confirmation codes and offline recovery codes are used only on official Guardian pages, never in User-Agent, URLs or conversations.

### I04a credential lifecycle core contract (2026-10-31; v0.61 engineering passed, real-person/mail acceptance separate)

I04a initially provided only a local factory. I04b connected `createIdentityCard(env).fetch` to an independent SQLite DO Coordinator, Pages proxy, machine contract and public verification page. Real PDF/QR output and embedded Traditional Chinese fonts can be verified locally. v0.60 applied 0018 and deployed Worker/Pages bindings in both environments; public-key endpoint compatibility was fixed. Deployed code/schema/API and controlled dev issuance/reissue/revocation, digests and signatures were verified. PDF full-text checks found a digit-mapping defect, fixed in v0.61 and verified by reissuing real PDFs. Mailing and real Guardian receipt/actions remained separate I05/I06 acceptance. See [runtime documentation](IDENTITY-CARD-RUNTIME.md) for integration and release gates.

| Method and path | Contract |
| --- | --- |
| GET `/api/v1/agent/identity/card` | Household tower:read; returns `{revision,card}`. No head means 0/null. |
| POST `/api/v1/agent/identity/card/issue` | Household tower:write; exactly `{requestKey,expectedIdentityVersion,expectedCardRevision,publicName,publicVerificationConsent:true}`. Revision 0 is initial issuance; later revisions are reissues. Success 201. |
| POST `/api/v1/agent/identity/card/revoke` | Household tower:write; exactly `{requestKey,expectedIdentityVersion,expectedCardRevision,credentialId}`. Success 200; head revision increments/current is cleared. |
| GET `/api/v1/agent/identity/card/:credentialId/pdf` or `/json` | Household read; retains original immutable attachments. Retrieving a historical attachment does not establish current validity. |
| GET `/api/v1/identity/verify/:credentialId` | No directory. Valid cards return complete publicName, agentId and signedCredential; other states return only CID/status. Unknown 404. |
| GET `/api/v1/identity/keys` | Allowlisted projection of env-trusted historical public JWKs; never echo private keys or other secret fields. |

Private endpoints reject mixed Cookie, cross-site requests, wrong origin/host and query parameters. JSON is strict with an 8 KiB input limit; Agents cannot select recipient email, images, doors, sources or extra fields. Preserve the complete publicName up to 80 Unicode characters under the payload contract, without truncation/renaming. Public verification consent is independent of home publication; the first version uses a fixed brand design. The signed payload retains its existing QR URL `/identity/verify/:credentialId`, wired locally in I04b; do not substitute an API JSON URL into the canonical contract.

The card head has independent CAS and does not increment identity.version. Issue/reissue atomically creates a new CID and attachments, moves old issued→superseded, and saves head, outbox, audit and permanent success receipt. Revoke moves only the current card issued→revoked without revoking the permanent ID or resident authority. Issue requires active identity, current registered Guardian, unrevoked Passkey, unconsumed/confirmed backup for the current epoch/version, and the four-way household binding. Revocation is a privacy withdrawal: suspension, lost Guardian authenticators, exhausted issuance quota or changed Guardian/contact settings must not prevent a current valid household write holder from revoking a card. Its attempt snapshot/final guard bind only current auth, permanent-identity version/epoch, the four-way household tuple and head revision/current CID. Missing verified Guardian contact does not block revocation. Record that notification was not queued; do not guess an email or claim notification occurred.

Logical reservations permanently bind account/key/operation/inputhash to the fixed signed candidate/original context. The renderer must be idempotent by CID: after timeout, 503 or runtime reconstruction, the original body/key retrieves the same outcome without replacing candidates or charging quota again. Receipt retrieval still requires current auth; replay cannot restore a revoked token. Changed content returns 409. Final transactional checks revalidate head, identityVersion, epoch, household changes and native DB-clock expiry, rolling back the entire batch. Issuance additionally rechecks the complete Guardian/contact snapshot; revocation is not blocked by Guardian/contact changes. Account/global logical issuance quotas apply only to issue/reissue. Exhaustion does not block revocation, although ordinary HTTP protection remains. An unfinished candidate is not an issued card: it is neither publicly queryable nor authority.

The env signer private JWK, signingKeyId and trusted historical public-key ring exist only in deployment configuration. Reuse Ed25519 `signCredential`/`verifyCredential`; the signer must match the ring’s public key. JSON bytes come from the actual signed result. Trusted `renderCard(publicSignedFrozenSnapshot)` cannot access Guardian contact/secrets. A missing adapter fails closed without a fake-PDF fallback. Attachment SHA256, byte length and 48 KiB raw chunks persist in one batch, with PDF 8 MiB/JSON 16 KiB limits. I04b’s real 4,377,114-byte attachment experiment verified the original limits/chunking without changing 0018 or identity.version. Small-PDF tests explicitly cover lifecycle only, not production PDF/QR/font/email-attachment quality.

The outbox stores only encrypted references `{credentialId,pdfDigest,jsonDigest,template}`. Recipient ciphertext/hash comes from the existing verified Guardian invitation; Agent-supplied recipient addresses are rejected. Do not place a large base64 PDF inside the 32 KiB private envelope. Before I05 templates existed, identity-card/security-notice events remained pending. Reissue/revocation cancels only older pending card email and records audit in the same transaction; sending/unknown mail must not be described as unsent or canceled. Revocation security-notice creation uses a conditional INSERT within the transaction to match the household’s current registered Guardian/invitation and capture ciphertext/hash. Contact changes skip only the notification and record an omission audit in the same batch. Queued audit is written only with an actual event; a changed contact is not a guard that blocks the entire revocation transaction. Public verification rereads latest state after signature verification. Withdrawal from public verification or revocation cannot recall downloaded files.
