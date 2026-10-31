import {readFileSync,readdirSync} from 'node:fs';
import {LocalDatabase} from '../../server/live/local-db.ts';
import {encryptPrivate,hashPrivate,hashIdentityInput} from '../../server/live/identity-private.ts';
import {signCredential} from '../../src/identity/index.ts';
const origin='https://identity.example',time='2026-10-31T00:00:00.000Z',key='9'.repeat(64),enc=new TextEncoder();
export async function envelopeFixture(size=64){
 const db=new LocalDatabase(':memory:'),native=new LocalDatabase(':memory:');
 for(const file of readdirSync(new URL('../../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../../migrations/'+file,import.meta.url),'utf8'));
 let clock=time,nativeClock=time;
 db.sqlite.function('strftime',{varargs:true},(...args)=>args[1]==='now'?nativeClock:native.sqlite.prepare('SELECT strftime('+args.map(()=>'?').join(',')+') v').get(...args)!.v);
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const pdf=new Uint8Array(size);pdf.fill(32);pdf.set(enc.encode('%PDF-1.7\n'));pdf.set(enc.encode('%%EOF'),size-5);
 for(const x of ['a','b']){
  const account=x.repeat(16),agent='mcid:'+x.repeat(64),invite=x.repeat(32),cid=(x==='a'?'c':'d').repeat(32),event=(x==='a'?'e':'f').repeat(32);
  db.sqlite.prepare('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)').run(account,await hashIdentityInput(x),time);
  db.sqlite.prepare("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'PRIVATE HOME','PRIVATE RELATION','resident','external-ready',?)").run(account,account,time);
  db.sqlite.prepare("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)").run(account,account,account,'https://private.example/'+x,time,time);
  db.sqlite.prepare("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,version,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,3,'active',1,?,?)").run(agent,account,account,account,time,time);
  const cipher=await encryptPrivate(key,'guardian-recipient',agent,'shared@example.com'),hash=await hashPrivate(key,'guardian-email','shared@example.com');
  db.sqlite.prepare("INSERT INTO identity_guardian_invites(id,agent_id,account_id,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,invite_token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,3,1,'registered',?,?,?,'2026-11-01T00:00:00.000Z',?,?)").run(invite,agent,account,cipher,hash,await hashPrivate(key,'guardian-confirmation:'+invite,'7'.repeat(64)),time,time);
  db.sqlite.prepare('INSERT INTO identity_guardians(guardian_id,agent_id,invitation_id,email_verified_at,created_at) VALUES(?,?,?,?,?)').run(invite,agent,invite,time,time);
  const signed=await signCredential({type:'NeoBabylonAgentIdentity',version:'0.01',issuer:origin,agentId:agent,credentialId:cid,publicName:'公開名字 '+x,issuedAt:time,keyId:'fixture',verificationURL:origin+'/identity/verify/'+cid},pair.privateKey),json=JSON.stringify(signed),pdfDigest=await hashIdentityInputBytes(pdf),jsonDigest=await hashIdentityInput(json);
  db.sqlite.prepare("INSERT INTO identity_credentials(credential_id,agent_id,account_id,revision,state,signed_json,pdf_digest,json_digest,pdf_length,json_length,pdf_chunks,json_chunks,issued_at,updated_at) VALUES(?,?,?,1,'issued',?,?,?,?,?,?,1,?,?)").run(cid,agent,account,json,pdfDigest,jsonDigest,pdf.length,enc.encode(json).length,Math.ceil(pdf.length/49152),time,time);
  db.sqlite.prepare('INSERT INTO identity_card_heads VALUES(?,1,?,1,?)').run(account,cid,time);
  for(const [kind,bytes] of [['pdf',pdf],['json',enc.encode(json)]] as const)for(let offset=0;offset<bytes.length;offset+=49152)db.sqlite.prepare('INSERT INTO identity_card_artifacts VALUES(?,?,?,?)').run(cid,kind,offset/49152,Buffer.from(bytes.subarray(offset,offset+49152)).toString('base64'));
  db.sqlite.prepare("INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,created_at,updated_at) VALUES(?,'identity-card',?,?,?,?,?,?,?)").run(event,cid,'card:'+cid,cipher,hash,await encryptPrivate(key,'mail-payload',event,JSON.stringify({credentialId:cid,pdfDigest,jsonDigest,template:'identity-card-v1'})),time,time);
 }
 const env={db,origin,contactKey:key,from:'MuseCondo <identity@example.com>',trustedKeys:new Map([['fixture',pair.publicKey]]),now:()=>new Date(clock)};
 const event='e'.repeat(32),cid='c'.repeat(32),agent='mcid:'+'a'.repeat(64),account='a'.repeat(16),invite='a'.repeat(32);
 const patchPayload=async(payload:unknown)=>db.sqlite.prepare('UPDATE identity_mail_events SET payload_ciphertext=? WHERE id=?').run(await encryptPrivate(key,'mail-payload',event,JSON.stringify(payload)),event);
 const invitation=async()=>{
  db.sqlite.prepare("UPDATE agent_identities SET state='provisional' WHERE account_id=?").run(account);
  db.sqlite.prepare("UPDATE identity_guardian_invites SET state='accepted' WHERE id=?").run(invite);
  db.sqlite.prepare("UPDATE identity_mail_events SET kind='guardian-invitation',entity_id=? WHERE id=?").run(invite,event);await patchPayload({token:'7'.repeat(64)});
 };
 const security=async(template='identity-card-revoked-v1')=>{
  db.sqlite.prepare("UPDATE identity_mail_events SET kind='security-notice' WHERE id=?").run(event);
  if(template==='identity-card-revoked-v1'){db.sqlite.prepare("UPDATE identity_credentials SET state='revoked' WHERE credential_id=?").run(cid);await patchPayload({credentialId:cid,template});}
  else {
   const request='1'.repeat(32),continued=template==='identity-recovery-continued-v1',state=continued?'continued':'new-admission-required';
   db.sqlite.prepare("INSERT INTO identity_recovery_requests(id,agent_id,candidate_hash,request_key,input_hash,state,created_at,expires_at,completed_at) VALUES(?,?,?,'test-key',?,?,?,'2026-10-31T01:00:00.000Z',?)").run(request,agent,'1'.repeat(64),'2'.repeat(64),state,time,time);
   const receipt=continued?{requestId:request,agentId:agent,state,authorityEpoch:1,instanceId:'2'.repeat(32)}:{requestId:request,agentId:agent,state};
   db.sqlite.prepare("INSERT INTO identity_recovery_receipts VALUES(?,'test-key',?,?,?)").run(request,'2'.repeat(64),JSON.stringify(receipt),time);
   if(continued){db.sqlite.prepare("INSERT INTO tower_tokens(id,account_id,token_hash,scopes,expires_at,created_at) VALUES('recovery-token',?,?,'[]','2027-01-01T00:00:00.000Z',?)").run(account,'3'.repeat(64),time);db.sqlite.prepare("INSERT INTO identity_recovery_instances VALUES(?,?,1,'recovery-token',?,?)").run('2'.repeat(32),agent,request,time);}
   else db.sqlite.prepare('INSERT INTO identity_offline_recovery_codes(agent_id,code_hash,authority_epoch,identity_version,created_at,confirmed_at) VALUES(?,?,1,3,?,?)').run(agent,'4'.repeat(64),time,time);
   db.sqlite.prepare('UPDATE identity_mail_events SET entity_id=? WHERE id=?').run(request,event);await patchPayload({template,agentId:agent,requestId:request,authorityEpoch:1});
  }
 };
 return {db,env,event,cid,agent,account,invite,pdf,pair,patchPayload,invitation,security,setClock:(s:string)=>{clock=s;},setNative:(s:string)=>{nativeClock=s;},close:()=>{db.close();native.close();},count:(t:string)=>Number(db.sqlite.prepare('SELECT count(*) n FROM '+t).get()!.n)};
}
async function hashIdentityInputBytes(bytes:Uint8Array){return Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))).toString('hex');}
