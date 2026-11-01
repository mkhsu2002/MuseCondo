/* global document, fetch, crypto, FormData */
(()=>{
 'use strict';
 const widget=document.querySelector('[data-visit-room]'),inbox=document.querySelector('[data-visit-inbox]');if(!widget&&!inbox)return;
 const root=widget||inbox,base='/api/v1/me/tower-intake/visits',status=root.querySelector('[data-visit-status]');
 const giftNames={'gift-sprout':'A little sprout 🌱','gift-cloud':'A cloud ☁','gift-coffee':'A cup of coffee ☕'},states={published:'Public visit',pending:'Private invitation awaiting a reply',accepted:'Accepted private invitation',rejected:'Hidden',withdrawn:'Withdrawn'};
 const errors={sign_in_required:'Please sign in to your home first.',csrf_rejected:'Your session has changed. Please refresh the page.',authorization_changed:'Your authorization has changed. Please sign in again.',visit_state_conflict:'This visit has changed. Refresh the page before continuing.',visit_target_changed:'This home has changed. Open it again before visiting.',home_not_found:'This home is not open to visitors.',visit_rate_limited:'Please wait a minute before making another visit.',contacts_or_links_not_allowed:'Do not include contact details or links in public messages or nicknames.',idempotency_conflict:'The content has changed. Refresh the page before submitting again.',invalid_visit_text:'Please check the length of your nickname and message.',no_home:'Your home is not connected yet. You can still see visits you have sent.'};
 let csrf='',signedIn=false;
 const say=message=>{status.textContent=message;};
 async function api(path,method='GET',body){const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});let data;try{data=await response.json();}catch{throw new Error('Unable to connect. Please try again later.');}if(!response.ok){const error=new Error(errors[data.error]||'Unable to complete this now. Refresh the page and try again.');error.code=data.error;throw error;}return data;}
 function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
 function button(label,fn){const node=el('button',label);node.type='button';node.addEventListener('click',async()=>{if(node.disabled)return;node.disabled=true;try{await fn();}catch(error){say(error.message);}finally{node.disabled=false;}});return node;}
 function card(item,mode){
  const article=el('article');article.className='tower-visit-card';article.append(el('h3',item.nickname||'Withdrawn visit'));
  const meta=el('div');meta.className='tower-visit-meta';meta.append(el('small',item.state?states[item.state]:'Public visit'),el('small',new Date(item.createdAt).toLocaleString('en-US')));article.append(meta);
  if(item.giftId)article.append(el('p',giftNames[item.giftId]||''));if(item.body)article.append(el('p',item.body));
  if(mode==='sent'){const link=el('a','Visit this home');link.href=item.targetDoor+'/inside#tower-visits';article.append(link);}
  const act=(action,route)=>{const requestKey=crypto.randomUUID();return async()=>{await api(base+'/'+item.id+'/'+route,'POST',{expectedVersion:item.version,requestKey,...(route==='moderate'?{action}:{})});say(action==='withdraw'?'This visit has been withdrawn.':'This visit has been updated.');await reloadPrivate();};};
  if(mode==='sent'&&item.state!=='withdrawn')article.append(button('Withdraw',act('withdraw','withdraw')));
  if(mode==='received'&&item.kind==='invitation'&&item.state==='pending'){article.append(button('Accept invitation',act('accept','moderate')),button('Decline invitation',act('reject','moderate')));}
  if(mode==='received'&&item.state==='published')article.append(button('Hide this visit',act('hide','moderate')));
  return article;
 }
 let receivedCursor=null,sentCursor=null;
 async function privatePage(sent,append=false){
  const box=root.querySelector(sent?'[data-visit-sent]':'[data-visit-received]'),more=root.querySelector(sent?'[data-more-sent]':'[data-more-received]'),cursor=sent?sentCursor:receivedCursor;
  if(!append)box.replaceChildren();
  try{const data=await api(base+(sent?'/sent':'')+(append&&cursor?'?cursor='+encodeURIComponent(cursor):''));if(!data.visits.length&&!append)box.append(el('p',sent?'You have not sent any visits yet.':'You have not received any visits yet.'));data.visits.forEach(item=>box.append(card(item,sent?'sent':'received')));if(sent)sentCursor=data.nextCursor;else receivedCursor=data.nextCursor;more.hidden=!data.nextCursor;}
  catch(error){if(error.code==='no_home'&&!sent){box.textContent=errors.no_home;more.hidden=true;return;}throw error;}
 }
 async function reloadPrivate(){await privatePage(false);await privatePage(true);}
 async function publicPage(append=false){const box=root.querySelector('[data-visit-list]'),more=root.querySelector('[data-visit-more]'),cursor=more.dataset.cursor;if(!append)box.replaceChildren();const data=await api('/api/v1/tower/rooms/'+widget.dataset.visitRoom+'/visits'+(append&&cursor?'?cursor='+encodeURIComponent(cursor):''));if(!data.visits.length&&!append)box.append(el('p','No messages yet. Leave a greeting.'));data.visits.forEach(item=>box.append(card(item,'public')));more.hidden=!data.nextCursor;more.dataset.cursor=data.nextCursor||'';}
 async function start(){
  const session=await api('/api/v1/session');signedIn=session.signedIn;csrf=session.csrf||'';
  if(inbox){root.querySelector('[data-visit-login]').hidden=signedIn;if(!signedIn){say('Sign in to view your visits and invitations.');return;}root.querySelector('[data-visit-private]').hidden=false;root.querySelector('[data-more-received]').addEventListener('click',()=>privatePage(false,true).catch(error=>say(error.message)));root.querySelector('[data-more-sent]').addEventListener('click',()=>privatePage(true,true).catch(error=>say(error.message)));await reloadPrivate();say('Invitations stay private between the sender and recipient.');return;}
  await publicPage();root.querySelector('[data-visit-more]').addEventListener('click',()=>publicPage(true).catch(error=>say(error.message)));
  root.querySelector('[data-visit-login]').hidden=signedIn;const form=root.querySelector('form');form.hidden=!signedIn;if(!signedIn){say('Sign in to leave a message, send a small gift or invite someone privately.');return;}
  const kind=form.elements.namedItem('kind'),gift=form.querySelector('[data-visit-gift]'),body=form.elements.namedItem('body'),note=form.querySelector('[data-visit-privacy]');
  const changed=()=>{gift.hidden=kind.value!=='gift';body.maxLength=kind.value==='invitation'?1000:280;note.textContent=kind.value==='invitation'?'Only you and this resident can read it. Accepting an invitation does not make it public.':'Messages and small gifts appear in this home’s visitor area. Do not include contact details or links.';delete form.dataset.requestKey;};
  kind.addEventListener('change',changed);form.addEventListener('input',()=>{delete form.dataset.requestKey;});changed();
  form.addEventListener('submit',async event=>{event.preventDefault();const submit=form.querySelector('button[type=submit]');if(submit.disabled)return;submit.disabled=true;const data=new FormData(form),key=form.dataset.requestKey||crypto.randomUUID();form.dataset.requestKey=key;
   try{await api(base+'/send','POST',{targetDoor:'/home/'+widget.dataset.visitRoom,requestKey:key,kind:data.get('kind'),nickname:data.get('nickname'),body:data.get('body'),...(kind.value==='gift'?{giftId:data.get('giftId')}:{})});say(kind.value==='invitation'?'Your private invitation has been sent.':'Your visit has been posted.');body.value='';delete form.dataset.requestKey;await publicPage();}catch(error){say(error.message);}finally{submit.disabled=false;}
  });say('You are welcome to leave a greeting.');
 }
 start().catch(error=>say(error.message));
})();
