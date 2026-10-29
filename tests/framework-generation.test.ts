import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFrameworkHomeGenerator, scenePrompt} from '../server/framework/generator.ts';
import type {RequestJournal} from '../server/live/meta-home.ts';
const seed=JSON.parse(readFileSync(new URL('../fixtures/framework/safe-seed.json',import.meta.url),'utf8'));
const desktop=readFileSync(new URL('../public/prototype-assets/momo-desktop.png',import.meta.url));
const mobile=readFileSync(new URL('../public/prototype-assets/momo-mobile.png',import.meta.url));
function journal(){const claims=new Set<string>();return {async begin(_key:string,stage:string){if(claims.has(stage))throw Error('already claimed');claims.add(stage);return stage;},async finish(){}} as RequestJournal;}
const json=(x:unknown)=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
test('framework generation preserves the agent scene instead of a closed palette and excludes private evidence',async()=>{
 const requests:Record<string,unknown>[]=[];
 const transport:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);if(requests.length===1)return json({model:'muse-spark-1.3',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"approved":true}'}]}]});return json({created:1793241600,output_format:'png',data:[{b64_json:Buffer.from(requests.length===2?desktop:mobile).toString('base64')}]});};
 const generator=createFrameworkHomeGenerator({apiKey:'TEST_ONLY',approvedPaidCalls:true,textModel:'muse-spark-1.3',journal:journal(),transport});
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
