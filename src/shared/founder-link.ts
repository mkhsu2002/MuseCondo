/** Add a fixed, accessible author link to browser-rendered copyright footers. */
export function installFounderLinks(root:HTMLElement){
 const enhance=()=>{
  for(const footer of root.querySelectorAll<HTMLElement>('.tower-attribution')){
   for(const node of [...footer.childNodes]){
    if(node.nodeType!==3)continue;
    const text=node.textContent??'',match=text.match(/^(©\s*\d{4}\s+)M\.K\.(.*)$/s);if(!match)continue;
    const link=root.ownerDocument.createElement('a');link.textContent='M.K.';link.href='https://mkhsu.icareu.tw/';link.target='_blank';link.rel='noopener noreferrer';
    node.replaceWith(root.ownerDocument.createTextNode(match[1]),link,root.ownerDocument.createTextNode(match[2]));
   }
  }
 };
 enhance();
 const observer=new MutationObserver(enhance);observer.observe(root,{childList:true,subtree:true});
 return ()=>observer.disconnect();
}
