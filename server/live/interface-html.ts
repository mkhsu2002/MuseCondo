import {parse,parseFragment,serialize,type DefaultTreeAdapterMap} from 'parse5';
import {normalizeInterfaceLocale,resolveInterfaceLocale,translateInterfaceText,type InterfaceLocale} from '../../src/shared/interface-locale.ts';
type Node=DefaultTreeAdapterMap['node'];
type Element=DefaultTreeAdapterMap['element'];
const isElement=(node:Node):node is Element=>'tagName' in node;
const attr=(element:Element,name:string)=>element.attrs.find(a=>a.name===name)?.value;
function set(element:Element,name:string,value:string){const old=element.attrs.find(a=>a.name===name);if(old)old.value=value;else element.attrs.push({name,value});}
const protectedTags=new Set(['script','style','textarea','pre','code','noscript']);
const translatedAttrs=['aria-label','aria-description','title','placeholder','alt'];
/** Browser language is only a fallback; zero-quality or unsupported tags are ignored. */
export function requestBrowserLanguage(header:string|null):InterfaceLocale|undefined{
 return (header??'').split(',').map((part,index)=>{const [tag,...params]=part.trim().split(';');const q=params.find(p=>p.trim().startsWith('q='));return {locale:normalizeInterfaceLocale(tag),q:q?Number(q.trim().slice(2)):1,index};}).filter(x=>x.locale&&Number.isFinite(x.q)&&x.q>0&&x.q<=1).sort((a,b)=>b.q-a.q||a.index-b.index)[0]?.locale;
}
function walk(node:Node,fn:(element:Element)=>void){if(isElement(node))fn(node);if('childNodes' in node)for(const child of node.childNodes)walk(child,fn);}
/** Only exact catalog UI nodes are localized; resident regions are explicitly excluded. */
export function localizeInterfaceHTML(html:string,locale:InterfaceLocale,homeMetadata=false,interactive=true):string{
 const doc=parse(html);let head:Element|undefined,body:Element|undefined;
 function visit(node:Node,blocked=false){
  if(!isElement(node)){if('childNodes' in node)node.childNodes.forEach(n=>visit(n,blocked));return;}
  if(node.tagName==='html')set(node,'lang',locale);
  if(node.tagName==='head')head=node;if(node.tagName==='body')body=node;
  if(homeMetadata&&node.tagName==='meta'&&['description','og:title','og:description','twitter:title','twitter:description','og:image:alt'].includes(attr(node,'name')??attr(node,'property')??''))set(node,'data-no-translate','');
  const excluded=blocked||protectedTags.has(node.tagName)||attr(node,'data-no-translate')!==undefined||attr(node,'translate')==='no'||attr(node,'data-interface-switch')!==undefined;
  if(excluded)return;
  // Content metadata belongs to its author; only site-level UI metadata is eligible.
  const text:Record<number,string>={},attrs:Record<string,string>={};
  node.childNodes.forEach((child,index)=>{if(child.nodeName==='#text'&&'value' in child){const next=translateInterfaceText(child.value,locale);if(next!==child.value){text[index]=child.value;child.value=next;}}});
  const names=[...translatedAttrs];if(node.tagName==='meta'&&['description','og:description','og:title'].includes(attr(node,'name')??attr(node,'property')??'')&&!homeMetadata)names.push('content');
  for(const name of names){const original=attr(node,name);if(original===undefined)continue;const next=translateInterfaceText(original,locale);if(next!==original){attrs[name]=original;set(node,name,next);}}
  if(Object.keys(text).length||Object.keys(attrs).length)set(node,'data-interface-original',JSON.stringify({text,attrs}));
  node.childNodes.forEach(n=>visit(n,excluded));
 }
 visit(doc);
 if(head&&interactive){const fragment=parseFragment(`<meta name="muse-interface-language" content="${locale}"><link rel="stylesheet" href="/interface-language.css"><script src="/interface-language.js" defer></script>`);for(const child of fragment.childNodes){child.parentNode=head;head.childNodes.push(child);}}
 if(body&&interactive){const fragment=parseFragment(`<nav class="interface-language" data-interface-switch aria-label="${locale==='zh-TW'?'語言':'Language'}"><button type="button" data-interface-locale="en" lang="en">English</button><button type="button" data-interface-locale="zh-TW" lang="zh-Hant">繁體中文</button></nav>`);for(const child of fragment.childNodes){child.parentNode=body;body.childNodes.unshift(child);}}
 return serialize(doc);
}
/** Per-request HTML only. API JSON, assets, redirects, methods and security headers retain their contracts. */
export async function localizeInterfaceResponse(request:Request,response:Response):Promise<Response>{
 if(request.method!=='GET'||!response.body||response.status<200||response.status>=400||!response.headers.get('Content-Type')?.toLowerCase().startsWith('text/html')||response.headers.has('Content-Disposition'))return response;
 const html=await response.text();if(!/<html\b/i.test(html))return new Response(html,response);
 const doc=parse(html);let home:InterfaceLocale|undefined;
 walk(doc,element=>{if(element.tagName==='meta'&&attr(element,'name')==='muse-home-language')home=normalizeInterfaceLocale(attr(element,'content'));});
 const cookie=request.headers.get('Cookie')?.match(/(?:^|;\s*)muse_interface_language=(en|zh-TW)(?:;|$)/)?.[1];
 const locale=resolveInterfaceLocale({explicit:new URL(request.url).searchParams.get('lang'),saved:cookie,home,browser:requestBrowserLanguage(request.headers.get('Accept-Language'))});
 const headers=new Headers(response.headers);headers.set('Content-Language',locale);headers.set('Cache-Control','no-store');
 const vary=new Set((headers.get('Vary')??'').split(',').map(x=>x.trim()).filter(Boolean));vary.add('Accept-Language');vary.add('Cookie');headers.set('Vary',[...vary].join(', '));
 for(const name of ['ETag','Content-Length','Content-Encoding','Last-Modified'])headers.delete(name);
 return new Response(localizeInterfaceHTML(html,locale,/^\/(?:private-home|home)\//.test(new URL(request.url).pathname)),{status:response.status,statusText:response.statusText,headers});
}
/** The cosmetic language cookie grants no authority and must not interfere with strict API cookie rejection. */
export function interfaceRuntimeRequest(request:Request):Request{
 const cookie=request.headers.get('Cookie');if(!cookie)return request;
 const parts=cookie.split(';').map(x=>x.trim()),remaining=parts.filter(x=>!/^muse_interface_language=(en|zh-TW)$/.test(x));
 if(parts.length===remaining.length)return request;
 const headers=new Headers(request.headers);if(remaining.length)headers.set('Cookie',remaining.join('; '));else headers.delete('Cookie');
 return new Request(request,{headers});
}
