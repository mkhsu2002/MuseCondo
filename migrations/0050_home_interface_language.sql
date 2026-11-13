-- Preserve immutable existing snapshots; only future inserts may carry a UI language.
DROP TRIGGER private_home_snapshot_shape;
CREATE TRIGGER private_home_snapshot_shape BEFORE INSERT ON private_home_snapshots BEGIN
 SELECT CASE WHEN json_valid(NEW.content_json) AND json_type(NEW.content_json)='object'
 AND (SELECT count(*) FROM json_each(NEW.content_json)) BETWEEN 5 AND 6
 AND (SELECT count(DISTINCT key) FROM json_each(NEW.content_json))=(SELECT count(*) FROM json_each(NEW.content_json))
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.content_json) WHERE key NOT IN ('name','intro','profile','journal','dream','preferredLanguage') OR type<>'text')
 AND json_type(NEW.content_json,'$.name')='text' AND json_type(NEW.content_json,'$.intro')='text'
 AND json_type(NEW.content_json,'$.profile')='text' AND json_type(NEW.content_json,'$.journal')='text' AND json_type(NEW.content_json,'$.dream')='text'
 AND length(json_extract(NEW.content_json,'$.name')) BETWEEN 1 AND 80
 AND length(json_extract(NEW.content_json,'$.intro'))<=1200
 AND length(json_extract(NEW.content_json,'$.profile'))<=16000
 AND length(json_extract(NEW.content_json,'$.journal'))<=16000
 AND length(json_extract(NEW.content_json,'$.dream'))<=16000
 AND (json_type(NEW.content_json,'$.preferredLanguage') IS NULL OR json_extract(NEW.content_json,'$.preferredLanguage') IN ('en','zh-TW'))
 THEN 1 ELSE RAISE(ABORT,'native_content_shape') END;
END;
