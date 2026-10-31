-- Private dispatch ledger. Deploy with 0020, coordinator and Pages as one release.
CREATE TABLE identity_mail_dispatches (
 event_id TEXT PRIMARY KEY NOT NULL REFERENCES identity_mail_envelopes(event_id),
 lease_id TEXT NOT NULL UNIQUE CHECK(length(lease_id)=32 AND length(CAST(lease_id AS BLOB))=32 AND lease_id NOT GLOB '*[^0-9a-f]*'),
 body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND length(CAST(body_digest AS BLOB))=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),
 body_length INTEGER NOT NULL CHECK(typeof(body_length)='integer' AND body_length BETWEEN 1 AND 12582912),
 created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)
);
CREATE TRIGGER identity_mail_dispatch_binding BEFORE INSERT ON identity_mail_dispatches
 WHEN NOT EXISTS(SELECT 1 FROM identity_mail_events e JOIN identity_mail_envelopes v ON v.event_id=e.id WHERE e.id=NEW.event_id AND e.state='pending' AND e.attempt_count=0 AND v.body_digest=NEW.body_digest AND v.body_length=NEW.body_length)
 BEGIN SELECT RAISE(ABORT,'mail-dispatch-binding'); END;
CREATE TRIGGER identity_mail_dispatch_immutable BEFORE UPDATE ON identity_mail_dispatches BEGIN SELECT RAISE(ABORT,'mail-dispatch-immutable'); END;
CREATE TRIGGER identity_mail_dispatch_permanent BEFORE DELETE ON identity_mail_dispatches BEGIN SELECT RAISE(ABORT,'mail-dispatch-permanent'); END;
CREATE TABLE identity_mail_finish_receipts (
 event_id TEXT PRIMARY KEY NOT NULL REFERENCES identity_mail_dispatches(event_id),
 lease_id TEXT NOT NULL UNIQUE REFERENCES identity_mail_dispatches(lease_id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(CAST(payload_json AS BLOB))<=1024),
 created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)
);
CREATE TRIGGER identity_mail_finish_binding BEFORE INSERT ON identity_mail_finish_receipts
 WHEN NOT EXISTS(SELECT 1 FROM identity_mail_dispatches WHERE event_id=NEW.event_id AND lease_id=NEW.lease_id)
 BEGIN SELECT RAISE(ABORT,'mail-finish-binding'); END;
CREATE TRIGGER identity_mail_finish_immutable BEFORE UPDATE ON identity_mail_finish_receipts BEGIN SELECT RAISE(ABORT,'mail-finish-immutable'); END;
CREATE TRIGGER identity_mail_finish_permanent BEFORE DELETE ON identity_mail_finish_receipts BEGIN SELECT RAISE(ABORT,'mail-finish-permanent'); END;
CREATE TABLE identity_mail_suppressions (
 recipient_hash TEXT PRIMARY KEY NOT NULL CHECK(length(recipient_hash)=64 AND length(CAST(recipient_hash AS BLOB))=64 AND recipient_hash NOT GLOB '*[^0-9a-f]*'),
 reason TEXT NOT NULL CHECK(reason IN ('bounce','complaint','manual')),
 created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)
);
CREATE TRIGGER identity_mail_suppression_immutable BEFORE UPDATE ON identity_mail_suppressions BEGIN SELECT RAISE(ABORT,'mail-suppression-immutable'); END;
CREATE TRIGGER identity_mail_suppression_permanent BEFORE DELETE ON identity_mail_suppressions BEGIN SELECT RAISE(ABORT,'mail-suppression-permanent'); END;
CREATE UNIQUE INDEX identity_mail_suppression_audit_once ON identity_mail_audit(event_id) WHERE action='suppressed';
CREATE UNIQUE INDEX identity_mail_dispatch_audit_once ON identity_mail_audit(event_id) WHERE action='sending';
CREATE UNIQUE INDEX identity_mail_finish_audit_once ON identity_mail_audit(event_id) WHERE action='dispatch-finished';
CREATE TRIGGER identity_mail_dispatch_audit_immutable BEFORE UPDATE ON identity_mail_audit
 WHEN OLD.action IN ('sending','dispatch-finished','suppressed') OR NEW.action IN ('sending','dispatch-finished','suppressed')
 BEGIN SELECT RAISE(ABORT,'mail-dispatch-audit-immutable'); END;
CREATE TRIGGER identity_mail_dispatch_audit_permanent BEFORE DELETE ON identity_mail_audit
 WHEN OLD.action IN ('sending','dispatch-finished','suppressed')
 BEGIN SELECT RAISE(ABORT,'mail-dispatch-audit-permanent'); END;
