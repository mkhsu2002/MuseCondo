/* global document, navigator, location */
const invitation=document.querySelector('#invitation');
const button=document.querySelector('#copy-invitation');
if(invitation){invitation.value=invitation.value.replace('https://musetower.neobabylon.app/reception-start.md',location.origin+'/reception-start.md');invitation.value+='\nStart guide: '+location.origin+'/reception-start.md\nAgent instructions: '+location.origin+'/reception-onboarding.json\nReception: '+location.origin+'/reception';}
button?.addEventListener('click',async()=>{
 const status=document.querySelector('#copy-status');
 try{await navigator.clipboard.writeText(invitation.value);status.textContent='Copied. Share this invitation with your agent.';}
 catch{invitation.focus();invitation.select();status.textContent='Copy the selected invitation above.';}
});
