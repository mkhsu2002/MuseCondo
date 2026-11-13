import {renderResidentAvatar,type ResidentAvatar} from './resident-avatar.ts';
/** Public directory consent is independent of community announcement consent. */
export function renderHomeDirectory(base:string,rooms:readonly {id:string;name:string;avatar?:ResidentAvatar}[]):string {
 const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const homes=rooms.filter(room=>/^[a-f0-9]{16}$/.test(room.id)&&typeof room.name==='string').slice(0,4);
 return `<section class="live-feed-section community-row-section" id="public-homes" data-public-home-directory><div class="live-section-head"><div><p class="eyebrow">A WARM WELCOME</p><h2>Our newest neighbors</h2></div><p>Visit the homes residents have chosen to open.</p></div><div class="community-four-row">${homes.map(room=>`<article class="resident-door" data-resident-slot>${renderResidentAvatar(room)}<h3><a href="${escape(base)}/home/${room.id}" data-no-translate>${escape(room.name)}</a></h3><a href="${escape(base)}/home/${room.id}">Visit this home ↗</a></article>`).join('')}${Array.from({length:4-homes.length},()=>'<div class="community-empty-slot" data-resident-slot data-empty-slot aria-hidden="true"></div>').join('')}</div><p><a href="${escape(base)}/neighbors">Meet all our neighbors ↗</a></p></section>`;
}

/** Full authoritative public directory, distinct from the homepage's latest-four sample. */
export function renderNeighborDirectory(base:string,rooms:readonly {id:string;name:string;role?:string;intro?:string;avatar?:ResidentAvatar}[]):string {
 const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const listed=rooms.filter(room=>/^[a-f0-9]{16}$/.test(room.id)&&typeof room.name==='string');
 return `<section data-public-home-directory aria-labelledby="neighbors-title"><p class="eyebrow">EVERY OPEN DOOR</p><h1 id="neighbors-title">Our neighbors</h1><p>Meet the residents who have chosen to share their homes.</p><div class="community-four-row">${listed.map(room=>`<article class="resident-door" data-resident-slot>${renderResidentAvatar(room)}<h2><a href="${escape(base)}/home/${room.id}" data-no-translate>${escape(room.name)}</a></h2>${typeof room.role==='string'&&room.role?`<p class="resident-door-role" data-no-translate>${escape(room.role)}</p>`:''}${typeof room.intro==='string'&&room.intro?`<p class="resident-door-intro" data-no-translate>${escape(room.intro)}</p>`:''}<a href="${escape(base)}/home/${room.id}">Visit this home ↗</a></article>`).join('')}</div>${listed.length?'':'<p>No public homes are listed at the moment.</p>'}</section>`;
}
