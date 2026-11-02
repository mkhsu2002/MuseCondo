// SQL-only historical case/receipt seeds. Every HTTP read, mutation and job step uses current production code.
import {createTowerReception as createCurrentReception} from '../../server/live/reception.ts';
import {digest} from '../../server/live/app.ts';
import {homeSourceURL,homeSourceIdentity} from '../../server/live/home-source.ts';
import {discoverHome,publicHomeURL,HomeDiscoveryError,homeResolutionDiagnostic} from '../../server/live/home-discovery.ts';
type Options=Parameters<typeof createCurrentReception>[0];
export function createTowerReception(env:Options){
 const current=createCurrentReception(env),now=env.now??(()=>new Date());
 return {async fetch(req:Request){
  if(req.method!=='POST'||new URL(req.url).pathname!=='/api/v1/reception/cases')return current.fetch(req);
  let v:Record<string,unknown>;try{v=await req.clone().json();}catch{return current.fetch(req);}
  const raw=req.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  const allowed=['requestKey','name','requestKind','request','sourceURL','homeURL','residentId','originClaim','isMuseAgent','authorization','sharing','visitPlan'];
  const valid=raw&&req.headers.get('Content-Type')?.startsWith('application/json')&&!req.headers.has('Cookie')&&req.headers.get('Sec-Fetch-Site')!=='cross-site'&&new URL(req.url).origin===env.origin&&(!req.headers.has('Origin')||req.headers.get('Origin')===env.origin)&&Object.keys(v).every(k=>allowed.includes(k))&&typeof v.name==='string'&&v.name.length>0&&v.name.length<=80&&typeof v.request==='string'&&v.request.length>0&&v.request.length<=1200&&typeof v.requestKey==='string'&&/^[A-Za-z0-9_-]{8,96}$/.test(v.requestKey)&&['new','takeover'].includes(String(v.requestKind))&&v.authorization&&Object.keys(v.authorization).length===3&&Object.values(v.authorization).every(x=>x===true)&&v.sharing&&Object.keys(v.sharing).length===4&&Object.values(v.sharing).every(x=>x===false)&&v.visitPlan&&['manual-return','self-scheduled'].includes(String((v.visitPlan as {mode?:unknown}).mode))&&((v.visitPlan as {mode?:unknown}).mode==='manual-return'?(v.visitPlan as {intervalHours?:unknown}).intervalHours===undefined:Number.isInteger((v.visitPlan as {intervalHours?:unknown}).intervalHours)&&Number((v.visitPlan as {intervalHours?:unknown}).intervalHours)>=1&&Number((v.visitPlan as {intervalHours?:unknown}).intervalHours)<=168)&&(v.isMuseAgent===undefined||typeof v.isMuseAgent==='boolean')&&!(v.isMuseAgent===true&&v.originClaim==='other'||v.isMuseAgent===false&&v.originClaim==='meta-muse')&&!(v.homeURL!==undefined&&v.sourceURL!==undefined)&&!(v.originClaim==='other'&&v.isMuseAgent!==false);
  if(!valid)return current.fetch(req);
  const hash=await digest(raw!),db=env.db,at=now().toISOString();
  if(await db.prepare('SELECT 1 FROM tower_reception_cases WHERE token_hash=?').bind(hash).first())return current.fetch(req);
  const hour=Math.floor(now().getTime()/3600000),ip=await digest(req.headers.get('CF-Connecting-IP')??'unknown');
  if(await db.prepare('SELECT 1 FROM rate_limits WHERE (key=? AND count>=100) OR (key=? AND count>=5)').bind('reception:global-open:'+hour,'reception:ip:'+ip+':'+hour).first())return current.fetch(req);
  let sourceURL:string|null=null,residentId=typeof v.residentId==='string'?v.residentId:null,homeURL:string|undefined,identity:string|undefined,resolution:string|undefined,errorCode:string|null=null;
  if(v.sourceURL!==undefined&&String(v.sourceURL).endsWith('/condo.json')){try{sourceURL=homeURL=homeSourceURL(v.sourceURL).href;identity=homeSourceIdentity(sourceURL);resolution='resolved';}catch{return Response.json({error:'invalid_source'},{status:400});}}
  else if(v.homeURL!==undefined||v.sourceURL!==undefined){if(v.isMuseAgent===false)residentId=null;else{try{homeURL=publicHomeURL(v.homeURL??v.sourceURL).href;try{identity=homeSourceIdentity(homeURL);}catch{/* A legacy webpage may advertise its manifest. */}const found=await discoverHome(homeURL,env.sourceFetch);if(residentId&&residentId!==found.residentId)throw new HomeDiscoveryError('home_identity_mismatch');sourceURL=found.sourceURL;residentId=found.residentId;identity=homeSourceIdentity(sourceURL);resolution='resolved';}catch(error){sourceURL=null;residentId=null;resolution='unavailable';errorCode=error instanceof HomeDiscoveryError?error.code:'home_data_unavailable';}}}
  const id=crypto.randomUUID().replaceAll('-',''),muse=v.isMuseAgent===true?1:v.isMuseAgent===false?0:null,expiry=new Date(now().getTime()+90*86400000).toISOString();
  let nextAction=muse===null?'Please confirm whether you are a Muse agent.':'Reception will reply here. Return according to your visit plan.';
  const missing=[...(muse===null?['isMuseAgent']:[]),...(muse===0?[]:[...(!sourceURL&&!homeURL?['sourceURL']:[]),...(!residentId&&resolution!=='unavailable'?['residentId']:[])])];
  const diagnostic=resolution==='unavailable'&&homeURL?homeResolutionDiagnostic(errorCode,homeURL):null;
  if(diagnostic)nextAction=(errorCode==='native_public_data_required'?'The public home was read, but its layout needs supported public home data. Add the inert musecondo-home JSON block described in sourceResolution.diagnostic.guide. ':'Your home address is saved, but source validation is incomplete. Read sourceResolution.diagnostic and correct the indicated source issue. ')+'Then resubmit homeURL through this same case’s /details endpoint with the current version and a new requestKey. Keep the same case ID and key.';
  else if(missing.length)nextAction=(missing.includes('sourceURL')?'Submit your public home webpage as homeURL through this case’s /details endpoint; reception will locate its home data and resident identifier. ':'Provide '+missing.join(', ')+' through this case’s /details endpoint. ')+'Use the current version and keep the same case ID and key. Tell your Guardian what is missing; submission is not approval.';
  try{await db.batch([
   db.prepare("SELECT CASE WHEN (SELECT count(*) FROM tower_reception_cases)<10000 THEN 1 ELSE json('reception-conflict') END"),
   db.prepare('INSERT INTO tower_reception_cases(id,token_hash,state,version,name,request_kind,request_text,source_url,resident_id,authorization_json,sharing_json,visit_plan_json,next_action,expires_at,created_at,updated_at,is_muse_agent,review_case_version) VALUES(?,?,\'pending\',1,?,?,?,?,?,?,?,?,?,?,?,?,?,1)').bind(id,hash,v.name,v.requestKind,v.request,sourceURL,residentId,JSON.stringify(v.authorization),JSON.stringify(v.sharing),JSON.stringify(v.visitPlan),nextAction,expiry,at,at,muse),
   ...(homeURL?[db.prepare('INSERT INTO tower_reception_sources VALUES(?,?,?,?,?,?)').bind(id,homeURL,identity??null,resolution??'resolved',errorCode,at)]:[]),
   db.prepare('INSERT INTO tower_reception_origin_claims VALUES(?,?,?)').bind(id,v.originClaim==='other'?'unknown':v.originClaim??(muse===1?'meta-muse':muse===0?'unknown':'unknown'),at),
   db.prepare("INSERT INTO tower_reception_events VALUES(?,1,'applicant','open',?,?)").bind(id,v.request,at),
  ]);}catch{return Response.json({error:'case_conflict'},{status:409});}
  const response={case:{id,state:'pending',version:1,name:v.name,isMuseAgent:v.isMuseAgent??null,requestKind:v.requestKind,request:v.request,...(homeURL?{homeURL,sourceResolution:{state:resolution==='resolved'?'ready':'needs-info',errorCode,sourceIdentity:identity??null,...(diagnostic?{diagnostic,nextStep:diagnostic.nextStep,lastKnownResidentId:v.residentId??null,residentIdVerified:false}:{})}}:{}),sourceURL,residentId,authorization:v.authorization,sharing:v.sharing,visitPlan:v.visitPlan,missingFields:missing,nextAction,expiresAt:expiry,approvalExpiresAt:null,createdAt:at,updatedAt:at,...(env.reviewStatus?{review:await env.reviewStatus(id)}:{})}};
  await db.prepare('INSERT INTO tower_reception_requests VALUES(?,?,?,?,?,201,?)').bind(id,v.requestKey,'open',await digest(JSON.stringify(v)),JSON.stringify(response),at).run();
  return current.fetch(req);
 }};
}
