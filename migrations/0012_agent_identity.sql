-- Private provisional identity binding. Recovery and credential issuance are not configured here.
CREATE TABLE agent_identities (
 agent_id TEXT PRIMARY KEY NOT NULL CHECK(length(agent_id)=69 AND length(CAST(agent_id AS BLOB))=69 AND substr(agent_id,1,5)='mcid:' AND substr(agent_id,6) NOT GLOB '*[^0-9a-f]*'),
 account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id),
 room_id TEXT NOT NULL UNIQUE REFERENCES tower_residencies(room_id) CHECK(length(room_id)=16 AND length(CAST(room_id AS BLOB))=16 AND room_id NOT GLOB '*[^0-9a-f]*'),
 resident_id TEXT NOT NULL UNIQUE CHECK(length(resident_id)=16 AND length(CAST(resident_id AS BLOB))=16 AND resident_id NOT GLOB '*[^0-9a-f]*'),
 version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version)='integer' AND version>=1),
 authority_epoch INTEGER NOT NULL DEFAULT 1 CHECK(typeof(authority_epoch)='integer' AND authority_epoch>=1),
 state TEXT NOT NULL DEFAULT 'provisional' CHECK(state IN ('provisional','active','suspended','retired')),
 recovery_consent INTEGER NOT NULL CHECK(recovery_consent=1),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TRIGGER agent_identity_immutable_binding BEFORE UPDATE ON agent_identities
 WHEN NEW.agent_id IS NOT OLD.agent_id OR NEW.account_id IS NOT OLD.account_id OR NEW.room_id IS NOT OLD.room_id OR NEW.resident_id IS NOT OLD.resident_id OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'identity-binding-immutable'); END;
CREATE TABLE identity_requests (
 account_id TEXT NOT NULL REFERENCES accounts(id), request_key TEXT NOT NULL,
 operation TEXT NOT NULL, input_hash TEXT NOT NULL, response_json TEXT NOT NULL,
 status INTEGER NOT NULL CHECK(status=201), created_at TEXT NOT NULL,
 PRIMARY KEY(account_id,request_key)
);
CREATE TABLE identity_audit (
 id TEXT PRIMARY KEY NOT NULL, agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),
 action TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX identity_audit_agent ON identity_audit(agent_id,created_at);

-- Permanent per-input rate reservations: a successful concurrent retry never consumes quota twice.
CREATE TABLE identity_rate_attempts (
 account_id TEXT NOT NULL REFERENCES accounts(id), request_key TEXT NOT NULL,
 input_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(account_id,request_key)
);
