-- Private operator-only metadata diagnostics. No resident/account is fabricated.
CREATE TABLE identity_mail_provider_checks (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=32 AND id NOT GLOB '*[^0-9a-f]*'),
 request_key_hash TEXT UNIQUE NOT NULL CHECK(length(request_key_hash)=64 AND request_key_hash NOT GLOB '*[^0-9a-f]*'),
 input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
 domain TEXT CHECK(domain IS NULL OR length(domain) BETWEEN 3 AND 253),
 state TEXT NOT NULL CHECK(state IN ('checking','complete')),
 response_status INTEGER NOT NULL CHECK(response_status IN (200,202,502,503)),
 result_json TEXT CHECK(result_json IS NULL OR (json_valid(result_json) AND length(CAST(result_json AS BLOB))<=2048)),
 created_at TEXT NOT NULL,completed_at TEXT,
 CHECK((state='checking' AND response_status=202 AND result_json IS NULL AND completed_at IS NULL) OR (state='complete' AND response_status!=202 AND result_json IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE TABLE identity_mail_provider_audit (
 id TEXT PRIMARY KEY NOT NULL,
 check_id TEXT NOT NULL REFERENCES identity_mail_provider_checks(id),
 action TEXT NOT NULL CHECK(action IN ('intent','completed')),
 detail_json TEXT NOT NULL CHECK(json_valid(detail_json) AND length(CAST(detail_json AS BLOB))<=2048),
 created_at TEXT NOT NULL,
 UNIQUE(check_id,action)
);
CREATE TRIGGER identity_mail_provider_check_immutable BEFORE UPDATE ON identity_mail_provider_checks
 WHEN NEW.id IS NOT OLD.id OR NEW.request_key_hash IS NOT OLD.request_key_hash OR NEW.input_hash IS NOT OLD.input_hash OR NEW.domain IS NOT OLD.domain OR NEW.created_at IS NOT OLD.created_at OR OLD.state!='checking' OR NEW.state!='complete'
 BEGIN SELECT RAISE(ABORT,'mail-provider-check-immutable');END;
CREATE TRIGGER identity_mail_provider_check_permanent BEFORE DELETE ON identity_mail_provider_checks
 BEGIN SELECT RAISE(ABORT,'mail-provider-check-permanent');END;
CREATE TRIGGER identity_mail_provider_audit_immutable BEFORE UPDATE ON identity_mail_provider_audit
 BEGIN SELECT RAISE(ABORT,'mail-provider-audit-immutable');END;
CREATE TRIGGER identity_mail_provider_audit_permanent BEFORE DELETE ON identity_mail_provider_audit
 BEGIN SELECT RAISE(ABORT,'mail-provider-audit-permanent');END;
