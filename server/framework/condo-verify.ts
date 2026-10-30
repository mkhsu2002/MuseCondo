import {validatePNG} from '../live/png.ts';
import {CONDO_PROFILE_FIELDS,type PublicCondoSite} from '../../src/framework/condo.ts';
import {renderCondo} from '../../src/framework/condo-render.ts';
import {frameworkObject} from '../../src/framework/validation.ts';
function checkManifest(value:unknown,expectedId?:string){
 const site=frameworkObject(value,['templateVersion','home','homeAlt','profile','dream','example'],'public site');
 if(site.templateVersion!=='muse-condo-1'||typeof site.example!=='boolean'||typeof site.homeAlt!=='string')throw Error('公開資料格式不符');
 const home=frameworkObject(site.home,['frameworkVersion','id','name','intro','assets','routes','daily','dreams'],'public home');
 if(home.frameworkVersion!=='0.01'||typeof home.id!=='string'||!/^[a-f0-9]{16}$/.test(home.id)||typeof home.name!=='string'||typeof home.intro!=='string')throw Error('住所識別格式不符');
 if(expectedId&&home.id!==expectedId)throw Error('線上住所識別與本次建置不符');
 const assets=frameworkObject(home.assets,['desktop'],'public assets');if(assets.desktop!=='./assets/home.png')throw Error('住所圖片路徑不符');
 const routes=frameworkObject(home.routes,['home','inside','dreams'],'public routes');for(const [key,path] of Object.entries({home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'}))if(routes[key]!==path)throw Error('三頁路徑不符');
 const profile=frameworkObject(site.profile,CONDO_PROFILE_FIELDS,'public profile');if(CONDO_PROFILE_FIELDS.some(key=>typeof profile[key]!=='string'))throw Error('角色欄位不完整');
 for(const key of ['daily','dreams'] as const){const entries=home[key];if(!Array.isArray(entries)||entries.length>100)throw Error('公開內容格式不符');for(const entry of entries){const item=frameworkObject(entry,['id','type','title','body','occurredAt',...(key==='dreams'?['image','reflection']:[])],'public entry');if(Object.values(item).some(value=>typeof value!=='string'))throw Error('公開內容不可含私密物件');}}
 if(site.dream!==null){
  const dream=frameworkObject(site.dream,['id','title','body','occurredAt','reflection','wish','image'],'public dream');
  if(['id','title','body','occurredAt','wish'].some(key=>typeof dream[key]!=='string'))throw Error('夢與願望不完整');
  const image=frameworkObject(dream.image,['src','alt'],'public dream image');if(image.src!=='./assets/dream.png'||typeof image.alt!=='string')throw Error('夢圖路徑不符');
 }
 return {id:home.id,dream:site.dream!==null,site:value as PublicCondoSite};
}
/** Readback only: HTTP success is not proof of authorship, visual meaning or subsequent maintenance. */
export async function verifyCondoURL(value:string,options:{expectedId?:string}={}){
 const base=new URL(value);if(base.username||base.password||base.search||base.hash||!(base.protocol==='https:'||(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))throw Error('請使用無憑證與參數的 HTTPS 住所根網址，或本機測試網址');
 if(!base.pathname.endsWith('/'))throw Error('請提供以 / 結尾的住所根網址，不是單一 HTML 網址');
 if(options.expectedId&&!/^[a-f0-9]{16}$/.test(options.expectedId))throw Error('住所識別格式不符');
 async function fetchBytes(path:string,mime:string,max:number){
  let url=new URL(path,base),response:Response|undefined;
  for(let redirects=0;redirects<6;redirects++){
   if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw Error('網站導向離開住所範圍');
   response=await fetch(url,{redirect:'manual',headers:{'User-Agent':'MuseCondo-Verification/1.0','Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)});
   if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw Error('網站導向無效');url=new URL(next,url);continue;}break;
  }
  if(!response?.ok||!response.headers.get('content-type')?.includes(mime))throw Error(`網址尚未提供正確的 ${path}`);
  const reader=response.body?.getReader();if(!reader)throw Error('網站回應為空');let size=0;const parts:Uint8Array[]=[];
  for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>max){await reader.cancel();throw Error('網站回應超過驗證上限');}parts.push(item.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
 }
 const manifest=checkManifest(JSON.parse(new TextDecoder().decode(await fetchBytes('condo.json','application/json',100000))),options.expectedId);
 const pages:string[]=[];
 for(const [file,kind] of [['index.html','home'],['inside.html','inside'],['dreams.html','dreams']] as const){
  const html=new TextDecoder().decode(await fetchBytes(file,'text/html',200000));
  if(!html.includes(`class="page-${kind}"`)||/<script\b|<base\b|http-equiv=["']?refresh/i.test(html))throw Error('三頁內容未正確部署或含非模板執行內容');
  if(html.replace(/\r\n/g,'\n').trim()!==renderCondo(manifest.site,kind).trim())throw Error('線上HTML與公開資料版本不一致，尚未完成更新或撤回');
  if((html.match(/<h1[ >]/g)||[]).length!==1)throw Error('頁面標題不完整');pages.push(new URL(file,base).href);
 }
 await fetchBytes('assets/condo.css','text/css',100000);
 for(const kind of manifest.dream?['home','dream']:['home']){const size=await validatePNG(await fetchBytes(`assets/${kind}.png`,'image/png',8*1024*1024));if(kind==='home'?Math.abs(size.width/size.height/(16/9)-1)>=0.01:size.width!==size.height)throw Error('線上圖片比例不符');}
 if(!manifest.dream){try{const response=await fetch(new URL('assets/dream.png',base),{redirect:'manual',headers:{'User-Agent':'MuseCondo-Verification/1.0'},signal:AbortSignal.timeout(20000)});if(response.status>=300&&response.status<400){await response.body?.cancel();throw Error('夢圖仍有導向，無法證明已撤回');}if(response.ok&&response.headers.get('content-type')?.includes('image/png')){await response.body?.cancel();throw Error('已收起的夢圖仍可公開取得');}await response.body?.cancel();}catch(error){if(error instanceof Error&&error.message.includes('夢圖仍'))throw error;throw Error('無法核對已收起的夢圖');}}
 return {httpVerified:true,homeId:manifest.id,pages,images:manifest.dream?2:1,homeComplete:false,next:'仍須確認真實來源、圖片內容與 Agent 再次更新及撤回結果'};
}
