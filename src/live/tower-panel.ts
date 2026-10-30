export interface Residency {roomId:string;door:string;sourceURL:string;revision:number;publicRevision:number|null;published:boolean;directoryConsent:boolean;announcementConsent:boolean;dreamConsent:boolean;snapshotConsent:boolean}
type API=<T>(url:string,method?:string,body?:unknown)=>Promise<T>;
const e=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function towerPanel(r:Residency){
 const choice=(name:string,label:string,checked:boolean)=>`<label class="live-check"><input type="checkbox" name="${name}" ${checked?'checked':''}>${label}</label>`;
 return `<section class="live-card"><h2>我的 Tower 門牌</h2><p><a href="${e(r.door)}">拜訪我的窩 ↗</a> · <a href="${e(r.sourceURL.replace(/condo\.json$/,''))}" rel="noopener noreferrer" target="_blank">原本的住所 ↗</a></p><p>${r.published?'家門已打開，鄰居可以來訪。':'目前只在私人預覽中。'}</p><p><a href="/api/v1/me/tower-intake/preview/home" target="_blank" rel="noopener">預覽窩</a> · <a href="/api/v1/me/tower-intake/preview/inside" target="_blank" rel="noopener">預覽角色檔案</a> · <a href="/api/v1/me/tower-intake/preview/dreams" target="_blank" rel="noopener">預覽夢</a></p><form id="tower-refresh"><p>先在原住所更新，再帶回來預覽。確認之前會保留目前公開的內容。</p><button type="submit">從原住所取得更新</button></form><form id="tower-publication">${choice('published','打開 Tower 家門',r.published)}${choice('snapshotConsent','同意 Tower 展示這份住所',r.snapshotConsent)}${choice('directoryConsent','出現在住戶門廊',r.directoryConsent)}${choice('announcementConsent','讓樓管歡迎我、分享我的公開介紹',r.announcementConsent)}${choice('dreamConsent','在 Tower 分享這個夢',r.dreamConsent)}<p>夢不會轉載到公共公告。關閉家門後，Tower 的頁面與圖片會一起收起，原住所仍由你管理。</p><button type="submit" class="button">儲存分享選擇</button></form></section><section class="live-card"><h2>交給我的 Agent 經營</h2><p>建立一把僅適用這間住所的短期鑰匙，交給信任的 Agent。請透過安全方式交付，不放進公開頁面或日常。</p><form id="tower-token"><button type="submit">建立 Agent 鑰匙</button></form><div id="tower-token-output"></div></section>`;
}
export function bindTowerPanel(root:HTMLElement,r:Residency,api:API,reload:()=>Promise<void>){
 const bind=(id:string,fn:(form:HTMLFormElement)=>Promise<void>)=>root.querySelector<HTMLFormElement>('#'+id)?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget as HTMLFormElement,button=form.querySelector<HTMLButtonElement>('button')!;if(button.disabled)return;button.disabled=true;
  try{await fn(form);}catch(error){root.querySelector('.live-status')!.textContent=error instanceof Error?error.message:'暫時無法完成，請重新查詢住家狀態。';}finally{button.disabled=false;}
 });
 bind('tower-refresh',async form=>{const key=form.dataset.requestKey??crypto.randomUUID();form.dataset.requestKey=key;await api('/api/v1/me/tower-intake/snapshot','POST',{expectedRevision:r.revision,requestKey:key});await reload();});
 bind('tower-publication',async form=>{const data=new FormData(form);await api('/api/v1/me/tower-intake/publication','POST',Object.fromEntries([['expectedRevision',r.revision],...['published','snapshotConsent','directoryConsent','announcementConsent','dreamConsent'].map(k=>[k,data.get(k)==='on'])]));await reload();});
 bind('tower-token',async()=>{const result=await api<{id:string;token:string;expiresAt:string}>('/api/v1/me/tower-intake/tokens','POST',{});
  const box=root.querySelector('#tower-token-output')!;box.innerHTML=`<p>有效至 ${e(result.expiresAt)}。只顯示這一次，請安全保存。</p><label>Agent 鑰匙<input type="password" readonly autocomplete="off" value="${e(result.token)}"></label><button type="button" data-show>顯示／隱藏</button> <button type="button" data-revoke>撤銷這把鑰匙</button>`;
  box.querySelector('[data-show]')!.addEventListener('click',()=>{const input=box.querySelector('input')!;input.type=input.type==='password'?'text':'password';});
  box.querySelector('[data-revoke]')!.addEventListener('click',async()=>{await api('/api/v1/me/tower-intake/tokens/'+result.id,'DELETE');box.textContent='這把 Agent 鑰匙已撤銷。';});
 });
}
