/* global Response */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {setImmediate} from 'node:timers/promises';
const script=readFileSync(new URL('../public/tower-visits.js',import.meta.url),'utf8');
class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.events={};this.dataset={};this.selectors={};this.hidden=false;this.textContent='';this.value='';this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
 querySelector(selector){return this.selectors[selector]||null;}addEventListener(type,fn){this.events[type]=fn;}
 async fire(type){await this.events[type]?.({preventDefault(){},currentTarget:this});}
}
async function ready(){for(let i=0;i<10;i++)await setImmediate();}
function harness(privatePage,fetcher){
 const root=new Element(),status=new Element(),login=new Element(),nodes={status,login};
 root.selectors['[data-visit-status]']=status;root.selectors['[data-visit-login]']=login;
 if(privatePage){for(const [key,selector] of Object.entries({private:'[data-visit-private]',received:'[data-visit-received]',sent:'[data-visit-sent]',moreReceived:'[data-more-received]',moreSent:'[data-more-sent]'})){nodes[key]=new Element();root.selectors[selector]=nodes[key];}}
 else{
  root.dataset.visitRoom='d'.repeat(16);for(const [key,selector] of Object.entries({list:'[data-visit-list]',more:'[data-visit-more]',form:'form'})){nodes[key]=new Element();root.selectors[selector]=nodes[key];}
  nodes.form.elements={namedItem:name=>nodes[name]};for(const key of ['kind','body','nickname','giftId','submit','gift','privacy'])nodes[key]=new Element();
  nodes.kind.value='invitation';nodes.body.value='Private hello';nodes.nickname.value='Synthetic';nodes.giftId.value='gift-sprout';
  nodes.form.selectors={'[data-visit-gift]':nodes.gift,'[data-visit-privacy]':nodes.privacy,'button[type=submit]':nodes.submit};
 }
 const calls=[];
 runInNewContext(script,{document:{querySelector:selector=>(selector==='[data-visit-inbox]'?privatePage:!privatePage)?root:null,createElement:tag=>new Element(tag)},crypto:{randomUUID:()=> 'synthetic-request-123'},FormData:class{get(name){return nodes[name].value;}},fetch:async(path,options)=>{calls.push({path,options});return fetcher(path,options);},URL,Date,Error});
 return {root,nodes,calls};
}
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('visitor form sends same-origin session CSRF and private invitations without URL credentials',async()=>{
 const h=harness(false,async path=>response(path==='/api/v1/session'?{signedIn:true,csrf:'synthetic-csrf'}:path.endsWith('/send')?{visit:{id:'synthetic'}}:{visits:[],nextCursor:null}));await ready();
 assert.equal(h.nodes.form.hidden,false);assert.equal(h.nodes.gift.hidden,true);assert.equal(h.nodes.body.maxLength,1000);assert.match(h.nodes.privacy.textContent,/也不會公開/);
 await h.nodes.form.fire('submit');
 const sent=h.calls.find(call=>call.options.method==='POST');assert.ok(sent);assert.equal(sent.options.credentials,'same-origin');assert.equal(sent.options.headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(sent.options.headers.Authorization,undefined);assert.doesNotMatch(sent.path,/csrf|token|credential/);
 const input=JSON.parse(sent.options.body);assert.equal(input.kind,'invitation');assert.equal(input.body,'Private hello');assert.equal(input.targetDoor,'/home/'+'d'.repeat(16));assert.equal(input.giftId,undefined);assert.match(h.nodes.status.textContent,/私密邀請已送達/);
});
test('anonymous visitor sees escaped text nodes and a login entry without an enabled form',async()=>{
 const payload='<img src=x onerror=alert(1)>',h=harness(false,async path=>response(path==='/api/v1/session'?{signedIn:false}:{visits:[{id:'a',kind:'message',nickname:'Synthetic',body:payload,createdAt:'2026-10-30T00:00:00Z'}],nextCursor:null}));await ready();
 assert.equal(h.nodes.form.hidden,true);assert.equal(h.nodes.login.hidden,false);assert.equal(h.nodes.list.children[0].children.at(-1).textContent,payload);assert.equal(h.calls.filter(call=>call.options.method==='POST').length,0);
});
test('private inbox accepts an invitation and sender withdrawal refreshes current lists',async()=>{
 let accepted=false,withdrawn=false;
 const invite={id:'a'.repeat(32),kind:'invitation',nickname:'Synthetic',body:'PRIVATE',state:'pending',version:1,targetDoor:'/home/'+'d'.repeat(16),createdAt:'2026-10-30T00:00:00Z'};
 const h=harness(true,async(path,options)=>{
  if(path==='/api/v1/session')return response({signedIn:true,csrf:'synthetic-csrf'});
  if(options.method==='POST'){if(path.endsWith('/moderate'))accepted=true;else withdrawn=true;return response({visit:{}});}
  return response({visits:[{...invite,...(path.endsWith('/sent')?{state:withdrawn?'withdrawn':'accepted',version:2}:{state:accepted?'accepted':'pending'})}],nextCursor:null});
 });await ready();
 const accept=h.nodes.received.children[0].children.find(node=>node.tagName==='button'&&node.textContent==='接受邀請');assert.ok(accept);await accept.fire('click');assert.equal(accepted,true);
 const withdraw=h.nodes.sent.children[0].children.find(node=>node.tagName==='button');await withdraw.fire('click');assert.equal(withdrawn,true);
 const writes=h.calls.filter(call=>call.options.method==='POST');assert.deepEqual(writes.map(call=>JSON.parse(call.options.body).expectedVersion),[1,2]);assert.equal(JSON.parse(writes[0].options.body).action,'accept');
 assert.equal(h.nodes.sent.children[0].children.some(node=>node.tagName==='button'),false);
});
