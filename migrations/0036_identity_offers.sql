-- Optional post-completion Guardian invitation. This grants no identity/recovery authority.
CREATE TABLE identity_offers (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=32 AND id NOT GLOB '*[^0-9a-f]*'),
 account_id TEXT NOT NULL REFERENCES accounts(id),
 generation INTEGER NOT NULL DEFAULT 1 CHECK(typeof(generation)='integer' AND generation>=1),
 room_id TEXT NOT NULL REFERENCES rooms(id), resident_id TEXT NOT NULL,
 public_revision INTEGER NOT NULL CHECK(typeof(public_revision)='integer' AND public_revision>=1),
 publication_epoch INTEGER NOT NULL CHECK(typeof(publication_epoch)='integer' AND publication_epoch>=0),
 snapshot_digest TEXT NOT NULL,
 offer_digest TEXT NOT NULL CHECK(length(offer_digest)=64 AND offer_digest NOT GLOB '*[^0-9a-f]*'),
 public_url TEXT NOT NULL,
 guardian_designated INTEGER NOT NULL CHECK(guardian_designated=1),
 mail_consent INTEGER NOT NULL CHECK(mail_consent=1),
 recipient_ciphertext TEXT NOT NULL CHECK(recipient_ciphertext GLOB 'v1.*.*'),
 recipient_hash TEXT NOT NULL CHECK(length(recipient_hash)=64 AND recipient_hash NOT GLOB '*[^0-9a-f]*'),
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
 mail_event_id TEXT NOT NULL UNIQUE REFERENCES identity_mail_events(id),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','declined')),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, decided_at TEXT,
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at) IS NOT NULL),
 CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',expires_at)=expires_at AND strftime('%Y-%m-%dT%H:%M:%fZ',expires_at) IS NOT NULL AND expires_at>created_at AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ',created_at,'+24 hours')),
 UNIQUE(account_id,generation),
 CHECK((state='pending' AND decided_at IS NULL) OR (state!='pending' AND decided_at IS NOT NULL))
);
CREATE TABLE identity_offer_heads (
 account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id), offer_id TEXT NOT NULL UNIQUE REFERENCES identity_offers(id),
 generation INTEGER NOT NULL CHECK(typeof(generation)='integer' AND generation>=1), updated_at TEXT NOT NULL
);
CREATE VIEW identity_offer_current_publications AS
 SELECT o.id FROM identity_offers o JOIN tower_residencies t ON t.account_id=o.account_id AND t.room_id=o.room_id AND t.resident_id=o.resident_id
 JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id JOIN tower_snapshots s ON s.room_id=t.room_id AND s.revision=t.public_revision
 WHERE t.public_revision=o.public_revision AND t.publication_epoch=o.publication_epoch AND s.content_digest=o.snapshot_digest
 AND t.snapshot_consent=1 AND t.directory_consent=1 AND r.published=1;
