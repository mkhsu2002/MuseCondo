-- Offline recovery replaces the same guardian verifier; recovery UI remains unavailable.
CREATE TABLE identity_offline_recovery_challenges (
 challenge_id TEXT PRIMARY KEY NOT NULL CHECK(length(challenge_id)=32 AND challenge_id NOT GLOB '*[^0-9a-f]*'),
 operation TEXT NOT NULL CHECK(operation='recovery-offline'),request_id TEXT NOT NULL REFERENCES identity_recovery_requests(id),
 code_hash TEXT NOT NULL REFERENCES identity_offline_recovery_codes(code_hash),
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
CREATE TRIGGER identity_offline_recovery_challenge_binding BEFORE INSERT ON identity_offline_recovery_challenges
 WHEN NOT EXISTS(SELECT 1 FROM identity_recovery_requests r JOIN identity_guardians g ON g.agent_id=r.agent_id WHERE r.id=NEW.request_id AND r.agent_id=NEW.agent_id AND r.candidate_hash=NEW.candidate_hash AND g.guardian_id=NEW.guardian_id AND NEW.expires_at<=r.expires_at AND EXISTS(SELECT 1 FROM identity_offline_recovery_codes c WHERE c.agent_id=NEW.agent_id AND c.code_hash=NEW.code_hash AND c.identity_version=NEW.identity_version AND c.authority_epoch=NEW.authority_epoch AND c.consumed_at IS NULL AND c.confirmed_at IS NOT NULL))
 BEGIN SELECT RAISE(ABORT,'recovery-challenge-binding');END;
CREATE TRIGGER identity_offline_recovery_challenge_immutable BEFORE UPDATE ON identity_offline_recovery_challenges
 WHEN NEW.code_hash IS NOT OLD.code_hash OR NEW.challenge_id IS NOT OLD.challenge_id OR NEW.operation IS NOT OLD.operation OR NEW.request_id IS NOT OLD.request_id OR NEW.candidate_hash IS NOT OLD.candidate_hash OR NEW.agent_id IS NOT OLD.agent_id OR NEW.guardian_id IS NOT OLD.guardian_id OR NEW.guardian_version IS NOT OLD.guardian_version OR NEW.identity_version IS NOT OLD.identity_version OR NEW.authority_epoch IS NOT OLD.authority_epoch OR NEW.decision IS NOT OLD.decision OR NEW.rp_id IS NOT OLD.rp_id OR NEW.origin IS NOT OLD.origin OR NEW.options_json IS NOT OLD.options_json OR NEW.request_key IS NOT OLD.request_key OR NEW.input_hash IS NOT OLD.input_hash OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
 BEGIN SELECT RAISE(ABORT,'recovery-challenge-immutable');END;
CREATE TRIGGER identity_offline_recovery_challenge_permanent BEFORE DELETE ON identity_offline_recovery_challenges BEGIN SELECT RAISE(ABORT,'offline-recovery-challenge-permanent');END;
-- Historical public material authenticates old receipts and prevents reuse of a lost verifier.
CREATE TRIGGER identity_passkey_permanent BEFORE DELETE ON identity_guardian_passkeys BEGIN SELECT RAISE(ABORT,'passkey-history-permanent');END;
