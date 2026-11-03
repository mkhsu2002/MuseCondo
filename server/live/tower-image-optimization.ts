import type {Database} from './db.ts';
import {createManagerAutonomy,type AssetBucket} from './tower-autonomy.ts';
import {readTowerAsset,readTowerAssetMetadata,type AssetPurpose} from './tower-asset-storage.ts';
import {readScene,type SceneArtifact} from './tower-scenes-storage.ts';
import {validatePNG} from './png.ts';
import {cleanTowerWebP} from './tower-image-webp.ts';
export const AUTO_IMAGE_PROFILE='cf-webp-1920-q85-v1';
export const IMAGE_SCHEMA=['tower_image_jobs','tower_image_pending','tower_image_events','tower_image_job_insert','tower_image_job_transition','tower_image_job_delete','tower_image_job_created','tower_image_job_event','tower_image_event_update','tower_image_event_delete','tower_image_event_replace'];
export type ImageSourceKind='home'|'scene'|'appearance';
interface Source {kind:ImageSourceKind;id:string;digest:string;size:number;epoch:string;bytes?:Uint8Array<ArrayBuffer>}
interface Job {id:string;source_kind:ImageSourceKind;source_id:string;source_sha:string;source_epoch:string;source_bytes:number;state:string;profile:string;lease_token:string|null;lease_until:string|null;source_width:number|null;source_height:number|null;object_key:string|null;output_sha:string|null;output_bytes:number|null;output_width:number|null;output_height:number|null}
interface Options {db:Database;bucket?:AssetBucket;enabled:boolean;dailyLimit:number;monthlyLimit:number;wake?:()=>Promise<void>;appearance?:Pick<ReturnType<typeof createManagerAutonomy>,'publicState'|'asset'>}
const hash=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
const hex=(length:number)=>Array.from(crypto.getRandomValues(new Uint8Array(length)),value=>value.toString(16).padStart(2,'0')).join('');
/** Durable event-driven optimization; original storage remains authoritative. */
export function createTowerImageOptimization(options:Options){
 const {db}=options;
 const configured=()=>options.enabled&&!!options.bucket&&!!options.wake&&Number.isInteger(options.dailyLimit)&&options.dailyLimit>0&&options.dailyLimit<=64&&Number.isInteger(options.monthlyLimit)&&options.monthlyLimit>0&&options.monthlyLimit<=1000;
 const row=(id:string)=>db.prepare('SELECT * FROM tower_image_jobs WHERE id=?').bind(id).first<Job>();
 async function objectBytes(key:string,size:number){const object=await options.bucket!.get(key);if(!object)return null;const declared=(object as {size?:number}).size;if(!Number.isInteger(declared)||declared!==size||size<1||size>2*1024*1024)return null;const bytes=new Uint8Array(await object.arrayBuffer());return bytes.length===size?bytes:null;}
 async function schema(){const rows=(await db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'tower_image_%'").all<{name:string}>()).results;return IMAGE_SCHEMA.every(name=>rows.some(value=>value.name===name));}
 async function source(kind:ImageSourceKind,id:string,bytes=false):Promise<Source|null>{
  if(kind==='home'){
   const match=id.match(/^([a-f0-9]{16}):(home|dream)$/);if(!match)return null;const purpose=match[2] as AssetPurpose;
   const residency=await db.prepare('SELECT * FROM tower_residencies WHERE room_id=? AND public_revision IS NOT NULL AND snapshot_consent=1').bind(match[1]).first<{public_revision:number;dream_consent:number;updated_at?:string}>();
   if(!residency||(purpose==='dream'&&!residency.dream_consent))return null;
   const asset=bytes?await readTowerAsset(db,match[1],residency.public_revision,purpose):await readTowerAssetMetadata(db,match[1],residency.public_revision,purpose);
   return asset?{kind,id,digest:asset.digest,size:asset.size,epoch:JSON.stringify([residency.public_revision,residency.updated_at??null]),...('bytes'in asset&&asset.bytes instanceof Uint8Array?{bytes:new Uint8Array(asset.bytes)}:{})}:null;
  }
  if(kind==='appearance'){
   const match=id.match(/^(manager-\d{4}-\d{2}-\d{2}-r[01]):(day|night)$/);if(!match)return null;
   const manager=options.appearance??createManagerAutonomy({db,bucket:options.bucket}),active=await manager.publicState();
   if(!active||active.generation!==match[1])return null;
   const asset=await db.prepare('SELECT object_key,sha256,bytes FROM tower_autonomy_assets WHERE generation_id=? AND scene=?').bind(match[1],match[2]).first<{object_key:string;sha256:string;bytes:number}>();if(!asset)return null;
   const data=bytes?await manager.asset(match[1],match[2]):undefined;if(bytes&&!data)return null;
   return {kind,id,digest:asset.sha256,size:asset.bytes,epoch:JSON.stringify([active.revision,active.presentation?.id??null]),...(data?{bytes:new Uint8Array(data)}:{})};
  }
  if(kind!=='scene'||!/^[-a-zA-Z0-9_]{1,100}$/.test(id))return null;
  const asset=await db.prepare("SELECT object_key,sha256,byte_length,width,height FROM tower_scenes WHERE id=? AND state='published'").bind(id).first<SceneArtifact>();
  if(!asset)return null;return {kind,id,digest:asset.sha256,size:asset.byte_length,epoch:asset.sha256,...(bytes?{bytes:await readScene(options.bucket,asset)}:{})};
 }
 function authority(job:Pick<Job,'source_kind'|'source_id'|'source_sha'|'source_epoch'>):{sql:string;args:unknown[]}{
  if(job.source_kind==='scene')return {sql:"EXISTS(SELECT 1 FROM tower_scenes WHERE id=? AND sha256=? AND state='published')",args:[job.source_id,job.source_sha]};
  if(job.source_kind==='appearance'){const [generation,scene]=job.source_id.split(':'),epoch=JSON.parse(job.source_epoch) as [number,unknown];return {sql:"EXISTS(SELECT 1 FROM tower_autonomy_current c JOIN tower_autonomy_assets a ON a.generation_id=c.generation_id WHERE c.id=1 AND c.generation_id=? AND a.scene=? AND a.sha256=? AND c.revision=? AND c.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND c.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",args:[generation,scene,job.source_sha,epoch[0]]};}
  const [room,purpose]=job.source_id.split(':');
  const epoch=JSON.parse(job.source_epoch) as [number,string|null];
  return {sql:"EXISTS(SELECT 1 FROM tower_residencies r WHERE r.public_revision=?"+(epoch[1]!==null?" AND r.updated_at=?":"")+" AND r.room_id=? AND r.public_revision IS NOT NULL AND r.snapshot_consent=1 AND (?='home' OR r.dream_consent=1) AND (EXISTS(SELECT 1 FROM tower_asset_refs a WHERE a.room_id=r.room_id AND a.revision=r.public_revision AND a.purpose=? AND a.digest=?) OR EXISTS(SELECT 1 FROM tower_asset_chunks a WHERE a.room_id=r.room_id AND a.revision=r.public_revision AND a.purpose=? AND a.digest=?)))",args:[epoch[0],...(epoch[1]!==null?[epoch[1]]:[]),room,purpose,purpose,job.source_sha,purpose,job.source_sha]};
 }
 async function enqueue(kind:ImageSourceKind,id:string){
  if(!configured()||!await schema())return null;const current=await source(kind,id);if(!current||current.size<=256*1024)return null;
  const jobId=await hash(new TextEncoder().encode(JSON.stringify([kind,id,current.digest,current.epoch,AUTO_IMAGE_PROFILE])));
  const prior=await db.prepare("SELECT * FROM tower_image_jobs WHERE source_kind=? AND source_id=? AND source_sha=? AND profile=? AND state IN ('ready','unknown') ORDER BY CASE state WHEN 'ready' THEN 0 ELSE 1 END LIMIT 1").bind(kind,id,current.digest,AUTO_IMAGE_PROFILE).first<Job>();if(prior)return prior;
  const result=await db.prepare("INSERT INTO tower_image_jobs(id,source_kind,source_id,source_sha,source_epoch,source_bytes,profile,daily_limit,monthly_limit,created_at) SELECT ?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM tower_image_jobs WHERE id=?)").bind(jobId,kind,id,current.digest,current.epoch,current.size,AUTO_IMAGE_PROFILE,options.dailyLimit,options.monthlyLimit,jobId).run();
  if((result.meta.changes??0)>0)try{await options.wake!();}catch{await db.prepare("INSERT INTO tower_image_events(job_id,kind,detail_json,created_at) VALUES(?,'wake-failed','{}',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(jobId).run();}
  return row(jobId);
 }
 async function mark(id:string,state:string,code:string){await db.prepare("UPDATE tower_image_jobs SET state=?,error_code=? WHERE id=? AND state='running'").bind(state,code,id).run();}
 async function claim(){
  if(!configured()||!await schema())return null;
  await db.prepare("UPDATE tower_image_jobs SET state='unknown',error_code='lease_expired_unknown' WHERE state='running' AND lease_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
  const pending=(await db.prepare("SELECT * FROM tower_image_jobs WHERE state='pending' ORDER BY created_at,id LIMIT 6").all<Job>()).results;
  for(const job of pending){
   const blocker=await db.prepare("SELECT state FROM tower_image_jobs WHERE id!=? AND source_kind=? AND source_id=? AND source_sha=? AND profile=? AND state IN ('running','unknown') ORDER BY CASE state WHEN 'unknown' THEN 0 ELSE 1 END LIMIT 1").bind(job.id,job.source_kind,job.source_id,job.source_sha,job.profile).first<{state:string}>();if(blocker){if(blocker.state==='unknown')await db.prepare("UPDATE tower_image_jobs SET state='cancelled',error_code='prior_outcome_unknown' WHERE id=? AND state='pending'").bind(job.id).run();continue;}
   const current=await source(job.source_kind,job.source_id,true);
   if(!current?.bytes||current.digest!==job.source_sha||current.size!==job.source_bytes||current.epoch!==job.source_epoch){await db.prepare("UPDATE tower_image_jobs SET state='cancelled',error_code='source_unavailable' WHERE id=? AND state='pending'").bind(job.id).run();continue;}
   const dimensions=await validatePNG(current.bytes),lease=hex(16),guard=authority(job);
   const claimed=await db.prepare("UPDATE tower_image_jobs SET state='running',claimed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),reserved_day=substr(strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,10),reserved_month=substr(strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,7),lease_token=?,lease_until=strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 minutes'),source_width=?,source_height=? WHERE id=? AND state='pending' AND "+guard.sql+" AND NOT EXISTS(SELECT 1 FROM tower_image_jobs blocked WHERE blocked.id!=tower_image_jobs.id AND blocked.source_kind=tower_image_jobs.source_kind AND blocked.source_id=tower_image_jobs.source_id AND blocked.source_sha=tower_image_jobs.source_sha AND blocked.profile=tower_image_jobs.profile AND blocked.state IN ('running','unknown')) AND (SELECT COUNT(*) FROM tower_image_jobs WHERE reserved_day=substr(strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,10))<MIN(daily_limit,?) AND (SELECT COUNT(*) FROM tower_image_jobs WHERE reserved_month=substr(strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,7))<MIN(monthly_limit,?)").bind(lease,dimensions.width,dimensions.height,job.id,...guard.args,options.dailyLimit,options.monthlyLimit).run();
   if((claimed.meta.changes??0)>0)return {id:job.id,lease,profile:AUTO_IMAGE_PROFILE,sourceSha:current.digest,bytes:current.bytes,...dimensions};
  }
  return null;
 }
 async function failed(id:string,lease:string,code:string){const job=await row(id);if(!job||job.state!=='running'||job.lease_token!==lease)return false;await mark(id,code==='transform_rejected'?'rejected':'unknown',code==='transform_rejected'?code:'transform_unknown');return true;}
 async function complete(id:string,lease:string,input:Uint8Array<ArrayBuffer>){
  const job=await row(id);if(!job||job.lease_token!==lease)return false;
  const output=cleanTowerWebP(input),outputSha=await hash(output.bytes);
  if(job.state==='ready')return job.output_sha===outputSha;
  if(job.state!=='running')return false;
  const current=await source(job.source_kind,job.source_id);if(!current||current.digest!==job.source_sha||current.size!==job.source_bytes||current.epoch!==job.source_epoch){await mark(id,'cancelled','source_changed');return false;}
  const scale=Math.min(1,1920/job.source_width!,1920/job.source_height!);
  if(output.bytes.length>=job.source_bytes||Math.abs(output.width-job.source_width!*scale)>1||Math.abs(output.height-job.source_height!*scale)>1){await mark(id,'rejected','output_not_smaller_or_dimensions');return false;}
  const key='tower-auto-derivatives/v1/'+id+'/'+outputSha+'.webp';await options.bucket!.put(key,output.bytes,{httpMetadata:{contentType:'image/webp'}});
  const actual=await objectBytes(key,output.bytes.length);if(!actual||await hash(actual)!==outputSha)throw Error('image_readback_mismatch');
  const guard=authority(job);const saved=await db.prepare("UPDATE tower_image_jobs SET state='ready',object_key=?,output_sha=?,output_bytes=?,output_width=?,output_height=? WHERE id=? AND state='running' AND lease_token=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND "+guard.sql).bind(key,outputSha,output.bytes.length,output.width,output.height,id,lease,...guard.args).run();
  if((saved.meta.changes??0)>0)return true;
  const after=await row(id);if(after?.state==='running')await mark(id,'cancelled','source_or_lease_changed');return after?.state==='ready'&&after.output_sha===outputSha;
 }
 async function image(kind:ImageSourceKind,id:string,expectedSha:string){
  if(!configured()||!await schema())return null;const current=await source(kind,id);if(!current||current.digest!==expectedSha)return null;
  const job=await db.prepare("SELECT * FROM tower_image_jobs WHERE source_kind=? AND source_id=? AND source_sha=? AND profile=? AND state='ready'").bind(kind,id,expectedSha,AUTO_IMAGE_PROFILE).first<Job>();if(!job||!job.object_key||!job.output_sha)return null;
  try{const bytes=await objectBytes(job.object_key,job.output_bytes!);if(!bytes||await hash(bytes)!==job.output_sha)return null;const decoded=cleanTowerWebP(bytes);if(decoded.width!==job.output_width||decoded.height!==job.output_height||decoded.bytes.length!==bytes.length)return null;return {bytes,digest:job.output_sha,size:bytes.length};}catch{return null;}
 }
 async function recover(){
  if(!configured()||!await schema())return;
  const pending=await db.prepare("SELECT id FROM tower_image_jobs WHERE state IN ('pending','running') ORDER BY created_at LIMIT 1").first<{id:string}>();if(!pending)return;
  const result=await db.prepare("INSERT INTO tower_image_events(job_id,kind,detail_json,created_at) SELECT ?,'recovery-wake','{}',strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM tower_image_events WHERE kind='recovery-wake' AND substr(created_at,1,10)=substr(strftime('%Y-%m-%dT%H:%M:%fZ','now'),1,10))").bind(pending.id).run();if((result.meta.changes??0)>0)await options.wake!();
 }
 const enqueueHome=async(room:string)=>{for(const purpose of ['home','dream'])await enqueue('home',room+':'+purpose);};
 const backfill=async(inputs:{kind:ImageSourceKind;id:string}[])=>{if(!Array.isArray(inputs)||inputs.length<1||inputs.length>6)throw Error('image_batch_limit');const results=[];for(const value of inputs){const job=await enqueue(value.kind,value.id);results.push({id:job?.id??null,state:job?.state??'skipped'});}if(results.some(value=>value.state==='pending'))await options.wake!();return results;};
 return {enqueue,enqueueHome,claim,complete,failed,image,recover,backfill,schema};
}
