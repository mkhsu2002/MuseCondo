-- Additive, room-scoped immutable asset storage. No legacy rows are rewritten.
CREATE TABLE tower_asset_objects (
 room_id TEXT NOT NULL REFERENCES rooms(id),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 size INTEGER NOT NULL CHECK(typeof(size)='integer' AND size BETWEEN 1 AND 8388608),
 chunk_count INTEGER NOT NULL CHECK(typeof(chunk_count)='integer' AND chunk_count=(size+524287)/524288),
 PRIMARY KEY(room_id,digest)
);
CREATE TABLE tower_asset_object_chunks (
 room_id TEXT NOT NULL,digest TEXT NOT NULL,sequence INTEGER NOT NULL CHECK(typeof(sequence)='integer' AND sequence>=0),
 data BLOB NOT NULL CHECK(typeof(data)='blob' AND length(data) BETWEEN 1 AND 524288),
 PRIMARY KEY(room_id,digest,sequence),
 FOREIGN KEY(room_id,digest) REFERENCES tower_asset_objects(room_id,digest)
);
CREATE TABLE tower_asset_refs (
 room_id TEXT NOT NULL,revision INTEGER NOT NULL,purpose TEXT NOT NULL CHECK(purpose IN ('home','dream')),
 object_digest TEXT,legacy_revision INTEGER,
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 size INTEGER NOT NULL CHECK(typeof(size)='integer' AND size BETWEEN 1 AND 8388608),
 PRIMARY KEY(room_id,revision,purpose),
 FOREIGN KEY(room_id,revision) REFERENCES tower_snapshots(room_id,revision),
 FOREIGN KEY(room_id,object_digest) REFERENCES tower_asset_objects(room_id,digest),
 CHECK((object_digest IS NOT NULL AND legacy_revision IS NULL AND digest=object_digest) OR (object_digest IS NULL AND typeof(legacy_revision)='integer' AND legacy_revision>=1 AND legacy_revision<revision))
);
CREATE TRIGGER tower_asset_object_collision BEFORE INSERT ON tower_asset_objects
 WHEN EXISTS(SELECT 1 FROM tower_asset_objects WHERE room_id=NEW.room_id AND digest=NEW.digest AND (size!=NEW.size OR chunk_count!=NEW.chunk_count))
 BEGIN SELECT RAISE(ABORT,'tower-asset-object-collision'); END;
CREATE TRIGGER tower_asset_object_immutable BEFORE UPDATE ON tower_asset_objects BEGIN SELECT RAISE(ABORT,'tower-asset-object-immutable'); END;
CREATE TRIGGER tower_asset_object_permanent BEFORE DELETE ON tower_asset_objects BEGIN SELECT RAISE(ABORT,'tower-asset-object-permanent'); END;
CREATE TRIGGER tower_asset_chunk_binding BEFORE INSERT ON tower_asset_object_chunks
 WHEN NOT EXISTS(SELECT 1 FROM tower_asset_objects WHERE room_id=NEW.room_id AND digest=NEW.digest AND NEW.sequence<chunk_count AND length(NEW.data)=MIN(524288,size-NEW.sequence*524288))
 OR EXISTS(SELECT 1 FROM tower_asset_object_chunks WHERE room_id=NEW.room_id AND digest=NEW.digest AND sequence=NEW.sequence AND data IS NOT NEW.data)
 BEGIN SELECT RAISE(ABORT,'tower-asset-chunk-binding'); END;
CREATE TRIGGER tower_asset_chunk_immutable BEFORE UPDATE ON tower_asset_object_chunks BEGIN SELECT RAISE(ABORT,'tower-asset-chunk-immutable'); END;
CREATE TRIGGER tower_asset_chunk_permanent BEFORE DELETE ON tower_asset_object_chunks BEGIN SELECT RAISE(ABORT,'tower-asset-chunk-permanent'); END;
CREATE TRIGGER tower_asset_ref_binding BEFORE INSERT ON tower_asset_refs
 WHEN (NEW.object_digest IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM tower_asset_objects o WHERE o.room_id=NEW.room_id AND o.digest=NEW.object_digest AND o.size=NEW.size
 AND (SELECT COUNT(*) FROM tower_asset_object_chunks c WHERE c.room_id=o.room_id AND c.digest=o.digest)=o.chunk_count
 AND (SELECT SUM(length(data)) FROM tower_asset_object_chunks c WHERE c.room_id=o.room_id AND c.digest=o.digest)=o.size))
 OR (NEW.legacy_revision IS NOT NULL AND (
 NOT EXISTS(SELECT 1 FROM tower_asset_chunks WHERE room_id=NEW.room_id AND revision=NEW.legacy_revision AND purpose=NEW.purpose AND sequence=0)
 OR EXISTS(SELECT 1 FROM tower_asset_chunks WHERE room_id=NEW.room_id AND revision=NEW.legacy_revision AND purpose=NEW.purpose AND digest!=NEW.digest)
 OR (SELECT SUM(length(data)) FROM tower_asset_chunks WHERE room_id=NEW.room_id AND revision=NEW.legacy_revision AND purpose=NEW.purpose) IS NOT NEW.size
 OR (SELECT COUNT(*) FROM tower_asset_chunks WHERE room_id=NEW.room_id AND revision=NEW.legacy_revision AND purpose=NEW.purpose)!=(SELECT MAX(sequence)+1 FROM tower_asset_chunks WHERE room_id=NEW.room_id AND revision=NEW.legacy_revision AND purpose=NEW.purpose)))
 BEGIN SELECT RAISE(ABORT,'tower-asset-ref-binding'); END;
CREATE TRIGGER tower_asset_ref_insert_once BEFORE INSERT ON tower_asset_refs
 WHEN EXISTS(SELECT 1 FROM tower_asset_refs WHERE room_id=NEW.room_id AND revision=NEW.revision AND purpose=NEW.purpose)
 BEGIN SELECT RAISE(ABORT,'tower-asset-ref-insert-once'); END;
CREATE TRIGGER tower_asset_ref_immutable BEFORE UPDATE ON tower_asset_refs BEGIN SELECT RAISE(ABORT,'tower-asset-ref-immutable'); END;
CREATE TRIGGER tower_asset_ref_permanent BEFORE DELETE ON tower_asset_refs BEGIN SELECT RAISE(ABORT,'tower-asset-ref-permanent'); END;
-- Once anchored, historical physical bytes cannot change behind a validated ref.
CREATE TRIGGER tower_asset_legacy_update BEFORE UPDATE ON tower_asset_chunks
 WHEN EXISTS(SELECT 1 FROM tower_asset_refs WHERE room_id=OLD.room_id AND legacy_revision=OLD.revision AND purpose=OLD.purpose)
 BEGIN SELECT RAISE(ABORT,'tower-asset-legacy-immutable'); END;
CREATE TRIGGER tower_asset_legacy_delete BEFORE DELETE ON tower_asset_chunks
 WHEN EXISTS(SELECT 1 FROM tower_asset_refs WHERE room_id=OLD.room_id AND legacy_revision=OLD.revision AND purpose=OLD.purpose)
 BEGIN SELECT RAISE(ABORT,'tower-asset-legacy-immutable'); END;
CREATE TRIGGER tower_asset_legacy_insert BEFORE INSERT ON tower_asset_chunks
 WHEN EXISTS(SELECT 1 FROM tower_asset_refs WHERE room_id=NEW.room_id AND legacy_revision=NEW.revision AND purpose=NEW.purpose)
 BEGIN SELECT RAISE(ABORT,'tower-asset-legacy-immutable'); END;
