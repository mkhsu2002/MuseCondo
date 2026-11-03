-- Weekly publication and notification intent are separate, permanent records.
CREATE TABLE tower_weekly_jobs(
 id TEXT PRIMARY KEY REFERENCES manager_jobs(id),period_key TEXT NOT NULL UNIQUE,
 period_start TEXT NOT NULL,cutoff_at TEXT NOT NULL,recipient_hash TEXT NOT NULL CHECK(length(recipient_hash)=64 AND recipient_hash NOT GLOB '*[^0-9a-f]*'),
 inaugural INTEGER NOT NULL CHECK(inaugural IN(0,1)),source_digest TEXT,source_json TEXT CHECK(source_json IS NULL OR json_valid(source_json)),lease_until TEXT,
 created_at TEXT NOT NULL,CHECK(julianday(period_start)<julianday(cutoff_at))
);
CREATE UNIQUE INDEX tower_weekly_inaugural ON tower_weekly_jobs(inaugural) WHERE inaugural=1;
CREATE TABLE tower_weekly_issues(
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL UNIQUE REFERENCES tower_weekly_jobs(id),number INTEGER NOT NULL UNIQUE CHECK(number>0),period_key TEXT NOT NULL UNIQUE,
 issue_json TEXT NOT NULL CHECK(json_valid(issue_json)),selection_json TEXT NOT NULL CHECK(json_valid(selection_json)),source_digest TEXT NOT NULL,published_at TEXT NOT NULL
);
CREATE TABLE tower_weekly_outbox(
 id TEXT PRIMARY KEY,issue_id TEXT NOT NULL REFERENCES tower_weekly_issues(id),recipient_hash TEXT NOT NULL CHECK(length(recipient_hash)=64 AND recipient_hash NOT GLOB '*[^0-9a-f]*'),
 state TEXT NOT NULL CHECK(state IN('pending','dispatching','sent','delivered','failed','unknown')),provider_id TEXT,idempotency_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,dispatching_at TEXT,sent_at TEXT,delivered_at TEXT,failed_at TEXT,lease_until TEXT,error_code TEXT,
 UNIQUE(issue_id,recipient_hash)
);
CREATE TABLE tower_weekly_audit(id TEXT PRIMARY KEY,issue_id TEXT REFERENCES tower_weekly_issues(id),job_id TEXT REFERENCES tower_weekly_jobs(id),kind TEXT NOT NULL,detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),created_at TEXT NOT NULL);
CREATE TRIGGER tower_weekly_job_binding BEFORE UPDATE ON tower_weekly_jobs WHEN NEW.id!=OLD.id OR NEW.period_key!=OLD.period_key OR NEW.period_start!=OLD.period_start OR NEW.cutoff_at!=OLD.cutoff_at OR NEW.recipient_hash!=OLD.recipient_hash OR NEW.inaugural!=OLD.inaugural OR NEW.created_at!=OLD.created_at OR (OLD.source_digest IS NOT NULL AND (NEW.source_digest IS NOT OLD.source_digest OR NEW.source_json IS NOT OLD.source_json)) BEGIN SELECT RAISE(ABORT,'weekly_job_immutable'); END;
CREATE TRIGGER tower_weekly_receipt_binding BEFORE UPDATE ON manager_jobs WHEN EXISTS(SELECT 1 FROM tower_weekly_jobs WHERE id=OLD.id) AND (NEW.id!=OLD.id OR NEW.source_digest!=OLD.source_digest OR NEW.created_at!=OLD.created_at OR OLD.state NOT IN('pending','running') OR (OLD.state='running' AND (NEW.state='pending' OR NEW.reserved_micro!=OLD.reserved_micro OR NEW.started_at IS NOT OLD.started_at)) OR (OLD.actual_micro IS NOT NULL AND (NEW.actual_micro IS NOT OLD.actual_micro OR NEW.input_tokens IS NOT OLD.input_tokens OR NEW.output_tokens IS NOT OLD.output_tokens OR NEW.provider_id IS NOT OLD.provider_id))) BEGIN SELECT RAISE(ABORT,'weekly_receipt_immutable'); END;
CREATE TRIGGER tower_weekly_receipt_delete BEFORE DELETE ON manager_jobs WHEN EXISTS(SELECT 1 FROM tower_weekly_jobs WHERE id=OLD.id) BEGIN SELECT RAISE(ABORT,'weekly_receipt_permanent'); END;
CREATE TRIGGER tower_weekly_receipt_replace BEFORE INSERT ON manager_jobs WHEN EXISTS(SELECT 1 FROM tower_weekly_jobs WHERE id=NEW.id OR id=NEW.source_digest) BEGIN SELECT RAISE(ABORT,'weekly_receipt_permanent'); END;
CREATE TRIGGER tower_weekly_issue_scope BEFORE INSERT ON tower_weekly_issues WHEN NOT EXISTS(SELECT 1 FROM tower_weekly_jobs w JOIN manager_jobs j ON j.id=w.id WHERE w.id=NEW.job_id AND w.period_key=NEW.period_key AND w.source_digest=NEW.source_digest AND j.state='running' AND j.provider_id IS NOT NULL AND j.actual_micro IS NOT NULL AND j.actual_micro<=j.reserved_micro AND w.lease_until>NEW.published_at AND w.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND abs(julianday(NEW.published_at)-julianday('now'))<1.0/1440 AND json_extract(NEW.issue_json,'$.id')=NEW.id AND json_extract(NEW.issue_json,'$.number')=NEW.number AND json_extract(NEW.issue_json,'$.periodKey')=NEW.period_key AND json_extract(NEW.issue_json,'$.cutoffAt')=w.cutoff_at AND json_extract(NEW.issue_json,'$.periodStart')=w.period_start AND json_extract(NEW.issue_json,'$.publishedAt')=NEW.published_at) BEGIN SELECT RAISE(ABORT,'weekly_issue_scope'); END;
CREATE TRIGGER tower_weekly_outbox_scope BEFORE INSERT ON tower_weekly_outbox WHEN NOT EXISTS(SELECT 1 FROM tower_weekly_issues i JOIN tower_weekly_jobs w ON w.id=i.job_id WHERE i.id=NEW.issue_id AND w.recipient_hash=NEW.recipient_hash AND NEW.state='pending' AND NEW.provider_id IS NULL AND NEW.idempotency_key='tower-weekly:'||i.id||':'||NEW.recipient_hash) BEGIN SELECT RAISE(ABORT,'weekly_outbox_scope'); END;
CREATE TRIGGER tower_weekly_outbox_binding BEFORE UPDATE ON tower_weekly_outbox WHEN NEW.id!=OLD.id OR NEW.issue_id!=OLD.issue_id OR NEW.recipient_hash!=OLD.recipient_hash OR NEW.idempotency_key!=OLD.idempotency_key OR NEW.created_at!=OLD.created_at OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS NOT OLD.provider_id) OR NOT ((OLD.state='pending' AND NEW.state IN('dispatching','failed')) OR (OLD.state='dispatching' AND NEW.state IN('sent','failed','unknown')) OR (OLD.state='sent' AND NEW.state IN('delivered','failed')) OR (OLD.state='unknown' AND NEW.state IN('sent','delivered','failed'))) BEGIN SELECT RAISE(ABORT,'weekly_outbox_transition'); END;
CREATE TRIGGER tower_weekly_jobs_delete BEFORE DELETE ON tower_weekly_jobs BEGIN SELECT RAISE(ABORT,'weekly_permanent'); END;
CREATE TRIGGER tower_weekly_jobs_replace BEFORE INSERT ON tower_weekly_jobs WHEN EXISTS(SELECT 1 FROM tower_weekly_jobs WHERE id=NEW.id OR period_key=NEW.period_key OR (inaugural=1 AND NEW.inaugural=1)) BEGIN SELECT RAISE(ABORT,'weekly_permanent'); END;
CREATE TRIGGER tower_weekly_issues_delete BEFORE DELETE ON tower_weekly_issues BEGIN SELECT RAISE(ABORT,'weekly_permanent'); END;
CREATE TRIGGER tower_weekly_issues_replace BEFORE INSERT ON tower_weekly_issues WHEN EXISTS(SELECT 1 FROM tower_weekly_issues WHERE id=NEW.id OR job_id=NEW.job_id OR number=NEW.number OR period_key=NEW.period_key) BEGIN SELECT RAISE(ABORT,'weekly_permanent'); END;
CREATE TRIGGER tower_weekly_outbox_delete BEFORE DELETE ON tower_weekly_outbox BEGIN SELECT RAISE(ABORT,'weekly_permanent'); END;
CREATE TRIGGER tower_weekly_outbox_replace BEFORE INSERT ON tower_weekly_outbox WHEN EXISTS(SELECT 1 FROM tower_weekly_outbox WHERE id=NEW.id OR idempotency_key=NEW.idempotency_key OR (issue_id=NEW.issue_id AND recipient_hash=NEW.recipient_hash)) BEGIN SELECT RAISE(ABORT,'weekly_permanent'); END;
CREATE TRIGGER tower_weekly_audit_delete BEFORE DELETE ON tower_weekly_audit BEGIN SELECT RAISE(ABORT,'weekly_permanent'); END;
CREATE TRIGGER tower_weekly_audit_replace BEFORE INSERT ON tower_weekly_audit WHEN EXISTS(SELECT 1 FROM tower_weekly_audit WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'weekly_permanent'); END;
CREATE TRIGGER tower_weekly_issues_immutable BEFORE UPDATE ON tower_weekly_issues BEGIN SELECT RAISE(ABORT,'weekly_immutable'); END;
CREATE TRIGGER tower_weekly_audit_immutable BEFORE UPDATE ON tower_weekly_audit BEGIN SELECT RAISE(ABORT,'weekly_immutable'); END;
CREATE TRIGGER tower_weekly_outbox_audit AFTER UPDATE ON tower_weekly_outbox BEGIN
 INSERT INTO tower_weekly_audit(id,issue_id,job_id,kind,detail_json,created_at)
 SELECT lower(hex(randomblob(16))),NEW.issue_id,i.job_id,'notification-state',json_object('from',OLD.state,'to',NEW.state),NEW.updated_at FROM tower_weekly_issues i WHERE i.id=NEW.issue_id;
END;
