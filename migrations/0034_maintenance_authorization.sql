-- Separate operational credentials from identity continuation and Guardian recovery.
CREATE TABLE maintenance_authorities (
 account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id),
 version INTEGER NOT NULL DEFAULT 0 CHECK(typeof(version)='integer' AND version>=0)
);
CREATE TABLE maintenance_requests (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=32 AND id NOT GLOB '*[^0-9a-f]*'),
 agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),
 account_id TEXT NOT NULL REFERENCES accounts(id),
 guardian_id TEXT NOT NULL REFERENCES identity_guardians(guardian_id),
 guardian_version INTEGER NOT NULL,identity_version INTEGER NOT NULL,authority_epoch INTEGER NOT NULL,maintenance_version INTEGER NOT NULL,
 candidate_hash TEXT NOT NULL UNIQUE CHECK(length(candidate_hash)=64 AND candidate_hash NOT GLOB '*[^0-9a-f]*'),
 candidate_offline_hash TEXT NOT NULL,
 request_key TEXT NOT NULL,input_hash TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('handover','renewal')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved')),
 token_id TEXT REFERENCES tower_tokens(id),approved_at TEXT,credential_expires_at TEXT,
 completion_key TEXT,completion_hash TEXT,
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+1 hour')),
 CHECK((state='pending' AND token_id IS NULL AND approved_at IS NULL AND credential_expires_at IS NULL AND completion_key IS NULL AND completion_hash IS NULL) OR (state='approved' AND token_id IS NOT NULL AND approved_at IS NOT NULL AND credential_expires_at IS NOT NULL AND completion_key IS NOT NULL AND completion_hash IS NOT NULL))
);
CREATE INDEX maintenance_requests_agent ON maintenance_requests(agent_id,state,expires_at);
CREATE TABLE maintenance_challenges (
 id TEXT PRIMARY KEY NOT NULL,request_id TEXT NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL,input_hash TEXT NOT NULL,options_json TEXT NOT NULL CHECK(json_valid(options_json)),
 credential_id TEXT,public_key TEXT,webauthn_user_id TEXT,
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,
 UNIQUE(request_id,request_key),
 CHECK(expires_at>created_at AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+5 minutes'))
);
CREATE TRIGGER maintenance_request_binding BEFORE UPDATE ON maintenance_requests
 WHEN NEW.id IS NOT OLD.id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.account_id IS NOT OLD.account_id OR NEW.guardian_id IS NOT OLD.guardian_id OR NEW.guardian_version IS NOT OLD.guardian_version OR NEW.identity_version IS NOT OLD.identity_version OR NEW.authority_epoch IS NOT OLD.authority_epoch OR NEW.maintenance_version IS NOT OLD.maintenance_version OR NEW.candidate_hash IS NOT OLD.candidate_hash OR NEW.candidate_offline_hash IS NOT OLD.candidate_offline_hash OR NEW.request_key IS NOT OLD.request_key OR NEW.input_hash IS NOT OLD.input_hash OR NEW.purpose IS NOT OLD.purpose OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.state='approved'
 BEGIN SELECT RAISE(ABORT,'maintenance-request-immutable');END;
CREATE TRIGGER maintenance_challenge_binding BEFORE UPDATE ON maintenance_challenges
 WHEN NEW.id IS NOT OLD.id OR NEW.request_id IS NOT OLD.request_id OR NEW.request_key IS NOT OLD.request_key OR NEW.input_hash IS NOT OLD.input_hash OR NEW.options_json IS NOT OLD.options_json OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.consumed_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'maintenance-challenge-immutable');END;
