-- I04a dormant lifecycle core. Not applied or exposed until I04 release gates pass.
CREATE TABLE identity_credentials (
 credential_id TEXT PRIMARY KEY NOT NULL CHECK(length(credential_id)=32 AND length(CAST(credential_id AS BLOB))=32 AND credential_id NOT GLOB '*[^0-9a-f]*'),
 agent_id TEXT NOT NULL REFERENCES agent_identities(agent_id),account_id TEXT NOT NULL REFERENCES accounts(id),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
 state TEXT NOT NULL CHECK(state IN ('issued','superseded','revoked')),
 signed_json TEXT NOT NULL CHECK(json_valid(signed_json) AND length(CAST(signed_json AS BLOB))<=16384),
 pdf_digest TEXT NOT NULL CHECK(length(pdf_digest)=64 AND pdf_digest NOT GLOB '*[^0-9a-f]*'),
 json_digest TEXT NOT NULL CHECK(length(json_digest)=64 AND json_digest NOT GLOB '*[^0-9a-f]*'),
 pdf_length INTEGER NOT NULL CHECK(typeof(pdf_length)='integer' AND pdf_length BETWEEN 1 AND 8388608),
 json_length INTEGER NOT NULL CHECK(typeof(json_length)='integer' AND json_length BETWEEN 1 AND 16384),
 pdf_chunks INTEGER NOT NULL CHECK(typeof(pdf_chunks)='integer' AND pdf_chunks=(pdf_length+49151)/49152),
 json_chunks INTEGER NOT NULL CHECK(typeof(json_chunks)='integer' AND json_chunks=1),
 issued_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(account_id,revision),UNIQUE(credential_id,account_id),
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',issued_at)=issued_at AND strftime('%Y-%m-%dT%H:%M:%fZ',issued_at) IS NOT NULL)
);
CREATE UNIQUE INDEX identity_card_one_issued ON identity_credentials(account_id) WHERE state='issued';
CREATE INDEX identity_card_agent ON identity_credentials(agent_id,revision);
CREATE TRIGGER identity_card_binding BEFORE INSERT ON identity_credentials
 WHEN NEW.state!='issued' OR NOT EXISTS(SELECT 1 FROM agent_identities i WHERE i.agent_id=NEW.agent_id AND i.account_id=NEW.account_id)
 BEGIN SELECT RAISE(ABORT,'card-binding');END;
CREATE TRIGGER identity_card_immutable BEFORE UPDATE ON identity_credentials
 WHEN NEW.credential_id IS NOT OLD.credential_id OR NEW.agent_id IS NOT OLD.agent_id OR NEW.account_id IS NOT OLD.account_id OR NEW.revision IS NOT OLD.revision OR NEW.signed_json IS NOT OLD.signed_json OR NEW.pdf_digest IS NOT OLD.pdf_digest OR NEW.json_digest IS NOT OLD.json_digest OR NEW.pdf_length IS NOT OLD.pdf_length OR NEW.json_length IS NOT OLD.json_length OR NEW.pdf_chunks IS NOT OLD.pdf_chunks OR NEW.json_chunks IS NOT OLD.json_chunks OR NEW.issued_at IS NOT OLD.issued_at OR OLD.state!='issued' OR NEW.state NOT IN ('superseded','revoked')
 BEGIN SELECT RAISE(ABORT,'card-immutable');END;
CREATE TRIGGER identity_card_permanent BEFORE DELETE ON identity_credentials BEGIN SELECT RAISE(ABORT,'card-permanent');END;
CREATE TABLE identity_card_heads (
 account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id),revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
 current_credential_id TEXT,public_verification_consent INTEGER NOT NULL CHECK(public_verification_consent IN (0,1)),updated_at TEXT NOT NULL,
 FOREIGN KEY(current_credential_id,account_id) REFERENCES identity_credentials(credential_id,account_id)
);
CREATE TRIGGER identity_card_head_insert BEFORE INSERT ON identity_card_heads
 WHEN NEW.revision!=1 OR NEW.current_credential_id IS NULL OR NEW.public_verification_consent!=1 OR NOT EXISTS(SELECT 1 FROM identity_credentials WHERE credential_id=NEW.current_credential_id AND account_id=NEW.account_id AND revision=NEW.revision AND state='issued')
 BEGIN SELECT RAISE(ABORT,'card-head-conflict');END;
