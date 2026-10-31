-- Dormant private delivery facts only. No route, provider setup or send authorization.
CREATE TABLE identity_mail_delivery_receipts (
 source TEXT NOT NULL CHECK(source IN ('webhook','readback')),
 origin TEXT NOT NULL CHECK(length(origin) BETWEEN 9 AND 512 AND length(CAST(origin AS BLOB))=length(origin) AND origin GLOB 'https://*' AND instr(substr(origin,9),'/')=0 AND instr(origin,'?')=0 AND instr(origin,'#')=0 AND instr(origin,'@')=0),
 message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 128 AND length(CAST(message_id AS BLOB))=length(message_id) AND message_id NOT GLOB '*[^A-Za-z0-9_-]*'),
 event_id TEXT NOT NULL REFERENCES identity_mail_dispatches(event_id),
 provider_id TEXT NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 128 AND length(CAST(provider_id AS BLOB))=length(provider_id) AND provider_id NOT GLOB '*[^A-Za-z0-9_-]*'),
 payload_hmac TEXT NOT NULL CHECK(length(payload_hmac)=64 AND length(CAST(payload_hmac AS BLOB))=64 AND payload_hmac NOT GLOB '*[^0-9a-f]*'),
 result_json TEXT NOT NULL CHECK(json_valid(result_json) AND json_type(result_json)='object' AND length(CAST(result_json AS BLOB))<=2048),
 observed_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',observed_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',observed_at)=observed_at),
 PRIMARY KEY(source,message_id)
);
CREATE TRIGGER identity_mail_delivery_receipt_binding BEFORE INSERT ON identity_mail_delivery_receipts
 WHEN NOT EXISTS(SELECT 1 FROM identity_mail_dispatches d JOIN identity_mail_envelopes v ON v.event_id=d.event_id JOIN identity_mail_events e ON e.id=d.event_id WHERE d.event_id=NEW.event_id AND d.body_digest=v.body_digest AND d.body_length=v.body_length AND e.provider_id=NEW.provider_id)
 BEGIN SELECT RAISE(ABORT,'mail-delivery-binding'); END;
CREATE TRIGGER identity_mail_delivery_receipt_immutable BEFORE UPDATE ON identity_mail_delivery_receipts BEGIN SELECT RAISE(ABORT,'mail-delivery-immutable'); END;
CREATE TRIGGER identity_mail_delivery_receipt_permanent BEFORE DELETE ON identity_mail_delivery_receipts BEGIN SELECT RAISE(ABORT,'mail-delivery-permanent'); END;
CREATE TABLE identity_mail_delivery_facts (
 event_id TEXT NOT NULL REFERENCES identity_mail_dispatches(event_id),
 fact TEXT NOT NULL CHECK(fact IN ('delivered','bounced','complained','failed','suppressed')),
 observed_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',observed_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',observed_at)=observed_at),
 PRIMARY KEY(event_id,fact)
);
CREATE TRIGGER identity_mail_delivery_fact_binding BEFORE INSERT ON identity_mail_delivery_facts
 WHEN NOT EXISTS(SELECT 1 FROM identity_mail_dispatches d JOIN identity_mail_envelopes v ON v.event_id=d.event_id WHERE d.event_id=NEW.event_id AND d.body_digest=v.body_digest AND d.body_length=v.body_length)
 BEGIN SELECT RAISE(ABORT,'mail-delivery-fact-binding'); END;
CREATE TRIGGER identity_mail_delivery_fact_immutable BEFORE UPDATE ON identity_mail_delivery_facts BEGIN SELECT RAISE(ABORT,'mail-delivery-fact-immutable'); END;
CREATE TRIGGER identity_mail_delivery_fact_permanent BEFORE DELETE ON identity_mail_delivery_facts BEGIN SELECT RAISE(ABORT,'mail-delivery-fact-permanent'); END;
CREATE TABLE identity_mail_delivery_audit (
 source TEXT NOT NULL,
 message_id TEXT NOT NULL,
 event_id TEXT NOT NULL REFERENCES identity_mail_dispatches(event_id),
 signal TEXT NOT NULL CHECK(signal IN ('accepted','delivered','bounced','complained','failed','suppressed')),
 detail_json TEXT NOT NULL CHECK(json_valid(detail_json) AND json_type(detail_json)='object' AND length(CAST(detail_json AS BLOB))<=2048),
 observed_at TEXT NOT NULL CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',observed_at) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ',observed_at)=observed_at),
 PRIMARY KEY(source,message_id),
 FOREIGN KEY(source,message_id) REFERENCES identity_mail_delivery_receipts(source,message_id)
);
CREATE TRIGGER identity_mail_delivery_audit_binding BEFORE INSERT ON identity_mail_delivery_audit
 WHEN NOT EXISTS(SELECT 1 FROM identity_mail_delivery_receipts r WHERE r.source=NEW.source AND r.message_id=NEW.message_id AND r.event_id=NEW.event_id AND r.result_json=NEW.detail_json AND r.observed_at=NEW.observed_at)
 BEGIN SELECT RAISE(ABORT,'mail-delivery-audit-binding'); END;
CREATE TRIGGER identity_mail_delivery_audit_immutable BEFORE UPDATE ON identity_mail_delivery_audit BEGIN SELECT RAISE(ABORT,'mail-delivery-audit-immutable'); END;
CREATE TRIGGER identity_mail_delivery_audit_permanent BEFORE DELETE ON identity_mail_delivery_audit BEGIN SELECT RAISE(ABORT,'mail-delivery-audit-permanent'); END;
