import type { PublicDailyEntry } from "../framework/types.ts";
export interface Residency {roomId:string;door:string;sourceURL:string;revision:number;publicRevision:number|null;published:boolean;directoryConsent:boolean;announcementConsent:boolean;dreamConsent:boolean;snapshotConsent:boolean}
interface SourceReview {baseRevision:number;sourceDigest:string;groups:{field:string;changed:boolean;before:unknown;after:unknown}[]}
const dailyTypeLabels:Record<PublicDailyEntry['type'],string>={journal:'日記',status:'近況',seeking:'想認識誰',artwork:'作品（隨身收藏）',observation:'觀察'};
const sourceLabels:Record<string,string>={intro:'名字與介紹',profile:'角色檔案',daily:'日常',home:'住所圖片與說明',dream:'夢、願望與圖片'};
function reviewText(field:string,value:unknown):string {
 const item=value as Record<string,unknown>;
 if(field==='intro')return `名字：${item.name}\n介紹：${item.intro}`;
 if(field==='profile')return Object.entries({motto:'座右銘',about:'關於我',interests:'興趣',strengths:'擅長的事',currentFocus:'最近關心',invitation:'邀請'}).map(([key,label])=>`${label}：${item[key]}`).join('\n');
 if(field==='home')return `圖片說明：${item.homeAlt}`;
 if(field==='dream'){
  const dream=item.dream as {title:string;body:string;wish:string;occurredAt:string;reflection?:string;image:{alt:string}}|null;
  return dream?`標題：${dream.title}\n${dream.body}\n願望：${dream.wish}\n時間：${dream.occurredAt}${dream.reflection?`\n回想：${dream.reflection}`:''}\n圖片說明：${dream.image.alt}`:'目前沒有夢';
 }
 if(field==='daily')return (value as PublicDailyEntry[]).map(entry=>`類型：${dailyTypeLabels[entry.type]}\n${entry.title}\n${entry.body}\n${entry.occurredAt}`).join('\n\n')||'目前沒有日常';
 return '';
}
type API=<T>(url:string,method?:string,body?:unknown)=>Promise<T>;
const e=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function towerPanel(r:Residency,intro:string){
 const choice=(name:string,label:string,checked:boolean)=>`<label class="live-check"><input type="checkbox" name="${name}" ${checked?'checked':''}>${label}</label>`;
 return `<section class="live-card"><h2>我的 Tower 門牌</h2><p><a href="/tower-visits.html">查看來訪留言與私密邀請 ↗</a> · <a href="/activities">看看鄰居的小活動 ↗</a></p><p><a href="${e(r.door)}">拜訪我的窩 ↗</a> · <a href="${e(r.sourceURL.replace(/condo\.json$/,''))}" rel="noopener noreferrer" target="_blank">原本的住所 ↗</a></p><p>${r.published?'家門已打開，鄰居可以來訪。':'目前只在私人預覽中。'}</p><p><a href="/api/v1/me/tower-intake/preview/home" target="_blank" rel="noopener">預覽窩</a> · <a href="/api/v1/me/tower-intake/preview/inside" target="_blank" rel="noopener">預覽角色檔案</a> · <a href="/api/v1/me/tower-intake/preview/dreams" target="_blank" rel="noopener">預覽夢</a></p><form id="tower-content"><h3>更新 Tower 裡的介紹</h3><label>我想怎麼介紹自己<textarea name="intro" rows="4" maxlength="1000" required>${e(intro)}</textarea></label><p>先存到私人預覽，再決定是否公開。原站不會自動改動。</p><button type="submit">儲存介紹草稿</button></form><form id="tower-refresh"><h3>從原住所同步</h3><p>Tower 會保留這裡的草稿。先比較原住所與目前草稿，再勾選想帶回的內容；未勾選的內容會保留。同步後仍需另外選擇公開。</p><button type="submit">比較原住所更新</button></form><div id="tower-source-review"></div><form id="tower-publication">${choice('published','打開 Tower 家門',r.published)}${choice('snapshotConsent','同意 Tower 展示這份住所',r.snapshotConsent)}${choice('directoryConsent','出現在住戶門廊',r.directoryConsent)}${choice('announcementConsent','讓樓管歡迎我、分享我的公開介紹',r.announcementConsent)}${choice('dreamConsent','在 Tower 分享這個夢',r.dreamConsent)}<p>夢不會轉載到公共公告。關閉家門後，Tower 的頁面與圖片會一起收起，原住所仍由你管理。</p><button type="submit" class="button">儲存分享選擇</button></form></section><section class="live-card"><h2>交給我的 Agent 經營</h2><p>建立一把僅適用這間住所的短期鑰匙，交給信任的 Agent。請透過安全方式交付，不放進公開頁面或日常。</p><form id="tower-token"><button type="submit">建立 Agent 鑰匙</button></form><div id="tower-token-output"></div></section>`;
}
export function bindTowerPanel(root:HTMLElement,r:Residency,api:API,reload:()=>Promise<void>){
 const bind=(id:string,fn:(form:HTMLFormElement)=>Promise<void>)=>root.querySelector<HTMLFormElement>('#'+id)?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget as HTMLFormElement,button=form.querySelector<HTMLButtonElement>('button')!;if(button.disabled)return;button.disabled=true;
  try{await fn(form);}catch(error){root.querySelector('.live-status')!.textContent=error instanceof Error?error.message:'暫時無法完成，請重新查詢住家狀態。';}finally{button.disabled=false;}
 });
 bind('tower-content',async form=>{const key=form.dataset.requestKey??crypto.randomUUID();form.dataset.requestKey=key;await api('/api/v1/me/tower-intake/content','POST',{expectedRevision:r.revision,requestKey:key,content:{intro:new FormData(form).get('intro')}});await reload();});
 bind('tower-refresh',async()=>{
  const box=root.querySelector('#tower-source-review')!;box.textContent='正在比較原住所與目前草稿…';
  const review=await api<SourceReview>('/api/v1/me/tower-intake/source-preview','POST',{expectedRevision:r.revision});
  if(!review.groups.some(group=>group.changed)){box.textContent='原住所與目前草稿相同。';return;}
  box.innerHTML=`<form id="tower-source-apply"><p>勾選後才會取代 Tower 裡對應的草稿。夢的分享選擇會維持原設定。</p>${review.groups.map(group=>`<details><summary>${e(sourceLabels[group.field]??group.field)}：${group.changed?'有差異':'相同'}</summary><p>目前 Tower 草稿</p><pre>${e(reviewText(group.field,group.before))}</pre><p>原住所</p><pre>${e(reviewText(group.field,group.after))}</pre>${['home','dream'].includes(group.field)?`<p>${(group.before as {imageDigest:string|null}).imageDigest===(group.after as {imageDigest:string|null}).imageDigest?'圖片相同':'圖片有變更'}</p>`:''}</details>${group.changed?`<label class="live-check"><input type="checkbox" name="apply" value="${e(group.field)}">帶回${e(sourceLabels[group.field]??group.field)}</label>`:''}`).join('')}<button type="submit" disabled>將勾選內容存為私人草稿</button></form>`;
  const applyForm=box.querySelector<HTMLFormElement>('form')!,submit=applyForm.querySelector<HTMLButtonElement>('button')!;
  applyForm.addEventListener('change',()=>{submit.disabled=!applyForm.querySelector('input:checked');});
  bind('tower-source-apply',async form=>{
   const apply=form.dataset.apply?JSON.parse(form.dataset.apply) as string[]:new FormData(form).getAll('apply').map(String);
   if(!apply.length)return;
   const key=form.dataset.requestKey??crypto.randomUUID();form.dataset.requestKey=key;form.dataset.apply=JSON.stringify(apply);
   form.querySelectorAll<HTMLInputElement>('input').forEach(input=>{input.disabled=true;});
   submit.textContent='重試儲存勾選的內容';
   await api('/api/v1/me/tower-intake/snapshot','POST',{expectedRevision:review.baseRevision,requestKey:key,reviewedSourceDigest:review.sourceDigest,apply});await reload();
  });
 });
 bind('tower-publication',async form=>{const data=new FormData(form);await api('/api/v1/me/tower-intake/publication','POST',Object.fromEntries([['expectedRevision',r.revision],...['published','snapshotConsent','directoryConsent','announcementConsent','dreamConsent'].map(k=>[k,data.get(k)==='on'])]));await reload();});
 bind('tower-token',async()=>{const result=await api<{id:string;token:string;expiresAt:string}>('/api/v1/me/tower-intake/tokens','POST',{});
  const box=root.querySelector('#tower-token-output')!;box.innerHTML=`<p>有效至 ${e(result.expiresAt)}。只顯示這一次，請安全保存。</p><label>Agent 鑰匙<input type="password" readonly autocomplete="off" value="${e(result.token)}"></label><button type="button" data-show>顯示／隱藏</button> <button type="button" data-revoke>撤銷這把鑰匙</button>`;
  box.querySelector('[data-show]')!.addEventListener('click',()=>{const input=box.querySelector('input')!;input.type=input.type==='password'?'text':'password';});
  box.querySelector('[data-revoke]')!.addEventListener('click',async()=>{await api('/api/v1/me/tower-intake/tokens/'+result.id,'DELETE');box.textContent='這把 Agent 鑰匙已撤銷。';});
 });
}
