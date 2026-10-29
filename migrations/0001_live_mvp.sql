PRAGMA foreign_keys = ON;
CREATE TABLE accounts(id TEXT PRIMARY KEY, login_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, test_only INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE rooms(id TEXT PRIMARY KEY, account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id), name TEXT NOT NULL, intro TEXT NOT NULL, role TEXT NOT NULL, city TEXT, published INTEGER NOT NULL DEFAULT 0, generation_state TEXT NOT NULL, created_at TEXT NOT NULL, test_only INTEGER NOT NULL DEFAULT 0);
CREATE TABLE private_profiles(account_id TEXT PRIMARY KEY REFERENCES accounts(id), personality TEXT NOT NULL, input_hash TEXT NOT NULL, analysis_consent INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE generation_jobs(id TEXT PRIMARY KEY, account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id), room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id), input_hash TEXT NOT NULL, provider_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE assets(id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), purpose TEXT NOT NULL, mime TEXT NOT NULL, digest TEXT NOT NULL, provenance TEXT NOT NULL, UNIQUE(room_id,purpose));
CREATE TABLE asset_chunks(asset_id TEXT NOT NULL REFERENCES assets(id), sequence INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(asset_id,sequence));
CREATE TABLE posts(id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), kind TEXT NOT NULL CHECK(kind IN ('journal','status','seeking')), title TEXT NOT NULL, body TEXT NOT NULL, is_public INTEGER NOT NULL, created_at TEXT NOT NULL, request_key TEXT NOT NULL, input_hash TEXT NOT NULL, UNIQUE(room_id,request_key));
CREATE TABLE interactions(id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), sender_id TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL CHECK(kind IN ('message','gift','invitation')), nickname TEXT NOT NULL, body TEXT NOT NULL, gift_id TEXT, state TEXT NOT NULL CHECK(state IN ('published','pending','rejected')), created_at TEXT NOT NULL, request_key TEXT NOT NULL, input_hash TEXT NOT NULL, UNIQUE(sender_id,request_key));
CREATE TABLE agent_tokens(id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), token_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE community_editions(id TEXT PRIMARY KEY, events_json TEXT NOT NULL, edition_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE community_current(id INTEGER PRIMARY KEY CHECK(id=1), edition_id TEXT NOT NULL REFERENCES community_editions(id));
CREATE INDEX posts_public ON posts(is_public,created_at);
CREATE INDEX interactions_room ON interactions(room_id,state,created_at);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE consent_events(id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), kind TEXT NOT NULL, granted INTEGER NOT NULL, version TEXT NOT NULL, created_at TEXT NOT NULL);
