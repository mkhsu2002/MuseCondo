import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFrameworkHomeGenerator, scenePrompt} from '../server/framework/generator.ts';
import type {RequestJournal} from '../server/live/meta-home.ts';
import {workerdFetch} from './helpers/workerd-fetch.ts';
const seed=JSON.parse(readFileSync(new URL('../fixtures/framework/safe-seed.json',import.meta.url),'utf8'));
const desktop=readFileSync(new URL('../public/prototype-assets/momo-desktop.png',import.meta.url));
const mobile=readFileSync(new URL('../public/prototype-assets/momo-mobile.png',import.meta.url));
function journal(){const claims=new Set<string>();return {async begin(_key:string,stage:string){if(claims.has(stage))throw Error('already claimed');claims.add(stage);return stage;},async finish(){}} as RequestJournal;}
const json=(x:unknown)=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
test('framework generation preserves the agent scene instead of a closed palette and excludes private evidence',async()=>{
 const requests:Record<string,unknown>[]=[];
 const transport:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);if(requests.length===1)return json({model:'muse-spark-1.3',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"approved":true}'}]}]});return json({created:1793241600,output_format:'png',data:[{b64_json:Buffer.from(requests.length===2?desktop:mobile).toString('base64')}]});};
 const generator=createFrameworkHomeGenerator({apiKey:'TEST_ONLY',approvedPaidCalls:true,textModel:'muse-spark-1.3',journal:journal(),transport:workerdFetch((request,_index,init)=>transport(request.url,init)).fetcher});
 const result=await generator.generate({personality:'not sent',providerKey:'framework-request-123456789',frameworkSeed:seed});
 assert.equal(result.length,2);assert.equal(requests[0].store,false);
 const imagePrompt=String(requests[1].prompt);assert(imagePrompt.includes(seed.home.form.description));assert(imagePrompt.includes(seed.home.selfImage.description));assert(imagePrompt.includes(seed.home.activity.description));assert(imagePrompt.includes(seed.home.ownerPortrait.description));assert(imagePrompt.includes(seed.home.view.description));
 assert(!JSON.stringify(requests).includes(seed.evidence[0].summary));assert(!JSON.stringify(requests).includes('PRIVATE-'));assert(!imagePrompt.includes('cute original alien sprite'));
 assert.equal(result[0].provenance.promptVersion,'framework-0.01');assert.equal(result[0].provenance.prompt,'');
 await assert.rejects(generator.generate({personality:'',providerKey:'framework-request-123456789',frameworkSeed:seed}));assert.equal(requests.length,3);
});
test('missing framework, consent or paid authorization cannot dispatch any provider request',async()=>{
 let calls=0;const transport:typeof fetch=async()=>{calls++;throw Error('must not call');};
 const cfg={apiKey:'TEST_ONLY',approvedPaidCalls:true,textModel:'muse-spark-1.3' as const,journal:journal(),transport};
 await assert.rejects(createFrameworkHomeGenerator(cfg).generate({personality:'legacy',providerKey:'framework-request-123456789'}));
 await assert.rejects(createFrameworkHomeGenerator({...cfg,approvedPaidCalls:false}).generate({personality:'',providerKey:'framework-request-123456789',frameworkSeed:seed}));
 const bad=structuredClone(seed);delete bad.home.ownerPortrait;
 await assert.rejects(createFrameworkHomeGenerator(cfg).generate({personality:'',providerKey:'framework-request-123456789',frameworkSeed:bad}));assert.equal(calls,0);
});
test('scene instructions contain compulsory portrait placement and preserve both image compositions',()=>{
 const prompt=scenePrompt(seed);assert.match(prompt,/table/);assert.match(prompt,/16:9/);assert.match(prompt,/window/i);assert.match(prompt,/not.*actual|imagined/i);assert(!prompt.includes('PRIVATE-'));
});

for(const status of [301,302,303,307,308])for(const stage of ['personality','desktop','mobile'] as const)test('workerd framework '+stage+' redirect '+status+' stays unknown without follow or retry',async()=>{
 const claims=journal(),entries:{id:string;state:string}[]=[],stages=['personality','desktop','mobile'];
 const log:RequestJournal={begin:claims.begin,async finish(id,state){entries.push({id,state});}};
 const approved={model:'muse-spark-1.3',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"approved":true}'}]}]};
 const network=workerdFetch((_request,index)=>index===stages.indexOf(stage)?new Response(JSON.stringify(approved),{status,headers:{Location:'https://untrusted.example/collect'}}):json(index===0?approved:{created:1793241600,output_format:'png',data:[{b64_json:Buffer.from(desktop).toString('base64')}]}));
 const generator=createFrameworkHomeGenerator({apiKey:'TEST_ONLY',approvedPaidCalls:true,textModel:'muse-spark-1.3',journal:log,transport:network.fetcher});const input={personality:'',providerKey:'framework-request-123456789',frameworkSeed:seed};
 await assert.rejects(generator.generate(input),/requires operator verification/);assert.equal(network.requests.length,stages.indexOf(stage)+1);assert(network.requests.every(r=>new URL(r.url).origin==='https://api.meta.ai'&&r.headers.get('Authorization')==='Bearer TEST_ONLY'));
 assert.equal(entries.at(-1)!.id,stage);assert.equal(entries.at(-1)!.state,'unknown');assert.equal(entries.filter(r=>r.state==='unknown').length,1);const count=network.requests.length;
 await assert.rejects(generator.generate(input));assert.equal(network.requests.length,count);
});
