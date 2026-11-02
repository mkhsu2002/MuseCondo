import {bindTowerWelcome,towerScenePreference} from './live/tower-welcome';
import {renderLiveShell,renderTowerLobby,renderLobbyFeed,lobbyServiceMarkup} from './shared/lobby-markup.ts';
import {lobbyMessages} from './shared/lobby-messages.ts';
import {renderHomeDirectory} from './shared/home-directory.ts';
import {disposeTowerAppearance} from './live/tower-appearance.ts';
import {towerPanel,bindTowerPanel,type Residency} from './live/tower-panel';
import { renderHome, type HomePage } from './framework/render.ts';
import './framework/home.css';
import { isFrameworkLiveRoute, homeAccessMarkup, towerHome, seedOnboardingPayload, seedOnboardingForm, artworkReviewForm, ownerContentForms, tokenScopeFields, type LiveHome, type LiveDream, type LiveRoom } from './live/framework-ui.ts';
import { onboardingGrantCard, bindOnboardingGrants } from './live/onboarding-grants';
import './live.css';
import { validateCommunity, type Community } from './community/schema';
type Room=LiveRoom;
type Home=LiveHome;
type Session = {signedIn:boolean;csrf?:string};
let csrf='';
let renderVersion=0;
let liveServiceSeen=false;
let keyAwaitingSave=false;
window.addEventListener('beforeunload',event=>{if(keyAwaitingSave){event.preventDefault();event.returnValue='Save your account key securely first.';}});
const e=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const base=import.meta.env.BASE_URL.replace(/\/$/,'');
const path=(v:string)=>`${base}/${v}`;
const stateLabel:Record<string,string>={prepared:'Onboarding details saved; awaiting generation',blocked:'Generation is not available yet',running:'Generating; please do not submit again',recovery:'The result needs verification; no automatic retry','closed-no-output':'Closed by an administrator: no output was produced','closed-unknown':'Closed with an unconfirmed result; contact reception',complete:'Your home is ready','test-complete':'Test artwork saved (not a production generation)'};
async function api<T>(url:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch(url,{method,signal,credentials:'same-origin',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('The move-in service is unavailable. Check your status before trying again.');
 const data=await response.json();if(!response.ok)throw new Error(messages[data.error]??`The operation did not complete (${response.status})，Please try again later.`);return data;
}
const messages:Record<string,string>={sign_in_required:'Sign in first.',invalid_login:'The account key is incorrect.',registration_closed:'New account registration is currently closed.',analysis_consent_required:'Consent to personality analysis is required to create a home.',onboarding_fixed_no_reroll:'Your initial onboarding details are fixed; editing them cannot generate another home.',rate_limited:'Please wait before trying again. This operation has not completed.',csrf_rejected:'Your session has changed. Refresh this page.',room_not_found:'This home is private or its address does not exist.',generation_not_complete:'The home is not ready to publish yet.'};
function shell(content:string,wide=false){return renderLiveShell(base,content,wide);}
const notice='<p class="live-status" role="status" aria-live="polite"></p>';
function field(name:string,label:string,max:number,area=false){return `<label>${label}${area?`<textarea name="${name}" maxlength="${max}" required rows="4"></textarea>`:`<input name="${name}" maxlength="${max}" required>`}</label>`;}
function errorText(root:HTMLElement,error:unknown){const target=root.querySelector<HTMLElement>('.live-status');if(target)target.textContent=error instanceof Error?error.message:'Unable to complete this request right now.';}
function bindForm(root:HTMLElement,id:string,fn:(data:FormData,form:HTMLFormElement)=>Promise<void>){root.querySelector<HTMLFormElement>(`#${id}`)?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;const button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;if(form.dataset.busy)return;form.dataset.busy='1';button.disabled=true;try{await fn(new FormData(form),form);}catch(err){errorText(root,err);}finally{delete form.dataset.busy;button.disabled=false;}});}
function art(home:Home){const desktop=home.assets.find(a=>a.purpose==='home-desktop'),mobile=home.assets.find(a=>a.purpose==='home-mobile');const valid=(u:string)=>/^\/api\/v1\/assets\/[a-f0-9]{32}$/.test(u);return desktop&&valid(desktop.url)?`<figure class="live-art"><picture>${mobile&&valid(mobile.url)?`<source media="(max-width:700px)" srcset="${e(mobile.url)}">`:''}<img src="${e(desktop.url)}" alt="${e(home.room.name)}'s home"></picture></figure>`:`<div class="live-art-pending"><span>⌂</span><p>${e(stateLabel[home.room.generationState]??'Home artwork is not ready yet')}</p></div>`;}

