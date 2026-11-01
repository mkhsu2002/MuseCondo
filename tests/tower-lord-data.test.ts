import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LocalDatabase } from '../server/live/local-db.ts';
import { createTowerLordData, TowerLordQueryError } from '../server/live/tower-lord-data.ts';
const stamp='2026-10-31T19:00:00.000Z';
function fixture(){
 const db=new LocalDatabase(':memory:');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 // Import historical read fixtures into the real schema, without invoking operational guards or outboxes.
 for(const row of db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all())db.sqlite.exec(`DROP TRIGGER "${String(row.name).replaceAll('"','""')}"`);
 db.sqlite.exec('PRAGMA foreign_keys=OFF');
 const insert=(table:string,data:Record<string,unknown>)=>{const keys=Object.keys(data);db.sqlite.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(data) as never[]);};
 const api=createTowerLordData({db,environment:'test',now:()=>new Date(Date.parse(stamp)+1000),towerOrigin:'https://tower.example'});
 return {db,insert,api};
}
function household(f:ReturnType<typeof fixture>,id:string,published:boolean,testOnly=0){
 f.insert('accounts',{id:'a'+id,login_hash:'hash'+id,created_at:stamp,test_only:testOnly});
 f.insert('rooms',{id,account_id:'a'+id,name:'Chosen '+id,intro:'private secret',role:'resident',published:published?1:0,generation_state:'complete',created_at:stamp,test_only:testOnly});
 f.insert('tower_residencies',{room_id:id,account_id:'a'+id,resident_id:'resident'+id,source_url:'https://source.example/'+id+'?private=secret#secret',proof_method:'challenge',revision:3,public_revision:published?2:null,created_at:stamp,updated_at:stamp});
}
function application(f:ReturnType<typeof fixture>,id:string,room:string){f.insert('tower_reception_cases',{id,token_hash:'secret-'+id,state:'active',name:'Applicant',request_kind:'new',request_text:'private prompt secret',account_id:'a'+room,authorization_json:'{"secret":true}',sharing_json:'{}',visit_plan_json:'{}',next_action:'private secret',expires_at:'2027-01-01T00:00:00.000Z',created_at:stamp,updated_at:stamp,is_muse_agent:1});}
function cycle(f:ReturnType<typeof fixture>){f.insert('tower_autonomy_cycles',{id:'cycle',day:'2026-10-31',state:'complete',purpose:'private prompt secret',outcome:'pass',budget_micro:3000000,audit_json:'{"secret":"raw secret", "callId":"same"}',review_json:'{"memory":"private secret"}',created_at:stamp,updated_at:stamp});}

test('overview counts stable households once across multiple applications, and preserves private/public and classification boundaries',async()=>{
 const f=fixture();try{household(f,'one',true);household(f,'two',false,1);application(f,'case1','one');application(f,'case2','one');
 const before=f.db.sqlite.prepare('SELECT total_changes() changes').get()?.changes;
 const o=await f.api.overview();assert.deepEqual({...o.households},{total:2,published:1,unpublished:1,synthetic:1,unclassified:1,archivedWithdrawn:null});assert.equal(o.applications?.reduce((n,r)=>n+Number(r.count),0),2);
 const r=await f.api.residents();assert.equal(r.items.length,2);assert.equal(r.items.find(x=>x.roomId==='two')?.towerUrl,null);assert.equal(r.items.find(x=>x.roomId==='one')?.sourceUrl,'https://source.example/one');assert.doesNotMatch(JSON.stringify({o,r}),/private prompt secret|private secret|token_hash|authorization_json|[?]private/);
 assert.equal(f.db.sqlite.prepare('SELECT total_changes() changes').get()?.changes,before);
 }finally{f.db.close();}
});

test('application case lifecycle and actual review result stay distinct; safe missing fields and no raw applicant request',async()=>{
 const f=fixture();try{household(f,'one',true);application(f,'case1','one');f.insert('manager_admission_jobs',{id:'review',case_id:'case1',case_version:1,policy_version:1,snapshot_json:'{"secret":"private prompt"}',state:'complete',decision:'approve',created_at:stamp});
 const response=await f.api.applications();const c=response.items[0];assert.equal(c.caseState,'active');assert.equal(c.reviewState,'complete');assert.equal(c.reviewDecision,'approve');assert.equal(c.isMuseAgent,1);assert.equal(c.speciesBasis,'self-declared-no-platform-attestation');assert.deepEqual(c.missingFields,['sourceUrl','residentId']);assert.doesNotMatch(JSON.stringify(response),/private prompt secret|authorization_json|secret-/);
 }finally{f.db.close();}
});

