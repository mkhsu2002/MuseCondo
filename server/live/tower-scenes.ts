import type {Database} from './db.ts';
import type {AssetBucket} from './tower-autonomy.ts';
import type {TowerScene} from '../../src/shared/tower-scene-types.ts';
import {BASELINE_SHA,BIBLE_VERSION,BIBLE,SCENES,sceneKey,b64,approvedSceneReference,PRIMARY_SCENE_REFERENCE,type SceneKey} from './tower-scenes-catalog.ts';
import {sceneProvider,outputJSON,SceneFailure,type SceneProviderOptions} from './tower-scenes-provider.ts';
import {baseline,storeScene,readScene,type SceneArtifact} from './tower-scenes-storage.ts';
export type {TowerScene} from '../../src/shared/tower-scene-types.ts';
export interface TowerSceneOptions extends SceneProviderOptions {db:Database;approved:boolean;origin:string;bucket?:AssetBucket;assetFetch?:(path:string)=>Promise<Response>;assets?:{fetch(request:Request):Promise<Response>}}
export interface SceneGenerateOptions {batchId?:string;periodKey?:string;autoPublish?:boolean}
export interface SceneStatus {id:string;state:string;sceneKey:string;errorCode:string|null;leaseUntil:string|null}
interface SceneRow extends SceneArtifact {baseline_sha:string;bible_version:string;id:string;scene_key:SceneKey;period_key:string|null;batch_id:string|null;state:string;plan_json:string|null;review_json:string|null;error_code:string|null;created_at:string;published_at:string|null;lease_until:string|null}
const referenceInstructions='The ORIGINAL reference is primary and binding. The maintainer-approved secondary reference only guides matching architectural details and atmosphere; never replace the original building or progressively imitate later generated images.';
const planInstructions='You are the actual Muse Tower Manager. Choose a fresh camera angle and write a bounded image-edit scene prompt for this exact Tower. Supplied scene Bible and original reference are binding. Return ONLY JSON {sceneKey:string,prompt:string}. Pick a permitted sceneKey; preserve the single same building. Never invent people, residents or events. No tools or outside actions.';
const reviewInstructions='You are an independent visual reviewer in a fresh context, not the author of the image. Compare the ORIGINAL Tower reference with the ACTUAL generated image. Same world requires the recognizable single stepped ivory modular tower, amber window grid, monumental rounded arches, greenery and curved pavilions. An unrelated building fails even if attractive. The empty interior or close-up must visibly share the architecture/materials. Check no people, text, logo, watermark or neighboring towers. Return ONLY JSON {pass:boolean,description:string}; describe actual visible evidence and reject uncertainty.';
const textRequest=(instructions:string,input:unknown)=>({model:'muse-spark-1.3',instructions:instructions+' '+referenceInstructions,input:Array.isArray(input)||typeof input==='string'?input:JSON.stringify(input)});
/** Internal service: operator/scheduler authorization belongs to the caller. Public reads never generate. */
export function createTowerScenes(options:TowerSceneOptions){
 const {db}=options,now=()=>options.now?.()??new Date(),run=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args).run();
 const assetFetch=options.assetFetch??(options.assets?async(path:string)=>options.assets!.fetch(new Request(new URL(path,options.origin))):undefined);
 const provider=sceneProvider({...options,restoreImage:async(id:string)=>{const s=await row(id);if(!s?.object_key)throw new SceneFailure('image_artifact_unavailable','unknown');const bytes=await readScene(options.bucket,s);return {data:[{b64_json:b64(bytes)}]};}});
 const row=(id:string)=>db.prepare('SELECT * FROM tower_scenes WHERE id=?').bind(id).first<SceneRow>();
 const configured=()=>options.approved&&!!options.apiKey&&!!options.bucket&&[options.budgetMicro,options.dailyBudgetMicro,options.monthlyBudgetMicro].every(v=>Number.isSafeInteger(v)&&v>0&&v<=1000000000);
 function publicScene(s:SceneRow):TowerScene{return {id:s.id,title:SCENES[s.scene_key][0],caption:SCENES[s.scene_key][1],url:new URL(`/api/v1/tower/scenes/${encodeURIComponent(s.id)}.png`,options.origin).href,width:s.width,height:s.height,createdAt:s.created_at,...(s.period_key?{issueId:'tower-weekly-'+s.period_key}:{})};}
 async function get(id:string){const s=await row(id);if(!s||s.state!=='published')return null;return publicScene(s);}
 async function getInternal(id:string):Promise<SceneStatus|null>{const s=await row(id);return s?{id:s.id,state:s.state,sceneKey:s.scene_key,errorCode:s.error_code,leaseUntil:s.lease_until}:null;}
 async function list(){const rows=(await db.prepare("SELECT * FROM tower_scenes WHERE state='published' ORDER BY published_at DESC,id LIMIT 200").all<SceneRow>()).results;return rows.map(publicScene);}
 async function asset(id:string){const s=await row(id);if(!s||s.state!=='published')return null;try{const bytes=await readScene(options.bucket,s);return {arrayBuffer:async()=>new Uint8Array(bytes).buffer,sha256:s.sha256};}catch{return null;}}
 async function previewAsset(id:string){const s=await row(id);if(!options.approved||!s||!['reviewed','published'].includes(s.state))return null;try{const bytes=await readScene(options.bucket,s);return {arrayBuffer:async()=>new Uint8Array(bytes).buffer,sha256:s.sha256};}catch{return null;}}
 async function approve(ids:string[]){if(!options.approved||ids.length<1||ids.length>6||new Set(ids).size!==ids.length)throw Error('scene_approval_invalid');for(const id of ids){const s=await row(id);if(!s||!['reviewed','published'].includes(s.state)||!s.batch_id)throw Error('scene_not_reviewed');await readScene(options.bucket,s);}await db.batch(ids.map(id=>db.prepare("UPDATE tower_scenes SET state='published',published_at=? WHERE id=? AND state='reviewed'").bind(now().toISOString(),id)));return list();}
 async function references(key:SceneKey,settings:SceneGenerateOptions,savedPlan?:string|null){
  const approval=await db.prepare('SELECT 1 FROM tower_scene_style_approval WHERE id=1 AND baseline_sha=? AND bible_version=?').bind(BASELINE_SHA,BIBLE_VERSION).first();
  const refs:Record<string,string>[]=[{...PRIMARY_SCENE_REFERENCE}];let secondary:SceneRow|null=null;
  if(!approval){if(settings.periodKey||settings.batchId?.startsWith('initial-v1-')&&!['arrival-court','atrium-lobby','rooftop-greenhouse'].includes(key))throw new SceneFailure('scene_style_approval_required','blocked');}
  else {
   const expected=approvedSceneReference(key);secondary=await row(expected.id);
   if(!secondary||!['reviewed','published'].includes(secondary.state)||secondary.scene_key!==expected.scene_key||secondary.batch_id!=='initial-v1-1'||secondary.baseline_sha!==BASELINE_SHA||secondary.bible_version!==BIBLE_VERSION||secondary.object_key!==`tower-scenes/${expected.id}.png`||secondary.sha256!==expected.sha256||secondary.width!==expected.width||secondary.height!==expected.height)throw new SceneFailure('scene_approved_reference_invalid','blocked');
   refs.push({role:'secondary',id:expected.id,sha256:expected.sha256});
  }
  if(savedPlan){const saved=JSON.parse(savedPlan) as {references?:unknown};if(JSON.stringify(saved.references)!==JSON.stringify(refs))throw new SceneFailure('scene_reference_binding','blocked');}
  const bytes=secondary?await readScene(options.bucket,secondary):null;
  return {refs,images:bytes?[{type:'input_text',text:'MAINTAINER-APPROVED SECONDARY reference; original remains primary'},{type:'input_image',image_url:`data:image/png;base64,${b64(bytes)}`}]:[],edit:bytes?[{image_url:`data:image/png;base64,${b64(bytes)}`}]:[]};
 }
 async function generate(id:string,key:string,settings:SceneGenerateOptions={}){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||!sceneKey(key)||!!settings.batchId===!!settings.periodKey||[settings.batchId,settings.periodKey].some(v=>v!==undefined&&!/^[a-zA-Z0-9_-]{1,100}$/.test(v)))throw Error('invalid_scene_job');
  const existing=await row(id);if(existing){if(existing.scene_key!==key||existing.batch_id!==(settings.batchId??null)||existing.period_key!==(settings.periodKey??null))throw Error('scene_job_binding');if(existing.state!=='pending')return get(id);}
  if(!existing)try{await run("INSERT INTO tower_scenes(id,scene_key,period_key,batch_id,baseline_sha,bible_version,state,created_at,lifetime_budget,daily_budget,monthly_budget) VALUES(?,?,?,?,?,?,'pending',?,?,?,?)",id,key,settings.periodKey??null,settings.batchId??null,BASELINE_SHA,BIBLE_VERSION,now().toISOString(),options.budgetMicro,options.dailyBudgetMicro,options.monthlyBudgetMicro);}catch(error){const duplicate=await row(id);if(duplicate&&duplicate.scene_key===key&&duplicate.batch_id===(settings.batchId??null)&&duplicate.period_key===(settings.periodKey??null)){if(duplicate.state!=='pending')return get(id);}else throw error;}
  let original:Uint8Array;
  try{original=await baseline(assetFetch);}catch(error){await run("UPDATE tower_scenes SET state='blocked',error_code=? WHERE id=? AND state='pending'",error instanceof Error?error.message:'baseline_unavailable',id);return null;}
  if(!configured()){await run("UPDATE tower_scenes SET state='blocked',error_code='scene_not_configured' WHERE id=? AND state='pending'",id);return null;}
  const claimedLease=new Date(now().getTime()+360000).toISOString();
  const claim=await run("UPDATE tower_scenes SET state='running',lease_until=? WHERE id=? AND state='pending'",claimedLease,id);if(claim.meta.changes!==1)return null;
  return runStages(id,key,settings,original,claimedLease);
 }
 async function runStages(id:string,key:SceneKey,settings:SceneGenerateOptions,original:Uint8Array,claimedLease:string){
  const ownedRun=async(sql:string,...args:unknown[])=>{const result=await run(sql,...args,claimedLease);if(result.meta.changes!==1)throw new SceneFailure('scene_lease_lost','blocked');return result;};
  const ownedProvider=(purpose:'plan'|'image'|'review',payload:Record<string,unknown>)=>provider(id,purpose,payload,claimedLease);
  try{
   const prior=await row(id),refs=await references(key,settings,prior?.plan_json);
   const used=(await db.prepare("SELECT scene_key,plan_json FROM tower_scenes WHERE id!=? AND plan_json IS NOT NULL ORDER BY created_at DESC LIMIT 20").bind(id).all()).results;
   const plan=outputJSON(await ownedProvider('plan',textRequest(planInstructions,[{role:'user',content:[{type:'input_text',text:JSON.stringify({bible:BIBLE,sceneKey:key,permittedSceneKeys:[key],view:SCENES[key][2],previousAngles:used})},{type:'input_image',image_url:`data:image/png;base64,${b64(original)}`},...refs.images]}])));
   if(plan.sceneKey!==key||typeof plan.prompt!=='string'||!plan.prompt.trim()||plan.prompt.length>4000||Object.keys(plan).some(k=>!['sceneKey','prompt'].includes(k)))throw new SceneFailure('scene_plan_invalid','invalid');
   await ownedRun("UPDATE tower_scenes SET plan_json=COALESCE(plan_json,?) WHERE id=? AND state='running' AND lease_until=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')",JSON.stringify({...plan,references:refs.refs}),id);
   // Re-read and hash the original immediately before every paid image edit.
   const exact=await baseline(assetFetch),checked=await references(key,settings,(await row(id))?.plan_json),image=await ownedProvider('image',{model:'muse-image-1.0',n:1,response_format:'b64_json',output_format:'png',size:'1600x1000',reasoning_strength:'low',tool_enablement:{enable_image_search:false,enable_web_search:false,enable_shell:false},prompt:`${BIBLE}\n${referenceInstructions}\nManager-selected scene: ${plan.prompt}`,images:[{image_url:`data:image/png;base64,${b64(exact)}`},...checked.edit]});
   const a=await storeScene(options.bucket,id,image,a=>ownedRun("UPDATE tower_scenes SET object_key=?,sha256=?,byte_length=?,width=?,height=? WHERE id=? AND state='running' AND lease_until=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')",a.object_key,a.sha256,a.byte_length,a.width,a.height,id));
   const actual=await readScene(options.bucket,a),reviewRefs=await references(key,settings,(await row(id))?.plan_json),review=outputJSON(await ownedProvider('review',textRequest(reviewInstructions,[{role:'user',content:[{type:'input_text',text:BIBLE},{type:'input_text',text:'ORIGINAL reference'},{type:'input_image',image_url:`data:image/png;base64,${b64(original)}`},...reviewRefs.images,{type:'input_text',text:'ACTUAL generated R2 readback'},{type:'input_image',image_url:`data:image/png;base64,${b64(actual)}`}]}])));
   if(typeof review.pass!=='boolean'||typeof review.description!=='string'||!review.description.trim()||review.description.length>2000||Object.keys(review).some(k=>!['pass','description'].includes(k)))throw new SceneFailure('scene_review_invalid','invalid');
   if(!review.pass)throw new SceneFailure('scene_review_failed','invalid');await readScene(options.bucket,a);
   await ownedRun("UPDATE tower_scenes SET state=?,review_json=?,published_at=? WHERE id=? AND state='running' AND lease_until=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')",settings.autoPublish&&!settings.batchId?'published':'reviewed',JSON.stringify(review),settings.autoPublish&&!settings.batchId?now().toISOString():null,id);
   return get(id);
  }catch(error){const failure=error instanceof SceneFailure?error:new SceneFailure(error instanceof Error?error.message:'scene_failed','invalid');await run("UPDATE tower_scenes SET state=?,error_code=? WHERE id=? AND state='running' AND lease_until=? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')",failure.outcome,failure.message,id,claimedLease);return null;}
 }
 async function ensureWeekly(periodKey:string,inaugural=false){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(periodKey))throw Error('invalid_scene_period');const assigned=await db.prepare('SELECT scene_id FROM tower_scene_periods WHERE period_key=?').bind(periodKey).first<{scene_id:string}>();if(assigned)return get(assigned.scene_id);
  let s:TowerScene|null=null;if(inaugural){const first=await db.prepare("SELECT id FROM tower_scenes WHERE state='published' AND batch_id IS NOT NULL ORDER BY created_at,id LIMIT 1").first<{id:string}>();if(first)s=await get(first.id);}else{const count=await db.prepare('SELECT count(*) n FROM tower_scene_periods').first<{n:number}>(),keys=Object.keys(SCENES);s=await generate('weekly-'+periodKey,keys[(count?.n??0)%keys.length],{periodKey,autoPublish:true});}
  if(s)await run('INSERT INTO tower_scene_periods(period_key,scene_id,created_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM tower_scene_periods WHERE period_key=?)',periodKey,s.id,now().toISOString(),periodKey);return s;
 }
 async function getForPeriod(periodKey:string){const r=await db.prepare('SELECT scene_id FROM tower_scene_periods WHERE period_key=?').bind(periodKey).first<{scene_id:string}>();return r?get(r.scene_id):null;}
 async function recover(id:string){const s=await row(id);if(!s||s.state!=='running'||!s.lease_until||s.lease_until>now().toISOString())return get(id);
  const claimedLease=new Date(now().getTime()+360000).toISOString();
  const claim=await run("UPDATE tower_scenes SET lease_until=? WHERE id=? AND state='running' AND lease_until=?",claimedLease,id,s.lease_until);if(claim.meta.changes!==1)return null;
  let original:Uint8Array;try{original=await baseline(assetFetch);}catch{return null;}
  return runStages(id,s.scene_key,{batchId:s.batch_id??undefined,periodKey:s.period_key??undefined,autoPublish:!s.batch_id},original,claimedLease);
 }
 return {generate,approve,list,get,getInternal,asset,ensureWeekly,getForPeriod,recover,previewAsset};
}
