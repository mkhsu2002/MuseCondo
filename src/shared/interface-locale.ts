import {INTERFACE_MESSAGES} from './interface-messages.ts';
export type InterfaceLocale='en'|'zh-TW';
export function normalizeInterfaceLocale(value:unknown):InterfaceLocale|undefined{
 if(typeof value!=='string'||value.length>256)return undefined;
 const language=value.split(',')[0].split(';')[0].trim().toLowerCase();
 if(/^en(?:-[a-z0-9]{2,8})*$/.test(language))return 'en';
 if(language==='zh'||/^zh-(?:tw|hk|mo|hant)(?:-[a-z0-9]{2,8})*$/.test(language))return 'zh-TW';
 return undefined;
}
export function resolveInterfaceLocale({explicit,saved,home,browser}:{explicit?:unknown;saved?:unknown;home?:unknown;browser?:unknown}={}):InterfaceLocale{
 return normalizeInterfaceLocale(explicit)??normalizeInterfaceLocale(saved)??normalizeInterfaceLocale(home)??normalizeInterfaceLocale(browser)??'en';
}
const reverse=new Map(Object.entries(INTERFACE_MESSAGES).map(([en,zh])=>[zh,en]));
export function translateInterfaceText(value:string,locale:InterfaceLocale):string{
 const trimmed=value.trim(),message=locale==='zh-TW'?(Object.hasOwn(INTERFACE_MESSAGES,trimmed)?INTERFACE_MESSAGES[trimmed]:undefined):reverse.get(trimmed);
 return message===undefined?value:value.replace(trimmed,message);
}
