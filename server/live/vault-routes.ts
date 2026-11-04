import type {VaultAuthorization} from './vault-auth.ts';
import {VaultError,type VaultAccess} from './vault-contract.ts';
import {readRequestBody,RequestBodyError} from './request-body.ts';

interface Mutation {path:string;expectedRevision:number;requestKey:string}
export interface VaultStore {
 list(access:VaultAccess):Promise<unknown>;
 get(access:VaultAccess,path:string):Promise<unknown>;
 put(access:VaultAccess,input:Mutation&{content:string}):Promise<unknown>;
 remove(access:VaultAccess,input:Mutation):Promise<unknown>;
 export(access:VaultAccess):Promise<unknown>;
}
export const vaultHeaders={
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow',
};
const json=(value:unknown,status=200,extra?:Record<string,string>)=>new Response(JSON.stringify(value),{status,headers:{...vaultHeaders,...extra}});
export function vaultFailure(error:unknown,origin:string){
 if(error instanceof VaultError)return json({...([401,403].includes(error.status)?{nextActor:'agent',nextAction:'read-vault-authorization-guide',startURL:origin+'/vault/start',guideURL:origin+'/vault-guide.md'}:{}),...error.details,error:error.code},error.status);
 if(error instanceof RequestBodyError)return json({error:error.code},error.status);
 return json({error:'vault_unavailable'},503);
}
async function input(request:Request,write:boolean,timeout?:number){
 if(!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(request.headers.get('Content-Type')??''))throw new VaultError(415,'json_required');
 const bytes=await readRequestBody(request,512*1024,timeout);let v:unknown;
 try{v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new VaultError(400,'invalid_json');}
 if(!v||typeof v!=='object'||Array.isArray(v))throw new VaultError(400,'invalid_vault_request');
 const value=v as Record<string,unknown>,keys=write?['path','content','expectedRevision','requestKey']:['path','expectedRevision','requestKey'];
 if(Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k))||typeof value.path!=='string'||typeof value.requestKey!=='string'||!Number.isSafeInteger(value.expectedRevision)||Number(value.expectedRevision)<0||write&&typeof value.content!=='string')throw new VaultError(400,'invalid_vault_request');
 return value as unknown as Mutation&{content:string};
}
/** Agent-only private data surface. It has no renderer, provider call or operator bypass. */
export function createVaultRoutes(env:{origin:string;authorization:VaultAuthorization;store:VaultStore;bodyReadTimeoutMs?:number}){
 return async(request:Request):Promise<Response|null>=>{
  const url=new URL(request.url),prefix='/api/v1/agent/vault',files=url.pathname===prefix+'/files',exporting=url.pathname===prefix+'/export',file=url.pathname.startsWith(prefix+'/files/')?url.pathname.slice((prefix+'/files/').length):null;
  if(!files&&!exporting&&file===null)return null;
  try{
   if(url.origin!==env.origin||request.headers.has('Cookie')||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==env.origin)throw new VaultError(403,'origin_rejected');
   if(url.search)throw new VaultError(400,'query_not_allowed');
   const read=['GET','HEAD'].includes(request.method),write=files&&['PUT','DELETE'].includes(request.method);
   if(!read&&!write)throw new VaultError(405,'method_not_allowed');
   const access=await env.authorization.authenticate(request,write?'vault:write':'vault:read');
   let response:Response;
   if(exporting){if(!read)throw new VaultError(405,'method_not_allowed');response=json(await env.store.export(access),200,{'Content-Disposition':'attachment; filename="muse-vault-export.json"'});}
   else if(file!==null){if(!read)throw new VaultError(405,'method_not_allowed');response=json(await env.store.get(access,file));}
   else if(request.method==='PUT')response=json(await env.store.put(access,await input(request,true,env.bodyReadTimeoutMs)));
   else if(request.method==='DELETE')response=json(await env.store.remove(access,await input(request,false,env.bodyReadTimeoutMs)));
   else response=json(await env.store.list(access));
   return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
  }catch(error){const response=vaultFailure(error,env.origin);return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;}
 };
}
