-- Dedicated private-vault authorization. Never grants or rotates Tower credentials.
CREATE TABLE vault_authorization_requests (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=32 AND id NOT GLOB '*[^0-9a-f]*'),
 agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),account_id TEXT NOT NULL REFERENCES accounts(id),
 room_id TEXT NOT NULL REFERENCES rooms(id),resident_id TEXT NOT NULL,
 candidate_hash TEXT NOT NULL UNIQUE CHECK(length(candidate_hash)=64 AND candidate_hash NOT GLOB '*[^0-9a-f]*'),
 candidate_offline_hash TEXT NOT NULL,request_key TEXT NOT NULL,input_hash TEXT NOT NULL,scopes_json TEXT NOT NULL CHECK(scopes_json='["vault:read","vault:write"]'),
 state TEXT NOT NULL CHECK(state IN ('waiting-for-guardian','pending','approved','claimed')),
 guardian_id TEXT REFERENCES identity_guardians(guardian_id),guardian_version INTEGER,identity_version INTEGER,authority_epoch INTEGER,maintenance_version INTEGER,
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,resume_key TEXT,
 approved_at TEXT,credential_id TEXT,public_key TEXT,webauthn_user_id TEXT,completion_key TEXT,completion_hash TEXT,
 claim_key TEXT,claimed_at TEXT,
 CHECK(expires_at>created_at AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+24 hours')),
 CHECK((state='waiting-for-guardian' AND guardian_id IS NULL AND guardian_version IS NULL AND identity_version IS NULL AND authority_epoch IS NULL AND maintenance_version IS NULL) OR (state!='waiting-for-guardian' AND guardian_id IS NOT NULL AND guardian_version IS NOT NULL AND identity_version IS NOT NULL AND authority_epoch IS NOT NULL AND maintenance_version IS NOT NULL)),
 CHECK((state IN ('waiting-for-guardian','pending') AND approved_at IS NULL AND credential_id IS NULL AND public_key IS NULL AND webauthn_user_id IS NULL AND completion_key IS NULL AND completion_hash IS NULL) OR (state IN ('approved','claimed') AND approved_at IS NOT NULL AND credential_id IS NOT NULL AND public_key IS NOT NULL AND webauthn_user_id IS NOT NULL AND completion_key IS NOT NULL AND completion_hash IS NOT NULL)),
 CHECK((state='claimed' AND claim_key IS NOT NULL AND claimed_at IS NOT NULL) OR (state!='claimed' AND claim_key IS NULL AND claimed_at IS NULL))
);
CREATE INDEX vault_requests_agent ON vault_authorization_requests(agent_id,state,expires_at);
CREATE TABLE vault_authorization_challenges (
 id TEXT PRIMARY KEY NOT NULL,request_id TEXT NOT NULL REFERENCES vault_authorization_requests(id),
 purpose TEXT NOT NULL CHECK(purpose IN ('approve','revoke')),request_key TEXT NOT NULL,input_hash TEXT NOT NULL,options_json TEXT NOT NULL CHECK(json_valid(options_json)),
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,
 completion_key TEXT,completion_hash TEXT,credential_id TEXT,public_key TEXT,webauthn_user_id TEXT,
 UNIQUE(request_id,purpose,request_key),
 CHECK(expires_at>created_at AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+5 minutes'))
);
CREATE TABLE vault_grants (
 id TEXT PRIMARY KEY NOT NULL,request_id TEXT NOT NULL UNIQUE REFERENCES vault_authorization_requests(id),
 agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),account_id TEXT NOT NULL REFERENCES accounts(id),room_id TEXT NOT NULL REFERENCES rooms(id),resident_id TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),scopes_json TEXT NOT NULL CHECK(scopes_json='["vault:read","vault:write"]'),
 authority_epoch INTEGER NOT NULL,guardian_id TEXT NOT NULL REFERENCES identity_guardians(guardian_id),guardian_version INTEGER NOT NULL,maintenance_version INTEGER NOT NULL,
 credential_id TEXT NOT NULL REFERENCES identity_guardian_passkeys(credential_id),public_key TEXT NOT NULL,webauthn_user_id TEXT NOT NULL,
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT,
 CHECK(expires_at>created_at AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+30 days'))
);
CREATE UNIQUE INDEX vault_one_active_grant ON vault_grants(account_id) WHERE revoked_at IS NULL;
CREATE TRIGGER vault_request_binding BEFORE UPDATE ON vault_authorization_requests
 WHEN NEW.id IS NOT OLD.id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.account_id IS NOT OLD.account_id OR NEW.room_id IS NOT OLD.room_id OR NEW.resident_id IS NOT OLD.resident_id OR NEW.candidate_hash IS NOT OLD.candidate_hash OR NEW.candidate_offline_hash IS NOT OLD.candidate_offline_hash OR NEW.request_key IS NOT OLD.request_key OR NEW.input_hash IS NOT OLD.input_hash OR NEW.scopes_json IS NOT OLD.scopes_json OR NEW.created_at IS NOT OLD.created_at
 OR NOT ((OLD.state='waiting-for-guardian' AND NEW.state='pending') OR (OLD.state='pending' AND NEW.state='approved') OR (OLD.state='approved' AND NEW.state='claimed'))
 OR (OLD.state!='waiting-for-guardian' AND (NEW.guardian_id IS NOT OLD.guardian_id OR NEW.guardian_version IS NOT OLD.guardian_version OR NEW.identity_version IS NOT OLD.identity_version OR NEW.authority_epoch IS NOT OLD.authority_epoch OR NEW.maintenance_version IS NOT OLD.maintenance_version OR NEW.expires_at IS NOT OLD.expires_at OR NEW.resume_key IS NOT OLD.resume_key))
 OR (OLD.state='approved' AND (NEW.approved_at IS NOT OLD.approved_at OR NEW.credential_id IS NOT OLD.credential_id OR NEW.public_key IS NOT OLD.public_key OR NEW.webauthn_user_id IS NOT OLD.webauthn_user_id OR NEW.completion_key IS NOT OLD.completion_key OR NEW.completion_hash IS NOT OLD.completion_hash))
 BEGIN SELECT RAISE(ABORT,'vault-request-immutable');END;
