import {parsePortraitCrop} from '../framework/condo.ts';
export interface ResidentAvatar {url:string;crop?:string}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Only same-household, authorization-checked public image paths may enter the directory. */
export function renderResidentAvatar(room:{id:string;name:string;avatar?:ResidentAvatar}):string{
 const fallback=`<span data-avatar-fallback>${escape(Array.from(room.name)[0]??'')}</span>`;
 let descriptor=room.avatar,style='';
 if(descriptor){
  const native=new RegExp('^/home/'+room.id+'/assets/home\\.png\\?revision=[1-9][0-9]*$'),imported=new RegExp('^/api/v1/tower/assets/'+room.id+'/[1-9][0-9]*/home\\.png$');
  if(!native.test(descriptor.url)&&!imported.test(descriptor.url))descriptor=undefined;
  else if(descriptor.crop){try{const box=parsePortraitCrop(descriptor.crop),width=Math.min(box.width,box.height*9/16),height=width*16/9,x=box.x+(box.width-width)/2,y=box.y+(box.height-height)/2;style=`width:${10000/width}%;left:${-x/width*100}%;top:${-y/height*100}%;`;}catch{descriptor=undefined;}}
 }
 if(!descriptor)return `<span class="resident-door-mark" data-no-translate aria-hidden="true">${escape(Array.from(room.name)[0]??'')}</span>`;
 return `<span class="resident-door-mark${descriptor?' resident-door-portrait':''}" data-no-translate aria-hidden="true">${fallback}${descriptor?`<img data-resident-avatar data-no-translate src="${escape(descriptor.url)}" alt="" loading="lazy" decoding="async"${style?` style="${style}"`:''}>`:''}</span>`;
}
