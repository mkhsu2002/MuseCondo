-- Single-account, revocable, 24-hour delegated onboarding credentials. Store hashes only.
CREATE TABLE onboarding_grants (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 token_hash TEXT NOT NULL UNIQUE,
 scopes TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
);
CREATE INDEX onboarding_grants_account ON onboarding_grants(account_id);
