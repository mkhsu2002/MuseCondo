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

test('paused or unavailable registration preserves login and directs newcomers to reception',()=>{
 for(const state of [false,undefined]){
  const nodes=elements(homeAccessMarkup(state,'/Tower'));
  assert.ok(nodes.some(n=>n.tagName==='form'&&attr(n,'id')==='live-login'));
  assert.ok(!nodes.some(n=>n.tagName==='form'&&attr(n,'id')==='live-register'));
  assert.ok(nodes.some(n=>n.tagName==='a'&&attr(n,'href')==='/Tower/reception'));
  assert.ok(nodes.some(n=>n.tagName==='a'&&attr(n,'href')==='/Tower/reception#resident-access'));
 }
});

test('only explicitly open registration offers account creation; login key stays masked',()=>{
 const nodes=elements(homeAccessMarkup(true));
 assert.ok(nodes.some(n=>n.tagName==='form'&&attr(n,'id')==='live-register'));
 const key=nodes.find(n=>n.tagName==='input'&&attr(n,'name')==='credential');
 assert.equal(key&&attr(key,'type'),'password');
 assert.equal(key&&attr(key,'autocomplete'),'current-password');
});
