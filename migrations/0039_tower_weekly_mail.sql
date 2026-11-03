-- Publication mail owns its frozen envelope, permanent POST receipt and delivery facts.
CREATE TABLE tower_weekly_mail_dispatches(outbox_id TEXT PRIMARY KEY REFERENCES tower_weekly_outbox(id),event_tag TEXT NOT NULL UNIQUE,metadata_ciphertext TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE tower_weekly_mail_facts(receipt_id TEXT PRIMARY KEY,outbox_id TEXT NOT NULL REFERENCES tower_weekly_outbox(id),provider_id TEXT NOT NULL,fact TEXT NOT NULL CHECK(fact IN('sent','delivered','failed')),payload_hmac TEXT NOT NULL,observed_at TEXT NOT NULL);
CREATE TABLE tower_weekly_mail_probes(nonce TEXT PRIMARY KEY,origin TEXT NOT NULL,day TEXT NOT NULL,secret_ciphertext TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,UNIQUE(origin,day));
CREATE TABLE tower_weekly_mail_recovery(origin TEXT NOT NULL,day TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(origin,day));
CREATE TRIGGER tower_weekly_mail_dispatch_scope BEFORE INSERT ON tower_weekly_mail_dispatches WHEN NOT EXISTS(SELECT 1 FROM tower_weekly_outbox WHERE id=NEW.outbox_id AND state='dispatching') BEGIN SELECT RAISE(ABORT,'weekly_mail_dispatch_scope'); END;
CREATE TRIGGER tower_weekly_mail_dispatch_immutable BEFORE UPDATE ON tower_weekly_mail_dispatches BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
CREATE TRIGGER tower_weekly_mail_dispatch_delete BEFORE DELETE ON tower_weekly_mail_dispatches BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
CREATE TRIGGER tower_weekly_mail_dispatch_replace BEFORE INSERT ON tower_weekly_mail_dispatches WHEN EXISTS(SELECT 1 FROM tower_weekly_mail_dispatches WHERE outbox_id=NEW.outbox_id OR event_tag=NEW.event_tag) BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
CREATE TRIGGER tower_weekly_mail_fact_immutable BEFORE UPDATE ON tower_weekly_mail_facts BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
CREATE TRIGGER tower_weekly_mail_fact_delete BEFORE DELETE ON tower_weekly_mail_facts BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
CREATE TRIGGER tower_weekly_mail_fact_replace BEFORE INSERT ON tower_weekly_mail_facts WHEN EXISTS(SELECT 1 FROM tower_weekly_mail_facts WHERE receipt_id=NEW.receipt_id) BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
CREATE TRIGGER tower_weekly_mail_probe_binding BEFORE UPDATE ON tower_weekly_mail_probes WHEN NEW.nonce!=OLD.nonce OR NEW.origin!=OLD.origin OR NEW.day!=OLD.day OR NEW.secret_ciphertext!=OLD.secret_ciphertext OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL BEGIN SELECT RAISE(ABORT,'weekly_mail_probe_permanent'); END;
CREATE TRIGGER tower_weekly_mail_probe_delete BEFORE DELETE ON tower_weekly_mail_probes BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
CREATE TRIGGER tower_weekly_mail_probe_replace BEFORE INSERT ON tower_weekly_mail_probes WHEN EXISTS(SELECT 1 FROM tower_weekly_mail_probes WHERE nonce=NEW.nonce OR (origin=NEW.origin AND day=NEW.day)) BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
CREATE TRIGGER tower_weekly_mail_recovery_update BEFORE UPDATE ON tower_weekly_mail_recovery BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
CREATE TRIGGER tower_weekly_mail_recovery_delete BEFORE DELETE ON tower_weekly_mail_recovery BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
CREATE TRIGGER tower_weekly_mail_recovery_replace BEFORE INSERT ON tower_weekly_mail_recovery WHEN EXISTS(SELECT 1 FROM tower_weekly_mail_recovery WHERE origin=NEW.origin AND day=NEW.day) BEGIN SELECT RAISE(ABORT,'weekly_mail_permanent'); END;
