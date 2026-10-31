-- I05b1 dormant private envelope factory only. NOT deployed by this change.
-- Large attachments remain in immutable identity_card_artifacts, never in this row.
CREATE TABLE identity_mail_envelopes (
 event_id TEXT PRIMARY KEY NOT NULL REFERENCES identity_mail_events(id)
  CHECK(length(event_id)=32 AND length(CAST(event_id AS BLOB))=32 AND event_id NOT GLOB '*[^0-9a-f]*'),
 template_version TEXT NOT NULL CHECK(template_version IN ('guardian-invitation-v1','identity-card-v1','identity-card-revoked-v1','identity-recovery-continued-v1','identity-guardian-repaired-v1')),
 metadata_ciphertext TEXT NOT NULL CHECK(length(metadata_ciphertext) BETWEEN 40 AND 32768 AND length(CAST(metadata_ciphertext AS BLOB))=length(metadata_ciphertext) AND metadata_ciphertext GLOB 'v1.*.*'),
 body_digest TEXT NOT NULL CHECK(length(body_digest)=64 AND length(CAST(body_digest AS BLOB))=64 AND body_digest NOT GLOB '*[^0-9a-f]*'),
 body_length INTEGER NOT NULL CHECK(typeof(body_length)='integer' AND body_length BETWEEN 1 AND 12582912),
 attachment_refs TEXT NOT NULL CHECK(json_valid(attachment_refs) AND json_type(attachment_refs)='array' AND json_array_length(attachment_refs) IN (0,2) AND length(CAST(attachment_refs AS BLOB))<=2048),
 created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at)
);
CREATE TRIGGER identity_mail_envelope_immutable BEFORE UPDATE ON identity_mail_envelopes BEGIN SELECT RAISE(ABORT,'mail-envelope-immutable');END;
CREATE TRIGGER identity_mail_envelope_permanent BEFORE DELETE ON identity_mail_envelopes BEGIN SELECT RAISE(ABORT,'mail-envelope-permanent');END;
CREATE UNIQUE INDEX identity_mail_prepared_once ON identity_mail_audit(event_id) WHERE action='prepared';
CREATE TRIGGER identity_mail_prepared_binding BEFORE INSERT ON identity_mail_audit
 WHEN NEW.action='prepared' AND NOT EXISTS(SELECT 1 FROM identity_mail_envelopes WHERE event_id=NEW.event_id AND json_valid(NEW.detail_json) AND json_extract(NEW.detail_json,'$.bodyDigest')=body_digest AND json_extract(NEW.detail_json,'$.bodyLength')=body_length AND json_extract(NEW.detail_json,'$.templateVersion')=template_version)
 BEGIN SELECT RAISE(ABORT,'mail-prepared-binding');END;
CREATE TRIGGER identity_mail_prepared_immutable BEFORE UPDATE ON identity_mail_audit WHEN OLD.action='prepared' OR NEW.action='prepared' BEGIN SELECT RAISE(ABORT,'mail-prepared-immutable');END;
CREATE TRIGGER identity_mail_prepared_permanent BEFORE DELETE ON identity_mail_audit WHEN OLD.action='prepared' BEGIN SELECT RAISE(ABORT,'mail-prepared-permanent');END;
