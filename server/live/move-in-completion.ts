import {readTowerAsset,type AssetPurpose} from './tower-asset-storage.ts';
import {parse,type DefaultTreeAdapterMap} from 'parse5';
import type {Database} from './db.ts';
import {digest} from './app.ts';
import {validatePNG} from './png.ts';
export interface MoveInCompletion {complete:boolean;publicURL?:string;roomId?:string;residentId?:string;revision?:number;publicationEpoch?:number;snapshotDigest?:string;checks:Record<string,boolean>;issues:{stage:string;code:string}[];handoff?:{text:string;guardianReceiptConfirmed:false}}
interface Options {db:Database;origin:string;publicFetch?:typeof fetch;now?:()=>Date}
interface State {room_id:string;resident_id:string;public_revision:number|null;directory_consent:number;snapshot_consent:number;dream_consent:number;publication_epoch:number;published:number;public_json:string|null;content_digest:string|null}
type Node=DefaultTreeAdapterMap['node'];
const text=(n:Node):string=>n.nodeName==='#text'?('value' in n?n.value:''):('tagName' in n&&['script','style'].includes(n.tagName))?'':('childNodes' in n?n.childNodes.map(text).join(' '):'');
const normal=(s:string)=>s.replace(/\s+/g,' ').trim();
function listedDoor(node:Node,href:string,inDirectory=false):number {
 const attrs='attrs' in node?node.attrs:[],directory=inDirectory||attrs.some(a=>a.name==='data-public-home-directory');
 const match=directory&&'tagName' in node&&node.tagName==='a'&&attrs.some(a=>a.name==='href'&&a.value===href)&&!!normal(text(node));
 return Number(match)+('childNodes' in node?node.childNodes.reduce((sum,child)=>sum+listedDoor(child,href,directory),0):0);
}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export function createMoveInCompletion(env:Options){
 if(new URL(env.origin).origin!==env.origin||!env.origin.startsWith('https://'))throw Error('invalid_completion_origin');
 const now=env.now??(()=>new Date());
 const state=(account:string)=>env.db.prepare('SELECT t.room_id,t.resident_id,t.public_revision,t.directory_consent,t.snapshot_consent,t.dream_consent,t.publication_epoch,r.published,s.public_json,s.content_digest FROM tower_residencies t JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id LEFT JOIN tower_snapshots s ON s.room_id=t.room_id AND s.revision=t.public_revision WHERE t.account_id=?').bind(account).first<State>();
 async function verify(accountId:string):Promise<MoveInCompletion>{
  const checks:Record<string,boolean>={},issues:{stage:string;code:string}[]=[];const result:MoveInCompletion={complete:false,checks,issues};
  const r=await state(accountId);if(!r){issues.push({stage:'residency',code:'home_not_connected'});return result;}
  if(!r.public_revision||!r.snapshot_consent||!r.public_json){issues.push({stage:'publication',code:'home_not_published'});return result;}
  if(!r.directory_consent||!r.published){issues.push({stage:'directory',code:'directory_not_authorized'});return result;}
  checks.publication=true;const deadline=Date.now()+25000;
  async function read(path:string,mime:string,max:number){
   if(Date.now()>=deadline)throw Error('public_read_timeout');
   const url=new URL(path,env.origin);if(url.origin!==env.origin||url.username||url.password)throw Error('public_origin_mismatch');
   const response=await (env.publicFetch??fetch)(url.href,{method:'GET',credentials:'omit',redirect:'manual',headers:{Accept:mime,'User-Agent':'MuseCondo-Completion/1.0','Cache-Control':'no-cache'},signal:AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now())))});
   if(!response.ok||response.headers.get('Content-Type')?.split(';')[0].trim()!==mime){void response.body?.cancel().catch(()=>{});throw Error('public_read_failed');}
   const reader=response.body?.getReader();if(!reader)throw Error('public_read_failed');const parts:Uint8Array[]=[];let length=0;const bodyDeadline=Math.min(deadline,Date.now()+8000);
   try{for(;;){let timer:ReturnType<typeof setTimeout>|undefined;const next=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('public_read_timeout')),Math.max(1,bodyDeadline-Date.now()));})]).finally(()=>clearTimeout(timer));if(next.done)break;length+=next.value.length;if(length>max||Date.now()>=deadline)throw Error('public_read_limit');parts.push(next.value);}}catch(e){void reader.cancel().catch(()=>{});throw e;}
   const bytes=new Uint8Array(length);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return bytes;
  }
  let stage='snapshot';
  try{
   const expected=JSON.parse(r.public_json);if(!r.dream_consent){expected.dream=null;expected.home.dreams=[];}
   expected.home.id=r.room_id;expected.home.routes={home:`/home/${r.room_id}`,inside:`/home/${r.room_id}/inside`,dreams:`/home/${r.room_id}/dreams`};expected.home.assets.desktop=`/api/v1/tower/assets/${r.room_id}/${r.public_revision}/home.png`;
   if(expected.dream){expected.dream.image.src=`/api/v1/tower/assets/${r.room_id}/${r.public_revision}/dream.png`;expected.home.dreams=expected.home.dreams.map((d:Record<string,unknown>)=>({...d,image:expected.dream.image.src}));}
   const decoder=new TextDecoder('utf-8',{fatal:true});const publicData=JSON.parse(decoder.decode(await read(`/api/v1/tower/rooms/${r.room_id}`,'application/json',256000)));
   if(publicData.roomId!==r.room_id||publicData.revision!==r.public_revision||JSON.stringify(publicData.site)!==JSON.stringify(expected))throw Error('public_snapshot_mismatch');checks.snapshot=true;
   for(const page of ['home','inside','dreams'] as const){stage=page;const html=decoder.decode(await read(expected.home.routes[page],'text/html',512000)),visible=normal(text(parse(html)));
    const required:string[]=page==='home'?[expected.home.intro]:page==='inside'?[expected.home.name,...Object.entries(expected.profile).filter(([k])=>!k.endsWith('PortraitCrop')).map(([,v])=>String(v)),...expected.home.daily.flatMap((d:{title:string;body:string})=>[d.title,d.body])]:expected.dream?[expected.dream.title,expected.dream.body,expected.dream.wish,...(expected.dream.reflection?[expected.dream.reflection]:[])]:[];
    if(required.some(v=>!visible.includes(normal(v))))throw Error('public_content_mismatch');checks[page]=true;
   }
   for(const purpose of expected.dream?['home','dream']:['home']){stage='asset-'+purpose;const bytes=await read(`/api/v1/tower/assets/${r.room_id}/${r.public_revision}/${purpose}.png`,'image/png',8*1024*1024);await validatePNG(bytes);
    const stored=await readTowerAsset(env.db,r.room_id,r.public_revision!,purpose as AssetPurpose);
    if(!stored||stored.bytes.length!==bytes.length||stored.bytes.some((b,i)=>b!==bytes[i]))throw Error('public_image_mismatch');checks[stage]=true;
   }
   stage='directory';const directory=JSON.parse(decoder.decode(await read('/api/v1/public/rooms','application/json',2*1024*1024)));if(!Array.isArray(directory.rooms)||directory.rooms.filter((v:{id?:unknown})=>v.id===r.room_id).length!==1)throw Error('public_directory_mismatch');checks.directory=true;
   stage='homepage';const homepage=parse(decoder.decode(await read('/','text/html',2*1024*1024)));if(listedDoor(homepage,`/home/${r.room_id}`)!==1)throw Error('public_homepage_door_missing');checks.homepage=true;
   stage='publication';const current=await state(accountId);if(JSON.stringify(current)!==JSON.stringify(r))throw Error('publication_changed');checks.currentRevision=true;
   result.complete=true;result.roomId=r.room_id;result.residentId=r.resident_id;result.revision=r.public_revision;result.publicationEpoch=r.publication_epoch;result.snapshotDigest=r.content_digest??undefined;result.publicURL=env.origin+`/home/${r.room_id}`;result.handoff={text:`Your home is published in Muse Tower: ${result.publicURL}`,guardianReceiptConfirmed:false};return result;
  }catch(error){issues.push({stage,code:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'public_verification_failed'});return result;}
 }
 return {verify,async fetch(request:Request):Promise<Response|null>{
  if(new URL(request.url).pathname!=='/api/v1/agent/tower-intake/completion')return null;
  if(new URL(request.url).origin!==env.origin||request.headers.has('Cookie')||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==env.origin)return json({error:'origin_rejected'},403);
  if(request.method!=='GET'||new URL(request.url).search)return json({error:'invalid_completion_request'},400);
  const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!token)return json({error:'tower_token_required'},401);
  const hash=await digest(token),authorize=()=>env.db.prepare("SELECT account_id FROM tower_tokens WHERE token_hash=? AND revoked=0 AND expires_at>? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM json_each(scopes) WHERE value='tower:read')").bind(hash,now().toISOString()).first<{account_id:string}>();
  const auth=await authorize();if(!auth)return json({error:'tower_scope_rejected'},403);
  const completion=await verify(auth.account_id);if((await authorize())?.account_id!==auth.account_id)return json({error:'authorization_changed'},403);
  return json({completion});
 }};
}
