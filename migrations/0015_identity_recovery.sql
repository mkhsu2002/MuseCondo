-- Passkey recovery only. Offline verifier replacement and UI remain unavailable.
-- Retain digest history when login hashes are replaced or owner sessions deleted.
CREATE TABLE identity_secret_history (
 secret_hash TEXT PRIMARY KEY NOT NULL CHECK(length(secret_hash)=64 AND secret_hash NOT GLOB '*[^0-9a-f]*')
);
INSERT OR IGNORE INTO identity_secret_history SELECT login_hash FROM accounts;
INSERT OR IGNORE INTO identity_secret_history SELECT token_hash FROM sessions;
INSERT OR IGNORE INTO identity_secret_history SELECT token_hash FROM tower_tokens;
INSERT OR IGNORE INTO identity_secret_history SELECT token_hash FROM agent_tokens;
INSERT OR IGNORE INTO identity_secret_history SELECT token_hash FROM onboarding_grants;
INSERT OR IGNORE INTO identity_secret_history SELECT token_hash FROM tower_reception_cases;
CREATE TRIGGER identity_history_accounts_insert AFTER INSERT ON accounts BEGIN INSERT OR IGNORE INTO identity_secret_history VALUES(NEW.login_hash);END;
CREATE TRIGGER identity_history_accounts_update AFTER UPDATE OF login_hash ON accounts BEGIN INSERT OR IGNORE INTO identity_secret_history VALUES(OLD.login_hash);INSERT OR IGNORE INTO identity_secret_history VALUES(NEW.login_hash);END;
CREATE TRIGGER identity_history_sessions AFTER INSERT ON sessions BEGIN INSERT OR IGNORE INTO identity_secret_history VALUES(NEW.token_hash);END;
CREATE TRIGGER identity_history_tower_tokens AFTER INSERT ON tower_tokens BEGIN INSERT OR IGNORE INTO identity_secret_history VALUES(NEW.token_hash);END;
CREATE TRIGGER identity_history_agent_tokens AFTER INSERT ON agent_tokens BEGIN INSERT OR IGNORE INTO identity_secret_history VALUES(NEW.token_hash);END;
CREATE TRIGGER identity_history_onboarding AFTER INSERT ON onboarding_grants BEGIN INSERT OR IGNORE INTO identity_secret_history VALUES(NEW.token_hash);END;
CREATE TRIGGER identity_history_cases AFTER INSERT ON tower_reception_cases BEGIN INSERT OR IGNORE INTO identity_secret_history VALUES(NEW.token_hash);END;
CREATE TRIGGER identity_history_immutable_update BEFORE UPDATE ON identity_secret_history BEGIN SELECT RAISE(ABORT,'secret-history-immutable');END;
CREATE TRIGGER identity_history_immutable_delete BEFORE DELETE ON identity_secret_history BEGIN SELECT RAISE(ABORT,'secret-history-immutable');END;
CREATE TABLE identity_recovery_requests (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=32 AND id NOT GLOB '*[^0-9a-f]*'),
 agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),
 candidate_hash TEXT NOT NULL UNIQUE CHECK(length(candidate_hash)=64 AND candidate_hash NOT GLOB '*[^0-9a-f]*'),
 request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 8 AND 96),input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','continued','new-admission-required')),
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,completed_at TEXT,
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at)=expires_at),
 CHECK(expires_at>created_at AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+1 hour'))
);
CREATE TRIGGER identity_recovery_request_binding BEFORE UPDATE ON identity_recovery_requests
 WHEN NEW.id IS NOT OLD.id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.candidate_hash IS NOT OLD.candidate_hash OR NEW.request_key IS NOT OLD.request_key OR NEW.input_hash IS NOT OLD.input_hash OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.state<>'pending' OR NEW.state='pending' OR NEW.completed_at IS NULL
 BEGIN SELECT RAISE(ABORT,'recovery-request-immutable');END;
