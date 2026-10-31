const storageKey='musecondo.tower-decoration';
/** Fixed local artwork; configuration never supplies markup, CSS, URLs or scripts. */
export function appearanceDecorations(){
 const pumpkin=(x:number,y:number,scale:number)=>`<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-4-43q-1-16 12-19" fill="none" stroke="#657351" stroke-width="8"/><ellipse rx="40" ry="36" fill="#d66624"/><ellipse rx="29" ry="36" fill="#f28a31"/><ellipse rx="15" ry="36" fill="#ffab43"/><path d="m-24-6 13-11 7 16zm48 0L11-17 4-1zM-22 12q22 25 44 0l-10 3-3-6-7 8-7-8-3 6z" fill="#ffe8a0"/></g>`;
 return `<div class="tower-festive-decor" aria-hidden="true"><svg class="tower-lantern-garland" viewBox="0 0 1200 160" focusable="false"><path d="M0 10Q600 130 1200 10" fill="none" stroke="#5b493c" stroke-width="3"/>${[100,300,600,900,1100].map((x,i)=>`<g transform="translate(${x} ${i===2?70:i===1||i===3?57:30})"><path d="M0-14V5" stroke="#5b493c" stroke-width="3"/><rect x="-14" y="5" width="28" height="35" rx="10" fill="#ffb661"/><path d="M-6 12v20m12-20v20" stroke="#ffdc9d" stroke-width="3"/></g>`).join('')}</svg><svg class="tower-halloween-corner tower-halloween-left" viewBox="-110 -135 240 245" focusable="false"><path d="M-87 67q85-17 177 3" stroke="#f8bd67" stroke-width="2" fill="none"/>${pumpkin(-35,35,1)}${pumpkin(43,57,.66)}<path d="M-65-85q-13-22-28-7l13 10-3 16 19-8 20 8-4-16 14-10q-17-14-31 7zM73-39q-11-19-24-7l10 9-2 12 16-6 16 6-2-12 10-9q-13-12-24 7z" fill="#4b384d"/><path d="m35-102 3 8 9 3-9 3-3 9-3-9-9-3 9-3z" fill="#ffdd9b"/></svg><svg class="tower-halloween-corner tower-halloween-right" viewBox="-110 -135 240 245" focusable="false">${pumpkin(30,40,1.1)}${pumpkin(-45,65,.57)}<path d="M-48-50q-15-25-32-9l14 12-3 16 22-9 21 9-3-16 14-12q-17-16-33 9z" fill="#4b384d"/><path d="m54-94 4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#ffdd9b"/></svg></div><p class="tower-appearance-banner" data-appearance-banner hidden>萬聖夜，留一盞暖燈。</p><div class="tower-appearance-control"><button type="button" data-appearance-toggle hidden>一般外觀</button></div>`;
}
export async function bindTowerAppearance(root:HTMLElement,base:string,fetcher:typeof fetch=fetch,clock:()=>number=Date.now):Promise<()=>void>{
 const panorama=root.querySelector<HTMLElement>('[data-tower-panorama]');if(!panorama)return ()=>{};
 const button=panorama.querySelector<HTMLButtonElement>('[data-appearance-toggle]')!,banner=panorama.querySelector<HTMLElement>('[data-appearance-banner]')!;
 panorama.dataset.theme='standard';let timer:ReturnType<typeof setTimeout>|undefined,endsAt=0,enabled=true;
 const apply=()=>{const live=endsAt>clock(),show=live&&enabled;panorama.dataset.theme=show?'halloween':'standard';button.hidden=!live;banner.hidden=!show;button.textContent=show?'一般外觀':'顯示節慶佈景';};
 try{
  const response=await fetcher(`${base}/api/v1/tower/appearance`,{credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(4000)});
  if(!response.ok)return ()=>{};const value=await response.json() as {theme?:unknown;endsAt?:unknown};
  if(value.theme!=='halloween'||typeof value.endsAt!=='string')return ()=>{};endsAt=Date.parse(value.endsAt);
  if(!Number.isFinite(endsAt)||endsAt<=clock()||endsAt-clock()>7*86400000)return ()=>{};
  try{enabled=localStorage.getItem(storageKey)!=='off';}catch{/* The switch does not require storage. */}
  button.addEventListener('click',()=>{enabled=!enabled;try{localStorage.setItem(storageKey,enabled?'on':'off');}catch{/* Optional preference. */}apply();});
  apply();timer=setTimeout(apply,Math.min(endsAt-clock(),2147483647));
 }catch{/* General appearance remains usable if the service is unavailable. */}
 return ()=>{if(timer)clearTimeout(timer);};
}
