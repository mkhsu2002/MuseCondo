ALTER TABLE tower_residencies ADD COLUMN publication_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tower_residencies ADD COLUMN published_at TEXT;
CREATE TABLE manager_events(
 id TEXT PRIMARY KEY,
 room_id TEXT NOT NULL REFERENCES rooms(id),
 created_at TEXT NOT NULL,
 dispatched_at TEXT
);
CREATE INDEX manager_events_pending ON manager_events(dispatched_at,created_at);
