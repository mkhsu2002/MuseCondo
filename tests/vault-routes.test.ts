import test from 'node:test';
import assert from 'node:assert/strict';
import {createVaultRoutes,type VaultStore} from '../server/live/vault-routes.ts';
import {VaultError,type VaultAccess} from '../server/live/vault-contract.ts';
import type {VaultAuthorization,VaultScope} from '../server/live/vault-auth.ts';
const origin='https://tower.example';
function fixture(){
 const calls:string[]=[],access={accountId:'owned',roomId:'room',residentId:'resident',agentId:'agent',grantId:'grant',guard:async()=>{throw Error('not used by route stub');}} satisfies VaultAccess;
 const authorization:VaultAuthorization={fetch:async()=>null,authenticate:async(req,scope:VaultScope)=>{calls.push('auth:'+scope);if(req.headers.get('Authorization')!=='Bearer dedicated')throw new VaultError(403,'vault_authorization_required');return access;}};
 const store:VaultStore={list:async()=>{calls.push('list');return {documents:[]};},get:async(_a,path)=>{calls.push('get:'+path);return {content:'private text'};},put:async(_a,v)=>{calls.push('put:'+v.path);return {revision:1};},remove:async()=>{calls.push('delete');return {state:'deleted'};},export:async()=>{calls.push('export');return {documents:[{content:'private text'}]};}};
 return {calls,route:createVaultRoutes({origin,authorization,store,bodyReadTimeoutMs:20})};
}
const request=(path:string,init:RequestInit={})=>new Request(origin+'/api/v1/agent/vault/'+path,{...init,headers:{Authorization:'Bearer dedicated',...init.headers}});
test('vault rejects cookie/cross-origin/query and unknown methods before private storage',async()=>{
 for(const req of [request('files',{headers:{Cookie:'session=value'}}),request('files',{headers:{Origin:'https://other.example'}}),request('files?account=other'),request('files',{method:'POST'})]){
  const {route,calls}=fixture(),response=await route(req);assert(response&&response.status>=400);assert.deepEqual(calls,[]);assert.equal(response.headers.get('Cache-Control'),'no-store');
 }
});
test('authorization denial precedes body parsing and does not disclose private content',async()=>{
 const {route,calls}=fixture(),response=await route(request('files',{method:'PUT',headers:{Authorization:'Bearer household-key'},body:'not-json'}));assert.equal(response?.status,403);assert.deepEqual(calls,['auth:vault:write']);assert.doesNotMatch(await response!.text(),/private text/);
});
test('owned file read/export have noncacheable typed output and HEAD has no body',async()=>{
 const {route,calls}=fixture();const response=await route(request('files/SOUL.md'));assert.equal(response?.status,200);assert.match(await response!.text(),/private text/);assert.equal(response?.headers.get('X-Content-Type-Options'),'nosniff');
 const exported=await route(request('export'));assert.match(exported!.headers.get('Content-Disposition')!,/attachment/);
 const head=await route(request('files/SOUL.md',{method:'HEAD'}));assert.equal(await head!.text(),'');assert.deepEqual(calls,['auth:vault:read','get:SOUL.md','auth:vault:read','export','auth:vault:read','get:SOUL.md']);
});
test('mutations reject caller identity and malformed or oversized transport without writing',async()=>{
 for(const body of ['{}',JSON.stringify({path:'SOUL.md',content:'text',expectedRevision:0,requestKey:'request-key',accountId:'other'}),'x'.repeat(512*1024+1)]){
  const {route,calls}=fixture(),response=await route(request('files',{method:'PUT',headers:{'Content-Type':'application/json'},body}));assert(response&&response.status>=400);assert.deepEqual(calls,['auth:vault:write']);
 }
});
test('mutations use write scope and pass exact selected document only',async()=>{
 const {route,calls}=fixture();const response=await route(request('files',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:'MEMORY.md',content:'選擇留下的記憶',expectedRevision:0,requestKey:'request-one'})}));assert.equal(response?.status,200);assert.deepEqual(calls,['auth:vault:write','put:MEMORY.md']);
 assert.equal(await route(new Request(origin+'/api/v1/unrelated')),null);
});
