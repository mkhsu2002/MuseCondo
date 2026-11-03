-- Deterministic, append-only daily editions. No provider budget or mutable lease.
CREATE TABLE tower_daily_journal_jobs (
 day TEXT PRIMARY KEY,
 cutoff_at TEXT NOT NULL CHECK(cutoff_at=day||'T16:00:00.000Z'),
 observed_at TEXT NOT NULL,
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 missed_days INTEGER NOT NULL CHECK(missed_days>=0),
 actual_micro INTEGER NOT NULL DEFAULT 0 CHECK(actual_micro=0)
);
CREATE TABLE tower_daily_journal_editions (
 day TEXT PRIMARY KEY REFERENCES tower_daily_journal_jobs(day),
 selection_json TEXT NOT NULL CHECK(json_valid(selection_json) AND json_array_length(selection_json)<=3)
);
CREATE TABLE tower_daily_journal_audit (
 day TEXT PRIMARY KEY REFERENCES tower_daily_journal_editions(day),
 event TEXT NOT NULL CHECK(event='published'),
 observed_at TEXT NOT NULL,
 actual_micro INTEGER NOT NULL CHECK(actual_micro=0)
);
CREATE TRIGGER tower_daily_job_native BEFORE INSERT ON tower_daily_journal_jobs BEGIN
 SELECT CASE WHEN NEW.day=date(strftime('%Y-%m-%dT%H:%M:%fZ','now'),'-7 hours')
  AND NEW.cutoff_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND abs(julianday(NEW.observed_at)-julianday(strftime('%Y-%m-%dT%H:%M:%fZ','now')))<1.0/1440
  AND date(NEW.observed_at,'-7 hours')=NEW.day AND NEW.observed_at>=NEW.cutoff_at
  AND NOT EXISTS(SELECT 1 FROM tower_daily_journal_jobs WHERE day=NEW.day)
  THEN 1 ELSE RAISE(ABORT,'daily_clock_or_duplicate') END;
END;
CREATE TRIGGER tower_daily_job_no_update BEFORE UPDATE ON tower_daily_journal_jobs BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_job_no_delete BEFORE DELETE ON tower_daily_journal_jobs BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_edition_no_update BEFORE UPDATE ON tower_daily_journal_editions BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_edition_no_delete BEFORE DELETE ON tower_daily_journal_editions BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_edition_no_replace BEFORE INSERT ON tower_daily_journal_editions WHEN EXISTS(SELECT 1 FROM tower_daily_journal_editions WHERE day=NEW.day) BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_audit_no_update BEFORE UPDATE ON tower_daily_journal_audit BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_audit_no_delete BEFORE DELETE ON tower_daily_journal_audit BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_audit_no_replace BEFORE INSERT ON tower_daily_journal_audit WHEN EXISTS(SELECT 1 FROM tower_daily_journal_audit WHERE day=NEW.day) BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
