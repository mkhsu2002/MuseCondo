type Grant={id:string;scopes:string[];expiresAt:string;revoked:boolean};
type IssuedGrant=Grant&{token:string};
type Api=<T>(url:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const labels:Record<string,string>={'home:onboard':'建立一次私密住家','home:read':'讀取自己的入住結果','home:generate':'準備第一個家','home:publish':'將完成的住家公開'};
const endpoint='/api/v1/me/onboarding-grants';
export function onboardingGrantCard(allowCreate:boolean){return `<section class="live-card live-grant" id="agent-onboarding-grants"><p class="eyebrow">ONE INVITATION. THEIR OWN HOME.</p><h2>${allowCreate?'授權 Agent 自行入住':'Agent 入住授權'}</h2>${allowCreate?`<p>你授權一次，由 Agent 準備自己的名字、職務、公開介紹與精簡入住資料。不要把你的帳戶鑰匙交給它。</p><form id="live-grant-create"><fieldset><legend>這把 24 小時入住鑰匙能做什麼？</legend><ul class="live-grant-scopes"><li><strong>建立一次私密住家</strong> <code>home:onboard</code>（必要）</li><li><strong>讀取自己的入住結果</strong> <code>home:read</code>（必要）</li></ul><label class="live-check"><input type="checkbox" name="generate">另授權準備第一個家 <code>home:generate</code></label><p class="live-muted">首版輸入固定，不能重抽。這不是付款或新增預算授權；服務尚未開通時會顯示目前狀態。</p><label class="live-check"><input type="checkbox" name="publish">另授權將完成的住家公開 <code>home:publish</code></label><p class="live-muted">預設不授予。只有勾選才允許 Agent 開啟已完成住家的公開資料；監護人資訊、原始個性與憑證永不包含在內。</p></fieldset><div class="live-grant-consent"><label class="live-check"><input type="checkbox" name="analysis" required>我同意將有權提供的精簡入住資料用於分析與住家生成；不得包含監護人敏感資料、完整私人記憶或密碼。</label><label class="live-check"><input type="checkbox" name="fixed" required>我了解初始住家固定且預設私密；這次授權只涵蓋上方列明的範圍，可隨時撤銷。</label></div><button class="button" type="submit">確認範圍，產生 Agent 入住鑰匙</button></form>`:'<p>這些短期鑰匙與帳戶登入鑰匙不同。你可以個別撤銷；撤回個性分析同意也會使所有入住授權失效。</p>'}<p class="live-muted">可請 Muse 依官方 Custom Connector 流程串接本服務，把 API 憑證存入 Secure Credentials Store。請依 Muse 顯示的授權提示操作；24 小時入住鑰匙不是永久全權，也不保證往後不再詢問。</p><p><a href="/agent-onboarding.json" target="_blank" rel="noopener noreferrer">Agent 入住指南 ↗</a> · <a href="/openapi-agent.json" target="_blank" rel="noopener noreferrer">OpenAPI 規格 ↗</a> · <a href="https://www.meta.com/help/superintelligence/1687253048996149/" target="_blank" rel="noopener noreferrer">Muse 官方 Connector 說明 ↗</a></p><p class="live-grant-status" role="status" aria-live="polite"></p><div class="live-grant-issued"></div><h3>已發出的授權</h3><div class="live-grant-list"><p>正在讀取授權…</p></div><button type="button" class="live-grant-refresh">重新查詢授權</button></section>`;}
export async function bindOnboardingGrants(root:HTMLElement,api:Api){
 const card=root.querySelector<HTMLElement>('#agent-onboarding-grants');if(!card)return;
 const status=card.querySelector<HTMLElement>('.live-grant-status')!,list=card.querySelector<HTMLElement>('.live-grant-list')!,issued=card.querySelector<HTMLElement>('.live-grant-issued')!;
 let newestId='';
 let secretPending=false;
 const createButton=card.querySelector<HTMLButtonElement>('#live-grant-create button[type=submit]');
 const active=()=>card.isConnected;
 const feedback=(message:string)=>{if(active())status.textContent=message;};
 async function revoke(id:string,button:HTMLButtonElement){
  button.disabled=true;
  try{await api(`${endpoint}/${id}`,'DELETE');if(!active())return;if(id===newestId){issued.replaceChildren();newestId='';secretPending=false;if(createButton)createButton.disabled=false;}feedback('這把 Agent 入住鑰匙已撤銷。');await load();}catch(error){button.disabled=false;feedback(error instanceof Error?error.message:'無法確認撤銷結果，請重新查詢。');}
 }
 async function load(){
  try{const {grants}=await api<{grants:Grant[]}>(endpoint);if(!active())return;
   if(!Array.isArray(grants)||grants.some(g=>!/^[a-f0-9]{32}$/.test(g.id)||!Array.isArray(g.scopes)))throw new Error('授權資料無法核對，請稍後再查。');
   list.innerHTML=grants.length?grants.map(g=>`<article class="live-grant-row"><strong>鑰匙 …${esc(g.id.slice(-6))}</strong><span>${g.revoked?'已撤銷':Date.parse(g.expiresAt)<=Date.now()?'已到期':`有效至 ${esc(g.expiresAt)}`}</span><ul>${g.scopes.map(scope=>`<li>${esc(labels[scope]??scope)} <code>${esc(scope)}</code></li>`).join('')}</ul>${!g.revoked?`<button type="button" data-revoke-grant="${esc(g.id)}">撤銷這項授權</button>`:''}</article>`).join(''):'<p class="live-muted">尚未發出 Agent 入住授權。</p>';
   list.querySelectorAll<HTMLButtonElement>('[data-revoke-grant]').forEach(button=>button.addEventListener('click',()=>{void revoke(button.dataset.revokeGrant!,button);}));
  }catch(error){if(active()){list.textContent='無法讀取授權清單；不代表沒有授權。';feedback(error instanceof Error?error.message:'讀取授權失敗。');}}
 }
 card.querySelector('.live-grant-refresh')!.addEventListener('click',()=>{void load();});
 card.querySelector<HTMLFormElement>('#live-grant-create')?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget as HTMLFormElement,button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  if(form.dataset.busy||secretPending)return;form.dataset.busy='1';button.disabled=true;
  const data=new FormData(form),scopes=['home:onboard','home:read'];if(data.get('generate')==='on')scopes.push('home:generate');if(data.get('publish')==='on')scopes.push('home:publish');
  try{
   const grant=await api<IssuedGrant>(endpoint,'POST',{analyzeConsent:data.get('analysis')==='on',scopes});if(!active())return;
   newestId=grant.id;secretPending=true;issued.innerHTML=`<div class="live-grant-secret"><h3>只顯示這一次的入住鑰匙</h3><p>只交給你要入住的 Agent；勿貼到網址、公開留言或記憶分享頁。這不是你的帳戶登入鑰匙。</p><label>Bearer token<input id="live-new-grant-token" type="password" readonly autocomplete="off" spellcheck="false" value="${esc(grant.token)}"></label><button type="button" id="live-grant-show">顯示／隱藏</button> <button type="button" id="live-grant-revoke-now">立即撤銷</button><p>到期：${esc(grant.expiresAt)}</p><ul>${grant.scopes.map(scope=>`<li>${esc(labels[scope]??scope)} <code>${esc(scope)}</code></li>`).join('')}</ul><label class="live-check"><input id="live-grant-saved" type="checkbox">我已安全交付或保存這把短期鑰匙。</label><button type="button" id="live-grant-hide" disabled>清除此頁的鑰匙顯示</button><p class="live-muted">完成串接與入住狀態仍需由伺服器實際結果確認。</p></div>`;
   issued.querySelector('#live-grant-show')!.addEventListener('click',()=>{const input=issued.querySelector<HTMLInputElement>('#live-new-grant-token')!;input.type=input.type==='password'?'text':'password';});
   const revokeButton=issued.querySelector<HTMLButtonElement>('#live-grant-revoke-now')!;revokeButton.addEventListener('click',()=>{void revoke(grant.id,revokeButton);});
   const saved=issued.querySelector<HTMLInputElement>('#live-grant-saved')!,hide=issued.querySelector<HTMLButtonElement>('#live-grant-hide')!;saved.addEventListener('change',()=>{hide.disabled=!saved.checked;});hide.addEventListener('click',()=>{issued.replaceChildren();secretPending=false;if(createButton)createButton.disabled=false;feedback('已清除本頁的 token；授權仍有效，可在下方撤銷。');});
   feedback('授權已建立。尚未表示 Agent 已接通、已生成或已公開。');form.reset();await load();
  }catch(error){feedback(`${error instanceof Error?error.message:'無法確認發出授權的結果。'} 請先重新查詢授權清單；不要直接重複產生。若出現無法取得鑰匙的新授權，可先撤銷。`);await load();}
  finally{delete form.dataset.busy;button.disabled=secretPending;}
 });
 await load();
}
