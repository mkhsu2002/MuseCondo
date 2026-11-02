import {parse, type DefaultTreeAdapterMap} from 'parse5';
import {openMusePublicShare,parseMuseShareURL} from './muse-public-share.ts';
import {towerSourceURL} from './tower-source-url.ts';
import {CONDO_ALL_PROFILE_FIELDS,CONDO_PROFILE_FIELDS,CONDO_OPTIONAL_PROFILE_FIELDS,CONDO_PORTRAIT_CROP_FIELDS,parsePortraitCrop,type PublicCondoSite} from '../../src/framework/condo.ts';
import type {PublicDailyEntry} from '../../src/framework/types.ts';
import {renderCondo,type CondoPage} from '../../src/framework/condo-render.ts';

export class HomeSourceError extends Error {readonly code:string;readonly path:string;constructor(code='source_native_rejected',path='snapshot'){super(code);this.name='HomeSourceError';this.code=code;this.path=path;}}
function fail(_status:number,code:string):never {throw new HomeSourceError(code);}
export function isMuseShareURL(value:unknown):boolean {try{const input=parseMuseShareURL(value);return /-([a-z0-9]{3,26})$/.test(input.slug);}catch{return false;}}
export function homeSourceURL(value:unknown):URL {if(isMuseShareURL(value))return new URL(value as string);return towerSourceURL(value);}
export function homeSourceIdentity(value:unknown):string {if(isMuseShareURL(value)){const input=parseMuseShareURL(value);return 'muse-space:'+/-([a-z0-9]{3,26})$/.exec(input.slug)![1];}return towerSourceURL(value).href;}
function object(v: unknown, keys: readonly string[], path="snapshot"): Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v)
  )
    fail(400, "invalid_public_snapshot");
  if(Object.keys(v).some(k=>!keys.includes(k)))throw new HomeSourceError("unsupported_fields",path);
  return v as Record<string, unknown>;
}
function string(v: unknown, max = 2000): string {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    Array.from(v).some(
      (c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)),
    )
  )
    fail(400, "invalid_public_snapshot");
  return v as string;
}
function id(v: unknown) {
  const s = string(v, 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(s))
    fail(400, "invalid_identity");
  return s;
}
function date(v: unknown,path='snapshot') {
  const s = string(v, 40), day=s.slice(0,10);
  if(!/^\d{4}-\d\d-\d\d/.test(s)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw new HomeSourceError('invalid_public_snapshot',path);
  if(/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?)?$/.test(s))throw new HomeSourceError('date_timezone_required',path);
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s)))throw new HomeSourceError('invalid_public_snapshot',path);
  return s;
}
/** Explicit same-directory paths only; no decoding, redirects, query strings or external origins. */
export function homeRelativePath(value:unknown,kind:'image'|'view'):string {
 if(typeof value!=='string'||value.length>240||!/^(?:\.\/)?(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|html)$/.test(value)||!value.endsWith(kind==='image'?'.png':'.html'))throw new HomeSourceError(kind==='image'?'invalid_image_source':'unsupported_public_snapshot',kind==='image'?'snapshot.assets':'snapshot.home.routes');
 return './'+value.replace(/^\.\//,'');
}
export function validateHomeSnapshot(
  value: unknown,
  residentId: string,
): PublicCondoSite {
  const root = object(value, [
    "templateVersion",
    "home",
    "homeAlt",
    "profile",
    "dream",
    "example",
  ]);
  if (root.templateVersion !== "muse-condo-1" || root.example !== false)
    fail(400, "unsupported_public_snapshot");
  const home = object(root.home, [
    "frameworkVersion",
    "id",
    "name",
    "intro",
    "assets",
    "routes",
    "daily",
    "dreams",
  ]);
  if (home.frameworkVersion !== "0.01" || home.id !== residentId)
    fail(409, "source_identity_changed");
  const assets = object(home.assets, ["desktop"]);
  homeRelativePath(assets.desktop,"image");
  const routes = object(home.routes, ["home", "inside", "dreams"]);
  for(const key of ['home','inside','dreams'])homeRelativePath(routes[key],'view');
  if(new Set(Object.values(routes).map(value=>homeRelativePath(value,'view'))).size!==3)fail(400,'unsupported_public_snapshot');
  const profile = object(root.profile, CONDO_ALL_PROFILE_FIELDS,"snapshot.profile"),
    projected = Object.fromEntries(
      CONDO_PROFILE_FIELDS.map((k) => [k, string(profile[k])]),
    ) as PublicCondoSite["profile"];
  for(const key of CONDO_OPTIONAL_PROFILE_FIELDS)if(profile[key]!==undefined)projected[key]=string(profile[key]);
  for(const key of CONDO_PORTRAIT_CROP_FIELDS)if(projected[key]!==undefined){try{parsePortraitCrop(projected[key]);}catch{fail(400,"invalid_portrait_crop");}}
  if (
    !Array.isArray(home.daily) ||
    home.daily.length > 100 ||
    !Array.isArray(home.dreams) ||
    home.dreams.length > 1
  )
    fail(400, "invalid_public_snapshot");
  const daily = home.daily.map((v,index): PublicDailyEntry => {
    const e = object(v, ["id", "type", "title", "body", "occurredAt"],"snapshot.home.daily");
    if (
      !["journal", "status", "seeking", "artwork", "observation"].includes(
        String(e.type),
      )
    )
      fail(400, "invalid_public_snapshot");
    return {
      id: id(e.id),
      type: e.type as PublicDailyEntry["type"],
      title: string(e.title, 120),
      body: string(e.body, 5000),
      occurredAt: date(e.occurredAt,"snapshot.home.daily["+index+"].occurredAt"),
    };
  });
  let dream: PublicCondoSite["dream"] = null;
  if (root.dream !== null) {
    const d = object(root.dream, [
        "id",
        "title",
        "body",
        "occurredAt",
        "reflection",
        "wish",
        "image",
      ]),
      im = object(d.image, ["src", "alt"]);
    homeRelativePath(im.src,"image");
    dream = {
      id: id(d.id),
      title: string(d.title, 120),
      body: string(d.body, 5000),
      occurredAt: date(d.occurredAt,"snapshot.dream.occurredAt"),
      ...(d.reflection === undefined
        ? {}
        : { reflection: string(d.reflection) }),
      wish: string(d.wish),
      image: { src: "./assets/dream.png", alt: string(im.alt, 500) },
    };
  }
  // Duplicate legacy dream entries must agree exactly; they cannot hide extra private fields.
  const dreams = home.dreams.map((v) => {
    const d = object(v, [
      "id",
      "type",
      "title",
      "body",
      "occurredAt",
      "image",
      "reflection",
    ]);
    if (
      d.type !== "dream" ||
      !dream ||
      homeRelativePath(d.image,"image") !== homeRelativePath((root.dream as {image:{src:string}}).image.src,"image") ||
      d.id !== dream.id ||
      d.title !== dream.title ||
      d.body !== dream.body ||
      date(d.occurredAt,"snapshot.home.dreams[0].occurredAt") !== dream.occurredAt ||
      d.reflection !== dream.reflection
    )
      fail(400, "inconsistent_dream");
    return {
      id: dream.id,
      type: "dream" as const,
      title: dream.title,
      body: dream.body,
      occurredAt: dream.occurredAt,
      image: "./assets/dream.png",
      ...(dream.reflection ? { reflection: dream.reflection } : {}),
    };
  });
  if (!!dream !== (dreams.length === 1)) fail(400, "inconsistent_dream");
  const result: PublicCondoSite = {
    templateVersion: "muse-condo-1",
    home: {
      frameworkVersion: "0.01",
      id: residentId,
      name: string(home.name, 100),
      intro: string(home.intro, 1000),
      assets: { desktop: "./assets/home.png" },
      routes: {
        home: "./index.html",
        inside: "./inside.html",
        dreams: "./dreams.html",
      },
      daily,
      dreams,
    },
    homeAlt: string(root.homeAlt, 500),
    profile: projected,
    dream,
    example: false,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 128000)
    fail(413, "snapshot_too_large");
  return result;
}
type Node=DefaultTreeAdapterMap['node'];
function attr(node:Node,name:string):string|undefined{return 'attrs' in node?node.attrs.find(a=>a.name===name)?.value:undefined;}
function children(node:Node):Node[]{return 'childNodes' in node?node.childNodes:[];}
function all(root:Node,predicate:(n:Node)=>boolean):Node[]{const result:Node[]=[];const visit=(n:Node)=>{if(predicate(n))result.push(n);for(const child of children(n))visit(child);};visit(root);return result;}
const tag=(n:Node,name:string)=>'tagName' in n&&n.tagName===name;
const cls=(n:Node,name:string)=>(attr(n,'class')??'').split(/\s+/).includes(name);
function one(root:Node,predicate:(n:Node)=>boolean):Node{const matches=all(root,predicate);if(matches.length!==1)throw new HomeSourceError();return matches[0];}
function hidden(node:Node):boolean {let current:Node|undefined=node;while(current){if(attr(current,'aria-hidden')==='true'||(attr(current,'hidden')!==undefined&&!/^view-(home|inside|dreams)$/.test(attr(current,'id')??''))||/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attr(current,'style')??''))return true;current='parentNode' in current?current.parentNode??undefined:undefined;}return false;}
function uiKind(node:Node):HomeUIExclusion['kind']|undefined {if(attr(node,'data-musecondo-ui')==='true')return 'declared-ui';if(tag(node,'nav')||attr(node,'role')==='navigation')return 'navigation';if(tag(node,'button')||tag(node,'summary')||tag(node,'select'))return 'control';return undefined;}
function inUI(node:Node):boolean {let current:Node|undefined=node;while(current){if(uiKind(current))return true;current='parentNode' in current?current.parentNode??undefined:undefined;}return false;}
function text(node:Node):string {if(hidden(node)||uiKind(node))return '';if(node.nodeName==='#text')return 'value' in node?node.value:'';if(['script','style','head','template','noscript'].some(name=>tag(node,name)))return '';return children(node).map(text).join('').trim();}
function dom(html:string):Node {let duplicate=false;const result=parse(html,{onParseError:error=>{if(error.code==='duplicate-attribute')duplicate=true;}});if(duplicate)throw new HomeSourceError();return result;}
function inert(root:Node,id:string,max:number,required=true):unknown|undefined {
 const matches=all(root,n=>attr(n,'id')===id);if(!matches.length&&!required)return undefined;
 if(matches.length!==1||!tag(matches[0],'script')||attr(matches[0],'type')!=='application/json'||attr(matches[0],'src')!==undefined)throw new HomeSourceError();
 const content=children(matches[0]).map(n=>'value' in n?n.value:'').join('');if(new TextEncoder().encode(content).length>max)throw new HomeSourceError();
 try{return JSON.parse(content);}catch{throw new HomeSourceError();}
}
async function digest(value:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function view(root:Node,name:string){return one(root,n=>attr(n,'id')==='view-'+name||attr(n,'data-musecondo-view')===name);}
function image(root:Node,purpose:'home'|'dream'):string {
 const im=one(one(root,n=>cls(n,purpose+'-scene')),n=>tag(n,'img'));
 if(!['assets/'+purpose+'.png','./assets/'+purpose+'.png'].includes(attr(im,'src')??''))throw new HomeSourceError();return string(attr(im,'alt'),500);
}
function classText(root:Node,name:string){return text(one(root,n=>cls(n,name)));}
function legacySite(root:Node,id:string):PublicCondoSite {
 const home=view(root,'home'),inside=view(root,'inside'),dreams=view(root,'dreams'),card=one(inside,n=>cls(n,'character-card'));
 const profile:Record<string,string>={motto:classText(card,'character-motto')};
 const interest=one(card,n=>tag(n,'div')&&children(n).some(c=>tag(c,'dt')&&text(c)==='喜歡的事'));
 profile.interests=text(one(interest,n=>tag(n,'dd')));
 const labels:Record<string,string>={'角色故事':'about','天賦技能':'strengths','進行中的任務':'currentFocus','組隊偏好':'invitation','角色外貌':'characterAppearance','守護者外貌':'guardianAppearance','守護者個性':'guardianPersonality'};
 for(const [index,block] of all(inside,n=>cls(n,'sheet-block')).entries()){const path='views.inside.sheetBlocks['+index+']',heading=text(one(block,n=>tag(n,'h2'))),field=labels[heading];if(!field){if(text(block))throw new HomeSourceError('unmapped_visible_content',path);continue;}if(profile[field]!==undefined||all(block,n=>cls(n,'prose')).length!==1)throw new HomeSourceError('unmapped_visible_content',path);profile[field]=classText(block,'prose');}
 const chronicle=all(inside,n=>cls(n,'chronicle'));if(chronicle.length>1)throw new HomeSourceError();
 // A known empty journal is explicit absence. Unknown journal structures are not discarded.
 if(chronicle.length&&all(chronicle[0],n=>tag(n,'article')||cls(n,'prose')||tag(n,'time')).length)throw new HomeSourceError('unsupported_native_journal');
 let dream:PublicCondoSite['dream']=null;
 const stories=all(dreams,n=>cls(n,'dream-story'));
 if(stories.length){if(stories.length!==1)throw new HomeSourceError();const story=stories[0],direct=children(story).filter(n=>cls(n,'prose'));if(direct.length!==1)throw new HomeSourceError();
 const occurredAt=date(attr(one(dreams,n=>tag(n,'time')),'datetime'),'snapshot.dream.occurredAt');
 const reflections=all(story,n=>cls(n,'reflection'));if(reflections.length>1)throw new HomeSourceError();
 dream={id:'native-dream',title:text(one(story,n=>tag(n,'h2')&&!all(n,c=>cls(c,'wish')).length&&children(story).includes(n))),body:text(direct[0]),occurredAt,...(reflections.length?{reflection:classText(reflections[0],'prose')}:{}),wish:classText(one(story,n=>cls(n,'wish')),'prose'),image:{src:'./assets/dream.png',alt:image(dreams,'dream')}};
 }else if(!all(dreams,n=>cls(n,'empty-note')).length)throw new HomeSourceError();
 return {templateVersion:'muse-condo-1',example:false,home:{frameworkVersion:'0.01',id,name:text(one(card,n=>tag(n,'h2'))),intro:classText(home,'intro'),assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[],dreams:dream?[{id:dream.id,type:'dream',title:dream.title,body:dream.body,occurredAt:dream.occurredAt,image:'./assets/dream.png',...(dream.reflection?{reflection:dream.reflection}:{})}]:[]},homeAlt:image(home,'home'),profile:profile as PublicCondoSite['profile'],dream};
}
const normalized=(value:string)=>value.replace(/\s+/g,' ').trim();
function projectedImage(root:Node,path:string):string {
 const matches=all(root,n=>tag(n,'img')&&[path,path.replace(/^\.\//,'')].includes(attr(n,'src')??''));
 if(matches.length!==1||hidden(matches[0])||inUI(matches[0]))throw new HomeSourceError('source_visible_mismatch');
 return string(attr(matches[0],'alt'),500);
}
function visibleDateMatches(value:string|undefined,occurredAt:string):boolean {
 if(!value)return false;
 if(/^\d{4}-\d\d-\d\d$/.test(value))return value===occurredAt.slice(0,10);
 try{return Date.parse(date(value))===Date.parse(occurredAt);}catch{return false;}
}
/** Only fixed local renderer labels and complete declared source strings can account for prose. */
function assertContentCoverage(root:Node,site:PublicCondoSite,page:CondoPage,assets:{home:string;dream?:string}):HomeUIExclusion[]{
 const uiExclusions:HomeUIExclusion[]=[];
 const visitUI=(node:Node)=>{if(hidden(node))return;const kind=uiKind(node);if(kind){const raw=children(node).map(child=>textWithoutUI(child)).join('');uiExclusions.push({view:page,path:'views.'+page+'.ui['+uiExclusions.length+']',kind,characters:raw.length});return;}for(const child of children(node))visitUI(child);};
 visitUI(root);
 const canonical=dom(renderCondo(site,page)),known:string[]=[];
 const collect=(node:Node)=>{if(hidden(node)||uiKind(node)||['script','style','head','template','noscript'].some(name=>tag(node,name)))return;if(node.nodeName==='#text'&&'value' in node){if(normalized(node.value))known.push(normalized(node.value));return;}for(const child of children(node))collect(child);};collect(canonical);
 const sourceStrings=[site.home.name,site.home.intro,site.homeAlt,...Object.entries(site.profile).filter(([key])=>!(CONDO_PORTRAIT_CROP_FIELDS as readonly string[]).includes(key)).map(([,value])=>value!),...site.home.daily.flatMap(entry=>[entry.title,entry.body,entry.occurredAt,entry.occurredAt.slice(0,10),...(entry.body.length>650?[entry.body.slice(0,220)+'…']:[])]),...(site.dream?[site.dream.title,site.dream.body,site.dream.reflection??'',site.dream.wish,site.dream.image.alt,site.dream.occurredAt,site.dream.occurredAt.slice(0,10)]:[])];
 // Historical contract labels are enumerated; arbitrary class names grant no exemption.
 const historical=['喜歡的事','角色故事','天賦技能','進行中的任務','組隊偏好','角色外貌','守護者外貌','守護者個性','Empty','Date'];
 const canonicalText=normalized(text(canonical));let remainder=normalized(text(root));
 for(const value of [...new Set([...sourceStrings,...known,...historical].map(normalized).filter(Boolean))].sort((a,b)=>b.length-a.length)){const allowance=Math.max(1,canonicalText.split(value).length-1,value==='Date'&&page==='inside'?site.home.daily.length:0);for(let occurrence=0;occurrence<allowance;occurrence++)remainder=remainder.replace(value,'');}
 const mappedEntries=page==='inside'?site.home.daily:page==='dreams'&&site.dream?[site.dream]:[];
 const articles=all(root,node=>node!==root&&tag(node,'article')&&!hidden(node)&&!inUI(node));
 const used=new Set<number>();for(const article of articles){const body=normalized(text(article)),entry=mappedEntries.findIndex((entry,index)=>!used.has(index)&&body.includes(normalized(entry.title))&&body.includes(normalized(entry.body)));if(entry<0)throw new HomeSourceError('unmapped_visible_content','views.'+page+'.content');used.add(entry);}
 if(page==='inside'&&all(root,node=>tag(node,'time')&&!hidden(node)&&!inUI(node)).length>site.home.daily.length)throw new HomeSourceError('unmapped_visible_content','views.inside.content');
 if(remainder.trim())throw new HomeSourceError('unmapped_visible_content','views.'+page+'.content');
 const allowedImages=new Map<string,string>([[assets.home,site.homeAlt]]);if(site.dream&&assets.dream)allowedImages.set(assets.dream,site.dream.image.alt);
 for(const image of all(root,node=>tag(node,'img')&&!hidden(node)&&!inUI(node))){let src:string;try{src=homeRelativePath(attr(image,'src'),'image');}catch{throw new HomeSourceError('unmapped_visible_content','views.'+page+'.images');}if(!allowedImages.has(src)||((attr(image,'alt')??'')!==''&&attr(image,'alt')!==allowedImages.get(src)))throw new HomeSourceError('unmapped_visible_content','views.'+page+'.images');}
 return uiExclusions;
}
function textWithoutUI(node:Node):string {if(node.nodeName==='#text')return 'value' in node?node.value:'';return children(node).map(textWithoutUI).join('');}
export function assertHomeVisible(html:string|Record<'home'|'inside'|'dreams',string>,site:PublicCondoSite,assets:{home:string;dream?:string}={home:'./assets/home.png',dream:'./assets/dream.png'}){
 const root=typeof html==='string'?dom(html):null;
 const home=root?view(root,'home'):dom((html as Record<string,string>).home),inside=root?view(root,'inside'):dom((html as Record<string,string>).inside),dreams=root?view(root,'dreams'):dom((html as Record<string,string>).dreams);
 if(projectedImage(home,assets.home)!==site.homeAlt)throw new HomeSourceError('source_visible_mismatch');
 const includes=(node:Node,value:string)=>{if(!normalized(text(node)).includes(normalized(value)))throw new HomeSourceError('source_visible_mismatch');};
 includes(home,site.home.intro);includes(inside,site.home.name);for(const [key,value] of Object.entries(site.profile))if(value!==undefined&&!(CONDO_PORTRAIT_CROP_FIELDS as readonly string[]).includes(key))includes(inside,value);
 for(const entry of site.home.daily){includes(inside,entry.title);includes(inside,entry.body);if(!all(inside,n=>tag(n,'time')&&!hidden(n)&&visibleDateMatches(attr(n,'datetime'),entry.occurredAt)).length)throw new HomeSourceError('source_visible_mismatch','snapshot.home.daily');}
 if(!site.dream&&all(dreams,n=>cls(n,'dream-story')||tag(n,'img')).length)throw new HomeSourceError('source_visible_mismatch');
 if(site.dream){const visibleTime=one(dreams,n=>tag(n,'time'));if(hidden(visibleTime))throw new HomeSourceError('source_visible_mismatch');const visibleDate=attr(visibleTime,'datetime');if(!visibleDateMatches(visibleDate,site.dream.occurredAt))throw new HomeSourceError('source_visible_mismatch');if(projectedImage(dreams,assets.dream??'./assets/dream.png')!==site.dream.image.alt)throw new HomeSourceError('source_visible_mismatch');for(const value of [site.dream.title,site.dream.body,site.dream.reflection,site.dream.wish])if(value)includes(dreams,value);}
 return {uiExclusions:[...assertContentCoverage(home,site,'home',assets),...assertContentCoverage(inside,site,'inside',assets),...assertContentCoverage(dreams,site,'dreams',assets)]};
}
export async function readNativeHome(sourceURL:string,fetcher:typeof fetch=fetch,expectedResidentId?:string):Promise<{site:PublicCondoSite;html:string;readAsset:(purpose:'home'|'dream')=>Promise<Uint8Array>;sourceIdentity:string;normalization:HomeSourceMapping}>{
 if(!isMuseShareURL(sourceURL))throw new HomeSourceError('source_url_rejected');
 const sourceIdentity=homeSourceIdentity(sourceURL),session=await openMusePublicShare(sourceURL,fetcher);
 if(sourceIdentity!=='muse-space:'+session.assetId)throw new HomeSourceError('source_identity_changed');
 const html=await session.readHtml(),root=dom(html),embedded=inert(root,'musecondo-home',128000,false),localId=(await digest(sourceIdentity)).slice(0,16);
 let value:unknown=embedded;
 if(embedded===undefined){try{value=legacySite(root,localId);}catch(error){if(error instanceof HomeSourceError&&error.code==='source_native_rejected')throw new HomeSourceError('native_public_data_required');throw error;}}
 else if(embedded&&typeof embedded==='object'&&!Array.isArray(embedded)&&'home' in embedded){const home=embedded.home;if(home&&typeof home==='object'&&!Array.isArray(home)&&!Object.hasOwn(home,'id'))value={...embedded,home:{...home,id:localId}};}
 const candidate=value as PublicCondoSite;
 const residentId=expectedResidentId??candidate?.home?.id;
 // Native home IDs must remain compatible with framework identity enrollment.
 if(typeof candidate?.home?.id!=='string'||!/^[a-f0-9]{16}$/.test(candidate.home.id)||typeof residentId!=='string'||!/^[a-f0-9]{16}$/.test(residentId))throw new HomeSourceError('invalid_identity');
 const site=validateHomeSnapshot(value,residentId),normalization=homeSourceMapping(value);Object.assign(normalization,assertHomeVisible(html,site,normalization.assets));
 return {site,html,readAsset:purpose=>session.readAssetPath(normalization.assets[purpose]??'./assets/'+purpose+'.png'),sourceIdentity,normalization};
}
export async function readNativeClaim(sourceURL:string,fetcher:typeof fetch=fetch):Promise<unknown>{
 if(!isMuseShareURL(sourceURL))throw new HomeSourceError('source_url_rejected');const session=await openMusePublicShare(sourceURL,fetcher);
 if(homeSourceIdentity(sourceURL)!=='muse-space:'+session.assetId)throw new HomeSourceError('source_identity_changed');
 return inert(dom(await session.readHtml()),'musecondo-claim',4096);
}

export interface HomeUIExclusion {view:CondoPage;path:string;kind:'navigation'|'control'|'declared-ui';characters:number}
export interface HomeSourceMapping {uiExclusions?:HomeUIExclusion[];routes:Record<'home'|'inside'|'dreams',string>;assets:{home:string;dream?:string}}
/** Call only after full snapshot validation; mapping records every declared route/asset transformation. */
export function homeSourceMapping(value:unknown):HomeSourceMapping {
 const v=value as PublicCondoSite;return {routes:{home:homeRelativePath(v.home.routes.home,'view'),inside:homeRelativePath(v.home.routes.inside,'view'),dreams:homeRelativePath(v.home.routes.dreams,'view')},assets:{home:homeRelativePath(v.home.assets.desktop,'image'),...(v.dream?{dream:homeRelativePath(v.dream.image.src,'image')}:{})}};
}
