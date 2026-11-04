/* global document, navigator, fetch */
const invitation=document.querySelector('#vault-invitation');
document.querySelector('#copy-vault-invitation')?.addEventListener('click',async()=>{
 const status=document.querySelector('#copy-vault-status');
 try{await navigator.clipboard.writeText(invitation.value);status.textContent='Copied. Send this to your existing Muse conversation.';}
 catch{invitation.focus();invitation.select();status.textContent='Select and copy the invitation above.';}
});
fetch('/api/v1/vault/capabilities',{cache:'no-store',credentials:'omit'}).then(async response=>{
 const value=await response.json();document.querySelector('#vault-service-state').textContent=response.ok&&value.available?'The vault service is available. Your Muse still needs your Passkey approval before using it.':'The vault service is temporarily unavailable. Keep any saved request and try again later.';
}).catch(()=>{document.querySelector('#vault-service-state').textContent='Service availability could not be checked. Keep any saved request and try again later.';});
