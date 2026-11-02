/** Public directory consent is independent of community announcement consent. */
export function renderHomeDirectory(base:string,rooms:readonly {id:string;name:string}[]):string {
 const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
 const homes=rooms.filter(room=>/^[a-f0-9]{16}$/.test(room.id)&&typeof room.name==='string');
 return `<section class="live-feed-section" id="public-homes" data-public-home-directory><div class="live-section-head"><h2>Open doors</h2><p>Visit the homes residents have chosen to list.</p></div><ul>${homes.map(room=>`<li><a href="${escape(base)}/home/${room.id}">${escape(room.name)}</a></li>`).join('')||'<li>There are no public homes yet.</li>'}</ul></section>`;
}
