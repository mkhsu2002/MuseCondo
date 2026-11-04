-- Private current-version documents; never public assets or immutable plaintext history.
CREATE TABLE agent_private_vault_documents (
 account_id TEXT NOT NULL REFERENCES accounts(id),
 path TEXT NOT NULL CHECK(path IN ('SOUL.md','MEMORY.md','SKILLS.md') OR (
  substr(path,1,7)='skills/' AND substr(path,-9)='/SKILL.md' AND length(path) BETWEEN 17 AND 80
  AND substr(path,8,length(path)-16) NOT GLOB '*[^a-z0-9-]*'
  AND substr(path,8,1)!='-' AND substr(path,-10,1)!='-'
  AND instr(substr(path,8,length(path)-16),'--')=0)),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 state TEXT NOT NULL CHECK(state IN ('live','deleted')),
 ciphertext TEXT,
 plaintext_bytes INTEGER NOT NULL CHECK(typeof(plaintext_bytes)='integer' AND plaintext_bytes BETWEEN 0 AND 65536),
 updated_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',updated_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at)=updated_at),
 PRIMARY KEY(account_id,path),
 CHECK((state='live' AND ciphertext IS NOT NULL AND length(CAST(ciphertext AS BLOB)) BETWEEN 40 AND 90112) OR (state='deleted' AND ciphertext IS NULL AND plaintext_bytes=0))
);
CREATE TRIGGER vault_document_insert BEFORE INSERT ON agent_private_vault_documents BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_private_vault_documents WHERE account_id=NEW.account_id AND path=NEW.path) THEN RAISE(ABORT,'vault_document_exists') END;
 SELECT CASE WHEN NEW.revision!=1 OR NEW.state!='live' THEN RAISE(ABORT,'vault_revision_conflict') END;
 SELECT CASE WHEN (SELECT coalesce(sum(plaintext_bytes),0) FROM agent_private_vault_documents WHERE account_id=NEW.account_id)+NEW.plaintext_bytes>1048576 THEN RAISE(ABORT,'vault_total_limit') END;
 SELECT CASE WHEN NEW.path LIKE 'skills/%' AND (SELECT count(*) FROM agent_private_vault_documents WHERE account_id=NEW.account_id AND state='live' AND path LIKE 'skills/%')>=10 THEN RAISE(ABORT,'vault_skill_limit') END;
END;
CREATE TRIGGER vault_document_update BEFORE UPDATE ON agent_private_vault_documents BEGIN
 SELECT CASE WHEN NEW.account_id IS NOT OLD.account_id OR NEW.path IS NOT OLD.path OR NEW.revision!=OLD.revision+1 THEN RAISE(ABORT,'vault_revision_conflict') END;
 SELECT CASE WHEN (SELECT coalesce(sum(plaintext_bytes),0) FROM agent_private_vault_documents WHERE account_id=NEW.account_id AND path!=NEW.path)+NEW.plaintext_bytes>1048576 THEN RAISE(ABORT,'vault_total_limit') END;
 SELECT CASE WHEN NEW.state='live' AND NEW.path LIKE 'skills/%' AND (SELECT count(*) FROM agent_private_vault_documents WHERE account_id=NEW.account_id AND path!=NEW.path AND state='live' AND path LIKE 'skills/%')>=10 THEN RAISE(ABORT,'vault_skill_limit') END;
END;
CREATE TRIGGER vault_document_tombstone BEFORE DELETE ON agent_private_vault_documents BEGIN SELECT RAISE(ABORT,'vault_tombstone_required');END;
CREATE TABLE agent_private_vault_requests (
 account_id TEXT NOT NULL REFERENCES accounts(id),request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 8 AND 96 AND length(CAST(request_key AS BLOB))=length(request_key) AND request_key NOT GLOB '*[^A-Za-z0-9_-]*'),
 operation TEXT NOT NULL CHECK(operation IN ('put','delete')),path TEXT NOT NULL,
 input_hmac TEXT NOT NULL CHECK(length(input_hmac)=64 AND input_hmac NOT GLOB '*[^0-9a-f]*'),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),state TEXT NOT NULL CHECK(state IN ('live','deleted')),
 plaintext_bytes INTEGER NOT NULL CHECK(typeof(plaintext_bytes)='integer' AND plaintext_bytes BETWEEN 0 AND 65536),
 created_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
 PRIMARY KEY(account_id,request_key),FOREIGN KEY(account_id,path) REFERENCES agent_private_vault_documents(account_id,path)
);
CREATE INDEX vault_request_daily ON agent_private_vault_requests(account_id,created_at);
CREATE TRIGGER vault_request_insert BEFORE INSERT ON agent_private_vault_requests BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM agent_private_vault_requests WHERE account_id=NEW.account_id AND request_key=NEW.request_key) THEN RAISE(ABORT,'vault_request_conflict') END;
 SELECT CASE WHEN (SELECT count(*) FROM agent_private_vault_requests WHERE account_id=NEW.account_id AND substr(created_at,1,10)=substr(NEW.created_at,1,10))>=100 THEN RAISE(ABORT,'vault_daily_limit') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM agent_private_vault_documents WHERE account_id=NEW.account_id AND path=NEW.path AND revision=NEW.revision AND state=NEW.state AND plaintext_bytes=NEW.plaintext_bytes) OR (NEW.operation='put' AND NEW.state!='live') OR (NEW.operation='delete' AND NEW.state!='deleted') THEN RAISE(ABORT,'vault_receipt_binding') END;
END;
CREATE TRIGGER vault_request_update BEFORE UPDATE ON agent_private_vault_requests BEGIN SELECT RAISE(ABORT,'vault_receipt_immutable');END;
CREATE TRIGGER vault_request_delete BEFORE DELETE ON agent_private_vault_requests BEGIN SELECT RAISE(ABORT,'vault_receipt_immutable');END;
CREATE TABLE agent_private_vault_audit (
 id TEXT PRIMARY KEY NOT NULL,account_id TEXT NOT NULL REFERENCES accounts(id),
 operation TEXT NOT NULL CHECK(operation IN ('put','delete')),path TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision>=1),
 plaintext_bytes INTEGER NOT NULL CHECK(typeof(plaintext_bytes)='integer' AND plaintext_bytes BETWEEN 0 AND 65536),
 result TEXT NOT NULL CHECK(result='success'),created_at TEXT NOT NULL,
 FOREIGN KEY(account_id,path) REFERENCES agent_private_vault_documents(account_id,path)
);
CREATE INDEX vault_audit_account ON agent_private_vault_audit(account_id,created_at);
CREATE TRIGGER vault_audit_replace BEFORE INSERT ON agent_private_vault_audit WHEN EXISTS(SELECT 1 FROM agent_private_vault_audit WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'vault_audit_immutable');END;
CREATE TRIGGER vault_audit_update BEFORE UPDATE ON agent_private_vault_audit BEGIN SELECT RAISE(ABORT,'vault_audit_immutable');END;
CREATE TRIGGER vault_audit_delete BEFORE DELETE ON agent_private_vault_audit BEGIN SELECT RAISE(ABORT,'vault_audit_immutable');END;
