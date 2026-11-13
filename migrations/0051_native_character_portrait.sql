-- Future native snapshots may carry a bounded public character crop; existing snapshots remain immutable.
DROP TRIGGER private_home_snapshot_shape;
CREATE TRIGGER private_home_snapshot_shape BEFORE INSERT ON private_home_snapshots BEGIN
 SELECT CASE WHEN json_valid(NEW.content_json) AND json_type(NEW.content_json)='object'
 AND (SELECT count(*) FROM json_each(NEW.content_json)) BETWEEN 5 AND 7
 AND (SELECT count(DISTINCT key) FROM json_each(NEW.content_json))=(SELECT count(*) FROM json_each(NEW.content_json))
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.content_json) WHERE key NOT IN ('name','intro','profile','journal','dream','preferredLanguage','characterPortraitCrop') OR type<>'text')
 AND json_type(NEW.content_json,'$.name')='text' AND json_type(NEW.content_json,'$.intro')='text'
 AND json_type(NEW.content_json,'$.profile')='text' AND json_type(NEW.content_json,'$.journal')='text' AND json_type(NEW.content_json,'$.dream')='text'
 AND length(json_extract(NEW.content_json,'$.name')) BETWEEN 1 AND 80
 AND length(json_extract(NEW.content_json,'$.intro'))<=1200
 AND length(json_extract(NEW.content_json,'$.profile'))<=16000
 AND length(json_extract(NEW.content_json,'$.journal'))<=16000
 AND length(json_extract(NEW.content_json,'$.dream'))<=16000
 AND (json_type(NEW.content_json,'$.preferredLanguage') IS NULL OR json_extract(NEW.content_json,'$.preferredLanguage') IN ('en','zh-TW'))
 AND CASE WHEN json_type(NEW.content_json,'$.characterPortraitCrop') IS NULL THEN 1
 WHEN length(json_extract(NEW.content_json,'$.characterPortraitCrop')) BETWEEN 7 AND 100
 AND json_extract(NEW.content_json,'$.characterPortraitCrop') NOT GLOB '*[^0-9.,]*'
 AND json_valid('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']')
 THEN CASE WHEN json_array_length('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']')=4
 AND NOT EXISTS(SELECT 1 FROM json_each('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']') WHERE type NOT IN ('integer','real'))
 AND json_extract('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']','$[0]')>=0
 AND json_extract('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']','$[1]')>=0
 AND json_extract('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']','$[2]')>0
 AND json_extract('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']','$[3]')>0
 AND json_extract('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']','$[0]')+json_extract('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']','$[2]')<=100
 AND json_extract('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']','$[1]')+json_extract('['||json_extract(NEW.content_json,'$.characterPortraitCrop')||']','$[3]')<=100
 THEN 1 ELSE 0 END ELSE 0 END=1
 THEN 1 ELSE RAISE(ABORT,'native_content_shape') END;
END;
