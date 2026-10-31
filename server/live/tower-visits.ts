import type {Database,Statement} from './db.ts';
interface Identity {accountId:string;guard:()=>Promise<Statement>;delegated:boolean}
interface Visit {
 id:string;recipient_room_id:string;sender_account_id:string;kind:'message'|'gift'|'invitation';
 nickname:string;body:string;gift_id:string|null;state:'published'|'pending'|'accepted'|'rejected'|'withdrawn';
 version:number;created_at:string;updated_at:string;
}
interface Dependencies {
 db:Database;stamp:()=>string;random:(n?:number)=>string;hash:(v:string)=>Promise<string>;
 fail:(status:number,code:string)=>never;
 body:(req:Request,keys?:readonly string[],max?:number)=>Promise<Record<string,unknown>>;
 requestKey:(v:unknown)=>string;revision:(v:unknown)=>number;
 write:(identity:Identity,statements:Statement[])=>Promise<void>;
 prior:(identity:Identity,key:string,operation:string,hash:string)=>Promise<unknown>;
 receipt:(identity:Identity,key:string,operation:string,hash:string,response:unknown)=>Statement;
 audit:(accountId:string,roomId:string|null,action:string,rev:number|null,detail?:unknown)=>Statement;
 json:(data:unknown,status?:number)=>Response;
}
const gifts=['gift-sprout','gift-cloud','gift-coffee'];
const publicColumns='id,kind,nickname,body,gift_id,created_at';
/** Uses intake identity/CSRF, transaction guards, permanent receipts and its private audit. */
export function createTowerVisits(d:Dependencies){
 const {db,fail}=d;
 const one=<T>(sql:string,...args:unknown[])=>db.prepare(sql).bind(...args).first<T>();
 function text(v:unknown,max:number){
  if(typeof v!=='string'||!v.trim()||v.length>max||Array.from(v).some(c=>(c.charCodeAt(0)<32&&![9,10,13].includes(c.charCodeAt(0)))||c.charCodeAt(0)===127))fail(400,'invalid_visit_text');
  return (v as string).trim();
 }
 const safe=(r:Visit)=>({id:r.id,targetDoor:'/home/'+r.recipient_room_id,kind:r.kind,
  ...(r.state==='withdrawn'?{}:{nickname:r.nickname,body:r.body,...(r.gift_id?{giftId:r.gift_id}:{})}),
  state:r.state,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at});
 const safePublic=(r:Visit)=>({id:r.id,kind:r.kind,nickname:r.nickname,body:r.body,...(r.gift_id?{giftId:r.gift_id}:{}),createdAt:r.created_at});
 function cursor(url:URL){
  if([...url.searchParams.keys()].some(k=>k!=='cursor')||url.searchParams.getAll('cursor').length>1)fail(400,'invalid_visit_cursor');
  const value=url.searchParams.get('cursor');if(value===null)return null;
  const match=value.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)~([a-f0-9]{32})$/);
  if(!match||!Number.isFinite(Date.parse(match[1])))fail(400,'invalid_visit_cursor');
  return {at:match![1],id:match![2]};
 }
 async function list(url:URL,condition:string,args:unknown[],isPublic=false){
  const c=cursor(url),rows=(await db.prepare(`SELECT ${isPublic?publicColumns:'*'} FROM tower_visits WHERE ${condition}${c?' AND (created_at<? OR (created_at=? AND id<?))':''} ORDER BY created_at DESC,id DESC LIMIT 51`).bind(...args,...(c?[c.at,c.at,c.id]:[])).all<Visit>()).results;
  const page=rows.slice(0,50),last=page.at(-1);
  return {visits:page.map(row=>isPublic?safePublic(row):safe(row)),nextCursor:rows.length>50&&last?last.created_at+'~'+last.id:null};
 }
 const targetSQL='SELECT room_id,account_id,publication_epoch FROM tower_residencies WHERE room_id=? AND public_revision IS NOT NULL AND snapshot_consent=1';
 const publicGuard=(roomId:string,epoch:number)=>db.prepare(`SELECT CASE WHEN EXISTS(${targetSQL} AND publication_epoch=?) THEN 1 ELSE json('tower-visit-target-changed') END`).bind(roomId,epoch);
 const rateSQL='SELECT COUNT(*) AS n FROM tower_visits WHERE sender_account_id=? AND created_at>?';
 async function target(roomId:string){return one<{room_id:string;account_id:string;publication_epoch:number}>(targetSQL,roomId);}
 return {
  async publicList(req:Request,roomId:string){
   if(!['GET','HEAD'].includes(req.method))fail(405,'method_not_allowed');
   if(!await target(roomId))fail(404,'home_not_found');
   const data=await list(new URL(req.url),"recipient_room_id=? AND state='published' AND kind IN ('message','gift') AND EXISTS(SELECT 1 FROM tower_residencies r WHERE r.room_id=tower_visits.recipient_room_id AND r.public_revision IS NOT NULL AND r.snapshot_consent=1)",[roomId],true);
   return req.method==='HEAD'?new Response(null,{headers:{'Cache-Control':'no-store'}}):d.json(data);
  },
  async owner(req:Request,route:string,identity:Identity):Promise<Response>{
   const accountId=identity.accountId,url=new URL(req.url);
   if(req.method==='GET'&&(route==='visits'||route==='visits/sent')){
    const sent=route.endsWith('/sent');
    const room=sent?null:await one<{room_id:string}>('SELECT room_id FROM tower_residencies WHERE account_id=?',accountId);
    if(!sent&&!room)fail(404,'no_home');
    // Private responses use no-store; never contain login/account IDs or tokens.
    return d.json(await list(url,sent?'sender_account_id=?':'recipient_room_id=?',[sent?accountId:room!.room_id]));
   }
   if(route==='visits/send'&&req.method==='POST'){
    if(url.search)fail(400,'invalid_visit_input');
    const input=await d.body(req,['targetDoor','requestKey','kind','nickname','body','giftId'],8192),
     door=typeof input.targetDoor==='string'?input.targetDoor.match(/^\/home\/([a-f0-9]{16})$/):null;
    if(!door||typeof input.kind!=='string'||!['message','gift','invitation'].includes(input.kind))fail(400,'invalid_visit_input');
    const roomId=door![1],kind=input.kind as Visit['kind'],nickname=text(input.nickname,24),body=text(input.body,kind==='invitation'?1000:280),
     gift=kind==='gift'?input.giftId:null;
    if(kind==='gift'?(typeof gift!=='string'||!gifts.includes(gift)):input.giftId!==undefined)fail(400,'invalid_free_gift');
    if(/https?:|www\.|[^\s]+@[^\s]+\.[^\s]+/i.test(nickname)||(kind!=='invitation'&&/https?:|www\.|[^\s]+@[^\s]+\.[^\s]+/i.test(body)))fail(400,'contacts_or_links_not_allowed');
    const key=d.requestKey(input.requestKey),op='visit-send',inputHash=await d.hash(JSON.stringify({roomId,kind,nickname,body,gift})),saved=await d.prior(identity,key,op,inputHash);
    if(saved)return d.json(saved,201);
    const recipient=await target(roomId);if(!recipient)fail(404,'home_not_found');
    const since=new Date(Date.parse(d.stamp())-60000).toISOString();
    if((await one<{n:number}>(rateSQL,accountId,since))!.n>=5)fail(429,'visit_rate_limited');
    const row:Visit={id:d.random(16),recipient_room_id:roomId,sender_account_id:accountId,kind,nickname,body,gift_id:gift as string|null,state:kind==='invitation'?'pending':'published',version:1,created_at:d.stamp(),updated_at:d.stamp()},result={visit:safe(row)};
    try{await d.write(identity,[publicGuard(roomId,recipient!.publication_epoch),
     db.prepare(`SELECT CASE WHEN (${rateSQL})<5 THEN 1 ELSE json('tower-visit-rate-limited') END`).bind(accountId,since),
     db.prepare('INSERT INTO tower_visits(id,recipient_room_id,sender_account_id,kind,nickname,body,gift_id,state,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(row.id,roomId,accountId,kind,nickname,body,gift,row.state,1,row.created_at,row.updated_at),
     d.receipt(identity,key,op,inputHash,result),d.audit(accountId,roomId,'visit-sent',null,{visitId:row.id,kind,state:row.state})]);
    }catch(error){
     if(error instanceof Error && 'status' in error)throw error;
     const replay=await d.prior(identity,key,op,inputHash);if(replay)return d.json(replay,201);
     const currentTarget=await target(roomId);if(!currentTarget||currentTarget.publication_epoch!==recipient!.publication_epoch)fail(409,'visit_target_changed');
     if((await one<{n:number}>(rateSQL,accountId,since))!.n>=5)fail(429,'visit_rate_limited');
     throw error;
    }
    return d.json(result,201);
   }
   const actionRoute=route.match(/^visits\/([a-f0-9]{32})\/(moderate|withdraw)$/);
   if(actionRoute&&req.method==='POST'){
    if(url.search)fail(400,'invalid_visit_input');
    const withdraw=actionRoute[2]==='withdraw',input=await d.body(req,withdraw?['expectedVersion','requestKey']:['expectedVersion','requestKey','action'],1024),
     expected=d.revision(input.expectedVersion),key=d.requestKey(input.requestKey),action=withdraw?'withdraw':input.action;
    if(typeof action!=='string'||!['accept','reject','hide','withdraw'].includes(action)||(!withdraw&&action==='withdraw'))fail(400,'invalid_visit_action');
    const id=actionRoute[1],op='visit-'+action,inputHash=await d.hash(JSON.stringify({id,expected,action})),
     saved=await d.prior(identity,key,op,inputHash);if(saved)return d.json(saved);
    const ownedSQL=withdraw?'sender_account_id=?':'EXISTS(SELECT 1 FROM tower_residencies r WHERE r.room_id=tower_visits.recipient_room_id AND r.account_id=?)',
     row=await one<Visit>(`SELECT * FROM tower_visits WHERE id=? AND ${ownedSQL}`,id,accountId);
    if(!row)fail(404,'visit_not_found');
    if(row!.version!==expected||row!.state==='withdrawn'||(action==='hide'&&(row!.state!=='published'||row!.kind==='invitation'))||
     ((action==='accept'||action==='reject')&&(row!.kind!=='invitation'||row!.state!=='pending')))fail(409,'visit_state_conflict');
    const state=action==='withdraw'?'withdrawn':action==='accept'?'accepted':'rejected',
     changed={...row!,state:state as Visit['state'],version:expected+1,updated_at:d.stamp()},result={visit:safe(changed)};
    try{await d.write(identity,[
     db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM tower_visits WHERE id=? AND version=? AND state=? AND ${ownedSQL}) THEN 1 ELSE json('tower-visit-conflict') END`).bind(id,expected,row!.state,accountId),
     db.prepare('UPDATE tower_visits SET state=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(state,changed.updated_at,id,expected),
     d.receipt(identity,key,op,inputHash,result),d.audit(accountId,row!.recipient_room_id,'visit-'+action,null,{visitId:id,kind:row!.kind,state,version:changed.version})]);
    }catch(error){
     if(error instanceof Error && 'status' in error)throw error;
     const replay=await d.prior(identity,key,op,inputHash);if(replay)return d.json(replay);
     const current=await one<Visit>(`SELECT * FROM tower_visits WHERE id=? AND ${ownedSQL}`,id,accountId);
     if(!current)fail(404,'visit_not_found');if(current!.version!==expected||current!.state!==row!.state)fail(409,'visit_state_conflict');
     throw error;
    }
    return d.json(result);
   }
   return fail(405,'method_not_allowed');
  },
 };
}
