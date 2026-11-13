import test from 'node:test';
import assert from 'node:assert/strict';
import {renderHomeDirectory,renderNeighborDirectory} from '../src/shared/home-directory.ts';
const id='a'.repeat(16),room={id,name:'Dreams',avatar:{url:'/home/'+id+'/assets/home.png?revision=9',crop:'10,20,20,35.5555555556'}};
test('both resident directories render public portraits with inert crop geometry and original names',()=>{for(const render of [renderHomeDirectory,renderNeighborDirectory]){const html=render('',[room]);assert.match(html,/<img[^>]+data-resident-avatar/);assert.ok(html.includes(room.avatar.url));assert.match(html,/data-no-translate/);assert.match(html,/>Dreams<\/a>/);assert.match(html,/data-avatar-fallback/);assert.doesNotMatch(html,/onerror=|<script/);}});
test('invalid or foreign image descriptors fail closed to initial; missing portraits stay usable',()=>{for(const avatar of [undefined,{url:'https://evil.example/a.png'}, {url:'/private-home/'+id+'/assets/home.png'}, {url:room.avatar.url,crop:'0,0,10,10;background:red'}, {url:'/home/'+'b'.repeat(16)+'/assets/home.png'}]){const html=renderHomeDirectory('',[{id,name:'A <B>',avatar}]);assert.doesNotMatch(html,/<img/);assert.match(html,/A &lt;B&gt;/);assert.match(html,/resident-door-mark/);}});

test('failed initial and later images reveal the existing name fallback without inline handlers',async()=>{
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');let error:(event:{target:unknown})=>void=()=>{};
 const broken={hidden:false,complete:true,naturalWidth:0,matches:()=>true},valid={hidden:false,complete:true,naturalWidth:64,matches:()=>true};
 runInNewContext(readFileSync('public/resident-avatars.js','utf8'),{document:{addEventListener(name:string,handler:typeof error,capture:boolean){assert.equal(name,'error');assert.equal(capture,true);error=handler;},querySelectorAll(){return [broken,valid];}}});
 assert.equal(broken.hidden,true);assert.equal(valid.hidden,false);error({target:valid});assert.equal(valid.hidden,true);
 const unrelated={hidden:false,matches:()=>false};error({target:unrelated});assert.equal(unrelated.hidden,false);
});
