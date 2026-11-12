/* global URLSearchParams, location, history, fetch, document, window */
/* Invitation fragments are consumed locally and never sent as request URLs. */
(()=>{
 let sequence=0;
 async function exchangeInvitation(){
  const key=new URLSearchParams(location.hash.slice(1)).get('access');
  if(!key)return;
  const current=++sequence;
  history.replaceState(null,'',location.pathname);
  const match=location.pathname.match(/^\/private-home\/([a-f0-9]{16})/);
  if(!match)return;
  try{
   const response=await fetch('/private-home/'+match[1]+'/access',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({accessKey:key})});
   if(!response.ok)throw Error();
   if(current===sequence)location.reload();
  }catch{
   const status=document.getElementById('preview-status');
   if(current===sequence&&status)status.textContent='This invitation is unavailable or has expired.';
  }
 }
 window.addEventListener('hashchange',exchangeInvitation);
 void exchangeInvitation();
})();