CREATE TRIGGER identity_card_head_update BEFORE UPDATE ON identity_card_heads
 WHEN NEW.account_id IS NOT OLD.account_id OR (NEW.revision!=OLD.revision+1 AND NOT(NEW.revision=OLD.revision AND NEW.current_credential_id IS OLD.current_credential_id AND OLD.public_verification_consent=1 AND NEW.public_verification_consent=0)) OR (NEW.current_credential_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM identity_credentials WHERE credential_id=NEW.current_credential_id AND account_id=NEW.account_id AND state='issued' AND revision<=NEW.revision))
 BEGIN SELECT RAISE(ABORT,'card-head-conflict');END;
CREATE TRIGGER identity_card_head_permanent BEFORE DELETE ON identity_card_heads BEGIN SELECT RAISE(ABORT,'card-head-permanent');END;
-- 48 KiB raw chunks (64 KiB base64), well below the D1 single-row limit.
CREATE TABLE identity_card_artifacts (
 credential_id TEXT NOT NULL REFERENCES identity_credentials(credential_id),kind TEXT NOT NULL CHECK(kind IN ('pdf','json')),
 chunk_index INTEGER NOT NULL CHECK(typeof(chunk_index)='integer' AND chunk_index>=0),
 data_base64 TEXT NOT NULL CHECK(length(data_base64) BETWEEN 4 AND 65536 AND length(CAST(data_base64 AS BLOB))=length(data_base64) AND data_base64 NOT GLOB '*[^A-Za-z0-9+/=]*'),
 PRIMARY KEY(credential_id,kind,chunk_index)
);
CREATE TRIGGER identity_card_artifact_count BEFORE INSERT ON identity_card_artifacts
 WHEN NOT EXISTS(SELECT 1 FROM identity_credentials WHERE credential_id=NEW.credential_id AND NEW.chunk_index<CASE NEW.kind WHEN 'pdf' THEN pdf_chunks ELSE json_chunks END)
 BEGIN SELECT RAISE(ABORT,'card-artifact-count');END;
CREATE TRIGGER identity_card_artifact_immutable BEFORE UPDATE ON identity_card_artifacts BEGIN SELECT RAISE(ABORT,'card-artifact-immutable');END;
CREATE TRIGGER identity_card_artifact_permanent BEFORE DELETE ON identity_card_artifacts BEGIN SELECT RAISE(ABORT,'card-artifact-permanent');END;
CREATE TABLE identity_card_requests (
 account_id TEXT NOT NULL REFERENCES accounts(id),request_key TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('issue','revoke')),
 input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),response_json TEXT NOT NULL CHECK(json_valid(response_json)),status INTEGER NOT NULL CHECK(status IN (200,201)),created_at TEXT NOT NULL,
 PRIMARY KEY(account_id,request_key)
);
CREATE TRIGGER identity_card_receipt_immutable BEFORE UPDATE ON identity_card_requests BEGIN SELECT RAISE(ABORT,'card-receipt-immutable');END;
CREATE TRIGGER identity_card_receipt_permanent BEFORE DELETE ON identity_card_requests BEGIN SELECT RAISE(ABORT,'card-receipt-permanent');END;
-- One permanent logical attempt pins one signed public candidate. Pure rendering safely resumes the same CID.
CREATE TABLE identity_card_attempts (
 account_id TEXT NOT NULL REFERENCES accounts(id),request_key TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('issue','revoke')),
 input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
 context_json TEXT NOT NULL CHECK(json_valid(context_json) AND length(context_json)<=16384),
 credential_id TEXT,signed_json TEXT CHECK(signed_json IS NULL OR (json_valid(signed_json) AND length(CAST(signed_json AS BLOB))<=16384)),created_at TEXT NOT NULL,
 CHECK((operation='revoke' AND credential_id IS NULL AND signed_json IS NULL) OR (operation='issue' AND credential_id IS NOT NULL AND signed_json IS NOT NULL AND length(credential_id)=32 AND credential_id NOT GLOB '*[^0-9a-f]*')),
 UNIQUE(credential_id),PRIMARY KEY(account_id,request_key)
);
CREATE TRIGGER identity_card_attempt_immutable BEFORE UPDATE ON identity_card_attempts BEGIN SELECT RAISE(ABORT,'card-attempt-immutable');END;
CREATE TRIGGER identity_card_attempt_permanent BEFORE DELETE ON identity_card_attempts BEGIN SELECT RAISE(ABORT,'card-attempt-permanent');END;
