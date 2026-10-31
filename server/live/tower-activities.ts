import type {Database,Statement} from './db.ts';
interface Identity {accountId:string;guard:()=>Promise<Statement>;delegated:boolean}
interface Activity {id:string;title:string;description:string;starts_at:string|null;ends_at:string|null;state:'draft'|'open'|'closed';version:number;created_at:string;updated_at:string}
interface Participation {state:'joined'|'declined'|'left';show_participation:number;version:number;updated_at:string}
interface Dependencies {
 db:Database;origin:string;operator?:(req:Request)=>Promise<boolean>;stamp:()=>string;random:(n?:number)=>string;hash:(v:string)=>Promise<string>;
 fail:(status:number,code:string)=>never;body:(req:Request,keys?:readonly string[],max?:number)=>Promise<Record<string,unknown>>;
 requestKey:(v:unknown)=>string;revision:(v:unknown)=>number;write:(identity:Identity,statements:Statement[])=>Promise<void>;
 prior:(identity:Identity,key:string,operation:string,hash:string)=>Promise<unknown>;
 receipt:(identity:Identity,key:string,operation:string,hash:string,response:unknown)=>Statement;
 audit:(accountId:string,roomId:string|null,action:string,rev:number|null,detail?:unknown)=>Statement;json:(data:unknown,status?:number)=>Response;
}
const safe=(a:Activity)=>({id:a.id,title:a.title,description:a.description,startsAt:a.starts_at,endsAt:a.ends_at,state:a.state,version:a.version});
const choice=(p:Participation|null)=>p?{state:p.state,showParticipation:!!p.show_participation,version:p.version,updatedAt:p.updated_at}:{state:'none',showParticipation:false,version:0,updatedAt:null};
/** Reuses intake identities, commit authorization, private receipts and audit. */
export function createTowerActivities(d:Dependencies){
 const {db,fail}=d,stmt=(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args),one=<T>(sql:string,...args:unknown[])=>stmt(sql,...args).first<T>();
 const guard=(sql:string,...args:unknown[])=>stmt("SELECT CASE WHEN ("+sql+") THEN 1 ELSE json('tower-activity-conflict') END",...args);
 const activity=(id:string,privateView=false)=>one<Activity>('SELECT * FROM tower_activities WHERE id=?'+(privateView?'':" AND state!='draft'"),id);
 // D1 UTC time is evaluated by SQLite when the guarded statement executes.
 const activeSQL="state='open' AND (starts_at IS NULL OR starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND (ends_at IS NULL OR ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
 const active=(activityID:string)=>one('SELECT id FROM tower_activities WHERE id=? AND '+activeSQL,activityID);
 const activityGuard=(a:Activity,requireActive=false)=>guard('EXISTS(SELECT 1 FROM tower_activities WHERE id=? AND version=? AND state=?'+(requireActive?' AND '+activeSQL:'')+')',a.id,a.version,a.state);
 function id(v:unknown){if(typeof v!=='string'||! /^[a-z0-9][a-z0-9-]{0,63}$/.test(v))fail(400,'invalid_activity_id');return v as string;}
 function text(v:unknown,max:number){if(typeof v!=='string'||!v.trim()||v.length>max||[...v].some(c=>c.charCodeAt(0)===127||c.charCodeAt(0)<32&&![9,10,13].includes(c.charCodeAt(0))))fail(400,'invalid_activity_text');return (v as string).trim();}
 function date(v:unknown){if(v===undefined||v===null)return null;if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)fail(400,'invalid_activity_date');return v as string;}
 function cursor(url:URL,room=false){if([...url.searchParams.keys()].some(k=>k!=='cursor')||url.searchParams.getAll('cursor').length>1)fail(400,'invalid_activity_cursor');const value=url.searchParams.get('cursor');if(value!==null&&(room?!/^[a-f0-9]{16}$/.test(value):! /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)))fail(400,'invalid_activity_cursor');return value;}
 async function list(url:URL,operator=false,account?:string){
  const c=cursor(url),rows=(await stmt('SELECT a.*'+(account?',p.state AS participation_state,p.show_participation,p.version AS participation_version,p.updated_at AS participation_updated_at':'')+' FROM tower_activities a'+(account?' LEFT JOIN tower_activity_participation p ON p.activity_id=a.id AND p.account_id=?':'')+' WHERE '+(operator?'1':"a.state!='draft'")+(c?' AND a.id>?':'')+' ORDER BY a.id LIMIT 51',...(account?[account]:[]),...(c?[c]:[])).all<Activity&{participation_state:Participation['state']|null;show_participation:number;participation_version:number;participation_updated_at:string}>()).results;
  const page=rows.slice(0,50);return {activities:page.map(a=>({...safe(a),...(account?{participation:choice(a.participation_state?{state:a.participation_state,show_participation:a.show_participation,version:a.participation_version,updated_at:a.participation_updated_at}:null)}:{})})),nextCursor:rows.length>50?page.at(-1)!.id:null};
 }
 async function operatorCheck(req:Request){if(req.headers.has('Cookie')||req.headers.get('Sec-Fetch-Site')==='cross-site'||req.headers.has('Origin')&&req.headers.get('Origin')!==d.origin)fail(403,'origin_rejected');if(!await d.operator?.(req))fail(401,'operator_required');}
 async function operatorReplay(key:string,op:string,hash:string){const r=await one<{operation:string;input_hash:string;response_json:string;response_status:number}>('SELECT * FROM tower_activity_operator_requests WHERE request_key=?',key);if(r&&(r.operation!==op||r.input_hash!==hash))fail(409,'idempotency_conflict');return r?d.json(JSON.parse(r.response_json),r.response_status):null;}
 return {
  async public(req:Request,activityId?:string){
   if(!['GET','HEAD'].includes(req.method))fail(405,'method_not_allowed');const url=new URL(req.url);
   let result:unknown;if(!activityId)result=await list(url);else{
    const a=await activity(activityId);if(!a)fail(404,'activity_not_found');const c=cursor(url,true);
    // One query checks current choice and current public door; no private name fallback.
    const rows=a!.state==='closed'?[]:(await stmt("SELECT p.room_id,json_extract(s.public_json,'$.home.name') AS name FROM tower_activity_participation p JOIN tower_residencies r ON r.room_id=p.room_id AND r.account_id=p.account_id JOIN tower_snapshots s ON s.room_id=r.room_id AND s.revision=r.public_revision JOIN tower_activities a ON a.id=p.activity_id WHERE p.activity_id=? AND a.state='open' AND p.state='joined' AND p.show_participation=1 AND r.public_revision IS NOT NULL AND r.snapshot_consent=1"+(c?' AND p.room_id>?':'')+' ORDER BY p.room_id LIMIT 51',activityId,...(c?[c]:[])).all<{room_id:string;name:string}>()).results;
    const page=rows.slice(0,50);result={activity:safe(a!),participants:page.map(r=>({name:r.name,door:'/home/'+r.room_id})),nextCursor:rows.length>50?page.at(-1)!.room_id:null};
   }return req.method==='HEAD'?new Response(null,{headers:{'Cache-Control':'no-store'}}):d.json(result);
  },
  async operator(req:Request,activityId?:string){
   await operatorCheck(req);const url=new URL(req.url);if(req.method==='GET'){
    if(!activityId)return d.json(await list(url,true));if(url.search)fail(400,'invalid_activity_cursor');const a=await activity(activityId,true);if(!a)fail(404,'activity_not_found');return d.json({activity:safe(a!)});
   }
   if(req.method!=='POST')fail(405,'method_not_allowed');if(url.search)fail(400,'invalid_activity_input');
   const input=await d.body(req,['id','title','description','startsAt','endsAt','state','expectedVersion','requestKey'],8192),activityID=id(activityId??input.id);
   if(activityId&&input.id!==undefined||!activityId&&input.expectedVersion!==undefined)fail(400,'invalid_activity_input');
   const title=text(input.title,100),description=text(input.description,2000),starts=date(input.startsAt),ends=date(input.endsAt);
   if(typeof input.state!=='string'||!['draft','open','closed'].includes(input.state)||starts&&ends&&ends<=starts)fail(400,'invalid_activity_input');
   const expected=activityId?d.revision(input.expectedVersion):0,key=d.requestKey(input.requestKey),op=activityId?'activity-update':'activity-create',hash=await d.hash(JSON.stringify({id:activityID,title,description,starts,ends,state:input.state,expected})),prior=await operatorReplay(key,op,hash);if(prior)return prior;
   const current=activityId?await activity(activityID,true):null;
   if(activityId&&(!current||current.version!==expected||current.state==='closed'&&input.state!=='closed'||current.state==='open'&&input.state==='draft'))fail(409,'activity_state_conflict');
   const quotaSQL="SELECT COUNT(*) AS n FROM tower_activity_audit WHERE created_at>?",since=new Date(Date.parse(d.stamp())-3600000).toISOString();
   if((await one<{n:number}>(quotaSQL,since))!.n>=100)fail(429,'activity_rate_limited');
   if(!activityId&&(await one<{n:number}>('SELECT COUNT(*) n FROM tower_activities'))!.n>=100)fail(409,'activity_capacity');
   const a:Activity={id:activityID,title,description,starts_at:starts,ends_at:ends,state:input.state as Activity['state'],version:expected+1,created_at:current?.created_at??d.stamp(),updated_at:d.stamp()},result={activity:safe(a)},status=activityId?200:201;
   try{
    await operatorCheck(req);
    await db.batch([guard('('+quotaSQL+')<100',since),...(current?[activityGuard(current)]:[guard('(SELECT COUNT(*) FROM tower_activities)<100'),guard('NOT EXISTS(SELECT 1 FROM tower_activities WHERE id=?)',activityID)]),
     current?stmt('UPDATE tower_activities SET title=?,description=?,starts_at=?,ends_at=?,state=?,version=?,updated_at=? WHERE id=?',title,description,starts,ends,a.state,a.version,a.updated_at,activityID):stmt('INSERT INTO tower_activities VALUES(?,?,?,?,?,?,?,?,?)',activityID,title,description,starts,ends,a.state,1,a.created_at,a.updated_at),
     stmt('INSERT INTO tower_activity_operator_requests VALUES(?,?,?,?,?,?)',key,op,hash,JSON.stringify(result),status,d.stamp()),stmt('INSERT INTO tower_activity_audit VALUES(?,?,?,?,?)',d.random(16),activityID,op,a.version,d.stamp())]);
   }catch(error){if(error instanceof Error&&'status'in error)throw error;const replay=await operatorReplay(key,op,hash);if(replay)return replay;const latest=await activity(activityID,true);if(latest?.version!==current?.version)fail(409,'activity_state_conflict');if((await one<{n:number}>(quotaSQL,since))!.n>=100)fail(429,'activity_rate_limited');if(!current&&(await one<{n:number}>('SELECT COUNT(*) n FROM tower_activities'))!.n>=100)fail(409,'activity_capacity');throw error;}
   return d.json(result,status);
  },
  async owner(req:Request,route:string,identity:Identity){
   const url=new URL(req.url),match=route.match(/^activities(?:\/([a-z0-9][a-z0-9-]{0,63})(\/participation)?)?$/);if(!match)fail(404,'activity_not_found');
   const room=await one<{room_id:string}>('SELECT room_id FROM tower_residencies WHERE account_id=?',identity.accountId);if(!room)fail(404,'no_home');
   const activityID=match![1];if(!activityID){if(req.method!=='GET')fail(405,'method_not_allowed');return d.json(await list(url,false,identity.accountId));}
   if(url.search)fail(400,'invalid_activity_input');const a=await activity(activityID);if(!a)fail(404,'activity_not_found');
   const own=()=>one<Participation>('SELECT state,show_participation,version,updated_at FROM tower_activity_participation WHERE activity_id=? AND account_id=?',activityID,identity.accountId);
   if(req.method==='GET'&&!match![2])return d.json({activity:safe(a!),participation:choice(await own())});
   if(req.method!=='POST'||!match![2])fail(405,'method_not_allowed');
   const input=await d.body(req,['action','showParticipation','expectedVersion','requestKey'],8192),action=typeof input.action==='string'?input.action:'';
   if(typeof action!=='string'||!['join','decline','leave','visibility'].includes(action)||!Number.isSafeInteger(input.expectedVersion)||Number(input.expectedVersion)<0||input.showParticipation!==undefined&&typeof input.showParticipation!=='boolean'||!['join','visibility'].includes(action)&&input.showParticipation!==undefined||action==='visibility'&&typeof input.showParticipation!=='boolean')fail(400,'invalid_participation_input');
   const expected=Number(input.expectedVersion),key=d.requestKey(input.requestKey),show=['join','visibility'].includes(action)&&input.showParticipation===true,op='activity-'+action,hash=await d.hash(JSON.stringify({activityID,expected,action,show})),prior=await d.prior(identity,key,op,hash);if(prior)return d.json(prior);
   const current=await own();if((current?.version??0)!==expected||['leave','visibility'].includes(action)&&current?.state!=='joined')fail(409,'participation_state_conflict');
   const requireActive=action==='join'||action==='visibility'&&show;
   if(requireActive&&!await active(activityID))fail(409,'activity_not_open');
   const since=new Date(Date.parse(d.stamp())-3600000).toISOString(),rateSQL="SELECT COUNT(*) AS n FROM tower_requests WHERE account_id=? AND (operation='activity-join' OR (operation='activity-visibility' AND json_extract(response_json,'$.participation.showParticipation')=1)) AND created_at>?";
   if(requireActive&&(await one<{n:number}>(rateSQL,identity.accountId,since))!.n>=20)fail(429,'activity_rate_limited');
   const capacitySQL="SELECT COUNT(*) AS n FROM tower_activity_participation WHERE account_id=? AND state='joined' AND activity_id!=?";
   if(action==='join'&&(await one<{n:number}>(capacitySQL,identity.accountId,activityID))!.n>=20)fail(409,'participation_capacity');
   const next:Participation={state:['join','visibility'].includes(action)?'joined':action==='decline'?'declined':'left',show_participation:show?1:0,version:expected+1,updated_at:d.stamp()},result={activity:safe(a!),participation:choice(next)};
   try{await d.write(identity,[activityGuard(a!,requireActive),guard('EXISTS(SELECT 1 FROM tower_residencies WHERE room_id=? AND account_id=?)',room!.room_id,identity.accountId),
    current?guard('EXISTS(SELECT 1 FROM tower_activity_participation WHERE activity_id=? AND account_id=? AND version=?)',activityID,identity.accountId,expected):guard('NOT EXISTS(SELECT 1 FROM tower_activity_participation WHERE activity_id=? AND account_id=?)',activityID,identity.accountId),
    ...(requireActive?[guard('('+rateSQL+')<20',identity.accountId,since)]:[]),...(action==='join'?[guard('('+capacitySQL+')<20',identity.accountId,activityID)]:[]),
    stmt('INSERT INTO tower_activity_participation VALUES(?,?,?,?,?,?,?) ON CONFLICT(activity_id,account_id) DO UPDATE SET state=excluded.state,show_participation=excluded.show_participation,version=excluded.version,updated_at=excluded.updated_at',activityID,identity.accountId,room!.room_id,next.state,next.show_participation,next.version,next.updated_at),
    d.receipt(identity,key,op,hash,result),d.audit(identity.accountId,room!.room_id,'activity-'+action,null,{activityId:activityID,version:next.version,showParticipation:show})]);
   }catch(error){if(error instanceof Error&&'status'in error)throw error;const replay=await d.prior(identity,key,op,hash);if(replay)return d.json(replay);if((await own())?.version!==current?.version)fail(409,'participation_state_conflict');if((await activity(activityID))?.version!==a!.version)fail(409,'activity_state_conflict');if(requireActive&&!await active(activityID))fail(409,'activity_not_open');if(requireActive&&(await one<{n:number}>(rateSQL,identity.accountId,since))!.n>=20)fail(429,'activity_rate_limited');if(action==='join'&&(await one<{n:number}>(capacitySQL,identity.accountId,activityID))!.n>=20)fail(409,'participation_capacity');throw error;}
   return d.json(result);
  },
 };
}
