-- Deployment-only webhook setup and bounded manual reconciliation. No provider secret is returned to an operator.
CREATE TABLE identity_mail_webhook_setups (
 origin TEXT PRIMARY KEY,endpoint TEXT NOT NULL UNIQUE,setup_request_key TEXT NOT NULL,lease_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('intent','creating','unknown','ready','blocked')),
 provider_id TEXT UNIQUE,secret_ciphertext TEXT,handler_probe_at TEXT,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 CHECK(state!='ready' OR (provider_id IS NOT NULL AND secret_ciphertext IS NOT NULL))
);
CREATE TABLE identity_mail_control_requests (
 request_key TEXT PRIMARY KEY,origin TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('setup','reconcile','event-reconcile','probe')),
 event_id TEXT,input_hmac TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE identity_mail_control_results (
 request_key TEXT PRIMARY KEY REFERENCES identity_mail_control_requests(request_key),result_json TEXT NOT NULL,status INTEGER NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE identity_mail_control_audit (
 id TEXT PRIMARY KEY,request_key TEXT NOT NULL REFERENCES identity_mail_control_requests(request_key),action TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE identity_mail_handler_probes (
 nonce TEXT PRIMARY KEY,origin TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE REFERENCES identity_mail_control_requests(request_key),expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL
);
CREATE TRIGGER identity_mail_webhook_binding BEFORE UPDATE ON identity_mail_webhook_setups WHEN NEW.origin!=OLD.origin OR NEW.endpoint!=OLD.endpoint OR NEW.setup_request_key!=OLD.setup_request_key OR NEW.lease_id!=OLD.lease_id OR NEW.created_at!=OLD.created_at OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS NOT OLD.provider_id) OR (OLD.secret_ciphertext IS NOT NULL AND NEW.secret_ciphertext IS NOT OLD.secret_ciphertext) BEGIN SELECT RAISE(ABORT,'mail-webhook-binding');END;
CREATE TRIGGER identity_mail_webhook_permanent BEFORE DELETE ON identity_mail_webhook_setups BEGIN SELECT RAISE(ABORT,'mail-control-permanent');END;
CREATE TRIGGER identity_mail_control_request_immutable BEFORE UPDATE ON identity_mail_control_requests BEGIN SELECT RAISE(ABORT,'mail-control-immutable');END;
CREATE TRIGGER identity_mail_control_request_permanent BEFORE DELETE ON identity_mail_control_requests BEGIN SELECT RAISE(ABORT,'mail-control-permanent');END;
CREATE TRIGGER identity_mail_control_result_immutable BEFORE UPDATE ON identity_mail_control_results BEGIN SELECT RAISE(ABORT,'mail-control-immutable');END;
CREATE TRIGGER identity_mail_control_result_permanent BEFORE DELETE ON identity_mail_control_results BEGIN SELECT RAISE(ABORT,'mail-control-permanent');END;
CREATE TRIGGER identity_mail_control_audit_immutable BEFORE UPDATE ON identity_mail_control_audit BEGIN SELECT RAISE(ABORT,'mail-control-immutable');END;
CREATE TRIGGER identity_mail_control_audit_permanent BEFORE DELETE ON identity_mail_control_audit BEGIN SELECT RAISE(ABORT,'mail-control-permanent');END;
CREATE TRIGGER identity_mail_probe_binding BEFORE UPDATE ON identity_mail_handler_probes WHEN NEW.nonce!=OLD.nonce OR NEW.origin!=OLD.origin OR NEW.request_key!=OLD.request_key OR NEW.expires_at!=OLD.expires_at OR NEW.created_at!=OLD.created_at OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL BEGIN SELECT RAISE(ABORT,'mail-control-immutable');END;
CREATE TRIGGER identity_mail_probe_permanent BEFORE DELETE ON identity_mail_handler_probes BEGIN SELECT RAISE(ABORT,'mail-control-permanent');END;
CREATE TRIGGER identity_mail_webhook_setups_insert_once BEFORE INSERT ON identity_mail_webhook_setups WHEN EXISTS(SELECT 1 FROM identity_mail_webhook_setups WHERE origin=NEW.origin) BEGIN SELECT RAISE(ABORT,'mail-control-replace');END;
CREATE TRIGGER identity_mail_control_requests_insert_once BEFORE INSERT ON identity_mail_control_requests WHEN EXISTS(SELECT 1 FROM identity_mail_control_requests WHERE request_key=NEW.request_key) BEGIN SELECT RAISE(ABORT,'mail-control-replace');END;
CREATE TRIGGER identity_mail_control_results_insert_once BEFORE INSERT ON identity_mail_control_results WHEN EXISTS(SELECT 1 FROM identity_mail_control_results WHERE request_key=NEW.request_key) BEGIN SELECT RAISE(ABORT,'mail-control-replace');END;
CREATE TRIGGER identity_mail_control_audit_insert_once BEFORE INSERT ON identity_mail_control_audit WHEN EXISTS(SELECT 1 FROM identity_mail_control_audit WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'mail-control-replace');END;
CREATE TRIGGER identity_mail_handler_probes_insert_once BEFORE INSERT ON identity_mail_handler_probes WHEN EXISTS(SELECT 1 FROM identity_mail_handler_probes WHERE nonce=NEW.nonce) BEGIN SELECT RAISE(ABORT,'mail-control-replace');END;
