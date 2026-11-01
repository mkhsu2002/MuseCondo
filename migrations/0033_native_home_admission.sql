-- Keep the submitted address even when the public source cannot yet be read.
CREATE TABLE tower_reception_sources (
 case_id TEXT PRIMARY KEY REFERENCES tower_reception_cases(id),
 home_url TEXT NOT NULL,
 source_identity TEXT,
 resolution TEXT NOT NULL CHECK(resolution IN ('resolved','unavailable')),
 error_code TEXT,
 updated_at TEXT NOT NULL
);
-- Derive stable native asset identities from the canonical share slug, independently
-- of applicant IDs, rotated share keys, and mutable reception metadata.
CREATE VIEW tower_source_identities AS
WITH declared_sources(source_url) AS (
 SELECT source_url FROM tower_reception_cases WHERE source_url IS NOT NULL
 UNION SELECT source_url FROM tower_admission_decisions WHERE source_url IS NOT NULL
 UNION SELECT source_url FROM tower_admission_memberships
 UNION SELECT source_url FROM tower_claims
), retained_sources(source_url) AS (
 SELECT source_url FROM tower_residencies
 UNION SELECT json_extract(snapshot_json,'$.sourceURL') FROM manager_admission_jobs WHERE json_extract(snapshot_json,'$.sourceURL') IS NOT NULL
 UNION SELECT home_url FROM tower_reception_sources
), urls(source_url) AS (
 SELECT source_url FROM declared_sources UNION SELECT source_url FROM retained_sources
)
SELECT source_url,COALESCE((WITH RECURSIVE input(value) AS (SELECT urls.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0),source_url) AS source_identity FROM urls;
CREATE TRIGGER tower_reception_source_identity_insert BEFORE INSERT ON tower_reception_sources
WHEN NEW.source_identity IS NOT NULL AND (WITH RECURSIVE input(value) AS (SELECT NEW.home_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) IS NOT NULL AND NEW.source_identity IS NOT (WITH RECURSIVE input(value) AS (SELECT NEW.home_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) BEGIN SELECT RAISE(ABORT,'native_source_identity_mismatch'); END;
CREATE TRIGGER tower_reception_source_identity_update BEFORE UPDATE ON tower_reception_sources
WHEN NEW.source_identity IS NOT NULL AND (WITH RECURSIVE input(value) AS (SELECT NEW.home_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) IS NOT NULL AND NEW.source_identity IS NOT (WITH RECURSIVE input(value) AS (SELECT NEW.home_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) BEGIN SELECT RAISE(ABORT,'native_source_identity_mismatch'); END;
CREATE TRIGGER manager_admission_native_dispatch BEFORE INSERT ON manager_admission_calls
WHEN EXISTS(SELECT 1 FROM tower_reception_sources s JOIN tower_reception_cases c ON c.id=s.case_id WHERE s.case_id=NEW.case_id AND s.resolution='unavailable' AND c.is_muse_agent=1) OR EXISTS(SELECT 1 FROM manager_admission_jobs j JOIN tower_source_identities current ON current.source_url=json_extract(j.snapshot_json,'$.sourceURL') WHERE j.id=NEW.job_id AND current.source_identity GLOB 'muse-space:*' AND (
 (json_extract(j.snapshot_json,'$.isMuseAgent')=1 AND EXISTS(SELECT 1 FROM tower_residencies r JOIN tower_source_identities other ON other.source_url=r.source_url WHERE other.source_identity=current.source_identity))
 OR EXISTS(SELECT 1 FROM manager_admission_calls p JOIN manager_admission_jobs old ON old.id=p.job_id JOIN tower_source_identities other ON other.source_url=json_extract(old.snapshot_json,'$.sourceURL') WHERE old.id!=j.id AND p.phase='review' AND other.source_identity=current.source_identity AND (p.state IN ('unknown','dispatching') OR p.created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes')))
)) BEGIN SELECT RAISE(ABORT,'manager_admission_native_duplicate'); END;
CREATE TRIGGER manager_admission_native_approval BEFORE INSERT ON manager_admission_results
WHEN NEW.decision='approve' AND EXISTS(SELECT 1 FROM manager_admission_jobs j JOIN tower_source_identities current ON current.source_url=json_extract(j.snapshot_json,'$.sourceURL') JOIN tower_residencies r JOIN tower_source_identities other ON other.source_url=r.source_url WHERE j.id=NEW.job_id AND current.source_identity=other.source_identity)
BEGIN SELECT RAISE(ABORT,'manager_admission_native_duplicate'); END;
CREATE TRIGGER tower_native_residency_insert BEFORE INSERT ON tower_residencies
WHEN EXISTS(SELECT 1 FROM tower_residencies r JOIN tower_source_identities i ON i.source_url=r.source_url WHERE i.source_identity=(WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0)) AND (WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'native_residency_duplicate'); END;
CREATE TRIGGER tower_native_residency_update BEFORE UPDATE OF source_url ON tower_residencies
WHEN (WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) IS NOT NULL AND EXISTS(SELECT 1 FROM tower_residencies r JOIN tower_source_identities i ON i.source_url=r.source_url WHERE r.account_id!=NEW.account_id AND i.source_identity=(WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0)) BEGIN SELECT RAISE(ABORT,'native_residency_duplicate'); END;

-- Rotating a public share key does not create a new native home. Carry only an
-- already imported, exact membership's original qualification while its case is
-- active. Source control still requires a fresh exact-URL claim below. Permanent
-- identity enrollment is independent and is not a prerequisite for this alias.
CREATE VIEW tower_admission_native_alias AS
SELECT d.id AS decision_id,t.account_id,t.room_id,t.resident_id,
 t.source_url AS current_source_url,original.source_identity
FROM tower_admission_decisions d
JOIN tower_admission_memberships m ON m.decision_id=d.id AND m.account_id=d.account_id AND m.resident_id=d.resident_id AND m.source_url=d.source_url
JOIN tower_reception_cases c ON c.id=d.case_id AND c.state='active' AND c.account_id=d.account_id AND c.resident_id=d.resident_id AND c.source_url=d.source_url AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
JOIN tower_residencies t ON t.account_id=m.account_id AND t.room_id=m.room_id AND t.resident_id=m.resident_id
JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id
JOIN tower_source_identities original ON original.source_url=d.source_url
JOIN tower_source_identities current ON current.source_url=t.source_url AND current.source_identity=original.source_identity
WHERE original.source_identity GLOB 'muse-space:*' AND current.source_identity GLOB 'muse-space:*';

DROP VIEW tower_admission_eligible;
CREATE VIEW tower_admission_eligible AS
 SELECT d.* FROM tower_admission_decisions d JOIN tower_admission_heads h ON h.decision_id=d.id
 JOIN tower_admission_current c ON c.id=1 AND c.policy_version=d.policy_version
 JOIN tower_admission_policies p ON p.version=c.policy_version
 WHERE d.state='eligible' AND d.created_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND d.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND EXISTS(SELECT 1 FROM json_each(p.allowed_agent_origins_json) WHERE value=d.agent_origin)
 AND (p.require_operator_review=0 OR d.evidence_kind IN ('operator-review','existing-resident','platform-attestation'))
 AND (d.case_id IS NULL OR EXISTS(SELECT 1 FROM tower_reception_cases r WHERE r.id=d.case_id AND (r.state IN ('pending','approved','active') OR EXISTS(SELECT 1 FROM tower_admission_continuity k WHERE k.decision_id=d.id) OR EXISTS(SELECT 1 FROM tower_admission_memberships m JOIN tower_residencies t ON t.account_id=m.account_id AND t.room_id=m.room_id AND t.resident_id=m.resident_id AND t.source_url=m.source_url WHERE m.account_id=d.account_id AND EXISTS(SELECT 1 FROM tower_admission_decisions admitted WHERE admitted.id=m.decision_id AND admitted.case_id=d.case_id AND admitted.account_id=d.account_id AND admitted.resident_id=d.resident_id AND admitted.source_url=d.source_url) AND m.resident_id=d.resident_id AND m.source_url=d.source_url AND (m.agent_id IS NULL OR EXISTS(SELECT 1 FROM agent_identities i WHERE i.agent_id=m.agent_id AND i.account_id=m.account_id AND i.room_id=m.room_id AND i.resident_id=m.resident_id)))) AND (r.account_id IS NULL OR r.account_id=d.account_id) AND (r.resident_id IS NULL OR r.resident_id=d.resident_id) AND (r.source_url IS NULL OR r.source_url=d.source_url OR EXISTS(SELECT 1 FROM tower_admission_continuity k WHERE k.decision_id=d.id))))
 AND (d.reviewed_room_id IS NULL OR EXISTS(SELECT 1 FROM tower_residencies t WHERE t.account_id=d.account_id AND t.room_id=d.reviewed_room_id))
 AND (NOT EXISTS(SELECT 1 FROM tower_residencies t WHERE t.account_id=d.account_id) OR EXISTS(SELECT 1 FROM tower_residencies t JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id WHERE t.account_id=d.account_id AND t.resident_id=d.resident_id AND (t.source_url=d.source_url OR EXISTS(SELECT 1 FROM tower_admission_continuity k WHERE k.decision_id=d.id AND k.room_id=t.room_id) OR EXISTS(SELECT 1 FROM tower_admission_native_alias k WHERE k.decision_id=d.id AND k.room_id=t.room_id))))
 AND NOT EXISTS(SELECT 1 FROM tower_admission_heads hn JOIN tower_admission_decisions n ON n.id=hn.decision_id WHERE n.policy_version=d.policy_version AND n.account_id=d.account_id AND n.resident_id=d.resident_id AND (n.source_url=d.source_url OR EXISTS(SELECT 1 FROM tower_admission_continuity k WHERE k.decision_id=d.id) OR EXISTS(SELECT 1 FROM tower_admission_native_alias k JOIN tower_source_identities ni ON ni.source_url=n.source_url AND ni.source_identity=k.source_identity WHERE k.decision_id=d.id)) AND n.state='ineligible')
 AND (d.continuity_agent_id IS NULL OR EXISTS(SELECT 1 FROM agent_identities i WHERE i.agent_id=d.continuity_agent_id AND i.account_id=d.account_id AND i.resident_id=d.resident_id));

DROP TRIGGER admission_tower_claims_insert;
CREATE TRIGGER admission_tower_claims_insert BEFORE INSERT ON tower_claims WHEN NOT (EXISTS(SELECT 1 FROM tower_admission_current c JOIN tower_admission_policies p ON p.version=c.policy_version WHERE c.id=1 AND p.allowed_agent_origins_json='["*"]' AND p.require_operator_review=0) OR EXISTS(SELECT 1 FROM tower_admission_eligible d WHERE d.account_id=NEW.account_id AND d.resident_id=NEW.resident_id AND (d.source_url=NEW.source_url OR EXISTS(SELECT 1 FROM tower_admission_continuity k WHERE k.decision_id=d.id AND k.account_id=NEW.account_id AND k.resident_id=NEW.resident_id) OR ((WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) IS NOT NULL AND EXISTS(SELECT 1 FROM tower_admission_native_alias alias WHERE alias.decision_id=d.id AND alias.account_id=NEW.account_id AND alias.resident_id=NEW.resident_id AND alias.source_identity=(WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0)))))) BEGIN SELECT RAISE(ABORT,'admission_required');END;

DROP TRIGGER admission_tower_claims_update;
CREATE TRIGGER admission_tower_claims_update BEFORE UPDATE ON tower_claims WHEN (NEW.account_id!=OLD.account_id OR NEW.resident_id!=OLD.resident_id OR NEW.source_url!=OLD.source_url OR NEW.verified>OLD.verified) AND NOT (EXISTS(SELECT 1 FROM tower_admission_current c JOIN tower_admission_policies p ON p.version=c.policy_version WHERE c.id=1 AND p.allowed_agent_origins_json='["*"]' AND p.require_operator_review=0) OR EXISTS(SELECT 1 FROM tower_admission_eligible d WHERE d.account_id=NEW.account_id AND d.resident_id=NEW.resident_id AND (d.source_url=NEW.source_url OR EXISTS(SELECT 1 FROM tower_admission_continuity k WHERE k.decision_id=d.id AND k.account_id=NEW.account_id AND k.resident_id=NEW.resident_id) OR ((WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) IS NOT NULL AND EXISTS(SELECT 1 FROM tower_admission_native_alias alias WHERE alias.decision_id=d.id AND alias.account_id=NEW.account_id AND alias.resident_id=NEW.resident_id AND alias.source_identity=(WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0)))))) BEGIN SELECT RAISE(ABORT,'admission_required');END;

DROP TRIGGER admission_tower_residencies_update;
CREATE TRIGGER admission_tower_residencies_update BEFORE UPDATE ON tower_residencies WHEN (NEW.account_id!=OLD.account_id OR NEW.resident_id!=OLD.resident_id OR NEW.source_url!=OLD.source_url OR (NEW.public_revision IS NOT NULL AND NEW.public_revision IS NOT OLD.public_revision) OR NEW.directory_consent>OLD.directory_consent OR NEW.announcement_consent>OLD.announcement_consent OR NEW.dream_consent>OLD.dream_consent OR NEW.snapshot_consent>OLD.snapshot_consent) AND NOT (EXISTS(SELECT 1 FROM tower_admission_current c JOIN tower_admission_policies p ON p.version=c.policy_version WHERE c.id=1 AND p.allowed_agent_origins_json='["*"]' AND p.require_operator_review=0) OR EXISTS(SELECT 1 FROM tower_admission_eligible d WHERE d.account_id=NEW.account_id AND d.resident_id=NEW.resident_id AND (d.source_url=NEW.source_url OR EXISTS(SELECT 1 FROM tower_admission_continuity k WHERE k.decision_id=d.id AND k.account_id=NEW.account_id AND k.resident_id=NEW.resident_id) OR ((WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) IS NOT NULL AND EXISTS(SELECT 1 FROM tower_admission_native_alias alias WHERE alias.decision_id=d.id AND alias.account_id=NEW.account_id AND alias.resident_id=NEW.resident_id AND alias.source_identity=(WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0)))))) BEGIN SELECT RAISE(ABORT,'admission_required');END;

DROP TRIGGER admission_verified_source_move;
CREATE TRIGGER admission_verified_source_move BEFORE UPDATE OF source_url ON tower_residencies
 WHEN NEW.source_url!=OLD.source_url
 AND NOT EXISTS(SELECT 1 FROM tower_admission_current c JOIN tower_admission_policies p ON p.version=c.policy_version WHERE c.id=1 AND p.allowed_agent_origins_json='["*"]' AND p.require_operator_review=0)
 AND (NEW.account_id!=OLD.account_id OR NEW.room_id!=OLD.room_id OR NEW.resident_id!=OLD.resident_id
  OR NOT EXISTS(SELECT 1 FROM tower_admission_eligible d WHERE d.account_id=OLD.account_id AND d.resident_id=OLD.resident_id AND (EXISTS(SELECT 1 FROM tower_admission_continuity k WHERE k.decision_id=d.id AND k.account_id=OLD.account_id AND k.room_id=OLD.room_id AND k.resident_id=OLD.resident_id) OR ((WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) IS NOT NULL AND EXISTS(SELECT 1 FROM tower_admission_native_alias alias WHERE alias.decision_id=d.id AND alias.account_id=NEW.account_id AND alias.resident_id=NEW.resident_id AND alias.source_identity=(WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0)))))
  OR NOT EXISTS(SELECT 1 FROM tower_claims proof WHERE proof.account_id=OLD.account_id AND proof.resident_id=OLD.resident_id AND proof.source_url=NEW.source_url AND proof.verified=1 AND proof.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
 BEGIN SELECT RAISE(ABORT,'admission_source_proof');END;

-- First import must still hold the exact active reception grant at commit time.
-- A readable source and a permanent qualification do not extend its activation lease.
CREATE TRIGGER tower_native_first_import_grant BEFORE INSERT ON tower_residencies
WHEN (WITH RECURSIVE input(value) AS (SELECT NEW.source_url), tokens(value,slug,share_key) AS (
 SELECT value,substr(substr(value,19),1,instr(substr(value,19),'/')-1),substr(value,19+instr(substr(value,19),'/')) FROM input
 ), parts(rest) AS (SELECT slug FROM tokens UNION ALL SELECT substr(rest,instr(rest,'-')+1) FROM parts WHERE instr(rest,'-')>0)
 SELECT CASE WHEN substr(value,1,18)='https://muse.ai/s/' AND length(slug) BETWEEN 1 AND 181 AND substr(slug,1,1) GLOB '[A-Za-z0-9]' AND slug NOT GLOB '*[^A-Za-z0-9_-]*' AND instr(slug,'-')>0 AND length(share_key)=43 AND share_key NOT GLOB '*[^A-Za-z0-9_-]*' AND length(rest) BETWEEN 3 AND 26 AND rest NOT GLOB '*[^a-z0-9]*' THEN 'muse-space:'||rest ELSE NULL END FROM tokens,parts WHERE instr(rest,'-')=0) IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM tower_admission_current policy JOIN tower_admission_policies p ON p.version=policy.policy_version WHERE policy.id=1 AND p.allowed_agent_origins_json='["*"]' AND p.require_operator_review=0)
 AND NOT EXISTS(SELECT 1 FROM tower_admission_eligible d JOIN tower_reception_cases c ON c.id=d.case_id WHERE d.account_id=NEW.account_id AND d.resident_id=NEW.resident_id AND d.source_url=NEW.source_url AND c.account_id=d.account_id AND c.resident_id=d.resident_id AND c.source_url=d.source_url AND c.state='active' AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND c.approval_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'native_first_import_grant_required'); END;
