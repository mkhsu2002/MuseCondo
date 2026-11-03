import {isLiveRoute,createNavigationEpoch} from './route-policy.ts';
import {installFounderLinks} from './shared/founder-link.ts';
// Render-blocking styles keep the server lobby intact while live JavaScript loads.
import './live/tower-welcome.css';
import './live.css';
import './base.css';
const root=document.querySelector<HTMLDivElement>('#app')!;
installFounderLinks(root);
const base=import.meta.env.BASE_URL.replace(/\/$/,'');
const navigation=createNavigationEpoch();
let live:typeof import('./live')|undefined;
let demo:ReturnType<typeof import('./demo').mountDemo>|undefined;
function finish(focus:boolean){
 if(focus){const main=root.querySelector<HTMLElement>('main');if(main){main.tabIndex=-1;main.focus({preventScroll:true});}}
 if(location.hash)requestAnimationFrame(()=>{try{document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();}catch{/* Invalid fragment has no target. */}});
 else if(focus)window.scrollTo({top:0,behavior:'instant'});
}
export async function navigate(focus=false){
 const isCurrent=navigation.begin();
 live?.cancelLiveRender();
 demo?.dispose();demo=undefined;
 let pathname:string;
 try{pathname=decodeURI(location.pathname).slice(base.length).replace(/^\/|\/$/g,'');}catch{pathname='invalid-path';}
 // The standalone historical build never contacts a live API.
 const liveRoute=!import.meta.env.VITE_MUSE_DEMO && (!pathname||isLiveRoute(pathname));
 if(liveRoute){
  const module=await import('./live');if(!isCurrent())return;live=module;
  if(!pathname)await module.renderLiveTower(root);
  else await module.renderLive(root,pathname);
 }else{
  const module=await import('./demo');if(!isCurrent())return;
  demo=module.mountDemo();demo.render(focus);
 }
 if(isCurrent())finish(focus);
}
root.addEventListener('click',event=>{
 const anchor=(event.target as Element).closest<HTMLAnchorElement>('a');
 if(!anchor||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||anchor.target||anchor.hasAttribute('download'))return;
 const url=new URL(anchor.href);if(url.origin!==location.origin||!url.pathname.startsWith(base+'/'))return;
 // Native fragment navigation retains the existing lobby image and video.
 if(url.pathname===location.pathname&&url.hash)return;
 if(!anchor.hasAttribute('data-route')&&!/^\/(?:move-in|neighbors|home(?:\/|$)|me(?:\/|$))/.test(url.pathname.slice(base.length))&&url.pathname!==base+'/')return;
 event.preventDefault();history.pushState({},'',url);void navigate(true);
});
window.addEventListener('popstate',()=>{void navigate(true);});
void navigate();
