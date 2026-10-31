/* global Response, Request, crypto, btoa */
import {Buffer} from 'node:buffer';
// Local opt-in proof: existing runtime cache only; every outbound request terminates in this stub.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {envelopeFixture} from '../tests/helpers/identity-mail-fixture.ts';
import {encryptPrivate} from '../server/live/identity-private.ts';
const runtimeRoot=process.argv[2];if(!runtimeRoot)throw Error('Pass an existing node_modules directory containing miniflare and esbuild');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(join(resolve(runtimeRoot),'miniflare/dist/src/index.js')).href);
const {build}=await import(pathToFileURL(join(resolve(runtimeRoot),'esbuild/lib/main.js')).href);
const compile=async entry=>(await build({entryPoints:[entry],bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'})).outputFiles[0].text;
const pagesSource=await compile('server/live/worker.ts');
// Inject a race at the final native batch boundary while keeping the production DO class unchanged.
const cardsSource=(await build({stdin:{contents:`
import publicWorker,{IdentityCardCoordinator as ProductCoordinator} from './workers/identity-card/worker.ts';
export class IdentityCardCoordinator extends ProductCoordinator {
 constructor(state,env){
  const sqls=new WeakMap(),native=env.DB;
  const db={prepare(sql){const track=s=>{const proxy=new Proxy(s,{get(target,name){if(name==='bind')return (...args)=>track(target.bind(...args));const v=target[name];return typeof v==='function'?v.bind(target):v;}});sqls.set(proxy,sql);return proxy;};const s=track(native.prepare(sql));return s;},async batch(statements){
   if(statements.some(s=>sqls.get(s)?.startsWith('INSERT INTO identity_mail_dispatches'))){const race=await native.prepare('SELECT enabled FROM synthetic_runtime_race WHERE id=1').first();if(race?.enabled){await native.batch([native.prepare("UPDATE identity_mail_webhook_setups SET state='unknown',handler_probe_at=NULL"),native.prepare('UPDATE synthetic_runtime_race SET enabled=0 WHERE id=1')]);}}
   return native.batch(statements);
  }};
  super(state,{...env,DB:db});
 }
}
export default publicWorker;
`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'})).outputFiles[0].text;
const fixture=await envelopeFixture(4400000),origin=fixture.env.origin,contact=fixture.env.contactKey;
const signingSecret='whsec_'+btoa('synthetic-local-provider-signing-only');
const events=['email.delivered','email.bounced','email.complained','email.failed','email.suppressed'];
const operator='synthetic-private-runtime-operator',providerCalls=[],sent=[];
let mf,created=false;const ambiguous='1'.repeat(32);let providerEmail=null;
const outbound=async request=>{
 const url=new URL(request.url);providerCalls.push({method:request.method,url:request.url});
 if(url.origin===origin){assert.equal(url.pathname,'/api/v1/identity/mail/webhook');return mf.dispatchFetch(request);}
 assert.equal(url.origin,'https://api.resend.com','No external provider/network request is allowed');
 assert.equal(request.headers.get('Authorization'),'Bearer synthetic-pages-only-key');
 if(url.pathname==='/webhooks'&&request.method==='GET')return Response.json({object:'list',has_more:false,data:created?[{id:'synthetic-hook',endpoint:origin+'/api/v1/identity/mail/webhook'}]:[]});
 if(url.pathname==='/webhooks'&&request.method==='POST'){
  assert(await (await mf.getD1Database('DB','pages')).prepare("SELECT 1 FROM identity_mail_webhook_setups WHERE state='creating'").first());
  assert.deepEqual(await request.json(),{endpoint:origin+'/api/v1/identity/mail/webhook',events});created=true;return Response.json({object:'webhook',id:'synthetic-hook',signing_secret:signingSecret},{status:201});
 }
 if(url.pathname==='/webhooks/synthetic-hook')return Response.json({object:'webhook',id:'synthetic-hook',endpoint:origin+'/api/v1/identity/mail/webhook',events,status:'enabled',signing_secret:signingSecret});
 if(url.pathname.startsWith('/suppressions/'))return new Response(null,{status:404});
 if(url.pathname==='/emails'&&request.method==='POST'){
  const body=await request.json();const event=body.tags.find(t=>t.name==='identity_event').value;
  const db=await mf.getD1Database('DB','pages');assert(await db.prepare('SELECT 1 FROM identity_mail_dispatches WHERE event_id=?').bind(event).first());
  sent.push(body);
  if(event===ambiguous){providerEmail={id:'synthetic-provider-11',from:body.from,to:body.to,subject:body.subject,tags:body.tags,last_event:'delivered',created_at:new Date().toISOString()};throw Error('Synthetic lost send acknowledgement');}
  return Response.json({id:'synthetic-provider-'+event.slice(0,2)});
 }
 if(url.pathname==='/emails'&&request.method==='GET')return Response.json({object:'list',has_more:false,data:providerEmail?[providerEmail]:[]});
 if(url.pathname==='/emails/synthetic-provider-11')return Response.json(providerEmail);
 throw Error('Unexpected local stub route: '+request.method+' '+url.pathname);
};
const common={PUBLIC_ORIGIN:origin,IDENTITY_CONTACT_KEY:contact,IDENTITY_MAIL_FROM:fixture.env.from};
const jwk=await crypto.subtle.exportKey('jwk',fixture.pair.publicKey);
const configuration={workers:[
 {name:'pages',modules:true,script:pagesSource,compatibilityDate:'2026-10-30',d1Databases:{DB:'synthetic-mail-shared'},bindings:{...common,TOWER_OPERATOR_KEY:operator,IDENTITY_MAIL_API_KEY:'synthetic-pages-only-key',IDENTITY_MAIL_DELIVERY_ENABLED:'true'},durableObjects:{IDENTITY_CARDS:{className:'IdentityCardCoordinator',scriptName:'cards'}},outboundService:outbound},
 {name:'cards',modules:true,script:cardsSource,compatibilityDate:'2026-10-30',d1Databases:{DB:'synthetic-mail-shared'},bindings:{...common,IDENTITY_PUBLIC_KEYS:JSON.stringify({fixture:jwk})},durableObjects:{IDENTITY_CARDS:{className:'IdentityCardCoordinator',useSQLite:true}},outboundService:()=>{throw Error('The private DO may never access the provider');}},
]};
mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(configuration):configuration);
try{
 const db=await mf.getD1Database('DB','pages');
 for(const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()){
  const statements=JSON.parse(execFileSync('python3',['-c',"import sys,sqlite3,json\nsql=sys.stdin.read(); current=''; result=[]\nfor char in sql:\n current+=char\n if char==';' and sqlite3.complete_statement(current):\n  result.append(current); current=''\nif current.strip() and not current.strip().startswith('--'): raise ValueError('Incomplete migration')\nprint(json.dumps(result))"],{input:await readFile('migrations/'+file,'utf8'),encoding:'utf8'}));
  await db.batch(statements.map(sql=>db.prepare(sql)));
 }
 await db.batch([db.prepare("INSERT INTO tower_admission_policies VALUES(2,'[\"*\"]',0,'2026-10-31T00:00:00.000Z')"),db.prepare('UPDATE tower_admission_current SET policy_version=2 WHERE id=1')]);
 // Seed data after all native indexes/triggers exist. Only independent synthetic identities are copied.
 for(const table of ['accounts','rooms','tower_residencies','agent_identities','identity_guardian_invites','identity_guardians','identity_credentials','identity_card_heads','identity_card_artifacts','identity_mail_events']){
  for(const row of fixture.db.sqlite.prepare('SELECT * FROM '+table).all()){
   const columns=Object.keys(row),query='INSERT INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')';
   await db.prepare(query).bind(...columns.map(c=>row[c])).run();
  }
 }
 await db.exec('CREATE TABLE synthetic_runtime_race(id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL)');await db.exec('INSERT INTO synthetic_runtime_race VALUES(1,0)');
 const post=(path,body,key=operator)=>mf.dispatchFetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Tower-Operator-Key':key},body:JSON.stringify(body)});
 const control=(action,requestKey)=>post('/api/v1/operator/identity/mail-delivery/'+action,{requestKey});
 const processEvent=id=>post('/api/v1/operator/identity/mail/'+id+'/process',{});
 const first=fixture.event,second='f'.repeat(32);
 assert.equal((await post('/api/v1/operator/identity/mail-delivery/setup',{requestKey:'unauthorized-setup'},'wrong')).status,401);assert.equal(providerCalls.length,0);
 assert.equal((await processEvent(first)).status,200);assert.equal(providerCalls.length,0);assert.equal(sent.length,0);
 const setup=await control('setup','native-setup-0001');assert.equal(setup.status,200,await setup.clone().text());assert.equal((await setup.json()).webhook.handlerVerified,false);
 const stored=await db.prepare('SELECT secret_ciphertext FROM identity_mail_webhook_setups').first();assert(!stored.secret_ciphertext.includes(signingSecret));
 const beforeProbeCalls=providerCalls.length;await processEvent(first);assert.equal(providerCalls.length,beforeProbeCalls,'Setup alone does not authorize a provider suppression GET or POST');
 const probe=await control('probe','native-probe-0001');assert.equal(probe.status,200,await probe.clone().text());assert.deepEqual(await probe.json(),{handlerVerified:true,deliveryVerified:false});
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM identity_mail_delivery_receipts').first()).n,0);
 const accepted=await processEvent(first);assert.equal(accepted.status,200,await accepted.clone().text());assert.equal((await accepted.json()).state,'accepted');assert.equal(sent.length,1);
 assert.equal(sent[0].attachments.length,2);assert.equal(Buffer.from(sent[0].attachments[0].content,'base64').length,fixture.pdf.length);
 assert.equal(Buffer.compare(Buffer.from(sent[0].attachments[0].content,'base64'),Buffer.from(fixture.pdf)),0);
 assert.equal(sent[0].attachments[1].content,Buffer.from(fixture.db.sqlite.prepare('SELECT signed_json FROM identity_credentials WHERE credential_id=?').get(fixture.cid).signed_json).toString('base64'));
 await processEvent(first);assert.equal(sent.length,1);
 await db.exec('UPDATE synthetic_runtime_race SET enabled=1 WHERE id=1');const raced=await processEvent(second);assert.equal(raced.status,200);assert.equal((await raced.json()).state,'pending');assert.equal(sent.length,1);assert.equal((await db.prepare('SELECT COUNT(*) n FROM identity_mail_dispatches WHERE event_id=?').bind(second).first()).n,0);
 assert.equal((await db.prepare('SELECT enabled FROM synthetic_runtime_race WHERE id=1').first()).enabled,0,'Race reached the final native D1 batch');
 await control('reconcile','native-reconcile-0001');await control('probe','native-probe-0002');
 await Promise.all([processEvent(second),processEvent(second)]);assert.equal(sent.length,2);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM identity_mail_dispatches').first()).n,2);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM identity_mail_finish_receipts').first()).n,2);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM identity_mail_audit WHERE action='sending'").first()).n,2);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM identity_mail_events WHERE attempt_count=1').first()).n,2);
 const privatePath='/__internal/identity-mail/prepare';assert.equal((await mf.dispatchFetch(origin+privatePath)).status,404);
 const cards=await mf.getWorker('cards');assert.equal((await cards.fetch(origin+privatePath)).status,404);
 const bindings=await mf.getBindings('pages'),stub=bindings.IDENTITY_CARDS.get(bindings.IDENTITY_CARDS.idFromName('mail:ee'));
 assert.equal((await stub.fetch(new Request(origin+privatePath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId:first})}))).status,503,'Private DO must reject already-processed prepare');
 assert.equal((await mf.dispatchFetch(origin+'/api/v1/identity/mail/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
 // A real signed callback crosses the compiled Pages route and its permanent receipt.
 const signal={type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:'synthetic-provider-ee',from:sent[0].from,to:sent[0].to,subject:sent[0].subject,tags:{identity_event:first},created_at:new Date().toISOString()}},raw=JSON.stringify(signal),timestamp=String(Math.floor(Date.now()/1000)),messageId='native-delivery-ee';
 const signingKey=await crypto.subtle.importKey('raw',Buffer.from(signingSecret.slice(6),'base64'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature='v1,'+Buffer.from(await crypto.subtle.sign('HMAC',signingKey,Buffer.from(messageId+'.'+timestamp+'.'+raw))).toString('base64');
 const callback=()=>mf.dispatchFetch(origin+'/api/v1/identity/mail/webhook',{method:'POST',headers:{'Content-Type':'application/json','svix-id':messageId,'svix-timestamp':timestamp,'svix-signature':signature},body:raw});
 const delivered=await callback();assert.equal(delivered.status,200,await delivered.clone().text());const delivery=await delivered.json();assert.equal(delivery.deliveryVerified,true);assert.deepEqual(await (await callback()).json(),delivery);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM identity_mail_delivery_receipts').first()).n,1);
 // A separate committed security event loses the provider acknowledgement; only GET reconciliation may resolve it.
 await db.prepare("UPDATE identity_credentials SET state='revoked' WHERE credential_id=?").bind(fixture.cid).run();
 const original=fixture.db.sqlite.prepare('SELECT * FROM identity_mail_events WHERE id=?').get(first),payload=await encryptPrivate(contact,'mail-payload',ambiguous,JSON.stringify({credentialId:fixture.cid,template:'identity-card-revoked-v1'})),now=new Date().toISOString();
 await db.prepare("INSERT INTO identity_mail_events(id,kind,entity_id,dedupe_key,recipient_ciphertext,recipient_hash,payload_ciphertext,created_at,updated_at) VALUES(?,'security-notice',?,?,?,?,?,?,?)").bind(ambiguous,fixture.cid,'synthetic-native-unknown',original.recipient_ciphertext,original.recipient_hash,payload,now,now).run();
 const unknown=await processEvent(ambiguous);assert.equal((await unknown.json()).state,'unknown');const postCount=sent.length;await processEvent(ambiguous);assert.equal(sent.length,postCount);
 const reconcile=()=>post('/api/v1/operator/identity/mail-delivery/event-reconcile',{requestKey:'native-send-readback',eventId:ambiguous});
 const resolved=await reconcile();assert.equal(resolved.status,200,await resolved.clone().text());const resolvedValue=await resolved.json();assert.equal(resolvedValue.delivery.deliveryVerified,true);const callCount=providerCalls.length;
 assert.deepEqual(await (await reconcile()).json(),resolvedValue);assert.equal(providerCalls.length,callCount);assert.equal(sent.length,postCount);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM identity_mail_dispatches').first()).n,3);assert.equal((await db.prepare('SELECT COUNT(*) n FROM identity_mail_finish_receipts').first()).n,3);
 await assert.rejects(db.exec('DELETE FROM identity_mail_control_audit'));await assert.rejects(db.exec('DELETE FROM identity_mail_dispatches'));
 console.log('PASS actual compiled Pages + DO + native D1: exact five-event setup, encrypted secret, own callback probe, async gate, final-batch race rollback, 4.4MB attachment identity, permanent single POST/lease/finish/audit, concurrent replay, signed callback receipts, unknown-send GET-only exact reconciliation and private RPC isolation; all network stubbed');
}finally{fixture.close();await mf.dispose();}
