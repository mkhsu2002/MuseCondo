-- Private first-guardian designation and event-driven transactional mail.
CREATE TABLE identity_guardian_invites (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=32 AND length(CAST(id AS BLOB))=32 AND id NOT GLOB '*[^0-9a-f]*'),
 agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id), account_id TEXT NOT NULL REFERENCES accounts(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version)='integer' AND version>=1),
 identity_version INTEGER NOT NULL CHECK(typeof(identity_version)='integer' AND identity_version>=1),
 authority_epoch INTEGER NOT NULL CHECK(typeof(authority_epoch)='integer' AND authority_epoch>=1),
 state TEXT NOT NULL CHECK(state IN ('proposed','accepted','registered','cancelled')),
 recipient_ciphertext TEXT NOT NULL, email_hash TEXT NOT NULL CHECK(length(email_hash)=64 AND email_hash NOT GLOB '*[^0-9a-f]*'),
 invite_token_hash TEXT CHECK(invite_token_hash IS NULL OR (length(invite_token_hash)=64 AND invite_token_hash NOT GLOB '*[^0-9a-f]*')),
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(state NOT IN ('accepted','registered') OR invite_token_hash IS NOT NULL),
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at)=expires_at),
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+24 hours') IS NOT NULL AND expires_at>created_at AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+24 hours'))
);
CREATE UNIQUE INDEX identity_guardian_one_active ON identity_guardian_invites(agent_id) WHERE state IN ('proposed','accepted','registered');
CREATE INDEX identity_guardian_account ON identity_guardian_invites(account_id,created_at);
CREATE TRIGGER identity_guardian_immutable_binding BEFORE UPDATE ON identity_guardian_invites
 WHEN NEW.id IS NOT OLD.id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.account_id IS NOT OLD.account_id OR NEW.recipient_ciphertext IS NOT OLD.recipient_ciphertext OR NEW.email_hash IS NOT OLD.email_hash OR NEW.authority_epoch IS NOT OLD.authority_epoch OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'guardian-binding-immutable'); END;
CREATE TRIGGER identity_guardian_account_binding BEFORE INSERT ON identity_guardian_invites
 WHEN NOT EXISTS(SELECT 1 FROM agent_identities WHERE agent_id=NEW.agent_id AND account_id=NEW.account_id)
 BEGIN SELECT RAISE(ABORT,'guardian-account-mismatch'); END;
CREATE TABLE guardian_invite_requests (
 scope TEXT NOT NULL, request_key TEXT NOT NULL, operation TEXT NOT NULL,
 input_hash TEXT NOT NULL, response_json TEXT NOT NULL, status INTEGER NOT NULL CHECK(status IN (200,201)), created_at TEXT NOT NULL,
 PRIMARY KEY(scope,request_key)
);
CREATE TABLE guardian_invite_rate_attempts (
 scope TEXT NOT NULL, request_key TEXT NOT NULL, input_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(scope,request_key)
);
CREATE TABLE identity_mail_events (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=32 AND length(CAST(id AS BLOB))=32 AND id NOT GLOB '*[^0-9a-f]*'),
 kind TEXT NOT NULL CHECK(kind IN ('guardian-invitation','identity-card','security-notice')),
 entity_id TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
 recipient_ciphertext TEXT NOT NULL, recipient_hash TEXT NOT NULL CHECK(length(recipient_hash)=64 AND recipient_hash NOT GLOB '*[^0-9a-f]*'),
 payload_ciphertext TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','failed','unknown','cancelled','delivered','bounced')),
 provider_id TEXT, attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(attempt_count)='integer' AND attempt_count>=0),
 error_code TEXT, lease_started_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(kind,entity_id,recipient_hash)
);
CREATE INDEX identity_mail_state ON identity_mail_events(state,created_at);
CREATE TABLE identity_mail_audit (
 id TEXT PRIMARY KEY NOT NULL, event_id TEXT NOT NULL REFERENCES identity_mail_events(id),
 action TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX identity_mail_audit_event ON identity_mail_audit(event_id,created_at);
