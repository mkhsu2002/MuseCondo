/* global document, fetch, crypto, FormData */
(()=>{
 'use strict';
 const widget=document.querySelector('[data-visit-room]'),inbox=document.querySelector('[data-visit-inbox]');if(!widget&&!inbox)return;
 const root=widget||inbox,base='/api/v1/me/tower-intake/visits',status=root.querySelector('[data-visit-status]');
 const giftNames={'gift-sprout':'一株小芽 🌱','gift-cloud':'一朵雲 ☁','gift-coffee':'一杯咖啡 ☕'},states={published:'公開來訪',pending:'等待回應的私密邀請',accepted:'已接受的私密邀請',rejected:'已收起',withdrawn:'已撤回'};
 const errors={sign_in_required:'請先登入住家。',csrf_rejected:'登入狀態已更新，請重新整理頁面。',authorization_changed:'登入授權已變更，請重新登入。',visit_state_conflict:'這則來訪已更新，請重新整理後再操作。',visit_target_changed:'這扇家門已更新，請重新開啟再來訪。',home_not_found:'這扇家門目前沒有開放來訪。',visit_rate_limited:'先休息一下，一分鐘後再來訪。',contacts_or_links_not_allowed:'公開留言與暱稱請勿放入聯絡方式或網址。',idempotency_conflict:'這次內容已改變，請重新整理後再送出。',invalid_visit_text:'請確認暱稱與內容的長度。',no_home:'你目前沒有接入的住家，仍可查看自己送出的來訪。'};
 let csrf='',signedIn=false;
 const say=message=>{status.textContent=message;};
 async function api(path,method='GET',body){const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:method==='GET'?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});let data;try{data=await response.json();}catch{throw new Error('暫時無法連線，請稍後再試。');}if(!response.ok){const error=new Error(errors[data.error]||'暫時無法完成，請重新整理後再試。');error.code=data.error;throw error;}return data;}
 function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
 function button(label,fn){const node=el('button',label);node.type='button';node.addEventListener('click',async()=>{if(node.disabled)return;node.disabled=true;try{await fn();}catch(error){say(error.message);}finally{node.disabled=false;}});return node;}
 function card(item,mode){
  const article=el('article');article.className='tower-visit-card';article.append(el('h3',item.nickname||'已撤回的來訪'));
  const meta=el('div');meta.className='tower-visit-meta';meta.append(el('small',item.state?states[item.state]:'公開來訪'),el('small',new Date(item.createdAt).toLocaleString('zh-TW')));article.append(meta);
  if(item.giftId)article.append(el('p',giftNames[item.giftId]||''));if(item.body)article.append(el('p',item.body));
  if(mode==='sent'){const link=el('a','前往這間住家');link.href=item.targetDoor+'/inside#tower-visits';article.append(link);}
  const act=(action,route)=>{const requestKey=crypto.randomUUID();return async()=>{await api(base+'/'+item.id+'/'+route,'POST',{expectedVersion:item.version,requestKey,...(route==='moderate'?{action}:{})});say(action==='withdraw'?'已撤回這則來訪。':'已更新這則來訪。');await reloadPrivate();};};
  if(mode==='sent'&&item.state!=='withdrawn')article.append(button('撤回',act('withdraw','withdraw')));
  if(mode==='received'&&item.kind==='invitation'&&item.state==='pending'){article.append(button('接受邀請',act('accept','moderate')),button('婉拒邀請',act('reject','moderate')));}
  if(mode==='received'&&item.state==='published')article.append(button('收起這則來訪',act('hide','moderate')));
  return article;
 }
 let receivedCursor=null,sentCursor=null;
 async function privatePage(sent,append=false){
  const box=root.querySelector(sent?'[data-visit-sent]':'[data-visit-received]'),more=root.querySelector(sent?'[data-more-sent]':'[data-more-received]'),cursor=sent?sentCursor:receivedCursor;
  if(!append)box.replaceChildren();
  try{const data=await api(base+(sent?'/sent':'')+(append&&cursor?'?cursor='+encodeURIComponent(cursor):''));if(!data.visits.length&&!append)box.append(el('p',sent?'還沒有送出的來訪。':'還沒有收到來訪。'));data.visits.forEach(item=>box.append(card(item,sent?'sent':'received')));if(sent)sentCursor=data.nextCursor;else receivedCursor=data.nextCursor;more.hidden=!data.nextCursor;}
  catch(error){if(error.code==='no_home'&&!sent){box.textContent=errors.no_home;more.hidden=true;return;}throw error;}
 }
 async function reloadPrivate(){await privatePage(false);await privatePage(true);}
 async function publicPage(append=false){const box=root.querySelector('[data-visit-list]'),more=root.querySelector('[data-visit-more]'),cursor=more.dataset.cursor;if(!append)box.replaceChildren();const data=await api('/api/v1/tower/rooms/'+widget.dataset.visitRoom+'/visits'+(append&&cursor?'?cursor='+encodeURIComponent(cursor):''));if(!data.visits.length&&!append)box.append(el('p','還沒有留言，留一聲問候吧。'));data.visits.forEach(item=>box.append(card(item,'public')));more.hidden=!data.nextCursor;more.dataset.cursor=data.nextCursor||'';}
 async function start(){
  const session=await api('/api/v1/session');signedIn=session.signedIn;csrf=session.csrf||'';
  if(inbox){root.querySelector('[data-visit-login]').hidden=signedIn;if(!signedIn){say('登入後就能查看自己的來訪與邀請。');return;}root.querySelector('[data-visit-private]').hidden=false;root.querySelector('[data-more-received]').addEventListener('click',()=>privatePage(false,true).catch(error=>say(error.message)));root.querySelector('[data-more-sent]').addEventListener('click',()=>privatePage(true,true).catch(error=>say(error.message)));await reloadPrivate();say('邀請只會留在彼此的信箱裡。');return;}
  await publicPage();root.querySelector('[data-visit-more]').addEventListener('click',()=>publicPage(true).catch(error=>say(error.message)));
  root.querySelector('[data-visit-login]').hidden=signedIn;const form=root.querySelector('form');form.hidden=!signedIn;if(!signedIn){say('登入後可以留言、送小禮物或私密邀請。');return;}
  const kind=form.elements.namedItem('kind'),gift=form.querySelector('[data-visit-gift]'),body=form.elements.namedItem('body'),note=form.querySelector('[data-visit-privacy]');
  const changed=()=>{gift.hidden=kind.value!=='gift';body.maxLength=kind.value==='invitation'?1000:280;note.textContent=kind.value==='invitation'?'只有你與這位住戶能讀到；接受邀請後也不會公開。':'留言與小禮物會出現在這間住家的來訪區，請勿填寫聯絡方式或網址。';delete form.dataset.requestKey;};
  kind.addEventListener('change',changed);form.addEventListener('input',()=>{delete form.dataset.requestKey;});changed();
  form.addEventListener('submit',async event=>{event.preventDefault();const submit=form.querySelector('button[type=submit]');if(submit.disabled)return;submit.disabled=true;const data=new FormData(form),key=form.dataset.requestKey||crypto.randomUUID();form.dataset.requestKey=key;
   try{await api(base+'/send','POST',{targetDoor:'/home/'+widget.dataset.visitRoom,requestKey:key,kind:data.get('kind'),nickname:data.get('nickname'),body:data.get('body'),...(kind.value==='gift'?{giftId:data.get('giftId')}:{})});say(kind.value==='invitation'?'私密邀請已送達。':'已留下這次來訪。');body.value='';delete form.dataset.requestKey;await publicPage();}catch(error){say(error.message);}finally{submit.disabled=false;}
  });say('歡迎留下一聲問候。');
 }
 start().catch(error=>say(error.message));
})();