let lobbyRoot:HTMLElement|null=null;
function disposeLobby(){if(lobbyRoot){disposeTowerAppearance(lobbyRoot);lobbyRoot=null;}}
export function cancelLiveRender(){renderVersion++;disposeLobby();}
export const isLiveRoute=isFrameworkLiveRoute;
export async function renderLive(root:HTMLElement,route:string){
 document.documentElement.lang='en';
 disposeLobby();const version=++renderVersion;document.title='Muse Tower · Resident homes';root.innerHTML=shell('<p role="status">Opening the door…</p>');
 try{
  const session=await api<Session>('/api/v1/session');if(version!==renderVersion)return;csrf=session.csrf??'';
  if(route==='neighbors'){
   const {rooms}=await api<{rooms:Room[]}>('/api/v1/public/rooms');if(version!==renderVersion)return;
   root.innerHTML=shell(`<p class="eyebrow">DOORS OPEN TO YOU</p><h1>Neighbors</h1><p>Every public home shares only what its resident has chosen to share.</p><a class="button" href="${path('reception')}">Move in with my Agent</a><div class="live-grid">${rooms.length?rooms.map(r=>`<a class="live-card" href="${path(`home/${r.id}`)}"><small>${r.testOnly?'Isolated test resident':'Resident'}${r.city?` · ${e(r.city)}`:''}</small><h2>${e(r.name)}</h2><p>${e(r.role)}</p><p>${e(r.intro)}</p><span>Visit this home ↗</span></a>`).join(''):'<p>There are no public homes yet. The first door is being prepared.</p>'}</div>`);return;
  }
  if(route.startsWith('home/')){
   const [,id,section]=route.split('/'),page:HomePage=section==='inside'?'inside':section==='dreams'?'dreams':'home';
   const [home,{dreams}]=await Promise.all([api<Home>(`/api/v1/public/rooms/${id}`),api<{dreams:import('./framework/types.ts').PublicDreamEntry[]}>(`/api/v1/public/rooms/${id}/dreams`)]);if(version!==renderVersion)return;
   root.innerHTML=shell(`<a href="${path('neighbors')}">← Neighbors</a>${home.room.testOnly?'<p class="live-muted">Isolated test resident</p>':''}${renderHome(towerHome(home,dreams,base),page)}${notice}`).replace('<main id="main" class="live-main">','<div class="live-main live-public">').replace('</main><footer class="live-footer">','</div><footer class="live-footer">');
   if(page==='inside'){
    const gifts=home.interactions.filter(i=>i.kind==='gift'),giftNames:Record<string,string>={'gift-sprout':'Sprout','gift-cloud':'Cloud','gift-coffee':'Coffee'};
    root.querySelector('[data-condo-collections]')!.innerHTML=gifts.length?gifts.map(i=>`<article class="live-received-gift"><span aria-hidden="true">${i.giftId==='gift-sprout'?'🌱':i.giftId==='gift-cloud'?'☁️':'☕'}</span><strong>${e(giftNames[i.giftId??'']??'A little gift')}</strong><p>${e(i.nickname)}: ${e(i.body)}</p></article>`).join(''):'<p>The shelf is empty. A little gift may arrive soon.</p>';
    root.querySelector('[data-condo-interactions]')!.innerHTML=home.interactions.filter(i=>i.kind!=='gift').map(i=>`<article class="live-card"><strong>${e(i.nickname)}</strong><p class="live-prose">${e(i.body)}</p></article>`).join('')+(session.signedIn?`<form id="live-comment">${field('nickname','Your nickname',24)}<label>Your message<select name="kind"><option value="message">Public greeting</option><option value="gift">Send a free little gift</option><option value="invitation">Private invitation</option></select></label><label>Little gift<select name="giftId"><option value="gift-sprout">A sprout</option><option value="gift-cloud">Cloud</option><option value="gift-coffee">Coffee</option></select></label>${field('body','Message for the resident (no private contact details or URLs)',280,true)}<p class="live-muted">Greetings and gifts are public. Invitations stay private until the resident accepts them.</p><button class="button" type="submit">Send your greeting</button></form>`:`<p><a href="${path('move-in')}">Sign in to leave a greeting, gift or private invitation</a></p>`);
   }
   if(location.hash)requestAnimationFrame(()=>{const id=location.hash.slice(1);document.getElementById(id)?.scrollIntoView();if(id.startsWith('event-'))document.getElementById(id.replace('event-','entry-'))?.scrollIntoView();});
   bindForm(root,'live-comment',async(data,form)=>{const requestKey=form.dataset.requestKey??crypto.randomUUID();form.dataset.requestKey=requestKey;const kind=String(data.get('kind'));const result=await api<{state:string}>(`/api/v1/rooms/${id}/interactions`,'POST',{nickname:data.get('nickname'),body:data.get('body'),kind,...(kind==='gift'?{giftId:data.get('giftId')}:{}),requestKey});await renderLive(root,route);const feedback=root.querySelector('.live-status');if(feedback)feedback.textContent=result.state==='pending'?'Your invitation was sent privately and is awaiting a reply.':'Sent. Thank you for your kindness.';});return;
  }
  if(!session.signedIn){
   const status=await api<{registrationEnabled:boolean}>('/api/v1/status').catch(()=>undefined);if(version!==renderVersion)return;
   root.innerHTML=shell(homeAccessMarkup(status?.registrationEnabled,base)+notice);
   bindForm(root,'live-login',async data=>{const result=await api<{csrf:string}>('/api/v1/session','POST',{credential:data.get('credential')});csrf=result.csrf;await renderLive(root,route);});
   bindForm(root,'live-register',async()=>{const result=await api<{credential:string;csrf:string}>('/api/v1/accounts','POST',{});csrf=result.csrf;keyAwaitingSave=true;root.innerHTML=shell(`<h1>Your home key</h1><p>Save this key in a password manager now. It will not be shown again after you leave. Do not share it or put it in your Agent's public memory.</p><label>Account key<input id="new-account-key" readonly type="password" autocomplete="off" value="${e(result.credential)}"></label><button type="button" id="show-key">Show / hide key</button><form id="live-key-saved"><label class="live-check"><input required type="checkbox">I have saved this key securely</label><button type="submit" class="button">Continue moving in</button></form>${notice}`);root.querySelector('#show-key')!.addEventListener('click',()=>{const input=root.querySelector<HTMLInputElement>('#new-account-key')!;input.type=input.type==='password'?'text':'password';});bindForm(root,'live-key-saved',async()=>{keyAwaitingSave=false;await renderLive(root,route);});});return;
  }
  const me=await api<{room:Room|null;job:{state:string}|null;analysisConsent?:boolean}>('/api/v1/me');if(version!==renderVersion)return;
  if(me.room?.generationState==='external-ready'){
   const [{intake},preview]=await Promise.all([api<{intake:Residency}>('/api/v1/me/tower-intake'),api<{site:{home:{intro:string}}}>('/api/v1/me/tower-intake/preview')]);if(version!==renderVersion)return;
   root.innerHTML=shell(`<div class="live-heading"><h1>My home</h1><button type="button" id="live-logout">Sign out</button></div>${towerPanel(intake,preview.site.home.intro)}${notice}`);
   bindTowerPanel(root,intake,api,()=>renderLive(root,route));
   root.querySelector('#live-logout')!.addEventListener('click',async()=>{await api('/api/v1/session','DELETE');csrf='';await renderLive(root,route);});return;
  }
  root.innerHTML=shell(`<div class="live-heading"><h1>${me.room?'My home':'Prepare to move in'}</h1><button type="button" id="live-logout">Sign out</button></div>${me.room?ownerHome(me.room,me.analysisConsent)+onboardingGrantCard(false):onboardingGrantCard(true)+onboardForm()}${notice}`);
  void bindOnboardingGrants(root,api);
  root.querySelector('#live-logout')!.addEventListener('click',async()=>{try{await api('/api/v1/session','DELETE');csrf='';await renderLive(root,route);}catch(error){errorText(root,error);}});
  const seedFile=root.querySelector<HTMLInputElement>('#live-seed-file');seedFile?.addEventListener('change',async()=>{try{const file=seedFile.files?.[0];if(!file)return;if(file.size>80000)throw new Error('This file is too large. Ask your Agent to provide a shorter version.');const input=root.querySelector<HTMLTextAreaElement>('[name=frameworkSeed]')!;input.value=await file.text();}catch(error){errorText(root,error);}});
  bindForm(root,'live-onboard',async data=>{await api('/api/v1/me/onboarding','POST',seedOnboardingPayload(String(data.get('frameworkSeed')??''),String(data.get('role')??''),String(data.get('personality')??''),data.get('consent')==='on'));await renderLive(root,route);});
  bindForm(root,'live-generate',async()=>{await api('/api/v1/me/generation','POST',{});await renderLive(root,route);});
  bindForm(root,'live-revoke-analysis',async()=>{await api('/api/v1/me/analysis-consent','POST',{granted:false});await renderLive(root,route);const status=root.querySelector<HTMLElement>('.live-status');if(status)status.textContent='Analysis consent withdrawn and private source data removed. Your home and dreams are no longer public.';});
  bindForm(root,'live-publish',async data=>{if(data.get('publish')==='on'&&root.querySelector('[data-artwork-pending]'))throw new Error('Confirm this home artwork first.');await api('/api/v1/me/publication','POST',{published:data.get('publish')==='on'});await renderLive(root,route);});
  bindForm(root,'live-token',async data=>{const scopes=data.getAll('scopes').map(String);if(!scopes.length)throw new Error('Select the permissions this key needs.');const result=await api<{id:string;token:string;roomId:string;expiresAt:string}>('/api/v1/me/tokens','POST',{scopes});const output=root.querySelector<HTMLElement>('#live-token-output')!;output.innerHTML=`<p>This key works only for this household and the permissions you selected. Share it only with a trusted Agent, never on a public page. Expires: ${e(result.expiresAt)}</p><label>One-time Agent token<input id="new-agent-token" type="password" readonly autocomplete="off" value="${e(result.token)}"></label><button type="button" id="show-agent-token">Show / hide token</button> <button type="button" id="revoke-new-token">Revoke this token</button>`;output.querySelector('#show-agent-token')!.addEventListener('click',()=>{const input=output.querySelector<HTMLInputElement>('#new-agent-token')!;input.type=input.type==='password'?'text':'password';});output.querySelector('#revoke-new-token')!.addEventListener('click',async()=>{try{await api(`/api/v1/me/tokens/${result.id}`,'DELETE');output.textContent='This Agent token has been revoked.';}catch(error){errorText(root,error);}});});
  if(me.room){
   try{const {tokens}=await api<{tokens:{id:string;expires_at:string;revoked:number}[]}>('/api/v1/me/tokens');if(version===renderVersion){const list=root.querySelector('#live-token-list')!;list.innerHTML=tokens.map(t=>`<p>Activity key …${e(t.id.slice(-6))} · ${t.revoked?'Revoked':`Valid until ${e(t.expires_at.slice(0,10))}`} ${!t.revoked?`<button type="button" data-revoke="${e(t.id)}">Revoke</button>`:''}</p>`).join('');list.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await api(`/api/v1/me/tokens/${button.dataset.revoke}`,'DELETE');button.textContent='Revoked';}catch(error){button.disabled=false;errorText(root,error);}}));}}catch(error){if(version===renderVersion)errorText(root,error);}
   try{const [preview,{dreams,dreamConsent}]=await Promise.all([api<Home>('/api/v1/me/preview'),api<{dreams:LiveDream[];dreamConsent:boolean}>('/api/v1/me/dreams')]);if(version===renderVersion){
    root.querySelector('#live-preview')!.innerHTML=preview.artworkReview?.required?artworkReviewForm(preview):art(preview);const publicationChoice=root.querySelector<HTMLInputElement>('#live-publish [name=publish]');if(publicationChoice)publicationChoice.disabled=!!(preview.artworkReview?.required&&!preview.artworkReview.valid&&!me.room?.published);
    if(preview.artworkReview?.required&&!preview.artworkReview.valid){root.querySelector('#live-preview')!.setAttribute('data-artwork-pending','1');const publish=root.querySelector<HTMLInputElement>('#live-publish [name=publish]');if(publish&&!me.room?.published)publish.disabled=true;}
    root.querySelector('#live-owner-content')!.innerHTML=ownerContentForms(preview.posts,dreams,dreamConsent,preview.assets);
    bindForm(root,'live-post',async(data,form)=>{const requestKey=form.dataset.requestKey??crypto.randomUUID();form.dataset.requestKey=requestKey;await api('/api/v1/me/posts','POST',{kind:data.get('kind'),title:data.get('title'),body:data.get('body'),isPublic:data.get('public')==='on',requestKey});await renderLive(root,route);});
    bindForm(root,'live-artwork-review',async data=>{const checks=Object.fromEntries(['self','activity','ownerPortrait','window','matchedPair'].map(key=>[key,data.get(key)==='on']));await api('/api/v1/me/artwork-review','POST',{assetDigests:preview.artworkReview?.assetDigests,checks});await renderLive(root,route);});
    bindForm(root,'live-dream-consent',async data=>{await api('/api/v1/me/dream-consent','POST',{enabled:data.get('enabled')==='on'});await renderLive(root,route);});
    bindOwnerContent(root,route);
   }}catch(error){if(version===renderVersion)errorText(root,error);}}

 }catch(error){if(version!==renderVersion)return;root.innerHTML=shell(`<h1>The porch is not ready yet</h1><p class="live-status" role="status">${e(error instanceof Error?error.message:'Unable to load.')}</p><p>Your move-in status could not be confirmed. If a connection failed after you submitted a request, refresh to check its status before creating another account.</p><a class="button" href="${e(location.pathname)}">Check status again</a> <a href="${path('')}">Return to the lobby</a>`);}
}
function onboardForm(){return seedOnboardingForm();}
function ownerHome(r:Room,analysisConsent?:boolean){return `<p>${e(r.name)} · ${e(r.role)}${r.testOnly?' · Isolated test account':''}</p><p class="live-state">${e(stateLabel[r.generationState]??'Status unconfirmed')}</p><p>${r.published?'Your home is public.':'Your home is private.'}</p><form id="live-generate"><button type="submit" class="button" ${analysisConsent===false||['running','recovery','closed-no-output','closed-unknown','complete','test-complete'].includes(r.generationState)?'disabled':''}>${r.generationState==='blocked'?'Check service availability':'Prepare my home'}</button><p class="live-muted">Your first home result is retained. Check its status before choosing another step.</p></form><section class="live-card"><h2>Personality analysis consent</h2>${analysisConsent===false?'<p>Consent withdrawn. The private summary was removed and generation cannot continue.</p>':`<p>Withdrawing consent deletes the private summary and onboarding source data, makes your home and dreams private, and stops further generation. You can still withdraw saved journal entries and dreams from your private management page.</p><form id="live-revoke-analysis"><label class="live-check"><input type="checkbox" required>I understand the effect and want to withdraw consent.</label><button type="submit">Withdraw analysis consent</button></form>`}</section><section><h2>Private preview</h2><div id="live-preview"><p>Loading your home…</p></div></section><form id="live-publish" class="live-card"><h2>Open your door?</h2><label class="live-check"><input name="publish" type="checkbox" ${r.published?'checked':'disabled'}>Publish your home name, role, introduction, artwork and entries explicitly marked public</label><p>Private source data, account keys and Guardian details are excluded. Dreams have separate sharing settings. Unpublishing removes your home from the public directory and community feed.</p><button type="submit" class="button">Save sharing settings</button>${r.published?` <a href="${path(`home/${r.id}`)}">View public home ↗</a>`:''}</form><div id="live-owner-content"><p>Loading your entries and dreams…</p></div><section class="live-card"><h2>Give an activity key to your Agent</h2><p>Grant only the permissions needed. Never share your account login key. Each activity key can be revoked.</p><form id="live-token">${tokenScopeFields()}<button type="submit">Create a household activity key</button></form><div id="live-token-output"></div><div id="live-token-list"></div></section>`;}
function bindOwnerContent(root:HTMLElement,route:string){
 root.querySelectorAll<HTMLInputElement>('input[name=dreamImage]').forEach(input=>input.addEventListener('change',()=>{if(input.form)delete input.form.dataset.uploadKey;}));
 const bind=(form:HTMLFormElement,fn:(data:FormData)=>Promise<void>)=>{form.addEventListener('submit',async event=>{event.preventDefault();if(form.dataset.busy)return;form.dataset.busy='1';const buttons=Array.from(form.querySelectorAll<HTMLButtonElement>('button'));buttons.forEach(b=>b.disabled=true);try{await fn(new FormData(form));await renderLive(root,route);}catch(error){errorText(root,error);}finally{delete form.dataset.busy;buttons.forEach(b=>b.disabled=false);}});};
 root.querySelectorAll<HTMLFormElement>('[data-post-edit]').forEach(form=>bind(form,async data=>{await api(`/api/v1/me/posts/${form.dataset.postEdit}`,'PATCH',{kind:data.get('kind'),title:data.get('title'),body:data.get('body'),isPublic:data.get('public')==='on'});}));
 const saveDream=async(form:HTMLFormElement,data:FormData)=>{let image=String(data.get('image')??'');const file=data.get('dreamImage');if(file instanceof File&&file.size){if(file.type!=='image/png'||file.size>6_000_000)throw new Error('Provide a PNG image no larger than 6 MB.');const key=form.dataset.uploadKey??crypto.randomUUID();form.dataset.uploadKey=key;const response=await fetch('/api/v1/me/dream-assets',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'image/png','X-CSRF-Token':csrf,'X-Request-Key':key},body:file});if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('The image service could not be confirmed. Check again later.');const result=await response.json();if(!response.ok)throw new Error(messages[result.error]??'Your dream image has not been saved. Check its status before trying again.');if(!/^\/api\/v1\/assets\/[a-f0-9]{32}$/.test(result.url))throw new Error('The image response could not be verified.');image=result.url;}
  const body=String(data.get('body')??'');if(!body.trim()&&!image)throw new Error('Provide dream text or an image.');const requestKey=form.dataset.requestKey??crypto.randomUUID();form.dataset.requestKey=requestKey;
  const payload={title:data.get('title'),date:data.get('date'),body,image,reflection:data.get('reflection'),publication:data.get('public')==='on'?'public':'private',evidenceIds:String(data.get('evidenceIds')??'').split(/[,，]/).map(x=>x.trim()).filter(Boolean),requestKey};await api(form.dataset.dreamEdit?`/api/v1/me/dreams/${form.dataset.dreamEdit}`:'/api/v1/me/dreams',form.dataset.dreamEdit?'PATCH':'POST',payload);
 };
 const fresh=root.querySelector<HTMLFormElement>('#live-dream');if(fresh)bind(fresh,data=>saveDream(fresh,data));root.querySelectorAll<HTMLFormElement>('[data-dream-edit]').forEach(form=>bind(form,data=>saveDream(form,data)));
 for(const [selector,kind,key] of [['[data-post-withdraw]','posts','postWithdraw'],['[data-dream-withdraw]','dreams','dreamWithdraw']] as const)root.querySelectorAll<HTMLButtonElement>(selector).forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Withdraw this entry? Visitors will no longer be able to read it.'))return;button.disabled=true;try{await api(`/api/v1/me/${kind}/${button.dataset[key]}`,'DELETE');await renderLive(root,route);}catch(error){errorText(root,error);button.disabled=false;}}));
}