test('usage sums unique original calls, excludes count estimates from inference tokens, retains unknowns and avoids shared theme references',async()=>{
 const f=fixture();try{cycle(f);
 f.insert('manager_jobs',{id:'welcome',source_digest:'digest',state:'complete',reserved_micro:50,actual_micro:20,input_tokens:5,output_tokens:2,created_at:stamp,started_at:stamp});
 f.insert('manager_jobs',{id:'cancelled-before-dispatch',source_digest:'cancelled',state:'cancelled',actual_micro:0,created_at:stamp});
 f.insert('manager_jobs',{id:'not-dispatched',source_digest:'other',state:'pending',reserved_micro:100000,created_at:stamp});
 f.insert('manager_admission_calls',{id:'admission',job_id:'j',case_id:'c',phase:'review',billing_day:'2026-10-31',state:'received',reserved_micro:30000,actual_micro:30,input_tokens:10,output_tokens:3,created_at:stamp});
 f.insert('manager_admission_calls',{id:'count',job_id:'j',case_id:'c',phase:'count',billing_day:'2026-10-31',state:'received',reserved_micro:0,actual_micro:0,input_tokens:999999,output_tokens:0,created_at:stamp});
 f.insert('tower_autonomy_calls',{id:'same',cycle_id:'cycle',step_key:'step1',purpose:'lobby-theme-v1:audit',model:'muse-spark-1.3',billing_day:'2026-10-31',state:'received',reserved_micro:200,actual_micro:40,input_tokens:20,output_tokens:4,created_at:stamp});
 f.insert('tower_autonomy_calls',{id:'unknown',cycle_id:'cycle',step_key:'step2',purpose:'daily-thinking',model:'muse-spark-1.3',billing_day:'2026-10-31',state:'unknown',reserved_micro:300,created_at:stamp});
 f.insert('tower_autonomy_events',{id:'reference',cycle_id:'cycle',kind:'audit',detail_json:'{"callId":"same","secret":"private secret"}',created_at:stamp});
 theme(f);
 const u=await f.api.usage();assert.equal(u.totals.calls,5);assert.equal(u.totals.inputTokens,35);assert.equal(u.totals.outputTokens,9);assert.equal(u.totals.calculatedCostMicro,90);assert.equal(u.totals.unresolvedReservedMicro,300);assert.equal(u.totals.exposureMicro,390);assert.equal(u.totals.costUnknownCalls,1);assert.equal(u.totals.inputKnownCalls,3);assert.equal(u.totals.providerInvoicedCostMicro,null);assert.equal(u.costBasis,'calculated-not-invoiced');assert.equal(u.budget.autonomyDailyExposureMicro,340);assert.doesNotMatch(JSON.stringify(u),/private secret|999999/);
 }finally{f.db.close();}
});

test('unknown-only usage is null, not zero; missing sources are diagnosed without fabricated health',async()=>{
 const f=fixture();try{cycle(f);f.insert('tower_autonomy_calls',{id:'unknown',cycle_id:'cycle',step_key:'step2',purpose:'daily-thinking',model:'muse-spark-1.3',billing_day:'2026-10-31',state:'unknown',reserved_micro:300,created_at:stamp});const u=await f.api.usage();assert.equal(u.totals.inputTokens,null);assert.equal(u.totals.outputTokens,null);assert.equal(u.totals.calculatedCostMicro,null);assert.equal(u.totals.exposureMicro,300);
 const db=new LocalDatabase(':memory:');try{const api=createTowerLordData({db,now:()=>new Date(Date.parse(stamp)+1000)});const d=await api.diagnostics();assert.equal(d.externalHealth,'not-probed');assert.ok(d.coverage.sources.every(x=>x.status==='missing'));assert.equal((await api.overview()).households,null);assert.equal((await api.usage()).totals.inputTokens,null);}finally{db.close();}
 }finally{f.db.close();}
});

