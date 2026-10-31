/** Minimal structural binding: Pages never imports the renderer or reads its secrets/artifacts. */
export interface IdentityCardNamespace {
 idFromName(name:string):unknown;
 get(id:unknown):{fetch(request:Request):Promise<Response>};
}
export function isIdentityCardPath(path:string):boolean {
 return /^\/api\/v1\/agent\/identity\/card(?:\/(?:issue|revoke|[a-f0-9]{32}\/(?:pdf|json)))?$/.test(path)||/^\/api\/v1\/identity\/(?:keys|verify\/[a-f0-9]{32})$/.test(path);
}
/** Fixed shard spaces: 256 private, 256 public, one unauthenticated bucket and one keys object.
 * Token hashing is routing only. Core always authenticates the original unmodified request. */
export async function cardShard(request:Request):Promise<string>{
 const path=new URL(request.url).pathname;
 if(path==='/api/v1/identity/keys')return 'keys';
 const cid=path.match(/^\/api\/v1\/identity\/verify\/([a-f0-9]{32})$/)?.[1];if(cid)return 'public:'+cid.slice(0,2);
 const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
 if(!token)return 'private:unauthorized';
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
 return 'private:'+bytes[0].toString(16).padStart(2,'0');
}
const unavailable=()=>new Response(JSON.stringify({error:'identity_cards_not_bound'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function proxyIdentityCard(request:Request,binding?:IdentityCardNamespace):Promise<Response>{
 if(!binding||typeof binding.idFromName!=='function'||typeof binding.get!=='function')return unavailable();
 try{return await binding.get(binding.idFromName(await cardShard(request))).fetch(request);}catch{return unavailable();}
}