CREATE VIEW identity_offer_renewable AS
 SELECT o.id,o.account_id,o.generation,o.recipient_hash FROM identity_offers o
 JOIN identity_offer_heads h ON h.account_id=o.account_id AND h.offer_id=o.id AND h.generation=o.generation
 JOIN identity_mail_events e ON e.id=o.mail_event_id
 WHERE o.state IN ('pending','accepted') AND NOT EXISTS(SELECT 1 FROM agent_identities i WHERE i.account_id=o.account_id) AND e.state NOT IN ('sending','unknown') AND (e.state!='pending' OR e.attempt_count=0)
 AND ((o.state='pending' AND o.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR NOT EXISTS(SELECT 1 FROM identity_offer_current_publications p WHERE p.id=o.id));
CREATE TRIGGER identity_offer_binding BEFORE INSERT ON identity_offers
 WHEN NEW.state!='pending' OR NEW.decided_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM tower_residencies t JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id WHERE t.account_id=NEW.account_id AND t.room_id=NEW.room_id AND t.resident_id=NEW.resident_id AND t.public_revision=NEW.public_revision AND t.publication_epoch=NEW.publication_epoch AND t.directory_consent=1 AND t.snapshot_consent=1 AND r.published=1 AND EXISTS(SELECT 1 FROM tower_snapshots s WHERE s.room_id=t.room_id AND s.revision=t.public_revision AND s.content_digest=NEW.snapshot_digest))
 OR EXISTS(SELECT 1 FROM agent_identities WHERE account_id=NEW.account_id)
 OR NOT ((NEW.generation=1 AND NOT EXISTS(SELECT 1 FROM identity_offers WHERE account_id=NEW.account_id)) OR EXISTS(SELECT 1 FROM identity_offer_renewable old WHERE old.account_id=NEW.account_id AND old.generation+1=NEW.generation AND old.recipient_hash=NEW.recipient_hash))
 OR NOT EXISTS(SELECT 1 FROM identity_mail_events WHERE id=NEW.mail_event_id AND kind='guardian-invitation' AND entity_id=NEW.id AND dedupe_key='identity-offer:'||NEW.id AND recipient_ciphertext=NEW.recipient_ciphertext AND recipient_hash=NEW.recipient_hash AND state='pending' AND attempt_count=0)
 BEGIN SELECT RAISE(ABORT,'identity-offer-binding'); END;
CREATE TRIGGER identity_offer_immutable BEFORE UPDATE ON identity_offers
 WHEN NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id OR NEW.generation IS NOT OLD.generation OR NEW.room_id IS NOT OLD.room_id OR NEW.resident_id IS NOT OLD.resident_id OR NEW.public_revision IS NOT OLD.public_revision OR NEW.publication_epoch IS NOT OLD.publication_epoch OR NEW.snapshot_digest IS NOT OLD.snapshot_digest OR NEW.offer_digest IS NOT OLD.offer_digest OR NEW.public_url IS NOT OLD.public_url OR NEW.guardian_designated IS NOT OLD.guardian_designated OR NEW.mail_consent IS NOT OLD.mail_consent OR NEW.recipient_ciphertext IS NOT OLD.recipient_ciphertext OR NEW.recipient_hash IS NOT OLD.recipient_hash OR NEW.token_hash IS NOT OLD.token_hash OR NEW.mail_event_id IS NOT OLD.mail_event_id OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.state!='pending' OR NEW.state NOT IN ('accepted','declined') OR NOT EXISTS(SELECT 1 FROM identity_offer_heads h WHERE h.account_id=OLD.account_id AND h.offer_id=OLD.id AND h.generation=OLD.generation)
 BEGIN SELECT RAISE(ABORT,'identity-offer-immutable'); END;
CREATE TRIGGER identity_offer_permanent BEFORE DELETE ON identity_offers BEGIN SELECT RAISE(ABORT,'identity-offer-permanent'); END;
CREATE TRIGGER identity_offer_insert_once BEFORE INSERT ON identity_offers WHEN EXISTS(SELECT 1 FROM identity_offers WHERE id=NEW.id OR (account_id=NEW.account_id AND generation=NEW.generation) OR token_hash=NEW.token_hash OR mail_event_id=NEW.mail_event_id) BEGIN SELECT RAISE(ABORT,'identity-offer-insert-once'); END;
CREATE TABLE identity_offer_audit (
 id TEXT PRIMARY KEY NOT NULL, offer_id TEXT NOT NULL REFERENCES identity_offers(id),
 action TEXT NOT NULL CHECK(action IN ('offered','accepted','declined')), created_at TEXT NOT NULL,
 UNIQUE(offer_id,action)
);
CREATE TRIGGER identity_offer_audit_immutable BEFORE UPDATE ON identity_offer_audit BEGIN SELECT RAISE(ABORT,'identity-offer-audit-immutable'); END;
CREATE TRIGGER identity_offer_audit_permanent BEFORE DELETE ON identity_offer_audit BEGIN SELECT RAISE(ABORT,'identity-offer-audit-permanent'); END;
CREATE TRIGGER identity_offer_audit_insert_once BEFORE INSERT ON identity_offer_audit WHEN EXISTS(SELECT 1 FROM identity_offer_audit WHERE id=NEW.id OR offer_id=NEW.offer_id AND action=NEW.action) BEGIN SELECT RAISE(ABORT,'identity-offer-audit-once'); END;
CREATE TRIGGER identity_offer_audit_binding BEFORE INSERT ON identity_offer_audit
 WHEN NOT EXISTS(SELECT 1 FROM identity_offers o WHERE o.id=NEW.offer_id AND ((NEW.action='offered' AND o.created_at=NEW.created_at) OR (NEW.action=o.state AND o.decided_at=NEW.created_at AND NEW.action IN ('accepted','declined'))))
 BEGIN SELECT RAISE(ABORT,'identity-offer-audit-binding'); END;

