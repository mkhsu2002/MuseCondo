-- Optional display derivatives never replace a source image or confer publication rights.
CREATE TABLE tower_image_jobs (
 id TEXT PRIMARY KEY CHECK(length(id)=64 AND id NOT GLOB '*[^a-f0-9]*'),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('home','scene','appearance')),
 source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 128),
 source_sha TEXT NOT NULL CHECK(length(source_sha)=64 AND source_sha NOT GLOB '*[^a-f0-9]*'),
 source_epoch TEXT NOT NULL,
 source_bytes INTEGER NOT NULL CHECK(source_bytes BETWEEN 1 AND 8388608),
 profile TEXT NOT NULL CHECK(profile='cf-webp-1920-q85-v1'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','ready','rejected','unknown','cancelled')),
 daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 64),
 monthly_limit INTEGER NOT NULL CHECK(monthly_limit BETWEEN 1 AND 1000),
 created_at TEXT NOT NULL, claimed_at TEXT, reserved_day TEXT, reserved_month TEXT, lease_token TEXT, lease_until TEXT,
 source_width INTEGER,source_height INTEGER,
 object_key TEXT,output_sha TEXT,output_bytes INTEGER,output_width INTEGER,output_height INTEGER,
 error_code TEXT,
 UNIQUE(source_kind,source_id,source_sha,source_epoch,profile),
 CHECK((claimed_at IS NULL AND reserved_day IS NULL AND reserved_month IS NULL AND lease_token IS NULL AND lease_until IS NULL) OR
       (claimed_at IS NOT NULL AND reserved_day=substr(claimed_at,1,10) AND reserved_month=substr(claimed_at,1,7) AND length(lease_token)=32 AND lease_token NOT GLOB '*[^a-f0-9]*' AND lease_until>claimed_at)),
 CHECK(state!='running' OR claimed_at IS NOT NULL),
 CHECK(state!='ready' OR (claimed_at IS NOT NULL AND object_key='tower-auto-derivatives/v1/'||id||'/'||output_sha||'.webp' AND length(output_sha)=64 AND output_sha NOT GLOB '*[^a-f0-9]*' AND output_bytes BETWEEN 1 AND 2097152 AND output_bytes<source_bytes AND output_width BETWEEN 1 AND 1920 AND output_height BETWEEN 1 AND 1920))
);
CREATE INDEX tower_image_pending ON tower_image_jobs(state,created_at);
CREATE TABLE tower_image_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL REFERENCES tower_image_jobs(id),kind TEXT NOT NULL,
 detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),created_at TEXT NOT NULL
);
CREATE TRIGGER tower_image_job_insert BEFORE INSERT ON tower_image_jobs BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_image_jobs WHERE id=NEW.id) OR NEW.state!='pending' OR NEW.claimed_at IS NOT NULL OR NEW.object_key IS NOT NULL OR NEW.output_sha IS NOT NULL OR NEW.output_bytes IS NOT NULL OR NEW.output_width IS NOT NULL OR NEW.output_height IS NOT NULL OR NEW.source_width IS NOT NULL OR NEW.source_height IS NOT NULL THEN RAISE(ABORT,'tower-image-initial-state') END;
END;
CREATE TRIGGER tower_image_job_transition BEFORE UPDATE ON tower_image_jobs BEGIN
 SELECT CASE WHEN NEW.id!=OLD.id OR NEW.source_kind!=OLD.source_kind OR NEW.source_id!=OLD.source_id OR NEW.source_sha!=OLD.source_sha OR NEW.source_epoch!=OLD.source_epoch OR NEW.source_bytes!=OLD.source_bytes OR NEW.profile!=OLD.profile OR NEW.daily_limit!=OLD.daily_limit OR NEW.monthly_limit!=OLD.monthly_limit OR NEW.created_at!=OLD.created_at THEN RAISE(ABORT,'tower-image-binding') END;
 SELECT CASE WHEN NOT ((OLD.state='pending' AND NEW.state IN ('running','cancelled')) OR (OLD.state='running' AND NEW.state IN ('ready','rejected','unknown','cancelled'))) THEN RAISE(ABORT,'tower-image-terminal') END;
 SELECT CASE WHEN OLD.claimed_at IS NOT NULL AND (NEW.claimed_at IS NOT OLD.claimed_at OR NEW.reserved_day IS NOT OLD.reserved_day OR NEW.reserved_month IS NOT OLD.reserved_month OR NEW.lease_token IS NOT OLD.lease_token OR NEW.lease_until IS NOT OLD.lease_until OR NEW.source_width IS NOT OLD.source_width OR NEW.source_height IS NOT OLD.source_height) THEN RAISE(ABORT,'tower-image-reservation-immutable') END;
 SELECT CASE WHEN OLD.state='pending' AND NEW.state='running' AND (
   NEW.claimed_at!=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.lease_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 minutes') OR NEW.source_width IS NULL OR NEW.source_height IS NULL OR NEW.source_width NOT BETWEEN 1 AND 8192 OR NEW.source_height NOT BETWEEN 1 AND 8192 OR
   (SELECT COUNT(*) FROM tower_image_jobs WHERE reserved_day=substr(strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,10))>=NEW.daily_limit OR
   (SELECT COUNT(*) FROM tower_image_jobs WHERE reserved_month=substr(strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,7))>=NEW.monthly_limit
 ) THEN RAISE(ABORT,'tower-image-quota-or-clock') END;
 SELECT CASE WHEN NEW.state='ready' AND (OLD.lease_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.output_width>OLD.source_width OR NEW.output_height>OLD.source_height) THEN RAISE(ABORT,'tower-image-ready-expired') END;
 SELECT CASE WHEN NEW.state!='ready' AND (NEW.object_key IS NOT NULL OR NEW.output_sha IS NOT NULL OR NEW.output_bytes IS NOT NULL OR NEW.output_width IS NOT NULL OR NEW.output_height IS NOT NULL) THEN RAISE(ABORT,'tower-image-output-state') END;
END;
CREATE TRIGGER tower_image_job_delete BEFORE DELETE ON tower_image_jobs BEGIN SELECT RAISE(ABORT,'tower-image-permanent'); END;
CREATE TRIGGER tower_image_job_created AFTER INSERT ON tower_image_jobs BEGIN
 INSERT INTO tower_image_events(job_id,kind,detail_json,created_at) VALUES(NEW.id,'pending',json_object('profile',NEW.profile),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER tower_image_job_event AFTER UPDATE ON tower_image_jobs BEGIN
 INSERT INTO tower_image_events(job_id,kind,detail_json,created_at) VALUES(NEW.id,NEW.state,json_object('errorCode',NEW.error_code,'reservedDay',NEW.reserved_day,'reservedMonth',NEW.reserved_month,'outputSha',NEW.output_sha,'outputBytes',NEW.output_bytes),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER tower_image_event_update BEFORE UPDATE ON tower_image_events BEGIN SELECT RAISE(ABORT,'tower-image-audit-immutable'); END;
CREATE TRIGGER tower_image_event_delete BEFORE DELETE ON tower_image_events BEGIN SELECT RAISE(ABORT,'tower-image-audit-permanent'); END;
CREATE TRIGGER tower_image_event_replace BEFORE INSERT ON tower_image_events WHEN EXISTS(SELECT 1 FROM tower_image_events WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'tower-image-audit-replace'); END;
