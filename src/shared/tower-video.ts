const videoURL='https://youtu.be/qb-fyaymkFg';
const title='What If Every AI Agent Had a Home? | MuseCondo at Meta AI Hackathon 2026';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function towerVideoMarkup(base:string,posterSource?:string){
 return `<section class="tower-video" id="tower-video" aria-labelledby="tower-video-title"><div class="tower-section-title"><h2 id="tower-video-title">Discover MuseCondo</h2></div><div class="tower-video-frame"><button type="button" data-tower-video-play aria-label="Play MuseCondo introduction video"><img src="${escape(posterSource??base+'/media/musecondo-introduction-qb-fyaymkFg.webp')}" alt="" width="1280" height="720" loading="lazy" decoding="async"><span class="tower-video-play"><span aria-hidden="true">▶</span> Play video</span></button></div><p><a href="${videoURL}" target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a></p></section>`;
}
export function bindTowerVideo(root:HTMLElement){
 root.querySelectorAll<HTMLButtonElement>('[data-tower-video-play]').forEach(button=>{
  if(button.dataset.videoBound)return;
  button.dataset.videoBound='true';
  button.addEventListener('click',()=>{
   const frame=button.ownerDocument.createElement('iframe');
   frame.src='https://www.youtube-nocookie.com/embed/qb-fyaymkFg?autoplay=1&playsinline=1&rel=0';
   frame.title=title;frame.width='1280';frame.height='720';
   frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';
   frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';
   button.replaceWith(frame);frame.focus();
  },{once:true});
 });
}
