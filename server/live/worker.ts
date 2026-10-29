import { createLiveApp } from './app.ts';
import type { Database } from './db.ts';
interface Bindings { DB: Database; ASSETS:{fetch(request:Request):Promise<Response>}; PUBLIC_ORIGIN:string; REGISTRATION_ENABLED?:string }
/** No provider credentials/configured transport yet. Generation intentionally fails closed. */
export default {async fetch(request:Request,env:Bindings):Promise<Response>{
 const url=new URL(request.url);
 if(!env.PUBLIC_ORIGIN||url.origin!==env.PUBLIC_ORIGIN)return new Response('Origin not configured',{status:503});
 if(url.pathname.startsWith('/api/'))return createLiveApp({db:env.DB,origin:env.PUBLIC_ORIGIN,localTest:false,registrationEnabled:env.REGISTRATION_ENABLED==='true'}).fetch(request,request.headers.get('CF-Connecting-IP')??'unknown');
 return env.ASSETS.fetch(request);
}};
