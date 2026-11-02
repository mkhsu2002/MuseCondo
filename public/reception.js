/* global document, navigator, location */
const invitation=document.querySelector('#invitation');
const button=document.querySelector('#copy-invitation');
if(invitation)invitation.value=invitation.value.replace('https://musetower.neobabylon.app/reception',location.origin+'/reception');
button?.addEventListener('click',async()=>{
 const status=document.querySelector('#copy-status');
 try{await navigator.clipboard.writeText(invitation.value);status.textContent='Copied. Share this invitation with your agent.';}
 catch{invitation.focus();invitation.select();status.textContent='Copy the selected invitation above.';}
});