-- Database backstops protect assisted authority even if an older application
-- process still reaches its historical enrollment INSERT during a rollout.
-- A completed human decision remains valid after its one-time token expires.
CREATE TRIGGER identity_offer_acceptance_binding BEFORE UPDATE OF state ON identity_offers
 WHEN NEW.state='accepted' AND NOT EXISTS(
  SELECT 1 FROM tower_residencies t JOIN identity_offer_heads h ON h.account_id=OLD.account_id AND h.offer_id=OLD.id AND h.generation=OLD.generation JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id
   JOIN tower_snapshots s ON s.room_id=t.room_id AND s.revision=t.public_revision
  WHERE OLD.state='pending' AND NEW.decided_at IS NOT NULL
   AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.decided_at) IS NOT NULL
   AND strftime('%Y-%m-%dT%H:%M:%fZ',NEW.decided_at)=NEW.decided_at
   AND NEW.decided_at>=OLD.created_at AND NEW.decided_at<OLD.expires_at
   AND NEW.decided_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND t.account_id=OLD.account_id AND t.room_id=OLD.room_id AND t.resident_id=OLD.resident_id
   AND t.public_revision=OLD.public_revision AND t.publication_epoch=OLD.publication_epoch
   AND s.content_digest=OLD.snapshot_digest AND t.snapshot_consent=1 AND t.directory_consent=1 AND r.published=1
 )
 BEGIN SELECT RAISE(ABORT,'identity-offer-acceptance-required'); END;
CREATE TRIGGER identity_offer_enrollment_binding BEFORE INSERT ON agent_identities
 WHEN EXISTS(SELECT 1 FROM manager_admission_policy_results WHERE account_id=NEW.account_id AND decision='approve')
 AND NOT EXISTS(
  SELECT 1 FROM identity_offers o
   JOIN identity_offer_heads h ON h.account_id=o.account_id AND h.offer_id=o.id AND h.generation=o.generation
   JOIN tower_residencies t ON t.account_id=o.account_id AND t.room_id=o.room_id AND t.resident_id=o.resident_id
   JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id
   JOIN tower_snapshots s ON s.room_id=t.room_id AND s.revision=t.public_revision
  WHERE o.account_id=NEW.account_id AND o.room_id=NEW.room_id AND o.resident_id=NEW.resident_id
   AND o.state='accepted' AND o.guardian_designated=1 AND o.mail_consent=1
   AND strftime('%Y-%m-%dT%H:%M:%fZ',o.decided_at) IS NOT NULL
   AND strftime('%Y-%m-%dT%H:%M:%fZ',o.decided_at)=o.decided_at
   AND o.decided_at>=o.created_at AND o.decided_at<o.expires_at
   AND o.decided_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND t.public_revision=o.public_revision AND t.publication_epoch=o.publication_epoch
   AND s.content_digest=o.snapshot_digest AND t.snapshot_consent=1 AND t.directory_consent=1 AND r.published=1
   AND EXISTS(SELECT 1 FROM identity_offer_audit a WHERE a.offer_id=o.id AND a.action='offered' AND a.created_at=o.created_at)
   AND EXISTS(SELECT 1 FROM identity_offer_audit a WHERE a.offer_id=o.id AND a.action='accepted' AND a.created_at=o.decided_at)
 )
 BEGIN SELECT RAISE(ABORT,'identity-offer-enrollment-required'); END;

