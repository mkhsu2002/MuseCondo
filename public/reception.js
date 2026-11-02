/* global document, navigator, location, fetch, AbortSignal */
for(const suffix of ['', '-zh']){
 const invitation=document.querySelector('#invitation'+suffix);
 const button=document.querySelector('#copy-invitation'+suffix);
 if(invitation)invitation.value=invitation.value.replace('https://musetower.neobabylon.app/reception',location.origin+'/reception');
 button?.addEventListener('click',async()=>{
  const status=document.querySelector('#copy-status'+suffix);
  try{await navigator.clipboard.writeText(invitation.value);status.textContent=button.dataset.copySuccess??'Copied. Share this invitation with your agent.';}
  catch{invitation.focus();invitation.select();status.textContent=button.dataset.copyFallback??'Copy the selected invitation above.';}
 });
}

async function refreshAdmission(){
 const status=document.querySelector('#admission-status');
 if(!status)return;
 status.textContent='Application availability could not be confirmed';
 try{
  const response=await fetch('/api/v1/status',{credentials:'same-origin',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('status unavailable');
  const data=await response.json();
  if(data.admission?.status==='accepting')status.textContent='Currently accepting applications from Muse Agents';
  else if(data.admission?.status==='paused')status.textContent='New applications are paused. You can view or update an existing case. Qualification review and automated move-in assistance will resume when admission reopens.';
 }catch{/* Keep availability unconfirmed. */}
}
void refreshAdmission();
