const appearanceStorageKey='musecondo.tower-decoration',sceneStorageKey='musecondo.tower-scene';
import {lobbyThemeCSS,validateLobbyTheme,type LobbyThemeManifest} from '../shared/lobby-theme.ts';
import {towerScenes,type TowerScene} from '../shared/tower-scenes.ts';
export {towerScenes,appearanceControls,type TowerScene} from '../shared/tower-scenes.ts';
const bindings=new WeakMap<HTMLElement,()=>void>();
export function disposeTowerAppearance(root:HTMLElement){bindings.get(root)?.();}
interface Presentation {version:1;id:string;revision:number;manifest:LobbyThemeManifest}
interface Projection {generation:string;images:{day:string;night:string};endsAt:number;presentation:Presentation|null}
async function projection(value:unknown,now:number):Promise<Projection|null>{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>,images=v.images as Record<string,unknown>|undefined;
 if(v.theme!=='halloween'||typeof v.generation!=='string'||!/^manager-\d{4}-\d{2}-\d{2}-r[01]$/.test(v.generation)||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||typeof v.endsAt!=='string'||!images)return null;
 const endsAt=Date.parse(v.endsAt);if(!Number.isFinite(endsAt)||endsAt<=now||endsAt-now>7*86400000)return null;
 const path=`/api/v1/tower/appearance/assets/${v.generation}`;
 if(images.day!==`${path}/day.png`||images.night!==`${path}/night.png`)return null;
 let presentation:Presentation|null=null;
 if(v.presentation!==undefined){
  const p=v.presentation as Record<string,unknown>|null;
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==4||!['version','id','revision','manifest'].every(k=>Object.hasOwn(p,k))||p.version!==1||typeof p.id!=='string'||!/^[a-f0-9]{64}$/.test(p.id)||!Number.isSafeInteger(p.revision)||Number(p.revision)<1)return null;
  try{
   const manifest=validateLobbyTheme(p.manifest);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(manifest))))).map(x=>x.toString(16).padStart(2,'0')).join('');
   if(hash!==p.id)return null;
   presentation={version:1,id:p.id,revision:Number(p.revision),manifest};
  }catch{return null;}
 }
 return {generation:v.generation,images:{day:images.day as string,night:images.night as string},endsAt,presentation};
}
async function loadImage(src:string){
 const next=new Image();await new Promise<void>((resolve,reject)=>{
  const finish=(error?:Error)=>{clearTimeout(timer);next.onload=null;next.onerror=null;if(error)reject(error);else resolve();};
  const timer=setTimeout(()=>finish(Error('image_load_timeout')),15000);
  next.onload=()=>finish();next.onerror=()=>finish(Error('image_load_failed'));next.src=src;
  if(next.complete&&next.naturalWidth>0)finish();
 });
}
/** Only a verified activated pair supplies scene URLs. Scene and appearance share one image owner. */
export async function bindTowerAppearance(root:HTMLElement,base:string,fetcher:typeof fetch=fetch,clock:()=>number=Date.now,preload:(src:string)=>Promise<void>=loadImage):Promise<()=>void>{
 disposeTowerAppearance(root);
 const panorama=root.querySelector<HTMLElement>('[data-tower-panorama]');if(!panorama)return ()=>{};
 const lobby=root.querySelector<HTMLElement>('[data-tower-lobby]');let style:HTMLStyleElement|undefined;
 const image=panorama.querySelector<HTMLImageElement>('img'),button=panorama.querySelector<HTMLButtonElement>('[data-appearance-toggle]');
 if(!image||!button)return ()=>{};
 const caption=panorama.querySelector<HTMLElement>('[data-scene-caption]'),status=panorama.querySelector<HTMLElement>('[role=status]');
 const sceneButtons=Array.from(panorama.querySelectorAll<HTMLButtonElement>('[data-tower-scene]'));
 let active:Projection|null=null,enabled=true,disposed=false,selection=0,timer:ReturnType<typeof setTimeout>|undefined;
 const scene=():TowerScene=>panorama.dataset.scene==='night'?'night':'day';
 const original=(value:TowerScene)=>`${base}/tower/muse-tower-${value}-v2.webp`;
 const source=(value:TowerScene)=>active&&enabled&&active.endsAt>clock()?`${base}${active.images[value]}`:original(value);
 function controls(show:boolean){panorama!.dataset.theme=show?'halloween':'standard';button!.hidden=!active||active.endsAt<=clock();button!.textContent=show?'一般外觀':'顯示節慶外觀';}
 function clearPresentation(){
  style?.remove();style=undefined;
  if(lobby){delete lobby.dataset.presentation;delete lobby.dataset.presentationScene;}
 }
 function applyPresentation(value:TowerScene,show:boolean){
  if(!show||!active?.presentation||!lobby){clearPresentation();return;}
  const css=lobbyThemeCSS(active.presentation.manifest,value);
  if(!style){style=lobby.ownerDocument.createElement('style');style.setAttribute('data-lobby-presentation',active.presentation.id);lobby.prepend(style);}
  style.textContent=css;lobby.dataset.presentation=active.presentation.id;lobby.dataset.presentationScene=value;
 }
 function commit(value:TowerScene,src:string,announce:boolean){
  // No await separates the preloaded image and its validated whole-page presentation.
  applyPresentation(value,src!==original(value));
  image!.src=src;image!.alt=towerScenes[value].alt;panorama!.dataset.scene=value;
  if(caption)caption.textContent=`Muse Tower 外觀想像 · ${towerScenes[value].label}`;
  for(const control of sceneButtons)control.setAttribute('aria-pressed',String(control.dataset.towerScene===value));
  if(status)status.textContent=announce?`已切換為${towerScenes[value].label}。`:'';
  controls(src!==original(value));
 }
 function fallback(){active=null;selection++;if(timer)clearTimeout(timer);commit(scene(),original(scene()),false);}
 async function show(value:TowerScene,announce=false){
  const current=++selection,src=source(value);if(status&&announce)status.textContent=`正在換成${towerScenes[value].label}…`;
  try{
   await preload(src);if(current!==selection||disposed||!panorama!.isConnected)return;
   // The mandate can expire while the image is loading.
   if(src!==source(value)){commit(value,original(value),announce);return;}
   commit(value,src,announce);
   try{localStorage.setItem(sceneStorageKey,value);}catch{/* Optional local preference. */}
  }catch{
   if(current!==selection||disposed)return;
   if(src!==original(value)){fallback();return;}
   if(status)status.textContent='景色暫時無法載入，請再試一次。';
  }
 }
 const sceneListeners=sceneButtons.map(control=>{const listener=()=>show(control.dataset.towerScene==='night'?'night':'day',true);control.addEventListener('click',listener);return {control,listener};});
 const toggle=async()=>{enabled=!enabled;try{localStorage.setItem(appearanceStorageKey,enabled?'on':'off');}catch{/* Optional local preference. */}if(!enabled){selection++;commit(scene(),original(scene()),false);}else await show(scene());};
 const imageError=()=>{if(active&&enabled)fallback();};
 button.addEventListener('click',toggle);image.addEventListener('error',imageError);controls(false);
 const cleanup=()=>{if(disposed)return;disposed=true;selection++;if(timer)clearTimeout(timer);active=null;commit(scene(),original(scene()),false);button.removeEventListener('click',toggle);image.removeEventListener('error',imageError);for(const {control,listener} of sceneListeners)control.removeEventListener('click',listener);if(bindings.get(root)===cleanup)bindings.delete(root);};
 bindings.set(root,cleanup);
 try{
  const response=await fetcher(`${base}/api/v1/tower/appearance`,{credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(4000)});
  if(!response.ok)return cleanup;const candidate=await projection(await response.json(),clock());if(!candidate||candidate.presentation&&!lobby)return cleanup;
  try{enabled=localStorage.getItem(appearanceStorageKey)!=='off';}catch{/* Optional local preference. */}
  // Both scenes must load before either scene is presented as the active exterior.
  await Promise.all([preload(`${base}${candidate.images.day}`),preload(`${base}${candidate.images.night}`)]);
  if(disposed||candidate.endsAt<=clock())return cleanup;
  active=candidate;await show(scene());if(active)timer=setTimeout(fallback,Math.min(candidate.endsAt-clock(),2147483647));
 }catch{fallback();}
 return cleanup;
}
