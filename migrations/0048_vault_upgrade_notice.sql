-- Independent service-upgrade mail; never widens identity/security-mail consent or kinds.
CREATE TABLE vault_upgrade_releases (
 id TEXT PRIMARY KEY CHECK(id='private-vault-v1'),origin TEXT NOT NULL,
 template_version TEXT NOT NULL CHECK(template_version='vault-upgrade-en-v1'),created_at TEXT NOT NULL
);
CREATE TABLE vault_upgrade_outbox (
 id TEXT PRIMARY KEY CHECK(length(id)=32 AND id NOT GLOB '*[^0-9a-f]*'),
 release_id TEXT NOT NULL REFERENCES vault_upgrade_releases(id),
 recipient_hash TEXT NOT NULL CHECK(length(recipient_hash)=64 AND recipient_hash NOT GLOB '*[^0-9a-f]*'),
 unsubscribe_hash TEXT NOT NULL UNIQUE CHECK(length(unsubscribe_hash)=64 AND unsubscribe_hash NOT GLOB '*[^0-9a-f]*'),
 sources_json TEXT NOT NULL CHECK(json_valid(sources_json) AND json_type(sources_json)='array' AND json_array_length(sources_json) BETWEEN 1 AND 100),
 metadata_ciphertext TEXT NOT NULL,body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),
 state TEXT NOT NULL CHECK(state IN('pending','sending','sent','unknown','failed','blocked')),
 provider_id TEXT UNIQUE,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(release_id,recipient_hash)
);
CREATE INDEX vault_upgrade_outbox_state ON vault_upgrade_outbox(state,created_at,id);
CREATE TABLE vault_upgrade_dispatches (
 notice_id TEXT PRIMARY KEY REFERENCES vault_upgrade_outbox(id),
 event_tag TEXT NOT NULL UNIQUE CHECK(length(event_tag)=32 AND event_tag NOT GLOB '*[^0-9a-f]*'),
 body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),created_at TEXT NOT NULL
);
CREATE TABLE vault_upgrade_preferences (
 recipient_hash TEXT PRIMARY KEY CHECK(length(recipient_hash)=64 AND recipient_hash NOT GLOB '*[^0-9a-f]*'),
 notice_id TEXT NOT NULL REFERENCES vault_upgrade_outbox(id),created_at TEXT NOT NULL
);
CREATE TABLE vault_upgrade_delivery_receipts (
 source TEXT NOT NULL CHECK(source IN('webhook','readback')),receipt_id TEXT NOT NULL,
 notice_id TEXT NOT NULL REFERENCES vault_upgrade_dispatches(notice_id),provider_id TEXT NOT NULL,
 fact TEXT NOT NULL CHECK(fact IN('accepted','delivered','bounced','complained','failed','suppressed')),
 payload_hmac TEXT NOT NULL CHECK(length(payload_hmac)=64 AND payload_hmac NOT GLOB '*[^0-9a-f]*'),created_at TEXT NOT NULL,
 PRIMARY KEY(source,receipt_id)
);
CREATE TABLE vault_upgrade_audit (
 id TEXT PRIMARY KEY,release_id TEXT NOT NULL REFERENCES vault_upgrade_releases(id),
 notice_id TEXT REFERENCES vault_upgrade_outbox(id),action TEXT NOT NULL,detail_json TEXT NOT NULL CHECK(json_valid(detail_json) AND json_type(detail_json)='object'),created_at TEXT NOT NULL
);
CREATE TRIGGER vault_upgrade_dispatch_binding BEFORE INSERT ON vault_upgrade_dispatches WHEN NOT EXISTS(SELECT 1 FROM vault_upgrade_outbox WHERE id=NEW.notice_id AND id=NEW.event_tag AND body_digest=NEW.body_digest AND state='sending') BEGIN SELECT RAISE(ABORT,'vault-notice-dispatch-binding');END;
CREATE TRIGGER vault_upgrade_receipt_binding BEFORE INSERT ON vault_upgrade_delivery_receipts WHEN NOT EXISTS(SELECT 1 FROM vault_upgrade_outbox o JOIN vault_upgrade_dispatches d ON d.notice_id=o.id AND d.body_digest=o.body_digest WHERE o.id=NEW.notice_id AND (o.provider_id IS NULL OR o.provider_id=NEW.provider_id)) BEGIN SELECT RAISE(ABORT,'vault-notice-receipt-binding');END;
CREATE TRIGGER vault_upgrade_outbox_binding BEFORE UPDATE ON vault_upgrade_outbox WHEN NEW.id IS NOT OLD.id OR NEW.release_id IS NOT OLD.release_id OR NEW.recipient_hash IS NOT OLD.recipient_hash OR NEW.unsubscribe_hash IS NOT OLD.unsubscribe_hash OR NEW.sources_json IS NOT OLD.sources_json OR NEW.metadata_ciphertext IS NOT OLD.metadata_ciphertext OR NEW.body_digest IS NOT OLD.body_digest OR NEW.created_at IS NOT OLD.created_at OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS NOT OLD.provider_id) BEGIN SELECT RAISE(ABORT,'vault-notice-frozen');END;
CREATE TRIGGER vault_upgrade_state_binding BEFORE UPDATE ON vault_upgrade_outbox WHEN NOT(NEW.state=OLD.state OR (OLD.state='pending' AND NEW.state IN('sending','blocked')) OR (OLD.state='sending' AND NEW.state IN('sent','unknown','failed')) OR (OLD.state='unknown' AND NEW.state='sent')) BEGIN SELECT RAISE(ABORT,'vault-notice-state');END;
CREATE TRIGGER vault_upgrade_outbox_no_replace BEFORE INSERT ON vault_upgrade_outbox WHEN EXISTS(SELECT 1 FROM vault_upgrade_outbox WHERE id=NEW.id OR unsubscribe_hash=NEW.unsubscribe_hash OR (release_id=NEW.release_id AND recipient_hash=NEW.recipient_hash)) BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_outbox_permanent BEFORE DELETE ON vault_upgrade_outbox BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_releases_update_immutable BEFORE UPDATE ON vault_upgrade_releases BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_releases_delete_immutable BEFORE DELETE ON vault_upgrade_releases BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_releases_no_replace BEFORE INSERT ON vault_upgrade_releases WHEN EXISTS(SELECT 1 FROM vault_upgrade_releases WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_dispatches_update_immutable BEFORE UPDATE ON vault_upgrade_dispatches BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_dispatches_delete_immutable BEFORE DELETE ON vault_upgrade_dispatches BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_dispatches_no_replace BEFORE INSERT ON vault_upgrade_dispatches WHEN EXISTS(SELECT 1 FROM vault_upgrade_dispatches WHERE notice_id=NEW.notice_id OR event_tag=NEW.event_tag) BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_preferences_update_immutable BEFORE UPDATE ON vault_upgrade_preferences BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_preferences_delete_immutable BEFORE DELETE ON vault_upgrade_preferences BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_preferences_no_replace BEFORE INSERT ON vault_upgrade_preferences WHEN EXISTS(SELECT 1 FROM vault_upgrade_preferences WHERE recipient_hash=NEW.recipient_hash) BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_delivery_receipts_update_immutable BEFORE UPDATE ON vault_upgrade_delivery_receipts BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_delivery_receipts_delete_immutable BEFORE DELETE ON vault_upgrade_delivery_receipts BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_delivery_receipts_no_replace BEFORE INSERT ON vault_upgrade_delivery_receipts WHEN EXISTS(SELECT 1 FROM vault_upgrade_delivery_receipts WHERE source=NEW.source AND receipt_id=NEW.receipt_id) BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_audit_update_immutable BEFORE UPDATE ON vault_upgrade_audit BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_audit_delete_immutable BEFORE DELETE ON vault_upgrade_audit BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
CREATE TRIGGER vault_upgrade_audit_no_replace BEFORE INSERT ON vault_upgrade_audit WHEN EXISTS(SELECT 1 FROM vault_upgrade_audit WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'vault-notice-permanent');END;
