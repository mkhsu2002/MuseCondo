-- Preserve existing immutable editions and audit exactly; only future editions may contain four entries.
-- Run as one migration transaction with foreign keys enabled; drop the referencing child before its parent.
CREATE TABLE migration_0045_editions AS SELECT * FROM tower_daily_journal_editions;
CREATE TABLE migration_0045_audit AS SELECT * FROM tower_daily_journal_audit;
DROP TABLE tower_daily_journal_audit;
DROP TABLE tower_daily_journal_editions;
CREATE TABLE tower_daily_journal_editions (
 day TEXT PRIMARY KEY REFERENCES tower_daily_journal_jobs(day),
 selection_json TEXT NOT NULL CHECK(json_valid(selection_json) AND json_array_length(selection_json)<=4)
);
CREATE TABLE tower_daily_journal_audit (
 day TEXT PRIMARY KEY REFERENCES tower_daily_journal_editions(day),
 event TEXT NOT NULL CHECK(event='published'),
 observed_at TEXT NOT NULL,
 actual_micro INTEGER NOT NULL CHECK(actual_micro=0)
);
INSERT INTO tower_daily_journal_editions SELECT * FROM migration_0045_editions;
INSERT INTO tower_daily_journal_audit SELECT * FROM migration_0045_audit;
CREATE TRIGGER tower_daily_edition_no_update BEFORE UPDATE ON tower_daily_journal_editions BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_edition_no_delete BEFORE DELETE ON tower_daily_journal_editions BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_edition_no_replace BEFORE INSERT ON tower_daily_journal_editions WHEN EXISTS(SELECT 1 FROM tower_daily_journal_editions WHERE day=NEW.day) BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_audit_no_update BEFORE UPDATE ON tower_daily_journal_audit BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_audit_no_delete BEFORE DELETE ON tower_daily_journal_audit BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
CREATE TRIGGER tower_daily_audit_no_replace BEFORE INSERT ON tower_daily_journal_audit WHEN EXISTS(SELECT 1 FROM tower_daily_journal_audit WHERE day=NEW.day) BEGIN SELECT RAISE(ABORT,'daily_immutable'); END;
DROP TABLE migration_0045_audit;
DROP TABLE migration_0045_editions;
