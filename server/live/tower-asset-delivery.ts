import type { Database } from './db.ts';
import { readTowerAsset, readTowerAssetMetadata, type AssetPurpose } from './tower-asset-storage.ts';

/** Caller must check current publication, revision and purpose consent first. */
export async function authorizedTowerAssetResponse(request: Request, db: Database, room: string, revision: number, purpose: AssetPurpose): Promise<Response|null> {
    const tag = (digest:string) => `"tower-${room}-${revision}-${purpose}-${digest}"`;
    const headers = (etag:string) => ({
        'Content-Type':'image/png', 'Cache-Control':'private, no-cache, must-revalidate',
        'ETag':etag, 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
    });
    const condition = request.headers.get('If-None-Match');
    if (condition !== null) {
        const metadata = await readTowerAssetMetadata(db,room,revision,purpose);
        if (!metadata) return null;
        const etag = tag(metadata.digest);
        // GET/HEAD use weak comparison. Never allow a partial or prefix match.
        if (condition.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//,'') === etag))
            return new Response(null,{status:304,headers:headers(etag)});
    }
    const asset = await readTowerAsset(db,room,revision,purpose);
    if (!asset) return null;
    return new Response(request.method === 'HEAD' ? null : asset.bytes,{headers:{...headers(tag(asset.digest)),'Content-Length':String(asset.size)}});
}
