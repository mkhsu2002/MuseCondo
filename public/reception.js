/* global document, navigator, location */
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
