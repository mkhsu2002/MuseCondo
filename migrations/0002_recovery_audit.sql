-- Operator-only closure log. Never expose through public or resident APIs.
CREATE TABLE recovery_audit (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL UNIQUE REFERENCES generation_jobs(id),
 expected_updated_at TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('provider-confirmed-no-output','abandoned-unknown')),
 evidence_ref TEXT NOT NULL,
 operator_ref TEXT NOT NULL,
 attested INTEGER NOT NULL CHECK(attested=1),
 closed_at TEXT NOT NULL
);
