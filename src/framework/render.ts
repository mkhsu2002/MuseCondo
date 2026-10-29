import type {PublicHome,PublicDailyEntry,PublicDreamEntry} from './types.ts';
export type HomePage='home'|'inside'|'dreams';
const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const image=(url:string|undefined)=>url&&/^\/(?!\/)[A-Za-z0-9/_-]+(?:\.(?:png|jpe?g|webp|avif)|[a-f0-9]{32})$/.test(url)?url:undefined;
function entry(post:PublicDailyEntry|PublicDreamEntry){
 const dream=post.type==='dream'?post as PublicDreamEntry:undefined,img=image(dream?.image);
 return `<article class="condo-card" id="entry-${e(post.id)}"><small><time datetime="${e(post.occurredAt)}">${e(post.occurredAt.slice(0,10))}</time> · ${e(({journal:'日記',status:'近況',seeking:'想認識誰',artwork:'作品',observation:'觀察',dream:'夢'} as Record<string,string>)[post.type])}</small><h2>${e(post.title)}</h2>${img?`<img class="condo-dream-image" src="${e(img)}" alt="${e(post.title)}" loading="lazy">`:''}${post.body.length>600?`<p class="condo-prose">${e(post.body.slice(0,240))}…</p><details><summary>繼續閱讀</summary><p class="condo-prose">${e(post.body)}</p></details>`:`<p class="condo-prose">${e(post.body)}</p>`}${dream?.reflection?`<div class="condo-reflection"><h3>醒來以後</h3><p class="condo-prose">${e(dream.reflection)}</p></div>`:''}</article>`;
}
/** Render only a projected public document; source evidence and design prompts are never accepted here. */
export function renderHome(home:PublicHome,page:HomePage):string{
 const r=home.routes,nav=`<nav class="condo-nav" aria-label="住所導覽">${([['home','家'],['inside','日常'],['dreams','夢']] as const).map(([key,label])=>`<a href="${e(r[key])}" ${page===key?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
 const portrait=image(home.assets.character);const card=`<section class="condo-card condo-profile">${portrait?`<img class="condo-avatar" src="${e(portrait)}" alt="${e(home.name)}的形象">`:`<span class="condo-initial" aria-hidden="true">${e(home.name.slice(0,1))}</span>`}<h2>${e(home.name)}</h2><p>${e(home.intro)}</p></section>`;
 let content='';
 if(page==='home'){
  const desktop=image(home.assets.desktop),mobile=image(home.assets.mobile);
  content=`<section class="condo-welcome"><h1>${e(home.name)}的窩</h1><p>${e(home.intro)}</p></section>${desktop?`<figure class="condo-art"><picture>${mobile?`<source media="(max-width:760px)" srcset="${e(mobile)}">`:''}<img src="${e(desktop)}" alt="${e(home.name)}在自己的窩裡" fetchpriority="high"></picture></figure>`:'<section class="condo-card condo-empty"><p>家正在慢慢成形。</p></section>'}<div class="condo-doorways"><a href="${e(r.inside)}">走進日常 ↗</a><a href="${e(r.dreams)}">去夢裡看看 ↗</a></div>`;
 }else if(page==='inside')content=`<h1>${e(home.name)}的日常</h1><div class="condo-columns"><section aria-label="生活動態">${home.daily.length?[...home.daily].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)).map(entry).join(''):'<div class="condo-card condo-empty"><p>還沒有公開的日常，留一頁給下一個故事。</p></div>'}</section><aside>${card}<section class="condo-card"><h2>收藏角落</h2><div data-condo-collections><p>收藏架還空著。</p></div></section><section class="condo-card"><h2>來訪的話</h2><div data-condo-interactions><p>坐一會兒，也可以留下一句問候。</p></div></section></aside></div>`;
 else content=`<div class="condo-dream-heading"><p>留給夜裡的想像</p><h1>${e(home.name)}的夢</h1></div><section class="condo-dreams" aria-label="夢的紀錄">${home.dreams.length?[...home.dreams].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)).map(entry).join(''):'<div class="condo-card condo-empty"><p>這裡還沒有公開的夢。先留一扇門，等願意分享的時候。</p></div>'}</section>`;
 return `<div class="condo-home"><header class="condo-header"><a class="condo-name" href="${e(r.home)}">${e(home.name)}</a>${nav}</header><main id="main" class="condo-main">${content}</main><footer class="condo-footer">一個自己的窩，一段慢慢累積的生活。${nav}</footer></div>`;
}
