import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parseFragment,type DefaultTreeAdapterTypes} from 'parse5';
import {homeSharing,homeSocialMetadata} from '../server/live/home-sharing.ts';
const url='https://tower.example/home/0123456789abcdef';
function elements(html:string){const list:DefaultTreeAdapterTypes.Element[]=[];function walk(n:DefaultTreeAdapterTypes.Node){if('tagName' in n)list.push(n);if('childNodes' in n)for(const c of n.childNodes)walk(c);}walk(parseFragment(html));return list;}
test('Facebook shares only the canonical public home and the two-line invitation uses the trusted guide',()=>{
 const nodes=elements(homeSharing(url)),link=nodes.find(n=>n.tagName==='a'&&n.attrs.some(a=>a.name==='href'&&a.value.startsWith('https://www.facebook.com/')))!;
 const target=new URL(link.attrs.find(a=>a.name==='href')!.value);assert.equal(target.origin,'https://www.facebook.com');assert.equal(target.searchParams.get('u'),url);assert.deepEqual([...target.searchParams.keys()],['u']);
 const fields=nodes.filter(n=>n.tagName==='textarea');assert.equal(fields.length,2);
 for(const field of fields){const value=field.childNodes.map(n=>'value' in n?n.value:'').join('');assert.equal(value.split('\n').length,2);assert.ok(value.endsWith('https://musetower.neobabylon.app/resident-quick-start.md'));}
 assert.match(homeSharing(url),/參考這個網址後為自己申請一個小窩/);
 for(const address of [url+'?key=secret',url+'#access=secret',url.replace('/home/','/private-home/'),'http://tower.example/home/0123456789abcdef'])assert.throws(()=>homeSharing(address));
});
test('copy actions work for home and both invitation languages with selection fallback and no browser URL access',async()=>{
 for(const fail of [false,true]){
  const html=elements(homeSharing(url)),fields=new Map<string,{value:string;hidden:boolean;selected:boolean;focus:()=>void;select:()=>void}>();
  for(const n of html.filter(n=>['input','textarea'].includes(n.tagName))){const data=n.attrs.find(a=>a.name.startsWith('data-'))!.name;const item={value:n.tagName==='input'?n.attrs.find(a=>a.name==='value')!.value:n.childNodes.map(x=>'value' in x?x.value:'').join(''),hidden:n.attrs.some(a=>a.name==='hidden'),selected:false,focus(){},select(){this.selected=true;}};fields.set('['+data+']',item);}
  const handlers:(()=>Promise<void>)[]=[],status={textContent:''},buttons=new Map(['[data-copy-home]','[data-copy-invitation]','[data-copy-invitation-zh]'].map(name=>[name,{hidden:true,addEventListener(_name:string,fn:()=>Promise<void>){handlers.push(fn);}}]));const copied:string[]=[];
  const section={querySelector(name:string){return name==='[data-home-sharing-status]'?status:buttons.get(name)??fields.get(name);}};
  runInNewContext(readFileSync('public/home-sharing.js','utf8'),{document:{querySelectorAll(){return [section];}},navigator:{clipboard:{async writeText(value:string){copied.push(value);if(fail)throw Error('clipboard denied');}}}});
  assert.equal(handlers.length,3);for(const handle of handlers)await handle();assert.ok([...buttons.values()].every(b=>!b.hidden));assert.equal(copied[0],url);assert.ok(copied[1].endsWith('/resident-quick-start.md'));assert.ok(copied[2].startsWith('參考這個網址'));
  assert.ok([...fields.values()].every(f=>f.selected===fail));assert.ok(status.textContent);
 }
});
test('published metadata is escaped rather than interpreting resident content',()=>{const html=homeSocialMetadata({title:'<resident>',description:'"public" & safe',url,image:'https://tower.example/og/muse-tower-share.jpg'});assert.ok(html.includes('og:image'));assert.ok(html.includes('&lt;resident&gt;'));assert.ok(!html.includes('content="<resident>'));});
