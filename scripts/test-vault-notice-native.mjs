// Synthetic isolated Workers/D1 validation. No deployment, real contacts or external provider traffic.
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {execFileSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {encryptPrivate,hashPrivate,hashIdentityInput} from '../server/live/identity-private.ts';
const runtime=process.argv[2];if(!runtime)throw Error('Pass existing miniflare/esbuild node_modules');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(join(resolve(runtime),'miniflare/dist/src/index.js')).href);
const {build}=await import(pathToFileURL(join(resolve(runtime),'esbuild/lib/main.js')).href);
const script=(await build({stdin:{contents:`import {createVaultUpgradeNotice} from './server/live/vault-upgrade-notice.ts';
let sends=0;
export default {async fetch(request,env){const origin='https://synthetic-vault-upgrade.example',key='a'.repeat(64),from='MuseCondo <identity@example.com>';
const notice=createVaultUpgradeNotice({db:env.DB,origin,contactKey:key,apiKey:'synthetic-not-a-provider-key',from,operator:async()=>true,ready:async()=>true,fetcher:async(url,init)=>{
if(String(url).includes('/suppressions/')){if(env.OUTCOME==='suppressed')return Response.json({object:'suppression',email:'shared@example.com',origin:'complaint'});if(env.OUTCOME==='race')await env.DB.prepare("UPDATE agent_identities SET state='retired'").run();return Response.json({},{status:404});}
if(String(url).endsWith('/emails')){sends++;if(env.OUTCOME==='unknown')throw Error('synthetic ambiguous outcome');return Response.json({id:'synthetic-provider-1'});}throw Error('External access prohibited');}});
if(new URL(request.url).pathname==='/metrics')return Response.json({sends});return await notice.fetch(request)??new Response('missing',{status:404});}};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false,target:'es2022'})).outputFiles[0].text;
const migrations=[];for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort()){
 const split=JSON.parse(execFileSync('python3',['-c',"import sys,sqlite3,json\ns='';r=[]\nfor c in sys.stdin.read():\n s+=c\n if c==';' and sqlite3.complete_statement(s):r.append(s);s=''\nif s.strip() and not s.strip().startswith('--'):raise ValueError('Incomplete SQL')\nprint(json.dumps(r))"],{input:await readFile('migrations/'+name,'utf8'),encoding:'utf8'}));migrations.push(...split);
}
async function scenario(outcome){const origin='https://synthetic-vault-upgrade.example',key='a'.repeat(64),from='MuseCondo <identity@example.com>',config={modules:true,script,compatibilityDate:'2026-10-30',d1Databases:{DB:'synthetic-vault-upgrade'},bindings:{OUTCOME:outcome},outboundService:()=>{throw Error('External access prohibited');}},mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config);
 try{const db=await mf.getD1Database('DB');for(const sql of migrations)await db.prepare(sql).run();const time=new Date().toISOString(),expires=new Date(Date.now()+3600000).toISOString();const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
 await run('INSERT INTO tower_admission_policies VALUES(2,?,0,?)','["*"]',time);await run('UPDATE tower_admission_current SET policy_version=2 WHERE id=1');
 for(const x of ['a','b']){const account=x.repeat(16),agent='mcid:'+x.repeat(64),invite=x.repeat(32),email=x==='a'?'SHARED@example.com':'shared@example.com';
 await run('INSERT INTO accounts(id,login_hash,created_at) VALUES(?,?,?)',account,await hashIdentityInput(x),time);
 await run("INSERT INTO rooms(id,account_id,name,intro,role,generation_state,created_at) VALUES(?,?,'synthetic','synthetic','resident','external-ready',?)",account,account,time);
 await run("INSERT INTO tower_residencies(room_id,account_id,resident_id,source_url,proof_method,created_at,updated_at) VALUES(?,?,?,?,'challenge',?,?)",account,account,account,'https://synthetic.example/'+x,time,time);
 await run("INSERT INTO agent_identities(agent_id,account_id,room_id,resident_id,state,recovery_consent,created_at,updated_at) VALUES(?,?,?,?,'active',1,?,?)",agent,account,account,account,time,time);
 await run("INSERT INTO identity_guardian_invites(id,agent_id,account_id,identity_version,authority_epoch,state,recipient_ciphertext,email_hash,invite_token_hash,expires_at,created_at,updated_at) VALUES(?,?,?,1,1,'registered',?,?,?,?,?,?)",invite,agent,account,await encryptPrivate(key,'guardian-recipient',agent,email),await hashPrivate(key,'guardian-email',email),'1'.repeat(64),expires,time,time);
 await run('INSERT INTO identity_guardians(guardian_id,agent_id,invitation_id,email_verified_at,created_at) VALUES(?,?,?,?,?)',invite,agent,invite,time,time);
 }
 await run("INSERT INTO identity_mail_webhook_setups VALUES(?,?,?,?,'ready',?,?,?,NULL,?,?)",origin,origin+'/api/v1/identity/mail/webhook','synthetic-setup','0'.repeat(32),'synthetic-hook',await encryptPrivate(key,'mail-webhook-secret',origin,'whsec_'+Buffer.from('synthetic-only-signing-key-not-real').toString('base64')),time,time,time);
 const check='c'.repeat(32),result={checkId:check,state:'ready',reason:'sender_verified',domain:'example.com',domainVerified:true,sendingEnabled:true,senderReady:true,deliveryVerified:false,checkedAt:time};
 await run("INSERT INTO identity_mail_provider_checks VALUES(?,?,?,?,'complete',200,?,?,?)",check,await hashIdentityInput(check),await hashIdentityInput(JSON.stringify(['identity-mail-provider:input',from,origin])),'example.com',JSON.stringify(result),time,time);
 const dispatch=()=>mf.dispatchFetch(origin+'/api/v1/operator/vault-upgrade/dispatch',{method:'POST',body:JSON.stringify({release:'private-vault-v1'})});
 const first=await dispatch();assert.equal(first.status,200,await first.clone().text());assert.equal((await db.prepare('SELECT count(*) n FROM vault_upgrade_outbox').first()).n,1);
 const state=(await db.prepare('SELECT state FROM vault_upgrade_outbox').first()).state;assert.equal(state,outcome==='ok'?'sent':outcome==='unknown'?'unknown':outcome==='suppressed'?'blocked':'pending');
 await dispatch();const metrics=await (await mf.dispatchFetch(origin+'/metrics')).json();assert.equal(metrics.sends,['race','suppressed'].includes(outcome)?0:1);
 assert.equal((await db.prepare('SELECT count(*) n FROM vault_upgrade_dispatches').first()).n,['race','suppressed'].includes(outcome)?0:1);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 if(!['race','suppressed'].includes(outcome))await assert.rejects(()=>db.prepare('DELETE FROM vault_upgrade_dispatches').run());
 console.log('PASS native vault notice '+outcome+': normalized shared mailbox, permanent replay, source CAS, FK/audit');
 }finally{await mf.dispose();}}
for(const outcome of ['ok','unknown','race','suppressed'])await scenario(outcome);
