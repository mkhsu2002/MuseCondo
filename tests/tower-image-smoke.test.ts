import test from 'node:test';
import assert from 'node:assert/strict';
import {runImageCodecSmoke} from '../workers/tower-manager/image-smoke.ts';
import type {ImageOptimizationBindings} from '../workers/tower-manager/image-optimizer.ts';
const DEV='https://framework-v001.musecondo.pages.dev',PROFILE='cf-webp-1920-q85-v1',SOURCE_SHA='5d3983dd12622dd7fb83eb1785f5d3f242a6394d52f688af5423a1773a8e68e1';
const webp=new Uint8Array(Buffer.from('UklGRpYAAABXRUJQVlA4WAoAAAAQAAAAAgAAAgAAQUxQSAoAAAAA/4AA/0D///+AVlA4IGYAAACwAgCdASoDAAMAAQAcJbACdEyAf0CpAPIvBr/hx+QA4lF96Tf5Ff/5Ffy+TT77DlD/9XP3f1JtCed51vySc1H6//fvKFf7Y6f1c/ubIqfwM/+9i9CYp39fmKDX9d1/u7BU/oAAAAA=','base64'));
const hash=async(bytes:Uint8Array)=>Buffer.from(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))).toString('hex');
function container(chunks:Uint8Array[]){const bytes=new Uint8Array(12+chunks.reduce((total,chunk)=>total+chunk.length,0));bytes.set(new TextEncoder().encode('RIFF'));new DataView(bytes.buffer).setUint32(4,bytes.length-8,true);bytes.set(new TextEncoder().encode('WEBP'),8);let at=12;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;}
function chunks(bytes:Uint8Array){const values:Uint8Array[]=[];let at=12;while(at<bytes.length){const length=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(at+4,true);values.push(bytes.slice(at,at+8+length+length%2));at+=8+length+length%2;}return values;}
function metadata(){const content=new TextEncoder().encode('synthetic-private-metadata'),parts=chunks(webp);parts[0][8]|=0x2c;for(const kind of ['EXIF','XMP ','ICCP']){const chunk=new Uint8Array(8+content.length+content.length%2);chunk.set(new TextEncoder().encode(kind));new DataView(chunk.buffer).setUint32(4,content.length,true);chunk.set(content,8);parts.push(chunk);}return container(parts);}
function fixture(options:{output?:Uint8Array;error?:unknown;gate?:Promise<void>;onInput?:()=>void}={}){
 const values=new Map<string,unknown>(),writes:{key:string;value:unknown}[]=[];let reads=0,calls=0,atomicDepth=0,queue=Promise.resolve();
 const storage={async get<T>(key:string){reads++;return structuredClone(values.get(key)) as T|undefined;},async put(key:string,value:unknown){writes.push({key,value:structuredClone(value)});values.set(key,structuredClone(value));}};
 const atomic=async<T>(callback:()=>Promise<T>)=>{let release:()=>void=()=>{};const prior=queue;queue=new Promise<void>(resolve=>{release=resolve;});await prior;atomicDepth++;try{return await callback();}finally{atomicDepth--;release();}};
 const env:ImageOptimizationBindings={PUBLIC_ORIGIN:DEV,MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic-unused',IMAGES:{input(stream){calls++;options.onInput?.();assert.equal(atomicDepth,0,'Do not hold blockConcurrencyWhile during codec work');assert.equal((values.get(PROFILE) as {state:string}).state,'dispatched','Persist reservation before dispatch');return {transform(parameters){assert.deepEqual(parameters,{width:1920,height:1920,fit:'scale-down'});return {async output(parameters){assert.deepEqual(parameters,{format:'image/webp',quality:85,anim:false});const bytes=new Uint8Array(await new Response(stream).arrayBuffer());assert.equal(await hash(bytes),SOURCE_SHA);await options.gate;if(options.error)throw options.error;return {response(){return new Response(new Uint8Array(options.output??webp),{headers:{'Content-Type':'image/webp'}});}};}};}};}}};
 return {env,storage,atomic,values,writes,get reads(){return reads;},get calls(){return calls;}};
}
test('configured production origin cannot be bypassed by a forged caller Origin',async()=>{
 const f=fixture();f.env.PUBLIC_ORIGIN='https://musetower.neobabylon.app';Object.assign(f.env,{Origin:DEV});const result=await runImageCodecSmoke(f.env,f.storage,f.atomic);assert.equal(result.status,404);assert.equal(f.calls,0);assert.equal(f.reads,0);assert.equal(f.writes.length,0);
});
test('missing Images binding rejects before claiming any durable or billable work',async()=>{
 const f=fixture();delete f.env.IMAGES;const result=await runImageCodecSmoke(f.env,f.storage,f.atomic);assert.equal(result.status,503);assert.equal(f.calls,0);assert.equal(f.reads,0);assert.equal(f.writes.length,0);
});
test('one fixed transparent PNG smoke strips metadata, persists its result and replays the exact output',async()=>{
 const f=fixture({output:metadata()}),response=await runImageCodecSmoke(f.env,f.storage,f.atomic);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');const result=await response.json() as {state:string;profile:string;sourceSHA:string;grossMicroUsd:number;outputSHA:string;bytes:number;width:number;height:number;alpha:boolean;metadataStripped:boolean;outputBase64:string};
 assert.equal(result.state,'complete');assert.equal(result.profile,PROFILE);assert.equal(result.sourceSHA,SOURCE_SHA);assert.equal(result.grossMicroUsd,500);assert.equal(result.width,3);assert.equal(result.height,3);assert.equal(result.alpha,true);assert.equal(result.metadataStripped,true);assert.equal(result.bytes,webp.length);assert.equal(result.outputSHA,await hash(webp));assert.deepEqual(new Uint8Array(Buffer.from(result.outputBase64,'base64')),webp);
 assert.equal(f.calls,1);assert.deepEqual(f.writes.map(write=>(write.value as {state:string}).state),['dispatched','complete']);assert.ok(f.writes.every(write=>write.key===PROFILE));assert.deepEqual(await(await runImageCodecSmoke(f.env,f.storage,f.atomic)).json(),result);assert.equal(f.calls,1);assert.equal(f.writes.length,2);
});
test('concurrent calls atomically share one reservation without holding the DO lock during conversion',async()=>{
 let start:()=>void=()=>{},finish:()=>void=()=>{};const started=new Promise<void>(resolve=>{start=resolve;}),gate=new Promise<void>(resolve=>{finish=resolve;});const f=fixture({gate,onInput:start});
 const first=runImageCodecSmoke(f.env,f.storage,f.atomic);await started;const concurrent=await(await runImageCodecSmoke(f.env,f.storage,f.atomic)).json() as {state:string};assert.equal(concurrent.state,'unknown');assert.equal(f.calls,1);assert.equal(f.writes.length,1);finish();const completed=await(await first).json();assert.deepEqual(await(await runImageCodecSmoke(f.env,f.storage,f.atomic)).json(),completed);assert.equal(f.calls,1);assert.equal(f.writes.length,2);
});
test('ambiguous and explicit provider failures persist only safe diagnostic codes and never retry',async()=>{
 for(const error of [Error('SECRET_RAW_ERROR'),Object.assign(Error('SECRET_PROVIDER_MESSAGE'),{code:9422}),Object.assign(Error('SECRET_BAD_CODE'),{code:'invalid-secret-token'})]){
  const f=fixture({error}),result=await(await runImageCodecSmoke(f.env,f.storage,f.atomic)).json() as {state:string;providerCode?:string};assert.equal(result.state,'unknown');assert.equal(result.providerCode,'code'in error&&error.code===9422?'9422':undefined);assert.doesNotMatch(JSON.stringify(result),/SECRET|secret-token/);assert.deepEqual(await(await runImageCodecSmoke(f.env,f.storage,f.atomic)).json(),result);assert.equal(f.calls,1);assert.equal(f.writes.length,2);
 }
});
test('opaque, invalid and oversized results cannot be accepted or cause another codec dispatch',async()=>{
 const opaque=container(chunks(webp).filter(chunk=>String.fromCharCode(...chunk.subarray(0,4))==='VP8 '));
 for(const output of [opaque,new Uint8Array([1,2,3]),new Uint8Array(16385)]){
  const f=fixture({output}),result=await(await runImageCodecSmoke(f.env,f.storage,f.atomic)).json() as {state:string;outputBase64?:string};assert.equal(result.state,'unknown');assert.equal(result.outputBase64,undefined);await runImageCodecSmoke(f.env,f.storage,f.atomic);assert.equal(f.calls,1);
 }
});
test('an existing dispatched receipt is permanently treated as unknown without rewriting or dispatching',async()=>{
 const f=fixture();f.values.set(PROFILE,{state:'dispatched',profile:PROFILE,sourceSHA:SOURCE_SHA,grossMicroUsd:500,createdAt:'2026-11-03T00:00:00.000Z'});const response=await runImageCodecSmoke(f.env,f.storage,f.atomic);assert.equal((await response.json() as {state:string}).state,'unknown');assert.equal(f.calls,0);assert.equal(f.writes.length,0);assert.equal((f.values.get(PROFILE) as {state:string}).state,'dispatched');
});
test('a lost durable claim acknowledgement cannot dispatch or reopen the stored reservation',async()=>{
 const f=fixture(),put=f.storage.put.bind(f.storage);f.storage.put=async(key,value)=>{await put(key,value);throw Error('synthetic storage acknowledgement lost');};const response=await runImageCodecSmoke(f.env,f.storage,f.atomic);assert.equal(response.status,503);assert.equal(f.calls,0);assert.equal((f.values.get(PROFILE) as {state:string}).state,'dispatched');assert.equal((await(await runImageCodecSmoke(f.env,f.storage,f.atomic)).json() as {state:string}).state,'unknown');assert.equal(f.calls,0);assert.equal(f.writes.length,1);
});
