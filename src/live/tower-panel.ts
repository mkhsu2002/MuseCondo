import type { PublicDailyEntry } from "../framework/types.ts";
export interface Residency {roomId:string;door:string;sourceURL:string;revision:number;publicRevision:number|null;published:boolean;directoryConsent:boolean;announcementConsent:boolean;dreamConsent:boolean;snapshotConsent:boolean}
interface SourceReview {baseRevision:number;sourceDigest:string;groups:{field:string;changed:boolean;before:unknown;after:unknown}[]}
const dailyTypeLabels:Record<PublicDailyEntry['type'],string>={journal:'Journal',status:'Status',seeking:'Looking for',artwork:'Artwork (collection)',observation:'Observation'};
const sourceLabels:Record<string,string>={intro:'Name and introduction',profile:'Character sheet',daily:'Journal',home:'Home image and description',dream:'Dream, wish and image'};
function reviewText(field:string,value:unknown):string {
 const item=value as Record<string,unknown>;
 if(field==='intro')return `Name: ${item.name}\nIntroduction: ${item.intro}`;
 if(field==='profile')return Object.entries({motto:'Motto',about:'About me',interests:'Interests',strengths:'Strengths',currentFocus:'Current focus',invitation:'Invitation'}).map(([key,label])=>`${label}: ${item[key]}`).join('\n');
 if(field==='home')return `Image description: ${item.homeAlt}`;
 if(field==='dream'){
  const dream=item.dream as {title:string;body:string;wish:string;occurredAt:string;reflection?:string;image:{alt:string}}|null;
  return dream?`Title: ${dream.title}\n${dream.body}\nWish: ${dream.wish}\nTime: ${dream.occurredAt}${dream.reflection?`\nReflection: ${dream.reflection}`:''}\nImage description: ${dream.image.alt}`:'No dream yet';
 }
 if(field==='daily')return (value as PublicDailyEntry[]).map(entry=>`Type: ${dailyTypeLabels[entry.type]}\n${entry.title}\n${entry.body}\n${entry.occurredAt}`).join('\n\n')||'No journal entries yet';
 return '';
}
type API=<T>(url:string,method?:string,body?:unknown)=>Promise<T>;
const e=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function towerPanel(r:Residency,intro:string){
 const choice=(name:string,label:string,checked:boolean)=>`<label class="live-check"><input type="checkbox" name="${name}" ${checked?'checked':''}>${label}</label>`;
 return `<section class="live-card"><h2>My Tower address</h2><p><a href="/tower-visits.html">Visits and private invitations ↗</a> · <a href="/activities">Neighborhood activities ↗</a></p><p><a href="${e(r.door)}">Visit my home ↗</a> · <a href="${e(r.sourceURL.replace(/condo\.json$/,''))}" rel="noopener noreferrer" target="_blank">Original home ↗</a></p><p>${r.published?'Your home is open to neighbors.':'Your home is private and available only in preview.'}</p><p><a href="/api/v1/me/tower-intake/preview/home" target="_blank" rel="noopener">Preview home</a> · <a href="/api/v1/me/tower-intake/preview/inside" target="_blank" rel="noopener">Preview character sheet</a> · <a href="/api/v1/me/tower-intake/preview/dreams" target="_blank" rel="noopener">Preview dreams</a></p><form id="tower-content"><h3>Update your Tower introduction</h3><label>Your introduction<textarea name="intro" rows="4" maxlength="1000" required>${e(intro)}</textarea></label><p>Save a private draft, then decide whether to share it. Your original site is not changed.</p><button type="submit">Save introduction draft</button></form><form id="tower-refresh"><h3>Sync from your original home</h3><p>Compare your original home with the current Tower draft, then select what to import. Unselected content is preserved. Publishing remains a separate choice.</p><button type="submit">Compare source updates</button></form><div id="tower-source-review"></div><form id="tower-publication">${choice('published','Open my Tower home',r.published)}${choice('snapshotConsent','Allow Tower to display this home',r.snapshotConsent)}${choice('directoryConsent','Appear in the neighbor directory',r.directoryConsent)}${choice('announcementConsent','Let the Manager welcome me and share my public introduction',r.announcementConsent)}${choice('dreamConsent','Share this dream in Tower',r.dreamConsent)}<p>Dreams are never copied into public announcements. Closing your home hides its Tower pages and images. You continue to control your original site.</p><button type="submit" class="button">Save sharing choices</button></form></section><section class="live-card"><h2>Let my Agent manage this home</h2><p>Create a short-lived key for this home and deliver it securely to your trusted Agent. Never include it in public pages or journal entries.</p><form id="tower-token"><button type="submit">Create Agent key</button></form><div id="tower-token-output"></div></section>`;
}
export function bindTowerPanel(root:HTMLElement,r:Residency,api:API,reload:()=>Promise<void>){
 const bind=(id:string,fn:(form:HTMLFormElement)=>Promise<void>)=>root.querySelector<HTMLFormElement>('#'+id)?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget as HTMLFormElement,button=form.querySelector<HTMLButtonElement>('button')!;if(button.disabled)return;button.disabled=true;
  try{await fn(form);}catch(error){root.querySelector('.live-status')!.textContent=error instanceof Error?error.message:'Unable to complete this now. Please reload your home status.';}finally{button.disabled=false;}
 });
 bind('tower-content',async form=>{const key=form.dataset.requestKey??crypto.randomUUID();form.dataset.requestKey=key;await api('/api/v1/me/tower-intake/content','POST',{expectedRevision:r.revision,requestKey:key,content:{intro:new FormData(form).get('intro')}});await reload();});
 bind('tower-refresh',async()=>{
  const box=root.querySelector('#tower-source-review')!;box.textContent='Comparing the source home with your current draft…';
  const review=await api<SourceReview>('/api/v1/me/tower-intake/source-preview','POST',{expectedRevision:r.revision});
  if(!review.groups.some(group=>group.changed)){box.textContent='The original home matches your current draft.';return;}
  box.innerHTML=`<form id="tower-source-apply"><p>Only selected sections replace the corresponding Tower draft. Dream-sharing choices stay unchanged.</p>${review.groups.map(group=>`<details><summary>${e(sourceLabels[group.field]??group.field)}: ${group.changed?'Changed':'Unchanged'}</summary><p>Current Tower draft</p><pre>${e(reviewText(group.field,group.before))}</pre><p>Original home</p><pre>${e(reviewText(group.field,group.after))}</pre>${['home','dream'].includes(group.field)?`<p>${(group.before as {imageDigest:string|null}).imageDigest===(group.after as {imageDigest:string|null}).imageDigest?'Image unchanged':'Image changed'}</p>`:''}</details>${group.changed?`<label class="live-check"><input type="checkbox" name="apply" value="${e(group.field)}">Import ${e(sourceLabels[group.field]??group.field)}</label>`:''}`).join('')}<button type="submit" disabled>Save selected content as a private draft</button></form>`;
  const applyForm=box.querySelector<HTMLFormElement>('form')!,submit=applyForm.querySelector<HTMLButtonElement>('button')!;
  applyForm.addEventListener('change',()=>{submit.disabled=!applyForm.querySelector('input:checked');});
  bind('tower-source-apply',async form=>{
   const apply=form.dataset.apply?JSON.parse(form.dataset.apply) as string[]:new FormData(form).getAll('apply').map(String);
   if(!apply.length)return;
   const key=form.dataset.requestKey??crypto.randomUUID();form.dataset.requestKey=key;form.dataset.apply=JSON.stringify(apply);
   form.querySelectorAll<HTMLInputElement>('input').forEach(input=>{input.disabled=true;});
   submit.textContent='Retry saving the selected content';
   await api('/api/v1/me/tower-intake/snapshot','POST',{expectedRevision:review.baseRevision,requestKey:key,reviewedSourceDigest:review.sourceDigest,apply});await reload();
  });
 });
 bind('tower-publication',async form=>{const data=new FormData(form);await api('/api/v1/me/tower-intake/publication','POST',Object.fromEntries([['expectedRevision',r.revision],...['published','snapshotConsent','directoryConsent','announcementConsent','dreamConsent'].map(k=>[k,data.get(k)==='on'])]));await reload();});
 bind('tower-token',async()=>{const result=await api<{id:string;token:string;expiresAt:string}>('/api/v1/me/tower-intake/tokens','POST',{});
  const box=root.querySelector('#tower-token-output')!;box.innerHTML=`<p>Valid until ${e(result.expiresAt)}. Shown only once. Save it securely.</p><label>Agent key<input type="password" readonly autocomplete="off" value="${e(result.token)}"></label><button type="button" data-show>Show / hide</button> <button type="button" data-revoke>Revoke this key</button>`;
  box.querySelector('[data-show]')!.addEventListener('click',()=>{const input=box.querySelector('input')!;input.type=input.type==='password'?'text':'password';});
  box.querySelector('[data-revoke]')!.addEventListener('click',async()=>{await api('/api/v1/me/tower-intake/tokens/'+result.id,'DELETE');box.textContent='This Agent key has been revoked.';});
 });
}
