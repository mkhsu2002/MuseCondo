/** Validate signed Cloudflare Access assertions; human identity is never inferred from a plain email header. */
export interface TowerLordAuthOptions {issuer?:string;audience?:string;stewards?:string;observers?:string;now?:()=>number;transport?:typeof fetch}
export interface TowerLordPrincipal {role:'acting-steward'|'observer';displayName:string}
export const isTowerLordPath=(path:string)=>/^\/(?:tower-lord|api\/v1\/tower-lord)(?:\/|$)/.test(path);
function addresses(value?:string):string[]{try{const a:unknown=JSON.parse(value??'[]');return Array.isArray(a)&&a.length<=20&&a.every(x=>typeof x==='string'&&x.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))?a.map(x=>(x as string).toLowerCase()):[];}catch{return [];}}
function decode(part:string):Uint8Array<ArrayBuffer>{if(!/^[\w-]+$/.test(part))throw Error('invalid_encoding');return Uint8Array.from(atob(part.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
function object(part:string):Record<string,unknown>{const v:unknown=JSON.parse(new TextDecoder().decode(decode(part)));if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid_object');return v as Record<string,unknown>;}
type PublicKey=JsonWebKey&{kid?:string};
const cache=new Map<string,{until:number;keys:PublicKey[]}>();
export function createTowerLordAuth(options:TowerLordAuthOptions){
 const issuer=options.issuer??'',audience=options.audience??'',stewards=addresses(options.stewards),observers=addresses(options.observers),clock=options.now??Date.now,transport=options.transport??fetch;
 return async(request:Request):Promise<TowerLordPrincipal|null>=>{
  if(!/^https:\/\/[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(issuer)||!audience||audience.length>256||!stewards.length&&!observers.length)return null;
  const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token||token.length>16384)return null;
  try{
   const parts=token.split('.');if(parts.length!==3)return null;const header=object(parts[0]),claims=object(parts[1]),now=clock()/1000;
   if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>256||header.crit!==undefined||header.typ!==undefined&&header.typ!=='JWT')return null;
   if(claims.iss!==issuer||!(claims.aud===audience||Array.isArray(claims.aud)&&claims.aud.includes(audience))||claims.type!=='app'||typeof claims.exp!=='number'||claims.exp<=now||claims.exp>now+86400||typeof claims.iat!=='number'||claims.iat>now+60||claims.nbf!==undefined&&(typeof claims.nbf!=='number'||claims.nbf>now)||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>256||typeof claims.email!=='string')return null;
   const email=claims.email.toLowerCase(),role=stewards.includes(email)?'acting-steward':observers.includes(email)?'observer':null;if(!role)return null;
   // Cache fixed-origin public keys only. JWT-provided jku/x5u URLs are never used.
   const cacheKey=issuer+(options.transport?'|test':'');let keys=cache.get(cacheKey);
   if(!keys||keys.until<=clock()){
    const response=await transport(issuer+'/cdn-cgi/access/certs',{redirect:'manual',signal:AbortSignal.timeout(5000)});if(!response.ok)return null;
    const reader=response.body?.getReader();if(!reader)return null;let size=0;const chunks:Uint8Array[]=[];
    while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>65536){await reader.cancel();return null;}chunks.push(next.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const data=JSON.parse(new TextDecoder().decode(bytes)) as {keys?:PublicKey[]};if(!Array.isArray(data.keys)||data.keys.length>20)return null;
    keys={until:clock()+300000,keys:data.keys};cache.set(cacheKey,keys);
   }
   const jwk=keys.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));if(!jwk)return null;
   const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
   if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))return null;
   return {role,displayName:role==='acting-steward'?'Acting Tower Steward':'Observer'};
  }catch{return null;}
 };
}
