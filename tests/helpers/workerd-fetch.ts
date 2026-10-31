/** Offline fetch boundary modelling workerd: `error` throws before dispatch; `manual` returns 3xx.
 * A follow request deliberately retains headers, as Cloudflare documents for fetch redirects.
 * https://developers.cloudflare.com/workers/runtime-apis/request/
 */
export function workerdFetch(respond:(request:Request,index:number,init?:RequestInit)=>Response|Promise<Response>){
 const requests:Request[]=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const redirect=init?.redirect??(input instanceof Request?input.redirect:'follow');
  if(redirect==='error')throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
  const request=new Request(input,init);requests.push(request);
  const response=await respond(request,requests.length-1,init);
  const location=response.headers.get('Location');
  if(request.redirect==='follow'&&response.status>=300&&response.status<400&&location){
   const next=new Request(new URL(location,request.url),request);requests.push(next);return respond(next,requests.length-1,next);
  }
  return response;
 };
 return {fetcher,requests};
}
