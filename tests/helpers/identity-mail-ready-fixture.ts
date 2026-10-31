import type {LocalDatabase} from '../../server/live/local-db.ts';
import {encryptPrivate} from '../../server/live/identity-private.ts';
/** Explicit synthetic setup proof; never a provider credential or real delivery claim. */
export async function syntheticMailReady(db:LocalDatabase,origin:string,key:string){
 const now='2026-10-31T00:00:00.000Z';
 const ciphertext=await encryptPrivate(key,'mail-webhook-secret',origin,'whsec_'+btoa('synthetic-only-signing-key-not-real'));
 db.sqlite.prepare("INSERT INTO identity_mail_webhook_setups VALUES(?,?,?,?,'ready',?,?,?,NULL,?,?)").run(origin,origin+'/api/v1/identity/mail/webhook','synthetic-setup-key','0'.repeat(32),'synthetic-hook',ciphertext,now,now,now);
}
