/** Conservative comparison of approved public presentation surfaces; never masks executable expressions. */
import ts from 'typescript';
import {parse,parseFragment} from 'parse5';
const displayAttributes=new Set(['class','style','title','alt','aria-label','aria-description']);
const seoNames=new Set(['description','og:title','og:description','twitter:title','twitter:description']);
const functionalTags=new Set(['script','style','base','link','form','input','textarea','select','option','button','iframe','object','embed']);
function htmlTree(source,{layout=false,document=false}={}){
 const root=document?parse(source):parseFragment(source);const records=[];
 function node(n,blocked=false){
  const tag=n.tagName??n.nodeName,code=blocked||['script','style','textarea'].includes(tag);
  if(tag==='#text')return code?['text',n.value]:['text'];
  if(tag==='#comment')return ['comment',n.data];
  const seoKey=(n.attrs??[]).find(a=>['name','property'].includes(a.name))?.value;
  const attrs=(n.attrs??[]).filter(a=>!layout||!displayAttributes.has(a.name)).map(a=>[a.name,tag==='meta'&&a.name==='content'&&seoNames.has(seoKey)?'__DISPLAY_COPY__':a.value]).sort((a,b)=>a[0].localeCompare(b[0]));
  if(layout){
   const protectedAttrs=attrs.filter(([key])=>key.startsWith('on')||key.startsWith('data-')||['id','href','src','srcset','action','formaction','target','rel','role','aria-controls','hidden','disabled','checked','value','name','type','integrity','crossorigin'].includes(key));
   if(tag==='meta'){
    const key=(n.attrs??[]).find(a=>['name','property'].includes(a.name))?.value;
    records.push(['meta',attrs.filter(([name])=>name!=='content'||!seoNames.has(key))]);
   }else if(functionalTags.has(tag))records.push([tag,attrs,(n.childNodes??[]).map(c=>node(c,code))]);
   else if(protectedAttrs.length)records.push(['attributes',protectedAttrs]);
   for(const c of n.childNodes??[])node(c,code);return null;
  }
  return [tag,attrs,(n.childNodes??[]).map(c=>node(c,code)),n.content?node(n.content,code):null];
 }
 const result=node(root);return JSON.stringify(layout?records.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):result);
}
export function staticPresentation(before,after){return htmlTree(before,{layout:true,document:true})===htmlTree(after,{layout:true,document:true});}
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