CREATE TRIGGER vault_challenge_binding BEFORE UPDATE ON vault_authorization_challenges
 WHEN NEW.id IS NOT OLD.id OR NEW.request_id IS NOT OLD.request_id OR NEW.purpose IS NOT OLD.purpose OR NEW.request_key IS NOT OLD.request_key OR NEW.input_hash IS NOT OLD.input_hash OR NEW.options_json IS NOT OLD.options_json OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
 BEGIN SELECT RAISE(ABORT,'vault-challenge-immutable');END;
CREATE TRIGGER vault_grant_binding BEFORE UPDATE ON vault_grants
 WHEN NEW.id IS NOT OLD.id OR NEW.request_id IS NOT OLD.request_id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.account_id IS NOT OLD.account_id OR NEW.room_id IS NOT OLD.room_id OR NEW.resident_id IS NOT OLD.resident_id OR NEW.token_hash IS NOT OLD.token_hash OR NEW.scopes_json IS NOT OLD.scopes_json OR NEW.authority_epoch IS NOT OLD.authority_epoch OR NEW.guardian_id IS NOT OLD.guardian_id OR NEW.guardian_version IS NOT OLD.guardian_version OR NEW.maintenance_version IS NOT OLD.maintenance_version OR NEW.credential_id IS NOT OLD.credential_id OR NEW.public_key IS NOT OLD.public_key OR NEW.webauthn_user_id IS NOT OLD.webauthn_user_id OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
 BEGIN SELECT RAISE(ABORT,'vault-grant-immutable');END;
CREATE TRIGGER vault_request_no_delete BEFORE DELETE ON vault_authorization_requests BEGIN SELECT RAISE(ABORT,'vault-authorization-permanent');END;
CREATE TRIGGER vault_challenge_no_delete BEFORE DELETE ON vault_authorization_challenges BEGIN SELECT RAISE(ABORT,'vault-authorization-permanent');END;
CREATE TRIGGER vault_grant_no_delete BEFORE DELETE ON vault_grants BEGIN SELECT RAISE(ABORT,'vault-authorization-permanent');END;

CREATE TRIGGER vault_grant_request_binding BEFORE INSERT ON vault_grants
 WHEN NOT EXISTS(SELECT 1 FROM vault_authorization_requests r WHERE r.id=NEW.request_id AND r.state='approved' AND r.agent_id=NEW.agent_id AND r.account_id=NEW.account_id AND r.room_id=NEW.room_id AND r.resident_id=NEW.resident_id AND r.candidate_hash=NEW.token_hash AND r.scopes_json=NEW.scopes_json AND r.authority_epoch=NEW.authority_epoch AND r.guardian_id=NEW.guardian_id AND r.guardian_version=NEW.guardian_version AND r.maintenance_version=NEW.maintenance_version AND r.credential_id=NEW.credential_id AND r.public_key=NEW.public_key AND r.webauthn_user_id=NEW.webauthn_user_id)
 BEGIN SELECT RAISE(ABORT,'vault-grant-request-binding');END;
