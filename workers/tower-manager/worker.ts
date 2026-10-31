interface ScheduleBindings {PUBLIC_ORIGIN:string;MANAGER_SCHEDULE_TRIGGER_KEY:string}
/** No public route, provider secret, resident credential, D1 binding or operator key. */
export default {
 async fetch(){return new Response('Not found',{status:404});},
 async scheduled(event:{scheduledTime:number},env:ScheduleBindings){
  const origin=new URL(env.PUBLIC_ORIGIN);
  if(origin.protocol!=='https:'||origin.origin!==env.PUBLIC_ORIGIN||!env.MANAGER_SCHEDULE_TRIGGER_KEY)throw Error('schedule_not_configured');
  const response=await fetch(new URL('/api/v1/manager/run-due',origin).href,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','X-Manager-Schedule-Key':env.MANAGER_SCHEDULE_TRIGGER_KEY},body:JSON.stringify({scheduledTime:new Date(event.scheduledTime).toISOString()}),signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error(`manager_schedule_http_${response.status}`);
 },
};