-- Exact explicit renewal requests remain permanently replayable, including after a later generation.
CREATE TABLE identity_offer_requests (
 account_id TEXT NOT NULL REFERENCES accounts(id), request_key TEXT NOT NULL CHECK(length(request_key) BETWEEN 8 AND 96),
 input_hash TEXT NOT NULL CHECK(length(input_hash)=64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
 offer_id TEXT NOT NULL UNIQUE REFERENCES identity_offers(id), created_at TEXT NOT NULL,
 PRIMARY KEY(account_id,request_key)
);
CREATE TRIGGER identity_offer_request_binding BEFORE INSERT ON identity_offer_requests
 WHEN NOT EXISTS(SELECT 1 FROM identity_offers o JOIN identity_offer_audit a ON a.offer_id=o.id AND a.action='offered' AND a.created_at=o.created_at WHERE o.id=NEW.offer_id AND o.account_id=NEW.account_id AND o.generation>1 AND o.state='pending' AND o.created_at=NEW.created_at)
 BEGIN SELECT RAISE(ABORT,'identity-offer-request-binding'); END;
CREATE TRIGGER identity_offer_request_immutable BEFORE UPDATE ON identity_offer_requests BEGIN SELECT RAISE(ABORT,'identity-offer-request-immutable'); END;
CREATE TRIGGER identity_offer_request_permanent BEFORE DELETE ON identity_offer_requests BEGIN SELECT RAISE(ABORT,'identity-offer-request-permanent'); END;
CREATE TRIGGER identity_offer_request_insert_once BEFORE INSERT ON identity_offer_requests WHEN EXISTS(SELECT 1 FROM identity_offer_requests WHERE account_id=NEW.account_id AND request_key=NEW.request_key OR offer_id=NEW.offer_id) BEGIN SELECT RAISE(ABORT,'identity-offer-request-once'); END;
CREATE TRIGGER identity_offer_head_insert BEFORE INSERT ON identity_offer_heads
 WHEN NOT EXISTS(SELECT 1 FROM identity_offers o JOIN identity_offer_audit a ON a.offer_id=o.id AND a.action='offered' AND a.created_at=o.created_at WHERE o.id=NEW.offer_id AND o.account_id=NEW.account_id AND o.generation=1 AND NEW.generation=1 AND o.state='pending')
 BEGIN SELECT RAISE(ABORT,'identity-offer-head-binding'); END;
CREATE TRIGGER identity_offer_head_update BEFORE UPDATE ON identity_offer_heads
 WHEN NEW.account_id IS NOT OLD.account_id OR NEW.generation!=OLD.generation+1
 OR EXISTS(SELECT 1 FROM agent_identities WHERE account_id=OLD.account_id)
 OR NOT EXISTS(SELECT 1 FROM identity_offer_renewable old JOIN identity_offers next ON next.account_id=old.account_id AND next.generation=old.generation+1 AND next.recipient_hash=old.recipient_hash JOIN identity_offer_requests q ON q.account_id=next.account_id AND q.offer_id=next.id WHERE old.id=OLD.offer_id AND old.generation=OLD.generation AND next.id=NEW.offer_id AND next.generation=NEW.generation AND next.state='pending')
 BEGIN SELECT RAISE(ABORT,'identity-offer-head-transition'); END;
CREATE TRIGGER identity_offer_head_permanent BEFORE DELETE ON identity_offer_heads BEGIN SELECT RAISE(ABORT,'identity-offer-head-permanent'); END;
CREATE TRIGGER identity_offer_head_insert_once BEFORE INSERT ON identity_offer_heads WHEN EXISTS(SELECT 1 FROM identity_offer_heads WHERE account_id=NEW.account_id OR offer_id=NEW.offer_id) BEGIN SELECT RAISE(ABORT,'identity-offer-head-once'); END;
