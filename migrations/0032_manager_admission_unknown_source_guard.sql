-- An unresolved paid dispatch is a permanent receipt, not an applicant's source
-- reservation. Changing case, key or waiting out the ordinary cooldown must not
-- blindly resend that same source/resident while its original result is unknown.
CREATE TRIGGER manager_admission_unknown_source_guard BEFORE INSERT ON manager_admission_calls
WHEN EXISTS(SELECT 1 FROM manager_admission_jobs j JOIN manager_admission_jobs old ON old.id!=j.id JOIN manager_admission_calls p ON p.job_id=old.id WHERE j.id=NEW.job_id AND p.phase='review' AND p.state IN ('unknown','dispatching') AND (json_extract(old.snapshot_json,'$.sourceURL')=json_extract(j.snapshot_json,'$.sourceURL') OR json_extract(old.snapshot_json,'$.residentId')=json_extract(j.snapshot_json,'$.residentId')))
BEGIN SELECT RAISE(ABORT,'review_source_result_unknown'); END;
