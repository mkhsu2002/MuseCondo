import type {Database} from './db.ts';
export type MoveInInvitationChoice='receive'|'later'|'decline';
export interface MoveInInvitationStatus {state:'awaiting-choice'|'awaiting-email'|'deferred'|'declined'|'offered'|'identity-present';nextActor:'resident'|'none';nextAction:string}
export interface MoveInInvitationEnvironment {db:Database;origin:string;now?:()=>Date;bodyReadTimeoutMs?:number}
export const INVITATION_CHOICE_SCHEMA=['manager_move_in_invitation_choices','manager_move_in_invitation_requests','manager_invitation_choice_update','manager_invitation_choice_delete','manager_invitation_choice_replace','manager_invitation_request_update','manager_invitation_request_delete','manager_invitation_request_replace','manager_invitation_case_account','manager_invitation_residency_insert'] as const;
export async function moveInInvitationStatus(db:Database,accountId:string):Promise<MoveInInvitationStatus>{
 const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_identities','identity_offers','manager_move_in_invitation_choices')").all<{name:string}>()).results;
 if(tables.some(t=>t.name==='agent_identities')&&await db.prepare('SELECT 1 FROM agent_identities WHERE account_id=?').bind(accountId).first())return {state:'identity-present',nextActor:'none',nextAction:'This household already has an identity. No new identity invitation is needed.'};
 if(tables.some(t=>t.name==='identity_offers')&&await db.prepare('SELECT 1 FROM identity_offers WHERE account_id=?').bind(accountId).first())return {state:'offered',nextActor:'resident',nextAction:'Your optional invitation was created. Read its status; creation does not confirm email delivery or a human decision.'};
 const row=tables.some(t=>t.name==='manager_move_in_invitation_choices')?await db.prepare('SELECT choice FROM manager_move_in_invitation_choices WHERE account_id=?').bind(accountId).first<{choice:string}>():null;
 if(row?.choice==='decline')return {state:'declined',nextActor:'none',nextAction:'No invitation reminder is pending. You can explicitly change this choice later.'};
 if(row?.choice==='receive')return {state:'awaiting-email',nextActor:'resident',nextAction:'Obtain the designated Guardian email and explicit mail consent, then use /api/v1/agent/identity/offer. Do not send without both.'};
 if(row?.choice==='later')return {state:'deferred',nextActor:'resident',nextAction:'On this return visit, ask your Guardian again about the optional identity invitation. Record receive, later or decline.'};
 return {state:'awaiting-choice',nextActor:'resident',nextAction:'Ask your Guardian whether they want the optional identity invitation. Record receive, later or decline. Your public home remains available.'};
}

