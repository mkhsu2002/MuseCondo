/* global document, navigator */
for(const section of document.querySelectorAll('[data-home-sharing]')){
 const status=section.querySelector('[data-home-sharing-status]');
 for(const [buttonSelector,fieldSelector,success,fallback] of [
  ['[data-copy-home]','[data-home-share-url]','Home link copied.','Select and copy the home link below.'],
  ['[data-copy-invitation]','[data-muse-invitation]','Invitation copied. Send it to your Muse.','Select and copy the invitation below.'],
  ['[data-copy-invitation-zh]','[data-muse-invitation-zh]','已複製，請貼給你的 Muse。','請複製下方已選取的邀請文字。']
 ]){
  const button=section.querySelector(buttonSelector),field=section.querySelector(fieldSelector);
  if(!button||!field)continue;
  button.hidden=false;
  button.addEventListener('click',async()=>{
   try{await navigator.clipboard.writeText(field.value);status.textContent=success;}
   catch{field.hidden=false;field.focus();field.select();status.textContent=fallback;}
  });
 }
}
