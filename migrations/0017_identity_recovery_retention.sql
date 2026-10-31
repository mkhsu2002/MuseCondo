-- Pending anonymous attempts are not permanent authorization evidence.
-- Native database time enforces a minimum 24-hour retention after expiry.
DROP TRIGGER identity_recovery_request_permanent;
DROP TRIGGER identity_recovery_challenge_permanent;
DROP TRIGGER identity_offline_recovery_challenge_permanent;
CREATE TRIGGER identity_recovery_request_prune_guard BEFORE DELETE ON identity_recovery_requests
 WHEN OLD.state<>'pending'
 OR OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'-24 hours')
 OR EXISTS(SELECT 1 FROM identity_recovery_receipts WHERE request_id=OLD.id)
 OR EXISTS(SELECT 1 FROM identity_recovery_instances WHERE request_id=OLD.id)
 OR EXISTS(SELECT 1 FROM identity_mail_events WHERE entity_id=OLD.id)
 OR EXISTS(SELECT 1 FROM identity_recovery_challenges WHERE request_id=OLD.id)
 OR EXISTS(SELECT 1 FROM identity_offline_recovery_challenges WHERE request_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'recovery-request-retained');END;
CREATE TRIGGER identity_recovery_challenge_prune_guard BEFORE DELETE ON identity_recovery_challenges
 WHEN OLD.consumed_at IS NOT NULL
 OR OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'-24 hours')
 BEGIN SELECT RAISE(ABORT,'recovery-challenge-retained');END;
CREATE TRIGGER identity_offline_recovery_challenge_prune_guard BEFORE DELETE ON identity_offline_recovery_challenges
 WHEN OLD.consumed_at IS NOT NULL
 OR OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'-24 hours')
 BEGIN SELECT RAISE(ABORT,'offline-recovery-challenge-retained');END;
CREATE INDEX identity_recovery_request_pending_expiry ON identity_recovery_requests(state,expires_at,id);
CREATE INDEX identity_recovery_challenge_pending_expiry ON identity_recovery_challenges(consumed_at,expires_at,challenge_id);
CREATE INDEX identity_offline_recovery_challenge_pending_expiry ON identity_offline_recovery_challenges(consumed_at,expires_at,challenge_id);
CREATE INDEX identity_recovery_challenge_request ON identity_recovery_challenges(request_id,consumed_at,expires_at);
CREATE INDEX identity_offline_recovery_challenge_request ON identity_offline_recovery_challenges(request_id,consumed_at,expires_at);
CREATE INDEX identity_mail_entity ON identity_mail_events(entity_id);
-- An issued instance is immutable authority history, never an expirable attempt.
CREATE TRIGGER identity_recovery_instance_immutable BEFORE UPDATE ON identity_recovery_instances
 BEGIN SELECT RAISE(ABORT,'recovery-instance-immutable');END;
CREATE TRIGGER identity_recovery_instance_permanent BEFORE DELETE ON identity_recovery_instances
 BEGIN SELECT RAISE(ABORT,'recovery-instance-permanent');END;
