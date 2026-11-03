import {validatePublicationTask,type PublicationTask} from '../../server/live/tower-weekly-routes.ts';
interface Storage {get<T>(key:string):Promise<T|undefined>;put(key:string,value:unknown):Promise<void>;setAlarm(time:number):Promise<void>;deleteAlarm():Promise<void>}
/** Separate object instance and queue: does not replace the existing daily autonomy clock. */
export async function enqueuePublications(storage:Storage,tasks:PublicationTask[]){
 if(!Array.isArray(tasks)||tasks.length<1||tasks.length>6||new Set(tasks.map(t=>t.id)).size!==tasks.length)throw Error('publication_queue_invalid');
 const queue=await storage.get<PublicationTask[]>('publicationQueue')??[];
 for(const task of tasks){if(!task||!['scene','repair','inaugural','due'].includes(task.kind)||typeof task.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(task.id))throw Error('publication_task_invalid');validatePublicationTask(task as unknown as Record<string,unknown>);const old=await storage.get<{state?:string}>('publicationResult:'+task.id);if(old&&old.state!=='transport-failed')continue;if(!queue.some(t=>t.id===task.id))queue.push(task);}
 if(queue.length>12)throw Error('publication_queue_full');await storage.put('publicationsMode',true);await storage.put('publicationQueue',queue);if(queue.length)await storage.setAlarm(Date.now()+1000);return {queued:true,pending:queue.map(t=>t.id)};
}
export async function publicationAlarm(storage:Storage,dispatch:(task:PublicationTask)=>Promise<Response>){
 const queue=await storage.get<PublicationTask[]>('publicationQueue')??[];if(!queue.length){await storage.deleteAlarm();return;}
 const task=queue[0];await storage.setAlarm(Date.now()+480000);
 try{const response=await dispatch(task);if(!response.ok)throw Error('publication_http_'+response.status);const result=await response.json() as {pending?:boolean;wakeAfterMs?:number;state?:string};if(result.pending){await storage.setAlarm(Date.now()+Math.max(1000,Math.min(360000,Number(result.wakeAfterMs)||6000)));return;}
  await storage.put('publicationResult:'+task.id,{state:result.state??'complete',completedAt:new Date().toISOString()});await storage.put('publicationAttempts:'+task.id,0);
 }catch{const count=(await storage.get<number>('publicationAttempts:'+task.id)??0)+1;await storage.put('publicationAttempts:'+task.id,count);if(count<3){await storage.setAlarm(Date.now()+count*10000);return;}await storage.put('publicationResult:'+task.id,{state:'transport-failed',completedAt:new Date().toISOString()});}
 const fresh=await storage.get<PublicationTask[]>('publicationQueue')??[];const remaining=fresh.filter(t=>t.id!==task.id);await storage.put('publicationQueue',remaining);if(remaining.length)await storage.setAlarm(Date.now()+1000);else await storage.deleteAlarm();
}
