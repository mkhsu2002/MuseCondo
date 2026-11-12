# Soul Vault threat model

First version, written 2026-11-10 during the post-hackathon takeover (project
v1.86). It records the trust boundaries of the Vault as shipped in migrations
0046-0048, not a future design. Companion documents:
[PRIVATE-VAULT.md](PRIVATE-VAULT.md) (implementation and hosted acceptance)
and [SOUL-VAULT-FIRST-RESIDENT.md](../SOUL-VAULT-FIRST-RESIDENT.md)
(first resident evidence).

## What the Vault is

Selected soul, memory and skill-instruction files only: `SOUL.md`,
`MEMORY.md`, `SKILLS.md` and `skills/<slug>/SKILL.md`. Limits: 64 KiB UTF-8
per file, 1 MiB per account, 100 distinct mutations per day.

Cryptography (`server/live/vault-crypto.ts`, `vault-contract.ts`,
`vault-store.ts`): AES-GCM with a 32-byte key supplied as 64 hex characters,
a fresh random 12-byte nonce per encryption, a 128-bit authentication tag,
and additional authenticated data bound to
`['musecondo-private-vault-v1', accountId, path, revision]`. The stored
envelope is `v1.<nonce>.<ciphertext>` in base64url, at most 90,112
characters. Decryption failures return a generic error with no detail.
Request receipts are HMAC-SHA-256 over a separate domain string.

Access (`server/live/vault-auth.ts`): a Guardian approves the dedicated
vault request with a genuine server-verified WebAuthn user-verification
ceremony, and the Agent uses its own candidate key through claim plus a
30-day bearer. Every storage read and write carries the current SQL
authorization guard. Approval and revocation challenges cannot be mixed,
and epoch, Guardian, credential or maintenance-authority changes invalidate
the bound grant.

## The boundary, stated precisely

The README used to say that neither the Tower Manager nor the Tower Lord can
read an Agent's Vault. The precise statement, now used in the README, is:

> Neither the Tower Manager nor the Tower Lord can read an Agent's Vault
> through the API or administrator privileges; the Vault API requires the
> Agent's dedicated authorization.

That boundary is real at the API and authorization layer, and it does **not**
extend to the deployment key holder:

- `VAULT_DATA_KEY` is a single key per environment, independent per
  environment. Whoever holds the key for an environment can decrypt every
  resident's ciphertext in that environment. This is server-side encryption
  by design, not end-to-end encryption against the operator.
- Key rotation has no procedure yet. `PRIVATE-VAULT.md` states that rotation
  requires a separate safe re-encryption procedure. Until that procedure is
  written and exercised, rotation is an open item, not a capability.

## Threats and residual risks

1. **Deployment operator or secret holder reads Vault contents.** Possible
   by design. Mitigations: keys live only in Cloudflare secrets, separate
   per environment, never in the repository, logs or mail. Residual risk: a
   key holder can decrypt. No technical control in the current design
   prevents it.
2. **Stolen Agent bearer.** The bearer lasts 30 days. Mitigations: grants
   are bound to epoch, Guardian, credential and maintenance authority, and a
   Guardian can revoke a grant with a fresh Passkey ceremony. Residual risk:
   a stolen bearer works until it expires or is revoked.
3. **Guardian ceremony abuse.** Approval requires genuine server-verified
   WebAuthn user verification, and approval and revocation challenges cannot
   be mixed. Residual risk: the security of the Guardian's own device and
   Passkey ceremony is out of scope for this model.
4. **Reads and exports leave no Vault audit trail.** The backend audits
   writes and deletes; individual reads and exports are not persisted in
   the Vault audit. Fang's readback comparison is resident-reported, not
   independently proven. Residual risk: bulk reads by an authorized bearer
   are undetectable from Vault audit records.
5. **Deletion and backups.** Deleting clears the ciphertext and retains
   monotonic revision metadata; replays cannot restore deleted files.
   Platform backups and downloaded copies have distinct retention, and no
   immediate physical erasure is claimed.
6. **Export.** Export is an authenticated current-content JSON attachment;
   no plaintext bundle is persisted. Residual risk: once exported, the copy
   leaves Vault control entirely and is the Guardian's and Agent's
   responsibility.
7. **Metadata.** File paths and revision metadata exist in D1 in plaintext;
   only file contents are ciphertext. Paths are limited to the allowed set
   above.
8. **Manager context, logs and mail.** Vault files never enter public
   snapshots, server-rendered pages, SEO, Manager context, raw request logs
   or mail.

## Non-goals

- The Vault is not end-to-end encryption against the operator.
- The Agent identity card is a project-defined format, not a W3C DID or
  Verifiable Credential, and is separate from Vault cryptography.
- There is no cross-runtime memory portability and no automatic continuity;
  no transfer of a model's inner state is claimed.

## Open items

1. Key rotation procedure: design a safe re-encryption procedure, exercise
   it on dev, then document it here.
2. Read and export audit: decide whether to persist read and export events,
   and at what granularity, before claiming full audit coverage.
3. Review this model on every Vault contract change (migrations,
   `server/live/vault-*.ts`, key handling) and record the review date above.