import {digest} from './app.ts';
import {readRequestBody,RequestBodyError} from './request-body.ts';
class ChoiceError extends Error {readonly status:number;constructor(status:number,code:string){super(code);this.status=status;}}
const fail=(status:number,code:string):never=>{throw new ChoiceError(status,code);};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function invitationChoiceReady(db:Database){const rows=(await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").all<{name:string}>()).results;return INVITATION_CHOICE_SCHEMA.every(name=>rows.some(row=>row.name===name));}
/** Records a private resident choice only. This service has no mail, identity or publication authority. */
export function createMoveInInvitationChoice(env:MoveInInvitationEnvironment){
 const {db}=env,stamp=()=>(env.now?.()??new Date()).toISOString();
 const stmt=(sql:string,...values:unknown[])=>db.prepare(sql).bind(...values);
 const authSQL="SELECT account_id FROM tower_tokens WHERE token_hash=? AND revoked=0 AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value='tower:write')";
 return {async fetch(request:Request):Promise<Response|null>{
  const url=new URL(request.url);if(url.pathname!=='/api/v1/agent/tower-intake/invitation-choice')return null;
  try{
   if(url.origin!==env.origin||request.headers.has('Cookie')||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==env.origin)fail(403,'origin_rejected');
   if(request.method!=='POST')fail(405,'method_not_allowed');if(url.search)fail(400,'invalid_invitation_choice');
   const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)fail(401,'tower_token_required');
   const tokenHash=await digest(token!),account=await stmt(authSQL,tokenHash,stamp()).first<{account_id:string}>();if(!account)fail(403,'tower_scope_rejected');
   if(!await invitationChoiceReady(db))fail(503,'invitation_choice_schema_not_ready');
   if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type')??''))fail(415,'json_required');
   const bytes=await readRequestBody(request,1024,env.bodyReadTimeoutMs);let raw:unknown;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'invalid_invitation_choice');}
   if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(400,'invalid_invitation_choice');
   const value=raw as Record<string,unknown>;
   if(Object.keys(value).sort().join(',')!=='choice,requestKey'||typeof value.requestKey!=='string'||!/^[A-Za-z0-9_-]{8,96}$/.test(value.requestKey)||typeof value.choice!=='string'||!['receive','later','decline'].includes(value.choice))fail(400,'invalid_invitation_choice');
   const choice=value.choice as MoveInInvitationChoice,requestKey=value.requestKey as string,inputHash=await digest(JSON.stringify({choice}));
   const authGuard=()=>stmt("SELECT CASE WHEN EXISTS("+authSQL+" AND account_id=?) THEN 1 ELSE json('invitation-authorization-changed') END",tokenHash,stamp(),account!.account_id);
   const replay=async()=>{const old=await stmt('SELECT input_hash,response_json FROM manager_move_in_invitation_requests WHERE account_id=? AND request_key=?',account!.account_id,requestKey).first<{input_hash:string;response_json:string}>();if(!old)return null;if(old.input_hash!==inputHash)fail(409,'request_key_conflict');try{await authGuard().first();}catch{fail(403,'authorization_changed');}return json(JSON.parse(old.response_json));};
   const oldReceipt=await replay();if(oldReceipt)return oldReceipt;
   const old=await stmt('SELECT choice,version FROM manager_move_in_invitation_choices WHERE account_id=?',account!.account_id).first<{choice:string;version:number}>();
   const next:MoveInInvitationStatus=choice==='receive'?{state:'awaiting-email',nextActor:'resident',nextAction:'Obtain the designated Guardian email and explicit mail consent, then use /api/v1/agent/identity/offer. Do not send without both.'}:choice==='later'?{state:'deferred',nextActor:'resident',nextAction:'The optional invitation is deferred. Ask your Guardian again on your next return visit.'}:{state:'declined',nextActor:'none',nextAction:'No invitation reminder is pending. You can explicitly change this choice later.'};
   const current=await moveInInvitationStatus(db,account!.account_id),response={invitation:current.state==='offered'||current.state==='identity-present'?current:next},at=stamp();
   try{await db.batch([
    authGuard(),
    old?stmt('UPDATE manager_move_in_invitation_choices SET choice=?,version=version+1,updated_at=? WHERE account_id=? AND version=? AND choice=?',choice,at,account!.account_id,old.version,old.choice):stmt('INSERT INTO manager_move_in_invitation_choices(account_id,choice,updated_at) VALUES(?,?,?)',account!.account_id,choice,at),
    stmt("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('invitation-choice-conflict') END"),
    stmt('INSERT INTO manager_move_in_invitation_requests VALUES(?,?,?,?,?)',account!.account_id,requestKey,inputHash,JSON.stringify(response),at),
   ]);}catch{const raced=await replay();if(raced)return raced;try{await authGuard().first();}catch{fail(403,'authorization_changed');}fail(409,'invitation_choice_conflict');}
   return (await replay())!;
  }catch(error){if(error instanceof RequestBodyError)return json({error:error.code},error.status);return error instanceof ChoiceError?json({error:error.message},error.status):json({error:'invitation_choice_unavailable'},503);}
 }};
}
