import type { Database } from './db.ts';
import { readTowerAsset, readTowerAssetMetadata, type AssetPurpose } from './tower-asset-storage.ts';
import { acceptsTowerWebP, readTowerWebP, TOWER_WEBP_PROFILE, type TowerDerivativeBucket } from './tower-asset-derivatives.ts';

/** Caller must check current publication, revision and purpose consent first. */
export async function authorizedTowerAssetResponse(request: Request, db: Database, room: string, revision: number, purpose: AssetPurpose, bucket?:TowerDerivativeBucket, automatic?:{image(digest:string):Promise<{bytes:Uint8Array<ArrayBuffer>;digest:string;size:number}|null>;enqueue():Promise<unknown>}): Promise<Response|null> {
    const tag = (digest:string) => `"tower-${room}-${revision}-${purpose}-${digest}"`;
    const headers = (etag:string,type='image/png') => ({
        'Content-Type':type, 'Cache-Control':'private, no-cache, must-revalidate', 'Vary':'Accept',
        'ETag':etag, 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
    });
    const condition = request.headers.get('If-None-Match');
    const matches = (etag:string) => condition?.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//,'') === etag);
    if ((bucket || automatic) && acceptsTowerWebP(request.headers.get('Accept'))) {
        const metadata=await readTowerAssetMetadata(db,room,revision,purpose);
        if (!metadata) return null;
        let auto=null;try{auto=await automatic?.image(metadata.digest)??null;}catch{/* Keep the verified original available. */}
        const webp=auto??await readTowerWebP(bucket,room,metadata);
        if(!webp&&automatic)try{await automatic.enqueue();}catch{/* A failed wake cannot hide original artwork. */}
        if (webp) {
            const etag=tag(`webp-${auto?'cf-webp-1920-q85-v1':TOWER_WEBP_PROFILE}-${webp.digest}`),responseHeaders=headers(etag,'image/webp');
            if (matches(etag)) return new Response(null,{status:304,headers:responseHeaders});
            return new Response(request.method==='HEAD'?null:webp.bytes,{headers:{...responseHeaders,'Content-Length':String(webp.size)}});
        }
    }
    if (condition !== null) {
        const metadata = await readTowerAssetMetadata(db,room,revision,purpose);
        if (!metadata) return null;
        const etag = tag(metadata.digest);
        // GET/HEAD use weak comparison. Never allow a partial or prefix match.
        if (matches(etag))
            return new Response(null,{status:304,headers:headers(etag)});
    }
    const asset = await readTowerAsset(db,room,revision,purpose);
    if (!asset) return null;
    return new Response(request.method === 'HEAD' ? null : asset.bytes,{headers:{...headers(tag(asset.digest)),'Content-Length':String(asset.size)}});
}
