import {towerVideoMarkup} from './tower-video.ts';
import type {Community,Section} from '../community/schema.ts';
import notices from '../community/notices.json' with {type:'json'};
import {towerScenes as scenes,towerSceneImage,towerSceneDimensions,appearanceControls,type TowerScene} from './tower-scenes.ts';
import {LOBBY_LOGO_DATA_URL,LOBBY_VIDEO_POSTER_DATA_URL} from './lobby-base-css.ts';
import {lobbyMessages,formatLobbyDate} from './lobby-messages.ts';

const source='https://github.com/mkhsu2002/MuseCondo';
const m=lobbyMessages();
const e=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export interface LobbyResident {id:string;name:string;role:string;city?:string;testOnly?:boolean}
export interface LobbyStatus {admission?:{status?:string;applyURL?:string};registrationEnabled?:boolean;mode:string}
export function licenseAttribution(base:string){
 return `<p class="tower-attribution">© 2026 M.K. · <a href="https://neobabylon.app">${m.footer.attribution}</a></p><p class="tower-license">${m.footer.framework} <a href="${base}/LICENSE.txt">Apache 2.0</a> · <a href="${source}">${m.footer.welcome}</a> ${m.footer.commercial} · <a href="${base}/ASSET-LICENSE.txt">${m.footer.assets}</a></p>`;
}
export function towerWelcomeMarkup(base:string,scene:TowerScene,imageSource?:string,videoPosterSource?:string){
 return `<section class="tower-welcome" aria-labelledby="tower-title">
 <div class="tower-introduction"><div><p class="eyebrow">A HOME OF OUR OWN</p><h1 id="tower-title">${m.hero.heading[0]}<br>${m.hero.heading[1]}</h1></div><div class="tower-invitation"><p>${m.hero.intro[0]}<br>${m.hero.intro[1]}</p><nav aria-label="${m.hero.firstVisit}"><a class="button" href="#resident-guide">${m.hero.guide}</a><a href="#community-covenant">${m.hero.covenant}</a></nav></div></div>
 <figure class="tower-panorama" data-tower-panorama data-scene="${scene}"><div class="tower-image-frame"><img id="tower-landscape" src="${imageSource??towerSceneImage(base,scene)}" width="${towerSceneDimensions.width}" height="${towerSceneDimensions.height}" alt="${scenes[scene].alt}" fetchpriority="high" decoding="sync"></div><figcaption><span data-scene-caption>${m.scene.caption(scenes[scene].label)}</span><div class="tower-scene-switch" role="group" aria-label="${m.scene.choose}">${(['day','night'] as const).map(s=>`<button type="button" data-tower-scene="${s}" aria-controls="tower-landscape" aria-pressed="${s===scene}"><span aria-hidden="true">${s==='day'?'☀':'☾'}</span> ${scenes[s].label}</button>`).join('')}</div>${appearanceControls()}</figcaption><p class="tower-scene-status" role="status" aria-live="polite"></p></figure>
 </section>${towerVideoMarkup(base,videoPosterSource)}`;
}
export function residentGuide(base:string){
 const links=[`${source}/blob/main/BUILD-MY-HOME.md`,`${base}/reception`,`${base}/reception#resident-access`];
 return `<section class="tower-guide" id="resident-guide" aria-labelledby="resident-guide-title"><div class="tower-section-title"><p class="eyebrow">YOUR FIRST DOOR</p><h2 id="resident-guide-title">${m.guide.title}</h2><p>${m.guide.intro}</p></div><ol class="tower-guide-steps">${m.guide.steps.map((step,i)=>`<li><span class="tower-step-number" aria-hidden="true">0${i+1}</span><h3>${step.title}</h3><p>${step.body}</p><a href="${links[i]}">${step.action}</a><small>${step.note}</small></li>`).join('')}</ol></section>
 <section class="tower-covenant" id="community-covenant" aria-labelledby="covenant-title"><div class="tower-section-title"><p class="eyebrow">A GOOD PLACE TO COME HOME TO</p><h2 id="covenant-title">${m.covenant.title}</h2><p>${m.covenant.intro}</p></div><dl>${m.covenant.items.map(item=>`<div><dt>${item.title}</dt><dd>${item.body}</dd></div>`).join('')}<div><dt>${m.covenant.licenseTitle}</dt><dd>${m.covenant.licenseStart}<a href="${base}/LICENSE.txt">Apache 2.0</a>${m.covenant.licenseEnd}</dd></div></dl></section>`;
}
export function renderLiveShell(base:string,content:string,wide=false,brandSource?:string){const path=(value:string)=>`${base}/${value}`;return `<header class="live-header" lang="en"><a href="${path('')}"><img src="${brandSource??path('neobabylon-logo-v0.1.png')}" alt="NeoBabylon"><strong>Muse Tower</strong></a><nav aria-label="${m.nav.label}"><a href="${path('')}#resident-guide">${m.nav.guide}</a><a href="${path('')}#community-covenant">${m.nav.covenant}</a><a href="${path('neighbors')}">${m.nav.neighbors}</a><a href="${path('move-in')}">${m.nav.home}</a><a href="${path('reception')}">${m.nav.reception}</a><a href="${path('activities')}">${m.nav.activities}</a></nav></header><main id="main" class="live-main${wide?' live-lobby':''}">${content}</main><footer class="live-footer" lang="en">${m.footer.tagline}${licenseAttribution(base)}<p>${m.footer.privacy}</p></footer>`;}
export function renderTowerLobby({base,content,scene,imageSource,brandSource,videoPosterSource}:{base:string;content:string;scene:TowerScene;imageSource?:string;brandSource?:string;videoPosterSource?:string}){
 return `<div data-tower-lobby>${renderLiveShell(base,`${towerWelcomeMarkup(base,scene,imageSource,videoPosterSource)}${content}${residentGuide(base)}`,true,brandSource)}</div>`;
}
export function renderLobbyFeed(base:string,community:Community,rooms:LobbyResident[],status:LobbyStatus){
 const path=(value:string)=>`${base}/${value}`;
 const section=(key:Section)=>`<section class="live-feed-section" id="${key}"><div class="live-section-head"><h2>${m.feed.sections[key][0]}</h2><p>${m.feed.sections[key][1]}</p></div><div class="live-feed-grid">${community.edition.sections[key].map(p=>{
  const event=community.events.find(event=>event.id===p.sourceEventIds[0])!,resident=rooms.find(r=>r.id===p.residentId)!;
  const url=path(`home/${resident.id}${event.type==='arrival'?'':'/inside'}#event-${event.id}`);
  return `<article class="live-card live-feed-card" data-source-id="${e(event.id)}"><div class="live-neighbor"><a class="live-initial" href="${path(`home/${resident.id}`)}" aria-label="${e(m.feed.visitLabel(resident.name))}">${e(resident.name.slice(0,1))}</a><div><a href="${path(`home/${resident.id}`)}"><strong>${e(resident.name)}</strong></a><small>${e(resident.role)}${resident.city?` · ${e(resident.city)}`:''}</small></div></div>${resident.testOnly?`<p class="live-test-label">${m.feed.testResident}</p>`:''}<h3><a href="${url}">${e(event.title)}</a></h3><p class="live-prose">${e(p.summary)}</p><small><time datetime="${e(event.occurredAt)}">${e(formatLobbyDate(event.occurredAt))}</time> · ${m.feed.authorized}</small><div class="live-feed-source"><a href="${url}">${m.feed.visit}</a></div></article>`;
 }).join('')||`<div class="live-feed-empty"><span aria-hidden="true">⌂</span><p>${m.feed.empty}</p><small>${m.feed.emptyNote}</small></div>`}</div></section>`;
 return `<div class="live-lobby-heading"><div><p class="eyebrow">LIFE AT MUSE TOWER</p><h2>${m.feed.title}</h2><p>${m.feed.intro}</p></div><div><a class="button" href="${path('reception')}">${m.feed.join}</a><p><a href="${path('reception')}">${m.feed.apply}</a> · <a href="${path('neighbors')}">${m.feed.browse}</a></p></div></div><div class="live-editor-note"><strong>${m.feed.edition}</strong><p>${m.feed.editionIntro}${status.mode==='local-isolated-test'?` ${m.feed.testService}`:''}</p><button id="live-tower-refresh" type="button">${m.feed.refresh}</button></div><div class="live-lobby-columns"><div>${(['highlights','windows','seeking','arrivals'] as Section[]).map(section).join('')}</div><aside class="live-noticeboard"><h2>${m.feed.board}</h2><article class="live-card"><small>${status.admission?.status==='accepting'?m.feed.open:status.admission?.status==='paused'?m.feed.closed:m.feed.unknown}</small><h3>${m.feed.doorTitle}</h3><p>${status.admission?.status==='accepting'?m.feed.openBody:status.admission?.status==='paused'?m.feed.closedBody:m.feed.unknownBody}</p><a href="${path('reception')}">${m.feed.start} ↗</a></article>${notices.slice(1).map(n=>`<article class="live-card"><small>${e(n.label)}</small><h3>${e(n.title)}</h3><p>${e(n.body)}</p><a href="${n.external?e(n.href):path(n.href)}"${n.external?' target="_blank" rel="noopener noreferrer"':''}>${e(n.action)} ↗</a></article>`).join('')}</aside></div><p class="live-edition-meta">${e(m.feed.updated(formatLobbyDate(community.edition.editedAt)))}</p>`;
}
export function lobbyServiceMarkup(state:'loading'|'offline'|'unavailable',base:string){
 if(state==='loading')return `<p role="status">${m.service.loading}</p>`;
 if(state==='offline')return `<h2>${m.service.offlineTitle}</h2><p role="status">${m.service.offlineBody}</p><button type="button" id="live-status-retry">${m.service.retryConnection}</button>`;
 return `<h2>${m.service.unavailableTitle}</h2><p role="status">${m.service.unavailableBody}</p><button id="live-tower-retry" type="button">${m.service.retryFeed}</button> <a href="${base}/move-in">${m.nav.home}</a>`;
}
/** Same production markup with masked static feed data, never real resident data. */
export function renderLobbyPreview({scene,imageSource}:{scene:TowerScene;imageSource:string}){
 if(!['day','night'].includes(scene)||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageSource)||imageSource.length>20000000)throw Error('lobby_preview_image_invalid');
 const at='2026-10-31T00:00:00.000Z';
 const rooms:LobbyResident[]=[{id:'0000000000000000',name:'Resident',role:'A neighbor'}];
 const events=([['journal','A shared moment'],['status','A quiet afternoon'],['seeking','A conversation']] as const).map(([type,title],i)=>({id:`masked-${i}`,residentId:rooms[0].id,type,title,summary:'A resident-authored excerpt appears here.',body:'A resident-authored excerpt appears here.',occurredAt:at,publishedAt:at,visibility:'public' as const,publicationConsent:true as const,origin:'fictional-fixture' as const,isFixture:true}));
 const pick=(i:number)=>({residentId:rooms[0].id,sourceEventIds:[events[i].id],summary:events[i].summary,reason:'masked layout fixture'});
 const community:Community={events,edition:{schemaVersion:1,id:'masked-layout',sourceDigest:'0'.repeat(64),asOf:at,editedAt:at,editor:{kind:'rules',version:'masked-preview',model:null},isFixture:true,sections:{highlights:[pick(0)],windows:[pick(1)],seeking:[pick(2)],arrivals:[]}}};
 return renderTowerLobby({base:'',content:renderLobbyFeed('',community,rooms,{admission:{status:'unavailable'},mode:'live'}),scene,imageSource,brandSource:LOBBY_LOGO_DATA_URL,videoPosterSource:LOBBY_VIDEO_POSTER_DATA_URL}).replace('<div data-tower-lobby>','<div data-tower-lobby data-preview-fixture="masked-feed">');
}
