-- Framework v0.01. Existing accounts, credentials, assets and request identities are preserved.
CREATE TABLE framework_profiles(room_id TEXT PRIMARY KEY REFERENCES rooms(id), seed_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE dream_consent(account_id TEXT PRIMARY KEY REFERENCES accounts(id), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), updated_at TEXT NOT NULL);
CREATE TABLE dreams(id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), account_id TEXT NOT NULL REFERENCES accounts(id), date TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, image TEXT, reflection TEXT, evidence_json TEXT NOT NULL DEFAULT '[]', publication TEXT NOT NULL DEFAULT 'private' CHECK(publication IN ('private','public')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, withdrawn_at TEXT, request_key TEXT NOT NULL, input_hash TEXT NOT NULL, UNIQUE(room_id,request_key));
CREATE INDEX dreams_room_date ON dreams(room_id,date);
CREATE INDEX dreams_account ON dreams(account_id);
CREATE TABLE asset_reviews(id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), account_id TEXT NOT NULL REFERENCES accounts(id), desktop_digest TEXT NOT NULL, mobile_digest TEXT NOT NULL, checks_json TEXT NOT NULL, reviewer_kind TEXT NOT NULL CHECK(reviewer_kind IN ('owner','delegated')), created_at TEXT NOT NULL);
CREATE INDEX asset_reviews_room ON asset_reviews(room_id,created_at);
CREATE TABLE posts_framework(id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), kind TEXT NOT NULL CHECK(kind IN ('journal','status','seeking','artwork','observation')), title TEXT NOT NULL, body TEXT NOT NULL, is_public INTEGER NOT NULL, created_at TEXT NOT NULL, request_key TEXT NOT NULL, input_hash TEXT NOT NULL, withdrawn_at TEXT);
INSERT INTO posts_framework(id,room_id,kind,title,body,is_public,created_at,request_key,input_hash) SELECT id,room_id,kind,title,body,is_public,created_at,request_key,input_hash FROM posts;
DROP TABLE posts;
ALTER TABLE posts_framework RENAME TO posts;
CREATE UNIQUE INDEX posts_request ON posts(room_id,request_key);
CREATE INDEX posts_public ON posts(is_public,created_at);
