/* global Response */
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import vm from 'node:vm';
const htmlURL=new URL('../public/identity-offer.html',import.meta.url),scriptURL=new URL('../public/identity-offer.js',import.meta.url);
async function fixture(hash='#'+'a'.repeat(32)+'.'+'b'.repeat(64)){
 assert.ok(existsSync(htmlURL),'human offer choice page exists');assert.ok(existsSync(scriptURL),'human offer choice script exists');
 const nodes=new Map(),calls=[],history=[];for(const id of ['offer-status','offer-form','offer-consent','offer-accept','offer-decline','offer-home','offer-expiry'])nodes.set(id,{hidden:false,disabled:false,checked:false,textContent:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});
 const context={document:{getElementById:id=>nodes.get(id)},location:{hash,pathname:'/identity/offer',origin:'https://identity.example'},history:{replaceState:(...args)=>history.push(args)},fetch:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(url.endsWith('/inspect')?{state:'pending',publicURL:'https://identity.example/home/test',expiresAt:'2026-11-02T00:00:00.000Z',offerDigest:'c'.repeat(64)}:{state:'accepted'}),{headers:{'Content-Type':'application/json'}});},URL,JSON,RegExp};
 vm.runInNewContext(readFileSync(scriptURL,'utf8'),context);for(let i=0;i<6;i++)await Promise.resolve();return {nodes,calls,history};
}
test('human offer choice strips fragment, never submits a decision on view, requires explicit consent and sends no household credential',async()=>{
 const f=await fixture();assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.endsWith('/inspect'));assert.match(f.nodes.get('offer-home').textContent,/home/);assert.match(f.nodes.get('offer-expiry').textContent,/2026-11-02/);assert.equal(f.history.length,1);
 await f.nodes.get('offer-form').handlers.submit({preventDefault(){}});assert.equal(f.calls.length,1);
 f.nodes.get('offer-consent').checked=true;await f.nodes.get('offer-form').handlers.submit({preventDefault(){}});
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].url,'/api/v1/identity/offer/decision');assert.equal(f.calls[1].init.credentials,'omit');assert.equal(JSON.parse(f.calls[1].init.body).decision,'accept');assert.equal(JSON.parse(f.calls[1].init.body).expectedOfferDigest,'c'.repeat(64));assert.ok(!JSON.stringify(f.calls[1]).includes('Authorization'));assert.match(f.nodes.get('offer-status').textContent,/Agent.*continue/i);
});
test('invalid invitation cannot submit and public copy accurately preserves optional identity choice',async()=>{
 const f=await fixture('#bad');assert.equal(f.nodes.get('offer-form').hidden,true);assert.equal(f.calls.length,0);
 const html=readFileSync(htmlURL,'utf8');assert.match(html,/no-referrer/);assert.match(html,/optional/i);assert.match(html,/Passkey/);assert.doesNotMatch(html,/provider|prompt|revision|worker|Resend/i);
});
