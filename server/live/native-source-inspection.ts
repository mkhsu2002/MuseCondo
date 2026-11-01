import {isMuseShareURL,readNativeHome} from './home-source.ts';
import {validateTowerSnapshot} from './tower-intake.ts';
import {validatePNG} from './png.ts';

/** Read-only operator diagnostics. There is deliberately no database or model transport. */
export function createNativeSourceInspection(env:{operator:(request:Request)=>Promise<boolean>;fetcher?:typeof fetch}) {
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
 return async(request:Request):Promise<Response|null>=>{
  if(new URL(request.url).pathname!=='/api/v1/operator/tower-sources/inspect')return null;
  if(!await env.operator(request))return reply({error:'operator_required'},403);
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
  if(request.headers.has('Cookie')||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin)return reply({error:'origin_rejected'},403);
  if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')return reply({error:'json_required'},415);
  if(Number(request.headers.get('Content-Length')??0)>2048)return reply({error:'body_too_large'},413);
  const reader=request.body?.getReader();if(!reader)return reply({error:'invalid_fields'},400);
  let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2048){void reader.cancel().catch(()=>{});return reply({error:'body_too_large'},413);}chunks.push(part.value);}}catch{return reply({error:'invalid_fields'},400);}
  let value:unknown;
  try{const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return reply({error:'invalid_fields'},400);}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join(',')!=='homeURL'||!isMuseShareURL((value as {homeURL:unknown}).homeURL))return reply({error:'invalid_fields'},400);
  try{
   const source=await readNativeHome((value as {homeURL:string}).homeURL,env.fetcher??fetch),site=validateTowerSnapshot(source.site,source.site.home.id);
   const images:{purpose:'home'|'dream';width:number;height:number;bytes:number}[]=[];
   for(const purpose of (site.dream?['home','dream']:['home']) as ('home'|'dream')[]){
    const bytes=await source.readAsset(purpose),png=await validatePNG(bytes);
    if(purpose==='home'?Math.abs(png.width/png.height-16/9)/(16/9)>=0.01:png.width!==png.height)throw Error('invalid_dimensions');
    images.push({purpose,width:png.width,height:png.height,bytes:bytes.length});
   }
   return reply({format:'native-muse-share',views:['home','inside','dreams'],profileFields:Object.keys(site.profile).length,images,stored:false});
  }catch{return reply({error:'source_inspection_unavailable'},422);}
 };
}
