import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment, type DefaultTreeAdapterMap} from 'parse5';
import {homeAccessMarkup} from '../src/live/framework-ui.ts';

function elements(html:string){
 const found:DefaultTreeAdapterMap['element'][]=[];
 function walk(node:DefaultTreeAdapterMap['node']){
  if('tagName' in node)found.push(node);
  if('childNodes' in node)node.childNodes.forEach(walk);
 }
 walk(parseFragment(html));return found;
}
const attr=(node:DefaultTreeAdapterMap['element'],name:string)=>node.attrs.find(a=>a.name===name)?.value;

test('all admission states preserve login and direct newcomers to reception',()=>{
 for(const state of [{status:'accepting'},{status:'paused'},{status:'unavailable'},{status:'unknown'},undefined]){
  const nodes=elements(homeAccessMarkup(state,'/Tower'));
  assert.ok(nodes.some(n=>n.tagName==='form'&&attr(n,'id')==='live-login'));
  assert.ok(!nodes.some(n=>n.tagName==='form'&&attr(n,'id')==='live-register'));
  assert.ok(nodes.some(n=>n.tagName==='a'&&attr(n,'href')==='/Tower/reception'));
  assert.ok(nodes.some(n=>n.tagName==='a'&&attr(n,'href')==='/Tower/reception#resident-access'));
 }
});

test('accepting applications never offers separate account creation; login key stays masked',()=>{
 const nodes=elements(homeAccessMarkup({status:'accepting',applyURL:'https://evil.example/reception'}));
 assert.ok(!nodes.some(n=>n.tagName==='form'&&attr(n,'id')==='live-register'));
 assert.ok(!nodes.some(n=>attr(n,'href')?.includes('evil.example')));
 const key=nodes.find(n=>n.tagName==='input'&&attr(n,'name')==='credential');
 assert.equal(key&&attr(key,'type'),'password');
 assert.equal(key&&attr(key,'autocomplete'),'current-password');
});

test('admission copy distinguishes paused from unavailable and preserves Agent ownership',()=>{
 assert.match(homeAccessMarkup({status:'accepting'}),/Currently accepting applications from Muse Agents/);
 assert.match(homeAccessMarkup({status:'paused'}),/New applications are paused\. You can view or update an existing case\. Qualification review and automated move-in assistance will resume when admission reopens\./);
 for(const state of [undefined,{status:'unavailable'},{status:'future'},{}]){
  const html=homeAccessMarkup(state);assert.match(html,/Application availability could not be confirmed/);assert.doesNotMatch(html,/Currently accepting|New applications are paused|Existing applications can continue/);
 }
 assert.match(homeAccessMarkup(undefined),/your own home/);
});
