import {validateLobbyTheme,lobbyThemeCSS,LOBBY_RENDERER_VERSION} from '../../src/shared/lobby-theme.ts';
import {renderLobbyPreview} from '../../src/shared/lobby-markup.ts';
import {LOBBY_BASE_CSS,LOBBY_RENDERER_BUILD_HASH} from '../../src/shared/lobby-base-css.ts';
import {validatePNG} from '../../server/live/png.ts';
export interface BrowserBinding {limits():Promise<unknown>;quickAction(action:'screenshot',options:Record<string,unknown>):Promise<Response>}
interface Env {BROWSER?:BrowserBinding}
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const safe=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Lobby-Render-Dispatched':'false','X-Content-Type-Options':'nosniff'}});
async function bounded(response:Response,max:number){const reader=response.body?.getReader();if(!reader)throw Error('render_body_missing');const chunks:Uint8Array[]=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('render_body_too_large');}chunks.push(value);}const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;}
/** Caller authentication is enforced by the enclosing private manager Worker before this route. */
export async function themeRendererRoute(request:Request,env:Env,load:(id:string)=>Promise<Response>,now:()=>number=Date.now):Promise<Response>{
 const url=new URL(request.url);if(request.method!=='POST'||url.search)return json({error:'invalid_render_request'},400);
 if(!env.BROWSER||typeof env.BROWSER.quickAction!=='function'||typeof env.BROWSER.limits!=='function')return json({available:false,error:'renderer_not_bound'},503);
 if(url.pathname==='/theme/ready'){
  try{const limits=await env.BROWSER.limits();return json({available:true,limits,quota:'binding-and-current-limits-only-daily-quota-requires-real-render-proof',rendererBuildHash:LOBBY_RENDERER_BUILD_HASH});}catch{return json({available:false,error:'renderer_limits_unavailable'},503);}
 }
 if(url.pathname!=='/theme/render')return json({error:'not_found'},404);
 let input:Record<string,unknown>;
 try{const bytes=await bounded(new Response(request.body),1024);const command=JSON.parse(new TextDecoder().decode(bytes));if(!safe(command)||Object.keys(command).length!==1||typeof command.receiptId!=='string'||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(command.receiptId))return json({error:'invalid_render_request'},400);const claimed=await load(command.receiptId);if(!claimed.ok)return json({error:'render_claim_denied'},409);input=JSON.parse(new TextDecoder().decode(await bounded(claimed,16*1024*1024)));if(!safe(input)||input.receiptId!==command.receiptId||Object.keys(input).sort().join(',')!=='endsAt,imageBase64,manifest,manifestHash,receiptId,rendererBuildHash,scene,startsAt,viewport')throw Error('render_claim_invalid');}catch{return json({error:'render_claim_denied'},409);}
 let html:string,manifestHash:string;
 try{
  if(input.rendererBuildHash!==LOBBY_RENDERER_BUILD_HASH||!['day','night'].includes(String(input.scene))||!['desktop','mobile'].includes(String(input.viewport))||typeof input.imageBase64!=='string'||input.imageBase64.length>12*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.imageBase64)||typeof input.startsAt!=='string'||typeof input.endsAt!=='string'||!Number.isFinite(Date.parse(input.startsAt))||!Number.isFinite(Date.parse(input.endsAt)))throw Error('render_claim_invalid');
  const image=Uint8Array.from(atob(input.imageBase64),c=>c.charCodeAt(0));await validatePNG(image);const manifest=validateLobbyTheme(input.manifest);manifestHash=await hash(JSON.stringify(manifest));if(manifestHash!==input.manifestHash)throw Error('render_claim_invalid');
  const markup=renderLobbyPreview({scene:input.scene as 'day'|'night',imageSource:`data:image/png;base64,${input.imageBase64}`});
  html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>${LOBBY_BASE_CSS}\n${lobbyThemeCSS(manifest,input.scene as 'day'|'night')}</style></head><body><div id="app">${markup}</div></body></html>`;
 }catch{return json({error:'render_claim_invalid'},409);}
 const htmlHash=await hash(html),viewport=input.viewport==='desktop'?{width:1280,height:900,deviceScaleFactor:1}:{width:390,height:844,deviceScaleFactor:1};
 // Last synchronous gate after the awaited D1 claim, own PNG validation, shared renderer and digest.
 if(now()<Date.parse(input.startsAt as string)||now()>=Date.parse(input.endsAt as string))return json({error:'render_scope_expired'},409);
 try{
  const response=await env.BROWSER.quickAction('screenshot',{html,setJavaScriptEnabled:false,viewport,screenshotOptions:{fullPage:true,type:'png'},gotoOptions:{timeout:10000,waitUntil:'load'},waitForSelector:{selector:'[data-tower-lobby]',timeout:5000},actionTimeout:15000,rejectRequestPattern:['^https?:','^wss?:'],rejectResourceTypes:['script','xhr','fetch','websocket','eventsource']});
  // Each timer limits its documented phase. These options are NOT a claimed whole-call hard deadline.
  const headers=new Headers({'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Lobby-Render-Dispatched':'true','X-Lobby-Renderer-Version':LOBBY_RENDERER_VERSION,'X-Lobby-Renderer-Build':LOBBY_RENDERER_BUILD_HASH,'X-Lobby-Manifest-Hash':manifestHash,'X-Lobby-HTML-Hash':htmlHash});
  const used=response.headers.get('X-Browser-Ms-Used');if(used!==null)headers.set('X-Browser-Ms-Used',used);const ray=response.headers.get('cf-ray');if(ray&&/^[A-Za-z0-9-]{1,100}$/.test(ray))headers.set('X-Render-Request-ID',ray);
  if(!response.ok){let code:string|number|null=null;try{const body=JSON.parse(new TextDecoder().decode(await bounded(response,8000)));const value=body?.error?.code??body?.errors?.[0]?.code;if(typeof value==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(value)||typeof value==='number'&&Number.isSafeInteger(value))code=value;}catch{/* Never persist provider message/body. */}headers.set('Content-Type','application/json');headers.set('X-Lobby-Upstream-Status',String(response.status));if(code!==null)headers.set('X-Lobby-Upstream-Code',String(code));return new Response(JSON.stringify({error:'renderer_upstream_failure'}),{status:response.status,headers});}
  return new Response(response.body,{status:response.status,headers});
 }catch{return new Response(null,{status:502,headers:{'Cache-Control':'no-store','X-Lobby-Render-Dispatched':'true'}});}
}
