/* global document, innerWidth, getComputedStyle */
function luminance(rgb){const values=(rgb.match(/[\d.]+/g)||[]).slice(0,3).map(Number).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;}
/** Run only inside the operator's authorized canonical browser tool; never launches a browser. */
export async function checkCondoLayout(page,base){
 const results=[],failures=[];
 await page.route('**/assets/condo.css',route=>route.continue());
 for(const width of [1365,768,390]){
  await page.setViewportSize({width,height:950});
  for(const file of ['index.html','inside.html','dreams.html']){
   await page.goto(new URL(file,base).href);await page.waitForLoadState('networkidle');
   const value=await page.evaluate(()=>{
    const img=document.querySelector('.dream-scene img,.home-scene img');const rect=img?.getBoundingClientRect();
    return {overflow:document.documentElement.scrollWidth>innerWidth,images:[...document.images].every(i=>i.complete&&i.naturalWidth>0),h1:document.querySelectorAll('h1').length,image:rect?{width:rect.width,height:rect.height}:null,color:getComputedStyle(document.querySelector('h1')).color,background:getComputedStyle(document.body).backgroundColor};
   });
   if(value.overflow||!value.images||value.h1!==1)failures.push(`${width} ${file}: content overflow, missing image or heading`);
   if(value.image){const expected=file==='dreams.html'?1:16/9;if(Math.abs(value.image.width/value.image.height/expected-1)>.01)failures.push(`${width} ${file}: image frame ratio ${value.image.width}/${value.image.height}`);}
   if(file==='dreams.html'){const colors=[luminance(value.color),luminance(value.background)].sort((a,b)=>b-a);const contrast=(colors[0]+.05)/(colors[1]+.05);value.contrast=contrast;if(contrast<4.5)failures.push(`${width} ${file}: title contrast ${contrast.toFixed(2)}`);}
   results.push({width,file,...value});
  }
 }
 if(failures.length)throw Error(failures.join('\n'));return results;
}
