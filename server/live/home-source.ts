import {parse, type DefaultTreeAdapterMap} from 'parse5';
import {openMusePublicShare,parseMuseShareURL} from './muse-public-share.ts';
import {towerSourceURL} from './tower-source-url.ts';
import {CONDO_ALL_PROFILE_FIELDS,CONDO_PROFILE_FIELDS,CONDO_OPTIONAL_PROFILE_FIELDS,CONDO_PORTRAIT_CROP_FIELDS,parsePortraitCrop,type PublicCondoSite} from '../../src/framework/condo.ts';
import type {PublicDailyEntry} from '../../src/framework/types.ts';

export class HomeSourceError extends Error {readonly code:string;constructor(code='source_native_rejected'){super(code);this.name='HomeSourceError';this.code=code;}}
function fail(_status:number,code:string):never {throw new HomeSourceError(code);}
export function isMuseShareURL(value:unknown):boolean {try{const input=parseMuseShareURL(value);return /-([a-z0-9]{3,26})$/.test(input.slug);}catch{return false;}}
export function homeSourceURL(value:unknown):URL {if(isMuseShareURL(value))return new URL(value as string);return towerSourceURL(value);}
export function homeSourceIdentity(value:unknown):string {if(isMuseShareURL(value)){const input=parseMuseShareURL(value);return 'muse-space:'+/-([a-z0-9]{3,26})$/.exec(input.slug)![1];}return towerSourceURL(value).href;}
function object(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail(400, "invalid_public_snapshot");
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
function date(v: unknown) {
  const s = string(v, 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(s) || !Number.isFinite(Date.parse(s)))
    fail(400, "invalid_public_snapshot");
  return s;
}
function validateSnapshot(
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
  if (assets.desktop !== "./assets/home.png") fail(400, "invalid_image_source");
  const routes = object(home.routes, ["home", "inside", "dreams"]);
  if (
    routes.home !== "./index.html" ||
    routes.inside !== "./inside.html" ||
    routes.dreams !== "./dreams.html"
  )
    fail(400, "unsupported_public_snapshot");
  const profile = object(root.profile, CONDO_ALL_PROFILE_FIELDS),
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
  const daily = home.daily.map((v): PublicDailyEntry => {
    const e = object(v, ["id", "type", "title", "body", "occurredAt"]);
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
      occurredAt: date(e.occurredAt),
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
    if (im.src !== "./assets/dream.png") fail(400, "invalid_image_source");
    dream = {
      id: id(d.id),
      title: string(d.title, 120),
      body: string(d.body, 5000),
      occurredAt: date(d.occurredAt),
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
      d.image !== "./assets/dream.png" ||
      !dream ||
      d.id !== dream.id ||
      d.title !== dream.title ||
      d.body !== dream.body ||
      d.occurredAt !== dream.occurredAt ||
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
function text(node:Node):string {if(hidden(node))return '';if(node.nodeName==='#text')return 'value' in node?node.value:'';if(tag(node,'script')||tag(node,'style'))return '';return children(node).map(text).join('').trim();}
function dom(html:string):Node {let duplicate=false;const result=parse(html,{onParseError:error=>{if(error.code==='duplicate-attribute')duplicate=true;}});if(duplicate)throw new HomeSourceError();return result;}
function inert(root:Node,id:string,max:number,required=true):unknown|undefined {
 const matches=all(root,n=>attr(n,'id')===id);if(!matches.length&&!required)return undefined;
 if(matches.length!==1||!tag(matches[0],'script')||attr(matches[0],'type')!=='application/json'||attr(matches[0],'src')!==undefined)throw new HomeSourceError();
 const content=children(matches[0]).map(n=>'value' in n?n.value:'').join('');if(new TextEncoder().encode(content).length>max)throw new HomeSourceError();
 try{return JSON.parse(content);}catch{throw new HomeSourceError();}
}
async function digest(value:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function view(root:Node,name:string){return one(root,n=>attr(n,'id')==='view-'+name);}
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
 for(const block of all(inside,n=>cls(n,'sheet-block'))){const heading=text(one(block,n=>tag(n,'h2'))),field=labels[heading];if(!field){if(all(block,n=>cls(n,'prose')).length)throw new HomeSourceError();continue;}if(profile[field]!==undefined)throw new HomeSourceError();profile[field]=classText(block,'prose');}
 const chronicle=all(inside,n=>cls(n,'chronicle'));if(chronicle.length>1)throw new HomeSourceError();
 // A known empty journal is explicit absence. Unknown journal structures are not discarded.
 if(chronicle.length&&all(chronicle[0],n=>tag(n,'article')||cls(n,'prose')||tag(n,'time')).length)throw new HomeSourceError('unsupported_native_journal');
 let dream:PublicCondoSite['dream']=null;
 const stories=all(dreams,n=>cls(n,'dream-story'));
 if(stories.length){if(stories.length!==1)throw new HomeSourceError();const story=stories[0],direct=children(story).filter(n=>cls(n,'prose'));if(direct.length!==1)throw new HomeSourceError();
 const time=attr(one(dreams,n=>tag(n,'time')),'datetime');let occurredAt:string;
 if(time&&/^\d{4}-\d\d-\d\d$/.test(time)){occurredAt=time+'T00:00:00.000Z';if(new Date(occurredAt).toISOString().slice(0,10)!==time)throw new HomeSourceError();}else occurredAt=date(time);
 const reflections=all(story,n=>cls(n,'reflection'));if(reflections.length>1)throw new HomeSourceError();
 dream={id:'native-dream',title:text(one(story,n=>tag(n,'h2')&&!all(n,c=>cls(c,'wish')).length&&children(story).includes(n))),body:text(direct[0]),occurredAt,...(reflections.length?{reflection:classText(reflections[0],'prose')}:{}),wish:classText(one(story,n=>cls(n,'wish')),'prose'),image:{src:'./assets/dream.png',alt:image(dreams,'dream')}};
 }else if(!all(dreams,n=>cls(n,'empty-note')).length)throw new HomeSourceError();
 return {templateVersion:'muse-condo-1',example:false,home:{frameworkVersion:'0.01',id,name:text(one(card,n=>tag(n,'h2'))),intro:classText(home,'intro'),assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[],dreams:dream?[{id:dream.id,type:'dream',title:dream.title,body:dream.body,occurredAt:dream.occurredAt,image:'./assets/dream.png',...(dream.reflection?{reflection:dream.reflection}:{})}]:[]},homeAlt:image(home,'home'),profile:profile as PublicCondoSite['profile'],dream};
}
const normalized=(value:string)=>value.replace(/\s+/g,' ').trim();
function assertVisible(root:Node,site:PublicCondoSite){
 const home=view(root,'home'),inside=view(root,'inside'),dreams=view(root,'dreams');
 if(image(home,'home')!==site.homeAlt)throw new HomeSourceError('source_visible_mismatch');
 const includes=(node:Node,value:string)=>{if(!normalized(text(node)).includes(normalized(value)))throw new HomeSourceError('source_visible_mismatch');};
 includes(home,site.home.intro);includes(inside,site.home.name);for(const [key,value] of Object.entries(site.profile))if(value!==undefined&&!(CONDO_PORTRAIT_CROP_FIELDS as readonly string[]).includes(key))includes(inside,value);
 for(const entry of site.home.daily){includes(inside,entry.title);includes(inside,entry.body);}
 if(!site.dream&&all(dreams,n=>cls(n,'dream-story')||tag(n,'img')).length)throw new HomeSourceError('source_visible_mismatch');
 if(site.dream){const visibleDate=attr(one(dreams,n=>tag(n,'time')),'datetime');if(!visibleDate||Date.parse(visibleDate)!==Date.parse(site.dream.occurredAt))throw new HomeSourceError('source_visible_mismatch');if(image(dreams,'dream')!==site.dream.image.alt)throw new HomeSourceError('source_visible_mismatch');for(const value of [site.dream.title,site.dream.body,site.dream.reflection,site.dream.wish])if(value)includes(dreams,value);}
}
export async function readNativeHome(sourceURL:string,fetcher:typeof fetch=fetch,expectedResidentId?:string):Promise<{site:PublicCondoSite;html:string;readAsset:(purpose:'home'|'dream')=>Promise<Uint8Array>;sourceIdentity:string}>{
 if(!isMuseShareURL(sourceURL))throw new HomeSourceError('source_url_rejected');
 const sourceIdentity=homeSourceIdentity(sourceURL),session=await openMusePublicShare(sourceURL,fetcher);
 if(sourceIdentity!=='muse-space:'+session.assetId)throw new HomeSourceError('source_identity_changed');
 const html=await session.readHtml(),root=dom(html),embedded=inert(root,'musecondo-home',128000,false),localId=(await digest(sourceIdentity)).slice(0,16);
 let value:unknown=embedded;
 if(embedded===undefined)value=legacySite(root,localId);
 else if(embedded&&typeof embedded==='object'&&!Array.isArray(embedded)&&'home' in embedded){const home=embedded.home;if(home&&typeof home==='object'&&!Array.isArray(home)&&!Object.hasOwn(home,'id'))value={...embedded,home:{...home,id:localId}};}
 const candidate=value as PublicCondoSite;
 const residentId=expectedResidentId??candidate?.home?.id;
 if(typeof residentId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(residentId))throw new HomeSourceError('invalid_identity');
 const site=validateSnapshot(value,residentId);assertVisible(root,site);
 return {site,html,readAsset:purpose=>session.readAsset(purpose),sourceIdentity};
}
export async function readNativeClaim(sourceURL:string,fetcher:typeof fetch=fetch):Promise<unknown>{
 if(!isMuseShareURL(sourceURL))throw new HomeSourceError('source_url_rejected');const session=await openMusePublicShare(sourceURL,fetcher);
 if(homeSourceIdentity(sourceURL)!=='muse-space:'+session.assetId)throw new HomeSourceError('source_identity_changed');
 return inert(dom(await session.readHtml()),'musecondo-claim',4096);
}
