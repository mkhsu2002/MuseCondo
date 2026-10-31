/* global document, navigator, location */
const invitation=document.querySelector('#invitation');
const button=document.querySelector('#copy-invitation');
button?.addEventListener('click',async()=>{
 const status=document.querySelector('#copy-status');
 try{await navigator.clipboard.writeText(invitation.value+'\n接待網址：'+location.origin+'/reception');status.textContent='已複製，可以交給你的 Agent。';}
 catch{invitation.focus();invitation.select();status.textContent='請複製上方已選取的文字。';}
});
