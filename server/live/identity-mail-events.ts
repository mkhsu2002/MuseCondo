import type {Database} from './db.ts';
import {createIdentityMail,type IdentityMailEnvironment} from './identity-mail.ts';
interface RuntimeContext {waitUntil(promise:Promise<unknown>):void}
/** A request owns its environment and exact IDs; no mutable callback is installed on the shared card service. */
export function identityMailEventDispatcher(env:IdentityMailEnvironment,context?:RuntimeContext){
 const mail=createIdentityMail(env);
 return async(eventId:string):Promise<void>=>{
  try{
   const work=mail.processOne(eventId).catch(()=>{});
   if(context)context.waitUntil(work);else await work;
  }catch{/* Committed events remain durable even when scheduling fails. */}
 };
}
/** Read only the small lifecycle result, never a PDF, signed artifact or private mail response. */
async function cardResult(response:Response):Promise<Record<string,unknown>>{
 const length=response.headers.get('Content-Length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>4096))throw Error('size');
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type')??''))throw Error('type');
 const reader=response.clone().body?.getReader();if(!reader)throw Error('empty');
 let size=0,raw='';const decoder=new TextDecoder('utf-8',{fatal:true});
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){void reader.cancel().catch(()=>{});throw Error('size');}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
 const value:unknown=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('shape');return value as Record<string,unknown>;
}
/** Trusted Coordinator success/receipt is the only source of CID; caller input never chooses a mail event. */
export async function dispatchIdentityCardResult(request:Request,response:Response,db:Database|undefined,dispatch:(eventId:string)=>Promise<void>):Promise<void>{
 const path=new URL(request.url).pathname;
 if(!db||request.method!=='POST'||!response.ok||!['/api/v1/agent/identity/card/issue','/api/v1/agent/identity/card/revoke'].includes(path))return;
 try{
  const result=await cardResult(response),issue=path.endsWith('/issue'),card=result.card;
  if(!Number.isSafeInteger(result.revision)||(result.revision as number)<1)return;
  const cid=issue&&card&&typeof card==='object'&&!Array.isArray(card)?(card as Record<string,unknown>).credentialId:!issue&&card===null?result.revokedCredentialId:null;
  if(typeof cid!=='string'||!/^[a-f0-9]{32}$/.test(cid))return;
  const kind=issue?'identity-card':'security-notice';
  const events=(await db.prepare("SELECT e.id FROM identity_mail_events e JOIN identity_credentials c ON c.credential_id=e.entity_id JOIN agent_identities i ON i.agent_id=c.agent_id AND i.account_id=c.account_id JOIN tower_residencies t ON t.account_id=i.account_id AND t.room_id=i.room_id AND t.resident_id=i.resident_id JOIN rooms r ON r.id=i.room_id AND r.account_id=i.account_id WHERE c.credential_id=? AND e.kind=? AND e.dedupe_key=? AND e.state='pending' LIMIT 2").bind(cid,kind,'card:'+kind+':'+cid).all<{id:string}>()).results;
  if(events.length===1)await dispatch(events[0].id);
 }catch{/* Preserve the exact successful core response; pending mail is independently recoverable. */}
}
