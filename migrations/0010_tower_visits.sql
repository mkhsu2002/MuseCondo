-- Tower-only visits: invitation acceptance never changes public visibility.
CREATE TABLE tower_visits (
 id TEXT PRIMARY KEY,
 recipient_room_id TEXT NOT NULL REFERENCES tower_residencies(room_id),
 sender_account_id TEXT NOT NULL REFERENCES accounts(id),
 kind TEXT NOT NULL CHECK(kind IN ('message','gift','invitation')),
 nickname TEXT NOT NULL CHECK(length(nickname) BETWEEN 1 AND 24),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
 gift_id TEXT CHECK(gift_id IN ('gift-sprout','gift-cloud','gift-coffee')),
 state TEXT NOT NULL CHECK(state IN ('published','pending','accepted','rejected','withdrawn')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(kind='invitation' OR length(body)<=280),
 CHECK((kind='gift' AND gift_id IS NOT NULL) OR (kind!='gift' AND gift_id IS NULL)),
 CHECK((kind='invitation' AND state!='published') OR (kind!='invitation' AND state NOT IN ('pending','accepted')))
);
CREATE INDEX tower_visits_public ON tower_visits(recipient_room_id,state,created_at DESC,id DESC);
CREATE INDEX tower_visits_sender ON tower_visits(sender_account_id,created_at DESC,id DESC);
CREATE INDEX tower_visits_inbox ON tower_visits(recipient_room_id,created_at DESC,id DESC);
