/** Conservative comparison of approved public presentation surfaces; never masks executable expressions. */
import ts from 'typescript';
import {parse,parseFragment} from 'parse5';
const displayAttributes=new Set(['class','style','title','alt','aria-label','aria-description']);
const seoNames=new Set(['description','og:title','og:description','twitter:title','twitter:description']);
const functionalTags=new Set(['script','style','noscript','base','link','form','input','textarea','select','option','button','iframe','object','embed']);
const imageOrigin='https://musetower.neobabylon.app';
const imageAttributes=new Set([...displayAttributes,'src','srcset','sizes','width','height','loading','decoding','fetchpriority']);
const imageMeta=new Set(['og:image','og:image:secure_url','twitter:image']);
const imageMetaText=new Set(['og:image:alt','twitter:image:alt']);
const imageMetaDimensions=new Set(['og:image:width','og:image:height']);
const dimension=value=>/^[1-9][0-9]{0,4}$/.test(value)&&Number(value)<=16384;
function imageURL(value,assetExists){
 const path=value.startsWith(imageOrigin+'/')?value.slice(imageOrigin.length):value;
 // Asset lookup is against the comparison HEAD, not an extension-based trust claim.
 return /^\/(?:media|og)\/[a-zA-Z0-9_.-]+\.(?:webp|png|jpe?g|avif)$/i.test(path)&&assetExists(path);
}
function imageNode(node,assetExists){
 const attrs=node.attrs??[],values=Object.fromEntries(attrs.map(a=>[a.name,a.value]));
 if(!attrs.every(a=>imageAttributes.has(a.name))||!values.src||!imageURL(values.src,assetExists))return false;
 if(['width','height'].some(name=>values[name]!==undefined&&!dimension(values[name])))return false;
 if(values.loading!==undefined&&!['lazy','eager'].includes(values.loading)||values.decoding!==undefined&&!['async','sync','auto'].includes(values.decoding)||values.fetchpriority!==undefined&&!['high','low','auto'].includes(values.fetchpriority))return false;
 if(values.srcset!==undefined){
  const entries=values.srcset.split(',');if(!entries.length||entries.length>12)return false;
  if(entries.some(entry=>{const match=entry.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?[xw]))?$/);return !match||!imageURL(match[1],assetExists)||match[2]&&!(Number(match[2].slice(0,-1))>0);}))return false;
 }
 return true;
}
function displayImageMeta(node,assetExists){
 const attrs=node.attrs??[],values=Object.fromEntries(attrs.map(a=>[a.name,a.value])),key=values.property??values.name;
 if(!attrs.every(a=>['name','property','content'].includes(a.name))||values.content===undefined)return false;
 if(imageMeta.has(key))return imageURL(values.content,assetExists);
 if(imageMetaText.has(key))return true;
 if(imageMetaDimensions.has(key))return dimension(values.content);
 return key==='og:image:type'&&['image/jpeg','image/png','image/webp','image/avif'].includes(values.content);
}
function nodes(root){const all=[];function visit(node){all.push(node);for(const child of node.childNodes??[])visit(child);if(node.content)visit(node.content);}visit(root);return all;}
function newDisplayIdentities(before,after,assetExists){
 const original=new Set(nodes(before).flatMap(n=>(n.attrs??[]).filter(a=>a.name==='id').map(a=>a.value))),all=nodes(after),ids=new Set(),sections=new Set();
 const ordinary=new Set(['section','div','h2','h3','h4','h5','h6','p','blockquote','ul','ol','li','strong','em','span','br','figure','figcaption','pre','code']);
 for(const section of all.filter(n=>n.tagName==='section')){
  const attributes=Object.fromEntries((section.attrs??[]).map(a=>[a.name,a.value])),children=nodes(section),label=attributes['aria-labelledby'];
  if(!attributes.id&&!label||attributes.id&&original.has(attributes.id)||label&&original.has(label))continue;
  if(label&&(!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(label)||children.filter(n=>/^h[2-6]$/.test(n.tagName??'')&&(n.attrs??[]).some(a=>a.name==='id'&&a.value===label)).length!==1))continue;
  if(children.some(n=>{
   if(n.nodeName==='#text'||n.nodeName==='#comment')return false;
   if(n.tagName==='img')return !imageNode(n,assetExists);
   if(!ordinary.has(n.tagName))return true;
   return (n.attrs??[]).some(a=>!displayAttributes.has(a.name)&&!(a.name==='id'&&!original.has(a.value)&&(n===section||a.value===label))&&!(a.name==='aria-labelledby'&&n===section&&a.value===label));
  }))continue;
  const sectionIds=children.flatMap(n=>(n.attrs??[]).filter(a=>a.name==='id').map(a=>a.value));
  if(sectionIds.some(id=>!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)||all.filter(n=>(n.attrs??[]).some(a=>a.name==='id'&&a.value===id)).length!==1))continue;
  for(const id of sectionIds)ids.add(id);if(label)sections.add(section);
 }
 return {ids,sections};
}
function htmlTree(source,{layout=false,document=false,root:providedRoot,assetExists=()=>false,identities}={}){
 const root=providedRoot??(document?parse(source):parseFragment(source));const records=[];
 function node(n,blocked=false){
  const tag=n.tagName??n.nodeName,code=blocked||['script','style','textarea','noscript'].includes(tag);
  if(tag==='#text')return code?['text',n.value]:['text'];
  if(tag==='#comment')return ['comment',n.data];
  const seoKey=(n.attrs??[]).find(a=>['name','property'].includes(a.name))?.value;
  const attrs=(n.attrs??[]).filter(a=>!layout||!displayAttributes.has(a.name)).map(a=>[a.name,tag==='meta'&&a.name==='content'&&seoNames.has(seoKey)?'__DISPLAY_COPY__':a.value]).sort((a,b)=>a[0].localeCompare(b[0]));
  if(layout){
   if(tag==='img'&&imageNode(n,assetExists)||tag==='meta'&&displayImageMeta(n,assetExists))return null;
   if(tag==='img'){records.push(['protected-image',attrs]);return null;}
   const structural=attrs.filter(([key,value])=>!(key==='id'&&identities?.ids.has(value))&&!(key==='aria-labelledby'&&identities?.sections.has(n)));
   const protectedAttrs=structural.filter(([key])=>key.startsWith('on')||key.startsWith('data-')||['id','aria-labelledby','aria-describedby','href','src','srcset','action','formaction','target','rel','role','aria-controls','hidden','disabled','checked','value','name','type','integrity','crossorigin'].includes(key));
   if(tag==='meta'){
    const key=(n.attrs??[]).find(a=>['name','property'].includes(a.name))?.value;
    records.push(['meta',attrs.filter(([name])=>name!=='content'||!seoNames.has(key))]);
   }else if(functionalTags.has(tag))records.push([tag,attrs,(n.childNodes??[]).map(c=>node(c,code))]);
   else if(protectedAttrs.length)records.push(['attributes',protectedAttrs]);
   for(const c of n.childNodes??[])node(c,code);if(n.content)node(n.content,code);return null;
  }
  return [tag,attrs,(n.childNodes??[]).map(c=>node(c,code)),n.content?node(n.content,code):null];
 }
 const result=node(root);return JSON.stringify(layout?records.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):result);
}
export function staticPresentation(before,after,{assetExists=()=>false}={}){
 try{const oldRoot=parse(before),newRoot=parse(after),identities=newDisplayIdentities(oldRoot,newRoot,assetExists);return htmlTree(before,{layout:true,root:oldRoot,assetExists})===htmlTree(after,{layout:true,root:newRoot,assetExists,identities});}catch{return false;}
}
function catalogueValue(n){
 if(!ts.isStringLiteral(n)||n.parent&&ts.isPropertyAssignment(n.parent)&&n.parent.name===n)return false;
 for(let p=n.parent;p;p=p.parent){if(ts.isFunctionLike(p))return false;if(ts.isVariableDeclaration(p))return p.name.getText()==='en'&&ts.isObjectLiteralExpression(p.initializer);}
 return false;
}
function signature(source,catalogue,metadata){
 const file=ts.createSourceFile('presentation.ts',source,ts.ScriptTarget.Latest,true);
 if(file.parseDiagnostics.length)throw Error('presentation_parse_failed');
 const printer=ts.createPrinter({removeComments:true});
 const result=ts.transform(file,[context=>{
  const visit=n=>{
   if(metadata&&ts.isStringLiteral(n)&&ts.isVariableDeclaration(n.parent)&&n.parent.name.getText()==='metadata'&&n.text.includes('<meta'))return ts.factory.createStringLiteral(htmlTree(n.text));
   if(catalogue&&catalogueValue(n)){
    if(/[<>]/.test(n.text))throw Error('catalogue_is_not_plain_copy');
    return ts.factory.createStringLiteral('__DISPLAY_COPY__');
   }
   if(ts.isNoSubstitutionTemplateLiteral(n)&&/^\s*</.test(n.text))return ts.factory.createNoSubstitutionTemplateLiteral(htmlTree(n.text));
   if(ts.isTemplateExpression(n)&&/^\s*</.test(n.head.text)){
    const html=n.head.text+n.templateSpans.map((s,i)=>`MUSE_EXPRESSION_${i}`+s.literal.text).join('');
    const expressions=n.templateSpans.map(s=>printer.printNode(ts.EmitHint.Unspecified,ts.visitNode(s.expression,visit),file));
    return ts.factory.createNoSubstitutionTemplateLiteral(JSON.stringify([htmlTree(html),expressions]));
   }
   return ts.visitEachChild(n,visit,context);
  };return n=>ts.visitNode(n,visit);
 }]);
 try{return printer.printFile(result.transformed[0]);}finally{result.dispose();}
}
export function modulePresentation(before,after,catalogue=false,metadata=false){try{return signature(before,catalogue,metadata)===signature(after,catalogue,metadata);}catch{return false;}}
export function cssPresentation(before,after){
 const dependencies=s=>JSON.stringify(s.match(/@import[^;]+;|url\([^)]*\)/g)??[]);
 return dependencies(before)===dependencies(after);
}
