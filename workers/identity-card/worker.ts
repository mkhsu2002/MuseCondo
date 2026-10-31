import {createIdentityCard} from '../../server/live/identity-card.ts';
import {isIdentityCardPath} from '../../server/live/identity-card-proxy.ts';
import type {Database} from '../../server/live/db.ts';
import {createFontLoader, renderIdentityCard, type AssetFetcher} from './render.ts';
export interface IdentityCardBindings {
 DB?:Database; ASSETS?:AssetFetcher; PUBLIC_ORIGIN?:string;
 IDENTITY_CONTACT_KEY?:string; IDENTITY_SIGNING_JWK?:string; IDENTITY_SIGNING_KEY_ID?:string; IDENTITY_PUBLIC_KEYS?:string;
}
const schema=['identity_credentials','identity_card_heads','identity_card_artifacts','identity_card_requests','identity_card_attempts','identity_card_agent','identity_card_one_issued','identity_card_binding','identity_card_immutable','identity_card_permanent','identity_card_head_insert','identity_card_head_update','identity_card_head_permanent','identity_card_artifact_count','identity_card_artifact_immutable','identity_card_artifact_permanent','identity_card_receipt_immutable','identity_card_receipt_permanent','identity_card_attempt_immutable','identity_card_attempt_permanent'];
const json=(error:string,status:number)=>new Response(JSON.stringify({error}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
function origin(value:string|undefined):value is string {try{return !!value&&new URL(value).origin===value&&value.startsWith('https://');}catch{return false;}}
/** SQLite-backed DO class. D1 permanent attempts/receipts remain the transaction authority.
 * Its instance lifetime only coalesces in-flight work; eviction never changes issuance identity. */
export class IdentityCardCoordinator {
 private readonly env:IdentityCardBindings;
 private readonly service:ReturnType<typeof createIdentityCard>|undefined;
 constructor(_state:unknown,env:IdentityCardBindings){
  this.env=env;
  const loadFont=createFontLoader(env.ASSETS);
  if(env.DB&&origin(env.PUBLIC_ORIGIN))this.service=createIdentityCard({db:env.DB,origin:env.PUBLIC_ORIGIN,contactKey:env.IDENTITY_CONTACT_KEY,signingKeyId:env.IDENTITY_SIGNING_KEY_ID,signingPrivateJwk:env.IDENTITY_SIGNING_JWK,trustedPublicJwks:env.IDENTITY_PUBLIC_KEYS,renderCard:signed=>renderIdentityCard(signed,loadFont)});
 }
 async fetch(request:Request):Promise<Response>{
  const url=new URL(request.url);
  if(!isIdentityCardPath(url.pathname))return json('not_found',404);
  if(!origin(this.env.PUBLIC_ORIGIN))return json('identity_cards_not_configured',503);
  if(url.origin!==this.env.PUBLIC_ORIGIN)return json('host_rejected',403);
  if(!this.service||!this.env.DB)return json('identity_cards_not_configured',503);
  try{
   if(url.pathname!=='/api/v1/identity/keys'){
    const rows=(await this.env.DB.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index')").all<{name:string}>()).results;
    if(!schema.every(name=>rows.some(row=>row.name===name)))return json('identity_card_schema_not_ready',503);
   }
   return await this.service.fetch(request)??json('not_found',404);
  }catch{return json('card_operation_unavailable',503);}
 }
}
/** No public service endpoint, even when assets are present. Only a Pages DO binding calls the class. */
export default {async fetch():Promise<Response>{return json('not_found',404);}};
