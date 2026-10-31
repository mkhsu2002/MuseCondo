import {themeRendererRoute,type BrowserBinding} from './theme-renderer.ts';
interface Stub {fetch(request:Request):Promise<Response>}
interface ScheduleBindings {BROWSER?:BrowserBinding;PUBLIC_ORIGIN:string;MANAGER_SCHEDULE_TRIGGER_KEY:string;MANAGER_CLOCK?:{idFromName(name:string):unknown;get(id:unknown):Stub}}
interface AlarmStorage {get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>;setAlarm(time:number):Promise<void>;deleteAlarm():Promise<void>}
interface DurableState {storage:AlarmStorage;blockConcurrencyWhile<T>(callback:()=>Promise<T>):Promise<T>}
function configuration(env:ScheduleBindings){const origin=new URL(env.PUBLIC_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PUBLIC_ORIGIN||!env.MANAGER_SCHEDULE_TRIGGER_KEY)throw Error('schedule_not_configured');return origin;}
async function dispatch(env:ScheduleBindings,path:string,body:unknown){const origin=configuration(env);const response=await fetch(new URL(path,origin),{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','X-Manager-Schedule-Key':env.MANAGER_SCHEDULE_TRIGGER_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error(`manager_schedule_http_${response.status}`);return response;}
/** Deployment-native alarms continue actual work, not a polling schedule. No provider key in this Worker. */
export class ManagerClock {
 state:DurableState;env:ScheduleBindings;
 constructor(state:DurableState,env:ScheduleBindings){this.state=state;this.env=env;}
 async fetch(request:Request){if(request.method!=='POST'||!['/wake','/theme/ready','/theme/render'].includes(new URL(request.url).pathname))return new Response('Not found',{status:404});await this.state.blockConcurrencyWhile(async()=>{await this.state.storage.put('recoveryAttempts',0);await this.state.storage.setAlarm(Date.now()+100);});return Response.json({queued:true});}
 async alarm(){
  // Write recovery wake before dispatch; a host interruption must not strand an owned lease.
  await this.state.storage.setAlarm(Date.now()+6*60000);
  try{const response=await dispatch(this.env,'/api/v1/manager/autonomy/step',{});const result=await response.json() as {pending?:boolean;wakeAfterMs?:number};await this.state.storage.put('recoveryAttempts',0);if(result.pending)await this.state.storage.setAlarm(Date.now()+Math.max(1000,Math.min(60000,Number.isFinite(result.wakeAfterMs)?result.wakeAfterMs!:1000)));else await this.state.storage.deleteAlarm();}
  catch{const attempts=(await this.state.storage.get<number>('recoveryAttempts')??0)+1;await this.state.storage.put('recoveryAttempts',attempts);if(attempts>=3)await this.state.storage.deleteAlarm();/* D1 paid dispatch ledger prevents blind provider retry. */}
 }
}
export default {
 async fetch(request?:Request,env?:ScheduleBindings){
  if(!request||!env||!['/wake','/theme/ready','/theme/render'].includes(new URL(request.url).pathname)||request.method!=='POST')return new Response('Not found',{status:404});
  const provided=request.headers.get('X-Manager-Schedule-Key');if(!provided||!env.MANAGER_SCHEDULE_TRIGGER_KEY)return new Response('Unauthorized',{status:401});
  const hash=async(v:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));const [a,b]=await Promise.all([hash(provided),hash(env.MANAGER_SCHEDULE_TRIGGER_KEY)]);let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a[i]^b[i];if(mismatch)return new Response('Unauthorized',{status:401});
  if(request.headers.has('Cookie')||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==env.PUBLIC_ORIGIN)return new Response('Unauthorized',{status:401});
  if(new URL(request.url).pathname.startsWith('/theme/'))return themeRendererRoute(request,env,id=>dispatch(env,'/api/v1/manager/autonomy/theme-render-claim',{receiptId:id}));
  if(!env.MANAGER_CLOCK)return new Response('Unavailable',{status:503});return env.MANAGER_CLOCK.get(env.MANAGER_CLOCK.idFromName('manager-daily')).fetch(new Request('https://clock.internal/wake',{method:'POST'}));
 },
 async scheduled(event:{scheduledTime:number},env:ScheduleBindings){
  let safeJobError:unknown;try{await dispatch(env,'/api/v1/manager/run-due',{scheduledTime:new Date(event.scheduledTime).toISOString()});}catch(error){safeJobError=error;}
  if(env.MANAGER_CLOCK)await env.MANAGER_CLOCK.get(env.MANAGER_CLOCK.idFromName('manager-daily')).fetch(new Request('https://clock.internal/wake',{method:'POST'}));
  if(safeJobError)throw safeJobError;
 },
};
