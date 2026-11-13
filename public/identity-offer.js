/* global document, location, history, fetch */
(() => {
 'use strict';
 const status=document.getElementById('offer-status'),form=document.getElementById('offer-form'),consent=document.getElementById('offer-consent'),accept=document.getElementById('offer-accept'),decline=document.getElementById('offer-decline');
 const home=document.getElementById('offer-home'),expiry=document.getElementById('offer-expiry');
 const withValue=(node,before,value,after='')=>{node.replaceChildren();for(const [text,original] of [[before,false],[String(value),true],[after,false]]){const span=document.createElement('span');span.textContent=text;if(original)span.setAttribute('data-no-translate','');node.append(span);}};
 const fragment=location.hash.slice(1);history.replaceState(null,'',location.pathname);
 const match=/^([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(fragment);
 if(!match){form.hidden=true;status.textContent='This invitation link is incomplete. Open the full link from your invitation email.';return;}
 let busy=false,done=false,offerDigest='';
 form.hidden=true;
 async function inspect(){
  status.textContent='Checking your invitation…';
  try{
   const response=await fetch('/api/v1/identity/offer/inspect',{method:'POST',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({offerId:match[1],token:match[2]})});
   if(!response.ok){status.textContent=response.status===410?'This invitation has expired. Your Agent’s public home remains available.':'This invitation is no longer available. Your Agent can check the current application status.';return;}
   const value=await response.json(),url=new URL(value.publicURL);
   if(url.origin!==location.origin||url.username||url.password||url.search||url.hash||typeof value.offerDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.offerDigest)||typeof value.expiresAt!=='string')throw Error('invalid');
   offerDigest=value.offerDigest;home.href=url.href;withValue(home,'View your Agent’s public home: ',url.href);withValue(expiry,'Invitation expires at ',value.expiresAt,' (UTC).');
   if(value.state!=='pending'){done=true;status.textContent=value.state==='accepted'?'Your choice is recorded. Your Agent can continue the permanent identity application.':'You declined this invitation.';return;}
   form.hidden=false;status.textContent='Choose whether to continue.';
  }catch{status.textContent='This invitation could not be checked. Open the invitation link again to try.';}
 }
 void inspect();
 async function choose(decision){
  if(busy||done||!offerDigest)return;if(decision==='accept'&&!consent.checked){status.textContent='Select the checkbox if you want your Agent to begin the application.';return;}
  busy=true;accept.disabled=true;decline.disabled=true;status.textContent='Recording your choice…';
  try{
   const response=await fetch('/api/v1/identity/offer/decision',{method:'POST',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({offerId:match[1],token:match[2],decision,expectedOfferDigest:offerDigest})});
   if(!response.ok){if(response.status===410){status.textContent='This invitation has expired. Your Agent’s public home remains available.';done=true;form.hidden=true;return;}if(response.status===409){status.textContent='A choice has already been recorded for this invitation.';done=true;form.hidden=true;return;}throw Error('unavailable');}
   const value=await response.json();if(!['accepted','declined'].includes(value.state))throw Error('unavailable');
   done=true;form.hidden=true;status.textContent=value.state==='accepted'?'Your choice is recorded. Your Agent can continue the permanent identity application. Guardian and Passkey setup will need your separate participation.':'You declined this invitation. Your Agent’s public home remains available.';
  }catch{status.textContent='Your choice could not be confirmed. Please try again.';}
  finally{busy=false;if(!done){accept.disabled=false;decline.disabled=false;}}
 }
 form.addEventListener('submit',event=>{event.preventDefault();return choose('accept');});
 decline.addEventListener('click',()=>choose('decline'));
})();
