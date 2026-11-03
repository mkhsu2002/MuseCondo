import {readFileSync} from 'node:fs';
import {expect,type Page} from '@playwright/test';
/** Compare the actual fresh live cascade with its original pre-split global stylesheet.
 * The temporary stylesheet is removed before the rest of the runtime flow proceeds.
 */
export async function assertFreshLobbyStyles(page:Page){
 await page.locator('.live-lobby-heading').waitFor();
 await page.mouse.move(0,0);
 const motion=await page.addStyleTag({content:'*{transition:none!important;animation:none!important}'});
 const snapshot=()=>page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>('html,body,#app,[data-tower-lobby],[data-tower-lobby] *')).map((element,index)=>{
  const style=getComputedStyle(element);
  return {element:`${index}:${element.tagName}.${element.className}`,style:Object.fromEntries(Array.from(style).filter(property=>!property.startsWith('--')).map(property=>[property,style.getPropertyValue(property)]))};
 }));
 const fresh=await snapshot();
 const original=await page.addStyleTag({content:readFileSync(new URL('../../src/style.css',import.meta.url),'utf8')});
 try{expect(await snapshot(),'fresh live styles must match the original shared cascade before any demo visit').toEqual(fresh);}
 finally{await original.evaluate(element=>(element as Element).remove());await motion.evaluate(element=>(element as Element).remove());}
}

/** The server shell must be styled while the live JavaScript import is held. */
export async function assertStyledSSRBeforeLive(page:Page,url:string){
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 let held=false;
 const pending:Promise<void>[]=[];
 const pattern=/\/assets\/live-[^/]+\.js(?:\?.*)?$/;
 await page.route(pattern,route=>{held=true;const continued=gate.then(()=>route.continue());pending.push(continued);return continued;});
 try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('link[rel=stylesheet]')).every(node=>(node as HTMLLinkElement).sheet!==null));
  await expect(page.locator('[data-tower-lobby]')).toBeVisible();
  expect(held,'the actual dynamic live JavaScript request is held').toBe(true);
  const geometry=await page.evaluate(()=>{
   const header=document.querySelector<HTMLElement>('.live-header')!,intro=document.querySelector<HTMLElement>('.tower-introduction')!,panorama=document.querySelector<HTMLElement>('.tower-panorama')!,image=document.querySelector<HTMLImageElement>('#tower-landscape')!;
   return {header:getComputedStyle(header).display,intro:getComputedStyle(intro).display,overflow:getComputedStyle(panorama).overflow,radius:parseFloat(getComputedStyle(panorama).borderRadius),imageWidth:image.getBoundingClientRect().width,viewport:innerWidth};
  });
  expect(geometry.header).toBe('flex');expect(geometry.intro).toBe('grid');expect(geometry.overflow).toBe('hidden');expect(geometry.radius).toBeGreaterThan(0);expect(geometry.imageWidth).toBeLessThanOrEqual(geometry.viewport);
 }finally{release();await Promise.all(pending);await page.unroute(pattern);}
}
