import test from 'node:test';
import assert from 'node:assert/strict';
import edgeWorker,{type EdgeBindings} from '../workers/edge-guard/worker.ts';
import {checkEdgeGuard} from '../server/live/edge-guard.ts';
import runtime from '../server/live/worker.ts';

const origin='https://tower.example';
const encoded={kind:'read',ipHash:'a'.repeat(64),credentialHash:'b'.repeat(64)};
const request=()=>new Request('https://edge-guard.internal/check',{method:'POST',body:JSON.stringify(encoded)});
function bindings(block?:keyof EdgeBindings){
 const used:{name:string;key:string}[]=[];
 const env=Object.fromEntries(['BURST','READ_IP','WRITE_IP','OPEN_IP','READ_KEY','WRITE_KEY','GLOBAL'].map(name=>[name,{limit:async({key}:{key:string})=>{used.push({name,key});return {success:name!==block};}}])) as unknown as EdgeBindings;
 return {env,used};
}
test('edge service combines shared IP/global and credential limits; key rotation cannot skip the IP bucket',async()=>{
 const {env,used}=bindings();assert.equal((await edgeWorker.fetch(request(),env)).status,204);
 assert.deepEqual(used.map(x=>x.name),['GLOBAL','BURST','READ_IP','READ_KEY']);
 assert.equal(used.find(x=>x.name==='READ_IP')?.key,encoded.ipHash);
 for(const bucket of ['GLOBAL','BURST','READ_IP','READ_KEY'] as const){const fixture=bindings(bucket);assert.equal((await edgeWorker.fetch(request(),fixture.env)).status,429);}
});
test('opening and writes have separate shared budgets; invalid input is rejected before counters',async()=>{
 for(const kind of ['open','write']){const {env,used}=bindings();assert.equal((await edgeWorker.fetch(new Request('https://edge-guard.internal/check',{method:'POST',body:JSON.stringify({...encoded,kind})}),env)).status,204);assert.ok(used.some(x=>x.name===(kind==='open'?'OPEN_IP':'WRITE_IP')));assert.ok(used.some(x=>x.name==='WRITE_KEY'));}
 const {env,used}=bindings();assert.equal((await edgeWorker.fetch(new Request('https://edge-guard.internal/check',{method:'POST',body:JSON.stringify({...encoded,ipHash:'raw-address'})}),env)).status,400);assert.equal(used.length,0);
});
test('Pages sends only hashed principal metadata to a private fixed service endpoint',async()=>{
 const secret='c'.repeat(64),ip='192.0.2.7';let captured:Request|undefined;
 const result=await checkEdgeGuard(new Request(origin+'/api/v1/reception/cases/private?after=2',{headers:{Authorization:'Bearer '+secret,'CF-Connecting-IP':ip}}),{EDGE_GUARD:{fetch:async r=>{captured=r;return new Response(null,{status:204});}}});
 assert.equal(result,null);assert.equal(captured!.url,'https://edge-guard.internal/check');const raw=await captured!.text();assert.ok(!raw.includes(secret)&&!raw.includes(ip)&&!raw.includes('private'));assert.match(JSON.parse(raw).ipHash,/^[a-f0-9]{64}$/);
});
test('missing or unavailable required binding fails closed; rate responses remain machine readable',async()=>{
 const req=new Request(origin+'/api/v1/status');assert.equal((await checkEdgeGuard(req,{EDGE_GUARD_REQUIRED:'true'}))?.status,503);
 assert.equal((await checkEdgeGuard(req,{EDGE_GUARD:{fetch:async()=>{throw Error('offline');}}}))?.status,503);
 const response=await checkEdgeGuard(req,{EDGE_GUARD:{fetch:async()=>new Response('private internals',{status:429})}});assert.equal(response?.status,429);assert.equal(response?.headers.get('Retry-After'),'60');assert.deepEqual(await response?.json(),{error:'rate_limited'});
});
test('edge denials precede all D1 queries and identity card service calls, with canonical origin first',async()=>{
 let calls=0,dbCalls=0,cardCalls=0;
 const env={PUBLIC_ORIGIN:origin,EDGE_GUARD_REQUIRED:'true',EDGE_GUARD:{fetch:async()=>{calls++;return new Response(null,{status:429});}},DB:{prepare:()=>{dbCalls++;throw Error('D1 must not run');},batch:async()=>{dbCalls++;throw Error('D1 must not run');}},IDENTITY_CARDS:{get:()=>{cardCalls++;throw Error('card must not run');},idFromName:()=>{cardCalls++;throw Error('card must not run');}}};
 for(const path of ['/api/v1/status','/api/v1/reception/cases/'+'d'.repeat(32),'/api/v1/agent/identity/card','/home/'+'e'.repeat(16)])assert.equal((await runtime.fetch(new Request(origin+path),env)).status,429);
 assert.equal((await runtime.fetch(new Request('https://alias.example/api/v1/status'),env)).status,403);assert.equal(calls,4);assert.equal(dbCalls,0);assert.equal(cardCalls,0);
});
