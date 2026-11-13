import {renderCondo,type CondoPage} from '../../src/framework/condo-render.ts';
import type {PublicCondoSite} from '../../src/framework/condo.ts';
import type {InterfaceLocale} from '../../src/shared/interface-locale.ts';
import {localizeInterfaceHTML} from '../live/interface-html.ts';
/** Independent exports retain their script-free contract; links select complete static UI variants. */
export function staticInterfaceDocument(html:string,locale:InterfaceLocale,english:string,chinese:string):string{
 const control=`<nav class="interface-language" data-interface-switch aria-label="Language"><a href="${english}" lang="en"${locale==='en'?' aria-current="page"':''}>English</a> · <a href="${chinese}" lang="zh-Hant"${locale==='zh-TW'?' aria-current="page"':''}>繁體中文</a></nav>`;
 return localizeInterfaceHTML(html.replace(/<body([^>]*)>/,`<body$1>${control}`),locale,true,false);
}
export function renderStandaloneCondo(site:PublicCondoSite,page:CondoPage,locale:InterfaceLocale='en'):string{
 const name=page==='home'?'index':page;
 let html=renderCondo(site,page);
 if(locale==='zh-TW')for(const file of ['index','inside','dreams'])html=html.replaceAll(`./${file}.html`,`./${file}.zh-TW.html`);
 return staticInterfaceDocument(html,locale,`./${name}.html`,`./${name}.zh-TW.html`);
}
