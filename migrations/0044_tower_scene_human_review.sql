-- Human quality review is separate from the unchanged model verdict and paid receipts.
CREATE TABLE tower_scene_human_reviews(
 scene_id TEXT PRIMARY KEY REFERENCES tower_scenes(id),
 image_sha256 TEXT NOT NULL CHECK(length(image_sha256)=64 AND image_sha256 NOT GLOB '*[^a-f0-9]*'),
 reason TEXT NOT NULL CHECK(reason='duplicate_composition'),
 reference_id TEXT NOT NULL REFERENCES tower_scenes(id),
 reference_sha256 TEXT NOT NULL CHECK(length(reference_sha256)=64 AND reference_sha256 NOT GLOB '*[^a-f0-9]*'),
 created_at TEXT NOT NULL
);
CREATE TRIGGER tower_scene_human_review_scope BEFORE INSERT ON tower_scene_human_reviews WHEN
 EXISTS(SELECT 1 FROM tower_scene_human_reviews WHERE scene_id=NEW.scene_id) OR
 NOT EXISTS(SELECT 1 FROM tower_scene_canonical s JOIN tower_scenes ref ON ref.id=NEW.reference_id
 WHERE s.id=NEW.scene_id AND s.state='reviewed' AND s.batch_id IS NOT NULL AND s.period_key IS NULL
 AND s.id NOT IN('seed-v1-01','seed-v1-02','seed-v1-05') AND s.logical_slot NOT IN('seed-v1-01','seed-v1-02','seed-v1-05')
 AND s.sha256=NEW.image_sha256 AND s.object_key IS NOT NULL AND json_extract(s.review_json,'$.pass')=1
 AND EXISTS(SELECT 1 FROM tower_scene_calls c JOIN tower_scene_results result ON result.job_id=c.job_id JOIN json_each(result.result_json,'$.output') message JOIN json_each(message.value,'$.content') content WHERE c.scene_id=s.id AND c.purpose='review' AND json_extract(message.value,'$.type')='message' AND json_extract(content.value,'$.type')='output_text' AND json_valid(json_extract(content.value,'$.text')) AND json_extract(json_extract(content.value,'$.text'),'$.pass')=1)
 AND ref.id!=s.id AND ref.state='published' AND ref.sha256=NEW.reference_sha256
 AND abs(julianday(NEW.created_at)-julianday('now'))<1.0/1440
 AND (SELECT count(*) FROM tower_scene_calls c JOIN manager_jobs j ON j.id=c.job_id WHERE c.scene_id=s.id AND j.state='complete' AND j.actual_micro IS NOT NULL AND j.actual_micro<=j.reserved_micro)=3)
 BEGIN SELECT RAISE(ABORT,'scene_human_review_scope'); END;
CREATE TRIGGER tower_scene_human_review_immutable BEFORE UPDATE ON tower_scene_human_reviews BEGIN SELECT RAISE(ABORT,'scene_human_review_immutable'); END;
CREATE TRIGGER tower_scene_human_review_permanent BEFORE DELETE ON tower_scene_human_reviews BEGIN SELECT RAISE(ABORT,'scene_human_review_permanent'); END;
-- A rejected artifact cannot be published or have its prior model evidence rewritten.
CREATE TRIGGER tower_scene_human_rejected BEFORE UPDATE ON tower_scenes WHEN EXISTS(SELECT 1 FROM tower_scene_human_reviews WHERE scene_id=OLD.id) BEGIN SELECT RAISE(ABORT,'scene_human_rejected'); END;
DROP TRIGGER tower_scene_repair_scope;
CREATE TRIGGER tower_scene_repair_scope BEFORE INSERT ON tower_scene_repairs WHEN
 EXISTS(SELECT 1 FROM tower_scene_repairs WHERE id=NEW.id) OR
 NOT EXISTS(SELECT 1 FROM tower_scene_canonical s WHERE s.id=NEW.source_id AND s.id NOT IN('seed-v1-01','seed-v1-02','seed-v1-05') AND s.logical_slot NOT IN('seed-v1-01','seed-v1-02','seed-v1-05') AND NEW.logical_slot=s.logical_slot AND NEW.scene_key=s.scene_key AND NEW.root_batch IS s.root_batch AND NEW.baseline_sha=s.baseline_sha AND NEW.bible_version=s.bible_version
 AND NOT EXISTS(SELECT 1 FROM tower_scene_calls c JOIN manager_jobs j ON j.id=c.job_id WHERE c.scene_id=s.id AND (j.state!='complete' OR j.actual_micro IS NULL OR j.actual_micro>j.reserved_micro))
 AND abs(julianday(NEW.created_at)-julianday('now'))<1.0/1440
 AND ((NEW.mode='resume' AND s.state='blocked' AND (s.error_code='token_count_unavailable' OR s.error_code LIKE 'token_count_http_%' OR s.error_code IN('token_count_timeout','token_count_network','token_count_invalid')) AND NEW.attempt=s.attempt AND (SELECT count(*) FROM tower_scene_repairs WHERE source_id=s.id AND mode='resume')<3 AND NOT EXISTS(SELECT 1 FROM tower_scene_repairs r WHERE r.source_id=s.id AND r.mode='resume' AND NOT EXISTS(SELECT 1 FROM tower_scene_repair_events e WHERE e.repair_id=r.id AND e.event='settled')) AND NOT EXISTS(SELECT 1 FROM tower_scene_calls c WHERE c.scene_id=s.id AND c.purpose='review') AND (SELECT count(*) FROM tower_scene_calls WHERE scene_id=s.id) IN(0,2) AND ((s.plan_json IS NULL AND s.object_key IS NULL) OR (s.plan_json IS NOT NULL AND s.object_key IS NOT NULL)))
 OR (NEW.mode='replace' AND s.batch_id IS NOT NULL AND ((s.state='invalid' AND s.error_code='scene_review_failed') OR (s.state='reviewed' AND EXISTS(SELECT 1 FROM tower_scene_human_reviews h WHERE h.scene_id=s.id AND h.image_sha256=s.sha256))) AND NEW.attempt=s.attempt+1 AND NEW.attempt<=2 AND NEW.target_id=s.logical_slot||'-r'||NEW.attempt AND NEW.repair_batch='repair-'||NEW.id AND NEW.repair_batch!=s.batch_id AND NOT EXISTS(SELECT 1 FROM tower_scenes WHERE id=NEW.target_id) AND (SELECT count(*) FROM tower_scene_calls c JOIN manager_jobs j ON j.id=c.job_id WHERE c.scene_id=s.id AND j.state='complete' AND j.actual_micro IS NOT NULL)=3 AND EXISTS(SELECT 1 FROM tower_scene_calls c JOIN tower_scene_results r ON r.job_id=c.job_id JOIN json_each(r.result_json,'$.output') message JOIN json_each(message.value,'$.content') content WHERE c.scene_id=s.id AND c.purpose='review' AND json_extract(message.value,'$.type')='message' AND json_extract(content.value,'$.type')='output_text' AND json_valid(json_extract(content.value,'$.text')) AND ((s.state='invalid' AND json_extract(json_extract(content.value,'$.text'),'$.pass')=0) OR (s.state='reviewed' AND json_extract(json_extract(content.value,'$.text'),'$.pass')=1 AND EXISTS(SELECT 1 FROM tower_scene_human_reviews h WHERE h.scene_id=s.id AND h.image_sha256=s.sha256)))))))
 BEGIN SELECT RAISE(ABORT,'scene_repair_scope'); END;
