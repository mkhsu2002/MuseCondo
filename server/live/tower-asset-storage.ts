import type { Database, Statement } from './db.ts';
/** Storage carries no publication or ownership authority. Callers must authorize first. */
export type AssetPurpose = 'home' | 'dream';
interface AssetRef {
    object_digest: string | null;
    legacy_revision: number | null;
    digest: string;
    size: number;
}
interface AssetObject {
    size: number;
    chunk_count: number;
}
interface Chunk {
    sequence: number;
    data: unknown;
    digest?: string;
    data_hex?: string;
}
export interface StoredTowerAsset {
    bytes: Uint8Array<ArrayBuffer>;
    digest: string;
    size: number;
    objectDigest: string | null;
    legacyRevision: number | null;
}
const CHUNK_SIZE = 524288;
const MAX_SIZE = 8 * 1024 * 1024;
const triggers = ['object_collision', 'object_immutable', 'object_permanent', 'chunk_binding', 'chunk_immutable', 'chunk_permanent', 'ref_binding', 'ref_insert_once', 'ref_immutable', 'ref_permanent', 'legacy_update', 'legacy_delete', 'legacy_insert'];
export const TOWER_ASSET_STORAGE_SCHEMA = ['tower_asset_objects', 'tower_asset_object_chunks', 'tower_asset_refs', ...triggers.map(name => 'tower_asset_' + name)];
const corrupt = (): never => { throw Error('tower_asset_corrupt'); };
const validDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
// Build bounded temporary strings rather than allocating one JS array per image.
function hexBytes(bytes: Uint8Array) {
    const parts: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192)
        parts.push(Array.from(bytes.subarray(offset, offset + 8192), b => b.toString(16).padStart(2, '0')).join(''));
    return parts.join('');
}
function fromHex(hex: string) {
    if (!hex.length || hex.length % 2 !== 0 || !/^[a-fA-F0-9]+$/.test(hex))
        return corrupt();
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++)
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}
/** D1 returns BLOBs as number arrays; local SQLite uses typed views. Reject coercion. */
function binary(value: unknown): Uint8Array<ArrayBuffer> {
    if (value instanceof ArrayBuffer)
        return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value))
        return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    if (Array.isArray(value) && value.every(v => Number.isInteger(v) && v >= 0 && v <= 255))
        return new Uint8Array(value);
    return corrupt();
}
async function reconstruct(chunks: Chunk[], digest: string, size?: number, count?: number) {
    if (!validDigest(digest) || !chunks.length || chunks.length > MAX_SIZE / CHUNK_SIZE || (count !== undefined && chunks.length !== count))
        return corrupt();
    let length = 0;
    const parts = chunks.map((chunk, i) => {
        if (chunk.sequence !== i || (chunk.digest !== undefined && chunk.digest !== digest))
            return corrupt();
        const hex = chunk.data_hex;
        if (hex !== undefined && (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[a-fA-F0-9]+$/.test(hex)))
            return corrupt();
        const bytes = hex === undefined ? binary(chunk.data) : fromHex(hex);
        if (!bytes.length || bytes.length > CHUNK_SIZE || (i < chunks.length - 1 && bytes.length !== CHUNK_SIZE))
            return corrupt();
        length += bytes.length;
        return bytes;
    });
    if (length > MAX_SIZE || (size !== undefined && length !== size))
        return corrupt();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.length;
    }
    if (await sha(bytes) !== digest)
        return corrupt();
    return bytes;
}
async function readObject(db: Database, room: string, digest: string) {
    const object = await db.prepare('SELECT size,chunk_count FROM tower_asset_objects WHERE room_id=? AND digest=?').bind(room, digest).first<AssetObject>();
    if (!object)
        return null;
    if (!Number.isInteger(object.size) || object.size < 1 || object.size > MAX_SIZE || object.chunk_count !== Math.ceil(object.size / CHUNK_SIZE))
        return corrupt();
    const chunks = (await db.prepare('SELECT sequence,' + (object.size > 3 * 1024 * 1024 ? 'hex(data) data_hex' : 'data') + ' FROM tower_asset_object_chunks WHERE room_id=? AND digest=? ORDER BY sequence').bind(room, digest).all<Chunk>()).results;
    return { bytes: await reconstruct(chunks, digest, object.size, object.chunk_count), ...object };
}
export async function readTowerAsset(db: Database, room: string, revision: number, purpose: AssetPurpose): Promise<StoredTowerAsset | null> {
    const ref = await db.prepare('SELECT object_digest,legacy_revision,digest,size FROM tower_asset_refs WHERE room_id=? AND revision=? AND purpose=?').bind(room, revision, purpose).first<AssetRef>();
    if (ref) {
        if (!validDigest(ref.digest) || !Number.isInteger(ref.size) || ref.size < 1 || ref.size > MAX_SIZE)
            return corrupt();
        if (ref.object_digest !== null) {
            if (ref.legacy_revision !== null || ref.object_digest !== ref.digest)
                return corrupt();
            const object = await readObject(db, room, ref.object_digest);
            if (!object || object.size !== ref.size)
                return corrupt();
            return { bytes: object.bytes, digest: ref.digest, size: ref.size, objectDigest: ref.object_digest, legacyRevision: null };
        }
        if (!Number.isInteger(ref.legacy_revision) || ref.legacy_revision! < 1 || ref.legacy_revision! >= revision)
            return corrupt();
    }
    const anchor = ref ? ref.legacy_revision! : revision;
    const metadata = await db.prepare('SELECT SUM(length(data)) size,COUNT(*) count FROM tower_asset_chunks WHERE room_id=? AND revision=? AND purpose=?').bind(room, anchor, purpose).first<{
        size: number | null;
        count: number;
    }>();
    if (!metadata?.count) {
        if (ref)
            return corrupt();
        return null;
    }
    if (metadata.size === null || metadata.size < 1 || metadata.size > MAX_SIZE || metadata.count > MAX_SIZE / CHUNK_SIZE)
        return corrupt();
    const chunks = (await db.prepare('SELECT sequence,' + (metadata.size > 3 * 1024 * 1024 ? 'hex(data) data_hex' : 'data') + ',digest FROM tower_asset_chunks WHERE room_id=? AND revision=? AND purpose=? ORDER BY sequence').bind(room, anchor, purpose).all<Chunk>()).results;
    if (!chunks.length) {
        if (ref)
            return corrupt();
        return null;
    }
    const digest = ref?.digest ?? chunks[0].digest!;
    const bytes = await reconstruct(chunks, digest, ref?.size);
    return { bytes, digest, size: bytes.length, objectDigest: null, legacyRevision: anchor };
}
/** Missing migration or guards blocks every write, including legacy-only text edits. */
async function storageGuard(db: Database): Promise<Statement> {
    const rows = (await db.prepare("SELECT name,type FROM sqlite_master WHERE name LIKE 'tower_asset_%'").all<{
        name: string;
        type: string;
    }>()).results;
    if (!TOWER_ASSET_STORAGE_SCHEMA.every(name => rows.some(row => row.name === name && row.type === (name === 'tower_asset_objects' || name === 'tower_asset_object_chunks' || name === 'tower_asset_refs' ? 'table' : 'trigger'))))
        throw Error('tower_asset_schema_not_ready');
    // Check again inside the caller's atomic batch.
    const tables = TOWER_ASSET_STORAGE_SCHEMA.slice(0, 3), guards = TOWER_ASSET_STORAGE_SCHEMA.slice(3);
    return db.prepare("SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE (type='table' AND name IN (" + tables.map(() => '?').join(',') + ")) OR (type='trigger' AND name IN (" + guards.map(() => '?').join(',') + ")))=? THEN 1 ELSE json('tower-asset-schema-not-ready') END").bind(...tables, ...guards, TOWER_ASSET_STORAGE_SCHEMA.length);
}
export async function assetStatements(db: Database, room: string, revision: number, images: {
    purpose: AssetPurpose;
    bytes: Uint8Array;
    digest: string;
}[]): Promise<Statement[]> {
    if (images.reduce((total, image) => total + image.bytes.length, 0) > 12 * 1024 * 1024)
        throw Error('tower_asset_size_limit');
    const statements = [await storageGuard(db)];
    const useHex = images.reduce((total, image) => total + image.bytes.length, 0) > 3 * 1024 * 1024;
    const prepared = new Set<string>();
    for (const image of images) {
        const bytes = new Uint8Array(image.bytes);
        if (!bytes.length || bytes.length > MAX_SIZE || await sha(bytes) !== image.digest)
            return corrupt();
        const existing = await readObject(db, room, image.digest);
        if (existing && (existing.bytes.length !== bytes.length || existing.bytes.some((b, i) => b !== bytes[i])))
            return corrupt();
        statements.push(db.prepare('INSERT INTO tower_asset_objects(room_id,digest,size,chunk_count) VALUES(?,?,?,?) ON CONFLICT(room_id,digest) DO NOTHING').bind(room, image.digest, bytes.length, Math.ceil(bytes.length / CHUNK_SIZE)));
        // Existing objects were verified and are immutable. First-writer races replay
        // identical chunk inserts; the binding trigger rejects conflicting bytes.
        if (!existing && !prepared.has(image.digest))
            for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
                const chunk = bytes.slice(offset, offset + CHUNK_SIZE);
                statements.push(db.prepare('INSERT INTO tower_asset_object_chunks(room_id,digest,sequence,data) VALUES(?,?,?,' + (useHex ? 'unhex(?)' : '?') + ') ON CONFLICT(room_id,digest,sequence) DO NOTHING').bind(room, image.digest, offset / CHUNK_SIZE, useHex ? hexBytes(chunk) : chunk.buffer));
            }
        prepared.add(image.digest);
        statements.push(db.prepare('INSERT INTO tower_asset_refs(room_id,revision,purpose,object_digest,legacy_revision,digest,size) VALUES(?,?,?,?,NULL,?,?)').bind(room, revision, image.purpose, image.digest, image.digest, bytes.length));
    }
    return statements;
}
export async function cloneAssetStatements(db: Database, room: string, from: number, to: number, purposes: AssetPurpose[]): Promise<Statement[]> {
    const statements = [await storageGuard(db)];
    for (const purpose of purposes) {
        const asset = await readTowerAsset(db, room, from, purpose);
        if (!asset)
            continue;
        if (asset.legacyRevision !== null)
            for (let offset = 0; offset < asset.bytes.length; offset += CHUNK_SIZE) {
                const chunk = asset.bytes.slice(offset, offset + CHUNK_SIZE);
                statements.push(db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_asset_chunks WHERE room_id=? AND revision=? AND purpose=? AND sequence=? AND data=unhex(?) AND digest=?) THEN 1 ELSE json('tower-asset-legacy-changed') END").bind(room, asset.legacyRevision, purpose, offset / CHUNK_SIZE, hexBytes(chunk), asset.digest));
            }
        statements.push(db.prepare('INSERT INTO tower_asset_refs(room_id,revision,purpose,object_digest,legacy_revision,digest,size) VALUES(?,?,?,?,?,?,?)').bind(room, to, purpose, asset.objectDigest, asset.legacyRevision, asset.digest, asset.size));
    }
    return statements;
}
export async function storedTowerImages(db: Database, room: string, revision: number) {
    const images = [];
    for (const purpose of ['home', 'dream'] as const) {
        const asset = await readTowerAsset(db, room, revision, purpose);
        if (asset)
            images.push({ purpose, digest: asset.digest, size: asset.size });
    }
    return images;
}
