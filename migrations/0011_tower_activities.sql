-- Activities record choices only. No submissions, rewards, fabricated work or schedules.
CREATE TABLE tower_activities (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 64),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 2000),
 starts_at TEXT, ends_at TEXT,
 state TEXT NOT NULL CHECK(state IN ('draft','open','closed')),
 version INTEGER NOT NULL CHECK(version>=1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE tower_activity_participation (
 activity_id TEXT NOT NULL REFERENCES tower_activities(id),
 account_id TEXT NOT NULL REFERENCES accounts(id),
 room_id TEXT NOT NULL REFERENCES tower_residencies(room_id),
 state TEXT NOT NULL CHECK(state IN ('joined','declined','left')),
 show_participation INTEGER NOT NULL DEFAULT 0 CHECK(show_participation IN (0,1)),
 version INTEGER NOT NULL CHECK(version>=1), updated_at TEXT NOT NULL,
 PRIMARY KEY(activity_id,account_id),
 CHECK(state='joined' OR show_participation=0)
);
CREATE INDEX tower_activity_public_participants ON tower_activity_participation(activity_id,state,show_participation,room_id);
CREATE TABLE tower_activity_operator_requests (
 request_key TEXT PRIMARY KEY, operation TEXT NOT NULL, input_hash TEXT NOT NULL,
 response_json TEXT NOT NULL, response_status INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE tower_activity_audit (
 id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES tower_activities(id),
 action TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL
);
