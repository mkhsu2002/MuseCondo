-- First-guardian registration only. No recovery sessions or Tower authority are issued here.
CREATE UNIQUE INDEX identity_guardian_invite_agent ON identity_guardian_invites(id,agent_id);
CREATE TABLE identity_guardians (
 guardian_id TEXT PRIMARY KEY NOT NULL CHECK(length(guardian_id)=32 AND guardian_id NOT GLOB '*[^0-9a-f]*'),
 agent_id TEXT NOT NULL UNIQUE REFERENCES agent_identities(agent_id),
 invitation_id TEXT NOT NULL UNIQUE,
 version INTEGER NOT NULL DEFAULT 1 CHECK(typeof(version)='integer' AND version>=1),
 email_verified_at TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(guardian_id,agent_id),FOREIGN KEY(invitation_id,agent_id) REFERENCES identity_guardian_invites(id,agent_id)
);
CREATE TABLE identity_guardian_passkeys (
 credential_id TEXT PRIMARY KEY NOT NULL CHECK(length(credential_id) BETWEEN 1 AND 1364 AND credential_id NOT GLOB '*[^A-Za-z0-9_-]*'),
 guardian_id TEXT NOT NULL,agent_id TEXT NOT NULL,
 webauthn_user_id TEXT NOT NULL UNIQUE CHECK(length(webauthn_user_id)=43 AND webauthn_user_id NOT GLOB '*[^A-Za-z0-9_-]*'),
 public_key TEXT NOT NULL CHECK(length(public_key) BETWEEN 1 AND 2048 AND public_key NOT GLOB '*[^A-Za-z0-9_-]*'),
 counter INTEGER NOT NULL CHECK(typeof(counter)='integer' AND counter BETWEEN 0 AND 4294967295),
 device_type TEXT NOT NULL CHECK(device_type IN ('singleDevice','multiDevice')),
 backed_up INTEGER NOT NULL CHECK(backed_up IN (0,1) AND (device_type='multiDevice' OR backed_up=0)),
 transports_json TEXT NOT NULL CHECK(json_valid(transports_json) AND json_type(transports_json)='array'),
 aaguid TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT,
 FOREIGN KEY(guardian_id,agent_id) REFERENCES identity_guardians(guardian_id,agent_id)
);
CREATE TABLE identity_offline_recovery_codes (
 agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),
 code_hash TEXT PRIMARY KEY NOT NULL CHECK(length(code_hash)=64 AND code_hash NOT GLOB '*[^0-9a-f]*'),
 authority_epoch INTEGER NOT NULL CHECK(typeof(authority_epoch)='integer' AND authority_epoch>=1),
 identity_version INTEGER NOT NULL CHECK(typeof(identity_version)='integer' AND identity_version>=1),
 consumed_at TEXT,created_at TEXT NOT NULL,confirmed_at TEXT NOT NULL
);
CREATE UNIQUE INDEX identity_offline_one_current ON identity_offline_recovery_codes(agent_id) WHERE consumed_at IS NULL;
CREATE TABLE identity_guardian_challenges (
 challenge_id TEXT PRIMARY KEY NOT NULL CHECK(length(challenge_id)=32 AND challenge_id NOT GLOB '*[^0-9a-f]*'),
 operation TEXT NOT NULL CHECK(operation='registration'),
 invitation_id TEXT NOT NULL,agent_id TEXT NOT NULL,
 invitation_version INTEGER NOT NULL CHECK(typeof(invitation_version)='integer' AND invitation_version>=1),
 identity_version INTEGER NOT NULL CHECK(typeof(identity_version)='integer' AND identity_version>=1),
 authority_epoch INTEGER NOT NULL CHECK(typeof(authority_epoch)='integer' AND authority_epoch>=1),
 invite_token_hash TEXT NOT NULL CHECK(length(invite_token_hash)=64 AND invite_token_hash NOT GLOB '*[^0-9a-f]*'),
 rp_id TEXT NOT NULL,origin TEXT NOT NULL,options_json TEXT NOT NULL CHECK(json_valid(options_json)),
 request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 8 AND 96),input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
 expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL,
 UNIQUE(invitation_id,request_key),FOREIGN KEY(invitation_id,agent_id) REFERENCES identity_guardian_invites(id,agent_id),
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at)=expires_at),
 CHECK(expires_at>created_at AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+5 minutes'))
);
CREATE TABLE identity_registration_requests (
 invitation_id TEXT NOT NULL REFERENCES identity_guardian_invites(id),request_key TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation='registration-complete'),input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
 response_json TEXT NOT NULL CHECK(json_valid(response_json)),created_at TEXT NOT NULL,
 PRIMARY KEY(invitation_id,request_key)
);
CREATE TRIGGER identity_guardian_credential_binding BEFORE UPDATE ON identity_guardians
 WHEN NEW.guardian_id IS NOT OLD.guardian_id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.invitation_id IS NOT OLD.invitation_id OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'guardian-credential-binding-immutable');END;
CREATE TRIGGER identity_passkey_immutable_binding BEFORE UPDATE ON identity_guardian_passkeys
 WHEN NEW.credential_id IS NOT OLD.credential_id OR NEW.guardian_id IS NOT OLD.guardian_id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.webauthn_user_id IS NOT OLD.webauthn_user_id OR NEW.public_key IS NOT OLD.public_key OR NEW.created_at IS NOT OLD.created_at OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
 BEGIN SELECT RAISE(ABORT,'passkey-binding-immutable');END;
CREATE TRIGGER identity_challenge_immutable_binding BEFORE UPDATE ON identity_guardian_challenges
 WHEN NEW.challenge_id IS NOT OLD.challenge_id OR NEW.operation IS NOT OLD.operation OR NEW.invitation_id IS NOT OLD.invitation_id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.invitation_version IS NOT OLD.invitation_version OR NEW.identity_version IS NOT OLD.identity_version OR NEW.authority_epoch IS NOT OLD.authority_epoch OR NEW.invite_token_hash IS NOT OLD.invite_token_hash OR NEW.rp_id IS NOT OLD.rp_id OR NEW.origin IS NOT OLD.origin OR NEW.options_json IS NOT OLD.options_json OR NEW.request_key IS NOT OLD.request_key OR NEW.input_hash IS NOT OLD.input_hash OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at OR OLD.consumed_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'challenge-binding-immutable');END;