test('history includes every recorded stage with safe summaries; stable cursor pagination and bounded filters',async()=>{
 const f=fixture();try{cycle(f);f.insert('tower_autonomy_events',{id:'e1',cycle_id:'cycle',kind:'private secret',detail_json:'{"prompt":"private secret"}',created_at:stamp});f.insert('tower_manager_runs',{run_key:'run',job:'private secret',period:'2026-10-31',state:'complete',attempts:1,lease_until:stamp,result_json:'{"secret":"private secret"}',created_at:stamp});
 const whole=await f.api.history();assert.equal(whole.items.length,5);assert.ok(whole.items.some(x=>x.duty==='audit'));assert.ok(whole.items.some(x=>x.duty==='reflection'));assert.ok(whole.items.some(x=>x.duty==='schedule'));assert.doesNotMatch(JSON.stringify(whole),/private secret|raw secret/);
 const ids:string[]=[];let cursor:string|null=null;do{const p=await f.api.history({limit:2,...(cursor?{cursor}:{})});ids.push(...p.items.map(x=>String(x.id)));cursor=p.nextCursor;}while(cursor);assert.equal(new Set(ids).size,5);assert.deepEqual(ids,whole.items.map(x=>x.id));assert.equal((await f.api.history({duty:'reflection'})).items.length,1);assert.equal((await f.api.history({correlationId:'cycle'})).items.length,4);
 for(const q of [{limit:101},{from:'2025-01-01',to:stamp},{to:'invalid'},{cursor:'not-base64'},{cursor:btoa('{"at":"invalid","id":"a"}')}])await assert.rejects(()=>f.api.history(q),TowerLordQueryError);
 }finally{f.db.close();}
});

function theme(f:ReturnType<typeof fixture>){
 const base={cycle_id:'cycle',generation_id:'generation',appearance_revision:1,original_budget_micro:3000000,starts_at:'2026-10-31T07:00:00.000Z',ends_at:'2026-11-01T07:00:00.000Z',state:'complete',outcome:'pass',audit_json:'{"callId":"same","private":"secret marker"}',review_json:'{"memory":"secret marker"}',created_at:stamp,updated_at:stamp};
 f.insert('tower_autonomy_extensions',{id:'theme',obligation_version:1,capability:'style-public-lobby-v1',...base});
 f.insert('tower_theme_build_reviews',{id:'build',extension_id:'theme',artifact_id:'artifact',source_build_hash:'a'.repeat(64),target_build_hash:'b'.repeat(64),content_revision:'english-copy-v1',...base});
}
test('history covers admission, welcome, cycle, theme, build, independent audit and reflection with distinct references',async()=>{
 const f=fixture();try{cycle(f);theme(f);household(f,'one',true);application(f,'case1','one');
 f.insert('manager_admission_jobs',{id:'review',case_id:'case1',case_version:1,policy_version:1,snapshot_json:'{}',state:'complete',decision:'approve',created_at:stamp});
 f.insert('manager_jobs',{id:'welcome',source_digest:'digest',state:'complete',created_at:stamp,started_at:stamp});
 const h=await f.api.history({limit:100});for(const duty of ['admission','welcome','daily','theme','build-review','audit','reflection'])assert.ok(h.items.some(x=>x.duty===duty),duty);assert.equal(h.items.filter(x=>x.duty==='reflection').length,3);assert.equal(h.items.find(x=>x.duty==='theme')?.outcome,'pass');assert.doesNotMatch(JSON.stringify(h),/secret marker|callId|memory/);
 }finally{f.db.close();}
});

test('pending missing declaration and needs-info decisions wait on Agent; error codes are allowlisted',async()=>{
 const f=fixture();try{household(f,'one',true);application(f,'incomplete','one');f.db.sqlite.exec("UPDATE tower_reception_cases SET state='pending',is_muse_agent=NULL WHERE id='incomplete'");
 let c=(await f.api.applications()).items[0];assert.equal(c.waitingOn,'agent');assert.equal(c.nextAction,'Provide missing application details');assert.ok((c.missingFields as string[]).includes('isMuseAgent'));
 f.db.sqlite.exec("UPDATE tower_reception_cases SET is_muse_agent=1,source_url='https://source.example',resident_id='residentone' WHERE id='incomplete'");
 f.insert('manager_admission_jobs',{id:'needs-info',case_id:'incomplete',case_version:1,policy_version:1,snapshot_json:'{}',state:'complete',decision:'needs-info',error_code:'review_source_cooldown',created_at:stamp});
 c=(await f.api.applications()).items[0];assert.equal(c.waitingOn,'agent');assert.equal(c.errorCode,'review_source_cooldown');
 f.db.sqlite.exec("UPDATE manager_admission_jobs SET error_code='private-error-with-secret-marker'");c=(await f.api.applications()).items[0];assert.equal(c.errorCode,'unclassified-error');const h=await f.api.history();assert.equal(h.items.find(x=>x.source==='manager_admission_jobs')?.errorCode,'unclassified-error');assert.doesNotMatch(JSON.stringify(h),/private-error-with-secret-marker/);
 }finally{f.db.close();}
});

