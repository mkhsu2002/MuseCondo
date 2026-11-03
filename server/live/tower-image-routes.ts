import type {createTowerImageOptimization,ImageSourceKind} from './tower-image-optimization.ts';
import {readRequestBody} from './request-body.ts';
type Service=ReturnType<typeof createTowerImageOptimization>;
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function createTowerImageRoutes(options:{service:Service;origin:string;authorized:()=>Promise<boolean>;operator:()=>Promise<boolean>}){
 return async(request:Request):Promise<Response|null>=>{
  const path=new URL(request.url).pathname,claim=path==='/api/v1/manager/images/claim',result=path.match(/^\/api\/v1\/manager\/images\/([a-f0-9]{64})\/(complete|failed)$/),backfill=path==='/api/v1/operator/images/backfill';
  if(!claim&&!result&&!backfill)return null;
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(new URL(request.url).origin!==options.origin||request.headers.has('Cookie')||request.headers.get('Sec-Fetch-Site')==='cross-site'||request.headers.has('Origin')&&request.headers.get('Origin')!==options.origin)return json({error:'origin_rejected'},403);
  if(!await(backfill?options.operator():options.authorized()))return json({error:'authorization_required'},401);
  try{
   if(claim){if((await readRequestBody(request,256)).length>2)return json({error:'invalid_request'},400);const job=await options.service.claim();return job?new Response(job.bytes,{headers:{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Image-Job-Id':job.id,'X-Image-Lease':job.lease,'X-Image-Source-Sha':job.sourceSha,'X-Image-Source-Size':String(job.bytes.length),'X-Image-Source-Width':String(job.width),'X-Image-Source-Height':String(job.height),'X-Image-Profile':job.profile}}):new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});}
   if(backfill){const body=JSON.parse(new TextDecoder().decode(await readRequestBody(request,4096))) as {sources:{kind:ImageSourceKind;id:string}[]};return json({results:await options.service.backfill(body.sources)});}
   const lease=request.headers.get('X-Image-Lease')??'';if(!/^[a-f0-9]{32}$/.test(lease))return json({error:'invalid_request'},400);
   if(result![2]==='complete'){
    if(request.headers.get('Content-Type')!=='image/webp')return json({error:'invalid_request'},415);
    const accepted=await options.service.complete(result![1],lease,new Uint8Array(await readRequestBody(request,2*1024*1024)));return json({accepted},accepted?200:409);
   }
   const body=JSON.parse(new TextDecoder().decode(await readRequestBody(request,256))) as {code:string};if(!['transform_rejected','transform_unknown'].includes(body.code))return json({error:'invalid_request'},400);
   const accepted=await options.service.failed(result![1],lease,body.code);return json({accepted},accepted?200:409);
  }catch{return json({error:'image_processing_unavailable'},503);}
 };
}