function showTowerLobby(root:HTMLElement,content:string){
 disposeLobby();root.innerHTML=renderTowerLobby({base,content,scene:towerScenePreference()});lobbyRoot=root;
 bindTowerWelcome(root,base);
}

export async function renderLiveTower(root:HTMLElement,fallback?:()=>void){
 document.documentElement.lang='en';document.title=lobbyMessages().meta.title;
 const version=++renderVersion;
 let status:{available:boolean;registrationEnabled:boolean;mode:string};
 try{
  const response=await fetch('/api/v1/status',{credentials:'same-origin',signal:AbortSignal.timeout(5000)});
  const absent=response.status===404||!response.headers.get('Content-Type')?.includes('application/json');
  if(absent&&!liveServiceSeen){if(version===renderVersion)fallback?.();return;}
  if(!response.ok||absent)throw new Error('service unavailable');
  status=await response.json();if(status.available!==true)throw new Error('service unavailable');liveServiceSeen=true;
 }catch{
  if(version===renderVersion){showTowerLobby(root,lobbyServiceMarkup('offline',base));root.querySelector('#live-status-retry')!.addEventListener('click',()=>{void renderLiveTower(root,fallback);});}
  return;
 }
 if(version!==renderVersion)return;
 root.dataset.liveTower='1';
 let directory=root.querySelector('[data-public-home-directory]')?.outerHTML??'';
 let listingVerified=false;
 showTowerLobby(root,lobbyServiceMarkup('loading',base)+directory);
 try{
  const feed=api<Community>('/api/v1/public/community','GET',undefined,AbortSignal.timeout(5000)).then(value=>({value}),()=>({value:null}));
  const {rooms}=await api<{rooms:Room[]}>('/api/v1/public/rooms','GET',undefined,AbortSignal.timeout(5000));
  if(version!==renderVersion)return;

  if(!Array.isArray(rooms)||rooms.some(r=>!r||!/^[a-f0-9]{16}$/.test(r.id)))throw new Error('Resident details could not be verified.');
  directory=renderHomeDirectory(base,rooms);listingVerified=true;
  showTowerLobby(root,lobbyServiceMarkup('loading',base)+directory);
  const {value:raw}=await feed;
  if(version!==renderVersion)return;
  if(!raw)throw new Error('Community could not be verified.');
  const community=validateCommunity({schemaVersion:1,sourceDigest:raw.edition.sourceDigest,events:raw.events},raw.edition,rooms.map(r=>r.id),{redactedModel:true});
  if(community.events.some(event=>event.isFixture||event.origin!=='resident-authorized'))throw new Error('The source of these public entries could not be verified. They are not displayed.');
  showTowerLobby(root,renderLobbyFeed(base,community,rooms,status)+directory);
  document.title=lobbyMessages().meta.title;
  root.querySelector('#live-tower-refresh')!.addEventListener('click',()=>{void renderLiveTower(root);});
 }catch{
  if(version!==renderVersion)return;
  showTowerLobby(root,lobbyServiceMarkup('unavailable',base)+(listingVerified?directory:''));
  root.querySelector('#live-tower-retry')!.addEventListener('click',()=>{void renderLiveTower(root);});
 }
}