test('resident card and Guardian milestones use actual schema; acceptance is distinct from delivery and no contact material escapes',async()=>{
 const f=fixture();try{const room='1234567890abcdef';household(f,room,true);const agent='mcid:'+'a'.repeat(64),credential='c'.repeat(32),event='e'.repeat(32);
 f.insert('agent_identities',{agent_id:agent,account_id:'a'+room,room_id:room,resident_id:'1234567890abcdef',state:'active',recovery_consent:1,created_at:stamp,updated_at:stamp});
 f.insert('identity_guardians',{guardian_id:'b'.repeat(32),agent_id:agent,invitation_id:'i',email_verified_at:stamp,created_at:stamp});
 f.insert('identity_credentials',{credential_id:credential,agent_id:agent,account_id:'a'+room,revision:1,state:'issued',signed_json:'{"secret":"private signed document"}',pdf_digest:'a'.repeat(64),json_digest:'b'.repeat(64),pdf_length:1,json_length:1,pdf_chunks:1,json_chunks:1,issued_at:stamp,updated_at:stamp});
 f.insert('identity_mail_events',{id:event,kind:'identity-card',entity_id:credential,dedupe_key:'card',recipient_ciphertext:'secret email material',recipient_hash:'f'.repeat(64),payload_ciphertext:'private payload',state:'accepted',created_at:stamp,updated_at:stamp});
 let r=(await f.api.residents()).items[0];assert.equal(r.identityState,'active');assert.equal(r.guardianRegistered,1);assert.equal(r.cardState,'issued');assert.equal(r.cardDeliveryState,'accepted');
 f.insert('identity_mail_delivery_facts',{event_id:event,fact:'delivered',observed_at:stamp});r=(await f.api.residents()).items[0];assert.equal(r.cardDeliveryState,'delivered');assert.doesNotMatch(JSON.stringify(r),/secret email|private payload|private signed|recipient_hash/);
 f.insert('identity_mail_delivery_facts',{event_id:event,fact:'complained',observed_at:stamp});assert.equal((await f.api.residents()).items[0].cardDeliveryState,'complained');
 f.insert('tower_manager_runs',{run_key:'run',job:'daily',period:'today',state:'complete',attempts:1,lease_until:stamp,created_at:stamp});const o=await f.api.overview();assert.equal(o.schedule.lastRecordedRunAt,stamp);assert.equal(o.schedule.lastWakeAt,null);
 }finally{f.db.close();}
});

test('D1 compound SELECT limits: bounded batches preserve global pagination and distinguish synthetic stage IDs',async()=>{
 const f=fixture();try{cycle(f);theme(f);household(f,'one',true);application(f,'case','one');
 f.insert('tower_autonomy_cycles',{id:'cycle:audit',day:'2026-10-30',state:'complete',purpose:'private',outcome:'pass',budget_micro:3000000,audit_json:'{}',review_json:'{}',created_at:stamp,updated_at:stamp});
 f.insert('manager_admission_jobs',{id:'review',case_id:'case',case_version:1,policy_version:1,snapshot_json:'{}',state:'complete',decision:'approve',created_at:stamp});
 f.insert('manager_jobs',{id:'welcome',source_digest:'digest',state:'complete',created_at:stamp,started_at:stamp});
 f.insert('tower_manager_runs',{run_key:'scheduled',job:'daily',period:'today',state:'complete',attempts:1,lease_until:stamp,created_at:'2026-10-30T19:00:00.000Z'});
 let queries=0;
 const restrictedDb={prepare(sql:string){const terms=sql.split(/\bUNION\s+ALL\b/i).length;assert.ok(terms<=8,`D1 rejected ${terms} compound terms`);if(sql.startsWith('WITH history'))queries++;return f.db.prepare(sql);},batch:f.db.batch.bind(f.db)};
 const api=createTowerLordData({db:restrictedDb,now:()=>new Date(Date.parse(stamp)+1000)});
 const whole=await api.history({limit:100});assert.ok(queries>=3);assert.equal(whole.items.length,15);assert.equal(new Set(whole.items.map(x=>x.id)).size,whole.items.length);
 assert.ok(whole.items.some(x=>x.id==='tower_autonomy_cycles:daily:cycle:audit'));assert.ok(whole.items.some(x=>x.id==='tower_autonomy_cycles:audit:cycle:audit'));
 const paged:string[]=[];let cursor:string|null=null;
 do{const result=await api.history({limit:2,...(cursor?{cursor}:{})});paged.push(...result.items.map(x=>String(x.id)));cursor=result.nextCursor;}while(cursor);
 assert.deepEqual(paged,whole.items.map(x=>x.id));
 const filtered=await api.history({limit:100,correlationId:'cycle'});assert.equal(filtered.items.length,9);assert.ok(filtered.items.every(x=>x.correlationId==='cycle'));
 assert.equal((await api.history({duty:'reflection'})).items.length,4);
 }finally{f.db.close();}
});
