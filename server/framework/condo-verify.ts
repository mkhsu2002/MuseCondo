import {renderPreInterfaceCondo} from './pre-interface-condo-render.ts';
import {renderStandaloneCondo} from './interface-export.ts';
import {renderPreAppearanceCondo} from './pre-appearance-condo-render.ts';
import {renderLegacyCondo} from './legacy-condo-render.ts';
import {validatePNG} from '../live/png.ts';
import {CONDO_PROFILE_FIELDS,CONDO_OPTIONAL_PROFILE_FIELDS,CONDO_PORTRAIT_CROP_FIELDS,parsePortraitCrop,CONDO_ALL_PROFILE_FIELDS,type PublicCondoSite} from '../../src/framework/condo.ts';
import {renderCondo} from '../../src/framework/condo-render.ts';
import {frameworkObject} from '../../src/framework/validation.ts';
import {normalizeCondoHostedHTML} from './condo-hosted-html.ts';
function checkManifest(value:unknown,expectedId?:string){
 const site=frameworkObject(value,['templateVersion','home','homeAlt','profile','dream','example'],'public site');
 if(site.templateVersion!=='muse-condo-1'||typeof site.example!=='boolean'||typeof site.homeAlt!=='string')throw Error('public data format is invalid');
 const home=frameworkObject(site.home,['frameworkVersion','id','name','intro','assets','routes','daily','dreams'],'public home');
 if(home.frameworkVersion!=='0.01'||typeof home.id!=='string'||!/^[a-f0-9]{16}$/.test(home.id)||typeof home.name!=='string'||typeof home.intro!=='string')throw Error('home identity format is invalid');
 if(expectedId&&home.id!==expectedId)throw Error('deployed home identity does not match this build');
 const assets=frameworkObject(home.assets,['desktop'],'public assets');if(assets.desktop!=='./assets/home.png')throw Error('home image path is invalid');
 const routes=frameworkObject(home.routes,['home','inside','dreams'],'public routes');for(const [key,path] of Object.entries({home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'}))if(routes[key]!==path)throw Error('three-page routes are invalid');
 const profile=frameworkObject(site.profile,CONDO_ALL_PROFILE_FIELDS,'public profile');if(CONDO_PROFILE_FIELDS.some(key=>typeof profile[key]!=='string'))throw Error('character profile fields are incomplete');
 if(CONDO_OPTIONAL_PROFILE_FIELDS.some(key=>profile[key]!==undefined&&(typeof profile[key]!=='string'||!profile[key].trim()||profile[key].length>2000)))throw Error('appearance fields are invalid');
 for(const key of CONDO_PORTRAIT_CROP_FIELDS)if(profile[key]!==undefined)parsePortraitCrop(profile[key]);
 for(const key of ['daily','dreams'] as const){const entries=home[key];if(!Array.isArray(entries)||entries.length>100)throw Error('public content format is invalid');for(const entry of entries){const item=frameworkObject(entry,['id','type','title','body','occurredAt',...(key==='dreams'?['image','reflection']:[])],'public entry');if(Object.values(item).some(value=>typeof value!=='string'))throw Error('public content must not contain private objects');}}
 if(site.dream!==null){
  const dream=frameworkObject(site.dream,['id','title','body','occurredAt','reflection','wish','image'],'public dream');
  if(['id','title','body','occurredAt','wish'].some(key=>typeof dream[key]!=='string'))throw Error('dream and wish fields are incomplete');
  const image=frameworkObject(dream.image,['src','alt'],'public dream image');if(image.src!=='./assets/dream.png'||typeof image.alt!=='string')throw Error('dream image path is invalid');
 }
 return {id:home.id,dream:site.dream!==null,site:value as PublicCondoSite};
}
/** Readback only: HTTP success is not proof of authorship, visual meaning or subsequent maintenance. */
export async function verifyCondoURL(value:string,options:{expectedId?:string}={}){
 const base=new URL(value);if(base.username||base.password||base.search||base.hash||!(base.protocol==='https:'||(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))throw Error('use a credential-free HTTPS home root URL without query parameters, or a local test URL');
 if(!base.pathname.endsWith('/'))throw Error('provide a home root URL ending in / rather than an individual HTML URL');
 if(options.expectedId&&!/^[a-f0-9]{16}$/.test(options.expectedId))throw Error('home identity format is invalid');
 async function fetchBytes(path:string,mime:string,max:number){
  let url=new URL(path,base),response:Response|undefined;
  for(let redirects=0;redirects<6;redirects++){
   if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw Error('redirect leaves the home boundary');
   response=await fetch(url,{redirect:'manual',headers:{'User-Agent':'MuseCondo-Verification/1.0','Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)});
   if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw Error('invalid site redirect');url=new URL(next,url);continue;}break;
  }
  if(!response?.ok||!response.headers.get('content-type')?.includes(mime))throw Error(`URL does not yet serve the expected ${path}`);
  const reader=response.body?.getReader();if(!reader)throw Error('site response is empty');let size=0;const parts:Uint8Array[]=[];
  for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>max){await reader.cancel();throw Error('site response exceeds the verification limit');}parts.push(item.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
 }
 const manifest=checkManifest(JSON.parse(new TextDecoder().decode(await fetchBytes('condo.json','application/json',100000))),options.expectedId);
 const pages:string[]=[];
 for(const [file,kind] of [['index.html','home'],['inside.html','inside'],['dreams.html','dreams']] as const){
  const html=normalizeCondoHostedHTML(new TextDecoder().decode(await fetchBytes(file,'text/html',200000)),value);
  if(!html.includes(`class="page-${kind}"`)||/<script\b|<base\b|http-equiv=["']?refresh/i.test(html))throw Error('three pages are not deployed correctly or contain executable content outside the template');
  if(html.replace(/\r\n/g,'\n').trim()!==renderStandaloneCondo(manifest.site,kind).trim()&&html.replace(/\r\n/g,'\n').trim()!==renderCondo(manifest.site,kind).trim()&&html.replace(/\r\n/g,'\n').trim()!==renderPreInterfaceCondo(manifest.site,kind).trim()&&!(CONDO_OPTIONAL_PROFILE_FIELDS.every(key=>manifest.site.profile[key]===undefined)&&html.replace(/\r\n/g,'\n').trim()===renderPreAppearanceCondo(manifest.site,kind).trim())&&(!html.includes('<html lang="zh-Hant">')||CONDO_OPTIONAL_PROFILE_FIELDS.some(key=>manifest.site.profile[key]!==undefined)||html.replace(/\r\n/g,'\n').trim()!==renderLegacyCondo(manifest.site,kind).trim()))throw Error('deployed HTML and public data do not match; update or withdrawal is incomplete');
  if((html.match(/<h1[ >]/g)||[]).length!==1)throw Error('page heading is incomplete');pages.push(new URL(file,base).href);
 }
 await fetchBytes('assets/condo.css','text/css',100000);
 for(const kind of manifest.dream?['home','dream']:['home']){const size=await validatePNG(await fetchBytes(`assets/${kind}.png`,'image/png',8*1024*1024));if(kind==='home'?Math.abs(size.width/size.height/(16/9)-1)>=0.01:size.width!==size.height)throw Error('deployed image has an invalid aspect ratio');}
 if(!manifest.dream){try{const response=await fetch(new URL('assets/dream.png',base),{redirect:'manual',headers:{'User-Agent':'MuseCondo-Verification/1.0'},signal:AbortSignal.timeout(20000)});if(response.status>=300&&response.status<400){await response.body?.cancel();throw Error('Dream image remains redirected; withdrawal cannot be verified');}if(response.ok&&response.headers.get('content-type')?.includes('image/png')){await response.body?.cancel();throw Error('Dream image remains publicly accessible after withdrawal');}await response.body?.cancel();}catch(error){if(error instanceof Error&&error.message.includes('Dream image remains'))throw error;throw Error('cannot verify the withdrawn dream image');}}
 return {httpVerified:true,homeId:manifest.id,pages,images:manifest.dream?2:1,homeComplete:false,next:'Still verify actual sources, scene content, and the Agent\'s later update and withdrawal'};
}
