-- Durable, event-driven editorial outbox. Amounts are integer micro-USD.
CREATE TABLE manager_jobs(
 id TEXT PRIMARY KEY,
 source_digest TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('pending','running','complete','blocked','unknown','cancelled','invalid')),
 reserved_micro INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micro>=0),
 actual_micro INTEGER CHECK(actual_micro>=0),
 input_tokens INTEGER,
 output_tokens INTEGER,
 provider_id TEXT,
 error_code TEXT,
 created_at TEXT NOT NULL,
 started_at TEXT,
 completed_at TEXT
);
CREATE INDEX manager_pending ON manager_jobs(state,created_at);
