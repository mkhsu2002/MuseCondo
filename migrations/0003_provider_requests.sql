CREATE TABLE provider_requests (
 id TEXT PRIMARY KEY, provider_key TEXT NOT NULL, stage TEXT NOT NULL,
 model TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('started','received','unknown')),
 started_at TEXT NOT NULL, finished_at TEXT, provider_request_id TEXT,
 UNIQUE(provider_key,stage)
);
