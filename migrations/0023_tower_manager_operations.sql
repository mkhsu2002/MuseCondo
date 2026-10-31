-- Bounded appearance and deployment-native calendar ledger. No resident data.
CREATE TABLE tower_appearance_state (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0),
 theme TEXT NOT NULL CHECK(theme IN ('standard','halloween')),
 starts_at TEXT, ends_at TEXT, timezone TEXT NOT NULL CHECK(timezone='America/Vancouver'),
 CHECK((theme='standard' AND starts_at IS NULL AND ends_at IS NULL) OR
       (theme='halloween' AND starts_at IS NOT NULL AND ends_at>starts_at))
);
INSERT INTO tower_appearance_state VALUES(1,0,'standard',NULL,NULL,'America/Vancouver');
CREATE TABLE tower_appearance_audit (
 request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('preview','activate','rollback','expire')),
 actor TEXT NOT NULL CHECK(actor IN ('operator','scheduler')), revision INTEGER,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)), created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX tower_appearance_revision ON tower_appearance_audit(revision) WHERE revision IS NOT NULL;
CREATE TRIGGER tower_appearance_audit_immutable_update BEFORE UPDATE ON tower_appearance_audit BEGIN SELECT RAISE(ABORT,'appearance_audit_immutable'); END;
CREATE TRIGGER tower_appearance_audit_immutable_delete BEFORE DELETE ON tower_appearance_audit BEGIN SELECT RAISE(ABORT,'appearance_audit_immutable'); END;
CREATE TRIGGER tower_appearance_state_guard BEFORE UPDATE ON tower_appearance_state
 WHEN NEW.revision!=OLD.revision+1 OR NOT EXISTS (
 SELECT 1 FROM tower_appearance_audit WHERE revision=NEW.revision
 AND json_extract(snapshot_json,'$.theme')=NEW.theme
 AND json_extract(snapshot_json,'$.startsAt') IS NEW.starts_at AND json_extract(snapshot_json,'$.endsAt') IS NEW.ends_at
 ) BEGIN SELECT RAISE(ABORT,'appearance_revision_guard'); END;
CREATE TRIGGER tower_appearance_state_permanent BEFORE DELETE ON tower_appearance_state BEGIN SELECT RAISE(ABORT,'appearance_state_permanent'); END;
CREATE TABLE tower_manager_runs (
 run_key TEXT PRIMARY KEY, job TEXT NOT NULL, period TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','complete','failed','abandoned')), attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 2),
 lease_until TEXT NOT NULL, result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 error_code TEXT, created_at TEXT NOT NULL, completed_at TEXT,
 UNIQUE(job,period)
);
CREATE TRIGGER tower_manager_runs_binding BEFORE UPDATE ON tower_manager_runs
 WHEN NEW.run_key!=OLD.run_key OR NEW.job!=OLD.job OR NEW.period!=OLD.period OR NEW.created_at!=OLD.created_at
 BEGIN SELECT RAISE(ABORT,'manager_run_binding_immutable'); END;
CREATE TRIGGER tower_manager_runs_permanent BEFORE DELETE ON tower_manager_runs BEGIN SELECT RAISE(ABORT,'manager_run_permanent'); END;
