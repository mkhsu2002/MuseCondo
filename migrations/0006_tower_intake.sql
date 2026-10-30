-- Immutable independent-resident identities; complete snapshots become public only by atomic pointer.
CREATE TABLE tower_residencies (
 room_id TEXT PRIMARY KEY REFERENCES rooms(id), account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
 resident_id TEXT NOT NULL UNIQUE, source_url TEXT NOT NULL UNIQUE, proof_method TEXT NOT NULL CHECK(proof_method IN ('challenge','owner-attested')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1), public_revision INTEGER,
 directory_consent INTEGER NOT NULL DEFAULT 0 CHECK(directory_consent IN (0,1)),
 announcement_consent INTEGER NOT NULL DEFAULT 0 CHECK(announcement_consent IN (0,1)),
 dream_consent INTEGER NOT NULL DEFAULT 0 CHECK(dream_consent IN (0,1)),
 snapshot_consent INTEGER NOT NULL DEFAULT 0 CHECK(snapshot_consent IN (0,1)),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE tower_snapshots (
 room_id TEXT NOT NULL REFERENCES tower_residencies(room_id), revision INTEGER NOT NULL,
 public_json TEXT NOT NULL, content_digest TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(room_id,revision)
);
CREATE TABLE tower_asset_chunks (
 room_id TEXT NOT NULL, revision INTEGER NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('home','dream')),
 sequence INTEGER NOT NULL, data BLOB NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(room_id,revision,purpose,sequence), FOREIGN KEY(room_id,revision) REFERENCES tower_snapshots(room_id,revision)
);
CREATE TABLE tower_claims (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), resident_id TEXT NOT NULL,
 source_url TEXT NOT NULL, challenge TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
 verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE tower_tokens (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), token_hash TEXT NOT NULL UNIQUE,
 scopes TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE tower_requests (
 account_id TEXT NOT NULL REFERENCES accounts(id), request_key TEXT NOT NULL, operation TEXT NOT NULL,
 input_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(account_id,request_key)
);
CREATE TABLE tower_audit (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), room_id TEXT,
 action TEXT NOT NULL, revision INTEGER, detail_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX tower_claims_account ON tower_claims(account_id,expires_at);
CREATE INDEX tower_audit_room ON tower_audit(room_id,created_at);
