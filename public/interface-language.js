/* global document, window, navigator, location, history, localStorage, fetch, MutationObserver, requestAnimationFrame, CustomEvent */
(()=>{
 'use strict';
 const COOKIE='muse_interface_language',KEY='muse-interface-language',originals=new WeakMap(),attributes=new WeakMap(),hydrated=new WeakSet();
 const excluded='[data-no-translate], [translate="no"], script, style, code, pre, textarea, [data-interface-switch]';
 const catalogURL=new URL(document.currentScript?.dataset.interfaceCatalog||'interface-messages.json',document.currentScript?.src||location.href);
 let catalog={},reverse=new Map(),locale='en',queued=false,deliberate=false;
 const normalize=value=>{if(typeof value!=='string'||value.length>256)return;const v=value.split(',')[0].split(';')[0].trim().toLowerCase();if(/^en(?:-[a-z0-9]{2,8})*$/.test(v))return 'en';if(v==='zh'||/^zh-(?:tw|hk|mo|hant)(?:-[a-z0-9]{2,8})*$/.test(v))return 'zh-TW';};
 const saved=()=>{try{return normalize(localStorage.getItem(KEY));}catch{return;}};
 const cookie=()=>normalize(document.cookie.match(/(?:^|;\s*)muse_interface_language=([^;]*)/)?.[1]);
 const resolve=()=>normalize(new URL(location.href).searchParams.get('lang'))||saved()||cookie()||normalize(document.querySelector('meta[name="muse-home-language"]')?.content)||(navigator.languages||[navigator.language]).map(normalize).find(Boolean)||'en';
 function translate(value){const text=value.trim(),next=locale==='zh-TW'?(Object.hasOwn(catalog,text)?catalog[text]:undefined):reverse.get(text);return typeof next==='string'?value.replace(text,next):value;}
 function source(value){return reverse.get(value.trim())?value.replace(value.trim(),reverse.get(value.trim())):value;}
 function hydrate(element){
  if(hydrated.has(element))return;hydrated.add(element);
  const raw=element.getAttribute('data-interface-original');if(!raw)return;
  try{const data=JSON.parse(raw);if(data&&typeof data==='object'){
   for(const [index,value] of Object.entries(data.text||{})){const node=element.childNodes[Number(index)];if(node?.nodeType===3&&typeof value==='string')originals.set(node,{source:value,last:node.nodeValue});}
   const attrs=new Map();for(const [name,value] of Object.entries(data.attrs||{}))if(typeof value==='string')attrs.set(name,{source:value,last:element.getAttribute(name)});attributes.set(element,attrs);
  }}catch{/* Unrecognized source metadata never changes page content. */}
 }
 function apply(){
  if(!document.body)return;
  for(const element of document.querySelectorAll('[data-interface-original]'))if(!element.closest(excluded))hydrate(element);
  const walker=document.createTreeWalker(document.documentElement,4);let node;
  while((node=walker.nextNode())){
   const parent=node.parentElement;if(!parent||parent.closest(excluded)||!node.nodeValue?.trim())continue;
   let item=originals.get(node);if(!item||item.last!==node.nodeValue)item={source:source(node.nodeValue),last:node.nodeValue};
   const value=translate(item.source);if(node.nodeValue!==value)node.nodeValue=value;item.last=value;originals.set(node,item);
  }
  for(const element of document.querySelectorAll('[title],[aria-label],[placeholder],[alt],meta[name="description"],meta[property="og:title"],meta[property="og:description"]')){
   if(element.closest(excluded))continue;
   let items=attributes.get(element);if(!items){items=new Map();attributes.set(element,items);}
   for(const name of ['title','aria-label','placeholder','alt',...(element.tagName==='META'?['content']:[])]){
    if(!element.hasAttribute(name))continue;const current=element.getAttribute(name);let item=items.get(name);
    if(!item||item.last!==current)item={source:source(current),last:current};const value=translate(item.source);if(current!==value)element.setAttribute(name,value);item.last=value;items.set(name,item);
   }
  }
  for(const time of document.querySelectorAll('time[datetime]')){
   if(time.closest(excluded))continue;const date=new Date(time.dateTime);if(!Number.isFinite(date.getTime()))continue;
   const original=originals.get(time.firstChild);if(!original||!/^\d{4}-\d{2}-\d{2}$|^[A-Za-z]{3,9} \d{1,2}, \d{4}$/.test(original.source.trim()))continue;
   const value=locale==='zh-TW'?new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(date):original.source;
   if(time.firstChild.nodeValue!==value)time.firstChild.nodeValue=value;original.last=value;
  }
  if(document.documentElement.lang!==locale)document.documentElement.lang=locale;
  for(const control of document.querySelectorAll('[data-interface-switch]')){const label=locale==='zh-TW'?'語言':'Language';if(control.getAttribute('aria-label')!==label)control.setAttribute('aria-label',label);}
  for(const button of document.querySelectorAll('[data-interface-locale]'))button.setAttribute('aria-pressed',String(button.dataset.interfaceLocale===locale));
  for(const anchor of deliberate?document.querySelectorAll('a[href]'):[]){
   const url=new URL(anchor.href,location.href);if(url.origin!==location.origin||anchor.hasAttribute('download')||!/^\/(?:$|home\/|private-home\/|neighbors\/?$|move-in\/?$|reception\/?$|identity(?:\/|$)|vault\/(?:start|authorize)|activities\/?$|tower-(?:weekly|scenes|history|visits)(?:\/|\.|$)|project(?:\/|$))/.test(url.pathname))continue;
   url.searchParams.set('lang',locale);if(anchor.href!==url.href)anchor.href=url.href;
  }
 }
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;apply();});}
 function choose(next){const selected=normalize(next);if(!selected)return;locale=selected;deliberate=true;
  try{localStorage.setItem(KEY,locale);}catch{/* The page still switches when storage is unavailable. */}
  document.cookie=COOKIE+'='+locale+'; Path=/; Max-Age=31536000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');
  const url=new URL(location.href);url.searchParams.set('lang',locale);history.replaceState(history.state,'',url.href);apply();window.dispatchEvent(new CustomEvent('muse:languagechange',{detail:{locale}}));
 }
 document.addEventListener('click',event=>{const button=event.target.closest?.('[data-interface-locale]');if(!button)return;event.preventDefault();choose(button.dataset.interfaceLocale);});
 deliberate=!!(normalize(new URL(location.href).searchParams.get('lang'))||saved()||cookie());
 locale=resolve();
 window.addEventListener('popstate',()=>{locale=resolve();deliberate=!!(normalize(new URL(location.href).searchParams.get('lang'))||saved()||cookie());schedule();});
 fetch(catalogURL.href,{credentials:'omit',cache:'no-store'}).then(response=>{if(!response.ok)throw Error();return response.json();}).then(messages=>{
  if(!messages||typeof messages!=='object'||Array.isArray(messages))return;catalog=messages;reverse=new Map(Object.entries(catalog).filter(([,value])=>typeof value==='string').map(([key,value])=>[value,key]));
  const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-interface-original','lang','title','aria-label','placeholder','alt','content']});
  apply();window.MuseInterfaceLanguage={get locale(){return locale;},choose,translate,refresh:schedule};
 }).catch(()=>{/* Keep the server-rendered language when a catalog cannot be loaded. */});
})();
