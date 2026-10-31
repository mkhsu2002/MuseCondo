const appearanceStorageKey='musecondo.tower-decoration',sceneStorageKey='musecondo.tower-scene';
export type TowerScene='day'|'night';
export const towerScenes={
 day:{label:'日景',alt:'白晝的 Muse Tower 局部立面，窗與花園平台向畫面外延伸，遠處是雲霧與虛空。'},
 night:{label:'夜景',alt:'夜晚的 Muse Tower 局部立面，同一座塔亮起溫暖窗燈，外側是靜謐雲霧與星空。'},
};
interface Projection {generation:string;images:{day:string;night:string};endsAt:number}
function projection(value:unknown,now:number):Projection|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>,images=v.images as Record<string,unknown>|undefined;
 if(v.theme!=='halloween'||typeof v.generation!=='string'||!/^manager-\d{4}-\d{2}-\d{2}-r[01]$/.test(v.generation)||!Number.isSafeInteger(v.revision)||Number(v.revision)<1||typeof v.endsAt!=='string'||!images)return null;
 const endsAt=Date.parse(v.endsAt);if(!Number.isFinite(endsAt)||endsAt<=now||endsAt-now>7*86400000)return null;
 const path=`/api/v1/tower/appearance/assets/${v.generation}`;
 if(images.day!==`${path}/day.png`||images.night!==`${path}/night.png`)return null;
 return {generation:v.generation,images:{day:images.day as string,night:images.night as string},endsAt};
}
export function appearanceControls(){return '<div class="tower-appearance-control"><button type="button" data-appearance-toggle hidden>一般外觀</button></div>';}
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
 const panorama=root.querySelector<HTMLElement>('[data-tower-panorama]');if(!panorama)return ()=>{};
 const image=panorama.querySelector<HTMLImageElement>('img'),button=panorama.querySelector<HTMLButtonElement>('[data-appearance-toggle]');
 if(!image||!button)return ()=>{};
 const caption=panorama.querySelector<HTMLElement>('[data-scene-caption]'),status=panorama.querySelector<HTMLElement>('[role=status]');
 const sceneButtons=Array.from(panorama.querySelectorAll<HTMLButtonElement>('[data-tower-scene]'));
 let active:Projection|null=null,enabled=true,disposed=false,selection=0,timer:ReturnType<typeof setTimeout>|undefined;
 const scene=():TowerScene=>panorama.dataset.scene==='night'?'night':'day';
 const original=(value:TowerScene)=>`${base}/tower/muse-tower-${value}-v2.webp`;
 const source=(value:TowerScene)=>active&&enabled&&active.endsAt>clock()?`${base}${active.images[value]}`:original(value);
 function controls(show:boolean){panorama!.dataset.theme=show?'halloween':'standard';button!.hidden=!active||active.endsAt<=clock();button!.textContent=show?'一般外觀':'顯示節慶外觀';}
 function commit(value:TowerScene,src:string,announce:boolean){
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
 const cleanup=()=>{disposed=true;selection++;if(timer)clearTimeout(timer);button.removeEventListener('click',toggle);image.removeEventListener('error',imageError);for(const {control,listener} of sceneListeners)control.removeEventListener('click',listener);};
 try{
  const response=await fetcher(`${base}/api/v1/tower/appearance`,{credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(4000)});
  if(!response.ok)return cleanup;const candidate=projection(await response.json(),clock());if(!candidate)return cleanup;
  try{enabled=localStorage.getItem(appearanceStorageKey)!=='off';}catch{/* Optional local preference. */}
  // Both scenes must load before either scene is presented as the active exterior.
  await Promise.all([preload(`${base}${candidate.images.day}`),preload(`${base}${candidate.images.night}`)]);
  if(disposed||candidate.endsAt<=clock())return cleanup;
  active=candidate;await show(scene());if(active)timer=setTimeout(fallback,Math.min(candidate.endsAt-clock(),2147483647));
 }catch{fallback();}
 return cleanup;
}
