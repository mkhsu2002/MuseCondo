-- Public source declarations are not ownership. A review only creates a short,
-- non-renewing cooldown, never an exclusive source reservation. Existing grants,
-- ownership challenges and residences are unchanged.
CREATE TRIGGER manager_admission_serial_review BEFORE UPDATE OF state ON manager_admission_jobs
WHEN NEW.state='running' AND OLD.state='queued' AND EXISTS(SELECT 1 FROM manager_admission_jobs WHERE state='running' AND id!=NEW.id)
BEGIN SELECT RAISE(ABORT,'manager_admission_review_busy'); END;

-- Check inside the same transaction that persists the pre-dispatch receipt.
-- Match immutable snapshots, not an applicant's subsequently editable case.
CREATE TRIGGER manager_admission_duplicate_dispatch BEFORE INSERT ON manager_admission_calls
WHEN EXISTS(SELECT 1 FROM manager_admission_jobs j WHERE j.id=NEW.job_id AND (
 (json_extract(j.snapshot_json,'$.isMuseAgent')=1 AND EXISTS(SELECT 1 FROM tower_residencies r WHERE r.source_url=json_extract(j.snapshot_json,'$.sourceURL') OR r.resident_id=json_extract(j.snapshot_json,'$.residentId')))
 OR EXISTS(SELECT 1 FROM manager_admission_calls p JOIN manager_admission_jobs old ON old.id=p.job_id WHERE old.id!=j.id AND p.phase='review' AND p.created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes') AND (json_extract(old.snapshot_json,'$.sourceURL')=json_extract(j.snapshot_json,'$.sourceURL') OR json_extract(old.snapshot_json,'$.residentId')=json_extract(j.snapshot_json,'$.residentId')))
))
BEGIN SELECT RAISE(ABORT,'manager_admission_duplicate_dispatch'); END;

-- A residence may connect while source downloads or paid review are in flight.
CREATE TRIGGER manager_admission_duplicate_approval BEFORE INSERT ON manager_admission_results
WHEN NEW.decision='approve' AND EXISTS(SELECT 1 FROM manager_admission_jobs j JOIN tower_residencies r ON r.source_url=json_extract(j.snapshot_json,'$.sourceURL') OR r.resident_id=json_extract(j.snapshot_json,'$.residentId') WHERE j.id=NEW.job_id)
BEGIN SELECT RAISE(ABORT,'manager_admission_duplicate_approval'); END;