CREATE TABLE identity_recovery_challenges (
 challenge_id TEXT PRIMARY KEY NOT NULL CHECK(length(challenge_id)=32 AND challenge_id NOT GLOB '*[^0-9a-f]*'),
 operation TEXT NOT NULL CHECK(operation='recovery-passkey'),request_id TEXT NOT NULL REFERENCES identity_recovery_requests(id),
 candidate_hash TEXT NOT NULL CHECK(length(candidate_hash)=64 AND candidate_hash NOT GLOB '*[^0-9a-f]*'),
 agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),guardian_id TEXT NOT NULL REFERENCES identity_guardians(guardian_id),
 guardian_version INTEGER NOT NULL CHECK(typeof(guardian_version)='integer' AND guardian_version>=1),
 identity_version INTEGER NOT NULL CHECK(typeof(identity_version)='integer' AND identity_version>=1),
 authority_epoch INTEGER NOT NULL CHECK(typeof(authority_epoch)='integer' AND authority_epoch>=1),
 decision TEXT NOT NULL CHECK(decision IN ('continue','new')),rp_id TEXT NOT NULL,origin TEXT NOT NULL,
 options_json TEXT NOT NULL CHECK(json_valid(options_json)),request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 8 AND 96),input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,
 UNIQUE(request_id,request_key),
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at)=expires_at),
 CHECK(expires_at>created_at AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+5 minutes'))
);
CREATE TRIGGER identity_recovery_challenge_binding BEFORE INSERT ON identity_recovery_challenges
 WHEN NOT EXISTS(SELECT 1 FROM identity_recovery_requests r JOIN identity_guardians g ON g.agent_id=r.agent_id WHERE r.id=NEW.request_id AND r.agent_id=NEW.agent_id AND r.candidate_hash=NEW.candidate_hash AND g.guardian_id=NEW.guardian_id AND NEW.expires_at<=r.expires_at)
 BEGIN SELECT RAISE(ABORT,'recovery-challenge-binding');END;
CREATE TRIGGER identity_recovery_challenge_immutable BEFORE UPDATE ON identity_recovery_challenges
 WHEN NEW.challenge_id IS NOT OLD.challenge_id OR NEW.operation IS NOT OLD.operation OR NEW.request_id IS NOT OLD.request_id OR NEW.candidate_hash IS NOT OLD.candidate_hash OR NEW.agent_id IS NOT OLD.agent_id OR NEW.guardian_id IS NOT OLD.guardian_id OR NEW.guardian_version IS NOT OLD.guardian_version OR NEW.identity_version IS NOT OLD.identity_version OR NEW.authority_epoch IS NOT OLD.authority_epoch OR NEW.decision IS NOT OLD.decision OR NEW.rp_id IS NOT OLD.rp_id OR NEW.origin IS NOT OLD.origin OR NEW.options_json IS NOT OLD.options_json OR NEW.request_key IS NOT OLD.request_key OR NEW.input_hash IS NOT OLD.input_hash OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
 BEGIN SELECT RAISE(ABORT,'recovery-challenge-immutable');END;
CREATE TABLE identity_recovery_receipts (
 request_id TEXT NOT NULL REFERENCES identity_recovery_requests(id),request_key TEXT NOT NULL,
 input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
 response_json TEXT NOT NULL CHECK(json_valid(response_json)),created_at TEXT NOT NULL,
 PRIMARY KEY(request_id,request_key)
);
CREATE TRIGGER identity_recovery_receipt_immutable BEFORE UPDATE ON identity_recovery_receipts BEGIN SELECT RAISE(ABORT,'recovery-receipt-immutable');END;
CREATE TRIGGER identity_recovery_receipt_permanent BEFORE DELETE ON identity_recovery_receipts BEGIN SELECT RAISE(ABORT,'recovery-receipt-permanent');END;
CREATE TABLE identity_recovery_instances (
 instance_id TEXT PRIMARY KEY NOT NULL CHECK(length(instance_id)=32 AND instance_id NOT GLOB '*[^0-9a-f]*'),
 agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),authority_epoch INTEGER NOT NULL CHECK(typeof(authority_epoch)='integer' AND authority_epoch>=1),
 token_id TEXT NOT NULL UNIQUE REFERENCES tower_tokens(id),request_id TEXT NOT NULL UNIQUE REFERENCES identity_recovery_requests(id),created_at TEXT NOT NULL
);
-- Candidates and backup generations are never forgotten/rebound, even before completion.
CREATE TRIGGER identity_recovery_request_permanent BEFORE DELETE ON identity_recovery_requests BEGIN SELECT RAISE(ABORT,'recovery-request-permanent');END;
CREATE TRIGGER identity_recovery_challenge_permanent BEFORE DELETE ON identity_recovery_challenges BEGIN SELECT RAISE(ABORT,'recovery-challenge-permanent');END;
CREATE TRIGGER identity_offline_history_permanent BEFORE DELETE ON identity_offline_recovery_codes BEGIN SELECT RAISE(ABORT,'offline-history-permanent');END;
CREATE TRIGGER identity_offline_history_immutable BEFORE UPDATE ON identity_offline_recovery_codes
 WHEN NEW.agent_id IS NOT OLD.agent_id OR NEW.code_hash IS NOT OLD.code_hash OR NEW.authority_epoch IS NOT OLD.authority_epoch OR NEW.identity_version IS NOT OLD.identity_version OR NEW.created_at IS NOT OLD.created_at OR NEW.confirmed_at IS NOT OLD.confirmed_at OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
 BEGIN SELECT RAISE(ABORT,'offline-history-immutable');END;
