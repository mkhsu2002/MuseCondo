import type {LocalDatabase} from '../../server/live/local-db.ts';
import {encryptPrivate,hashIdentityInput,randomIdentityId} from '../../server/live/identity-private.ts';
import {senderDomain} from '../../server/live/identity-mail-readiness.ts';
/** Independent synthetic metadata receipt; never provider credentials or a real sender/delivery claim. */
export async function syntheticSenderReady(db:LocalDatabase,origin:string,from='MuseCondo <identity@example.com>',now='2026-10-31T00:00:00.000Z',overrides:Record<string,unknown>={}){
 const id=randomIdentityId(),domain=typeof overrides.domain==='string'?overrides.domain:senderDomain(from),result={checkId:id,state:'ready',reason:'sender_verified',domain,domainVerified:true,sendingEnabled:true,senderReady:true,deliveryVerified:false,providerHttpStatus:200,providerErrorName:null,checkedAt:now,...overrides};
 db.sqlite.prepare("INSERT INTO identity_mail_provider_checks VALUES(?,?,?,?,'complete',200,?,?,?)").run(id,await hashIdentityInput(id),await hashIdentityInput(JSON.stringify(['identity-mail-provider:input',from,origin])),domain,JSON.stringify(result),now,now);
 db.sqlite.prepare("INSERT INTO identity_mail_provider_audit VALUES(?,?,'intent','{}',?)").run(randomIdentityId(),id,now);
 db.sqlite.prepare("INSERT INTO identity_mail_provider_audit VALUES(?,?,'completed',?,?)").run(randomIdentityId(),id,JSON.stringify(result),now);
 return id;
}
/** Explicit synthetic setup proof; never a provider credential or real delivery claim. */
export async function syntheticMailReady(db:LocalDatabase,origin:string,key:string,now='2026-10-31T00:00:00.000Z',sender=true){
 const ciphertext=await encryptPrivate(key,'mail-webhook-secret',origin,'whsec_'+btoa('synthetic-only-signing-key-not-real'));
 db.sqlite.prepare("INSERT INTO identity_mail_webhook_setups VALUES(?,?,?,?,'ready',?,?,?,NULL,?,?)").run(origin,origin+'/api/v1/identity/mail/webhook','synthetic-setup-key','0'.repeat(32),'synthetic-hook',ciphertext,now,now,now);
 if(sender)await syntheticSenderReady(db,origin,undefined,now);
}
