import test from 'node:test';
import assert from 'node:assert/strict';
import {createTowerImageRoutes} from '../server/live/tower-image-routes.ts';
import type {createTowerImageOptimization} from '../server/live/tower-image-optimization.ts';
import worker from '../workers/tower-manager/worker.ts';
import pages from '../server/live/worker.ts';
const dev='https://framework-v001.musecondo.pages.dev',production='https://musetower.neobabylon.app';
const service={} as ReturnType<typeof createTowerImageOptimization>;
test('only the configured dev environment accepts the operator smoke; caller Origin cannot impersonate dev',async()=>{
 let auth=0,proxies=0;const productionRoute=createTowerImageRoutes({origin:production,service,authorized:async()=>true,operator:async()=>{auth++;return true;},smoke:async()=>{proxies++;return Response.json({state:'complete'});}});
 const rejected=(await productionRoute(new Request(production+'/api/v1/operator/images/smoke',{method:'POST',headers:{Origin:dev},body:'{}'})))!;assert.equal(rejected.status,404);assert.equal(auth,0);assert.equal(proxies,0);
 const direct=await worker.fetch(new Request('https://manager.internal/images/smoke',{method:'POST',headers:{Origin:dev,'X-Manager-Schedule-Key':'synthetic'}}),{PUBLIC_ORIGIN:production,MANAGER_SCHEDULE_TRIGGER_KEY:'synthetic'});assert.equal(direct.status,404);
 const publicRoute=await pages.fetch(new Request(production+'/api/v1/operator/images/smoke',{method:'POST',headers:{Origin:dev},body:'{}'}),{PUBLIC_ORIGIN:production});assert.equal(publicRoute.status,404);
});
test('dev smoke requires operator authentication and rejects cookies, hostile origins and variable payloads',async()=>{
 let allowed=false,proxies=0;const route=createTowerImageRoutes({origin:dev,service,authorized:async()=>true,operator:async()=>allowed,smoke:async()=>{proxies++;return Response.json({state:'complete'});}});
 const request=(headers:Record<string,string>={},body='{}')=>new Request(dev+'/api/v1/operator/images/smoke',{method:'POST',headers,body});
 assert.equal((await route(request()))!.status,401);allowed=true;
 for(const headers of [{Cookie:'synthetic=1'},{Origin:'https://foreign.example'},{'Sec-Fetch-Site':'cross-site'}] as Record<string,string>[])assert.equal((await route(request(headers)))!.status,403);
 assert.equal((await route(request({},'{"url":"https://foreign.example/image.png"}')))!.status,400);assert.equal(proxies,0);
 const response=(await route(request()))!;assert.equal(response.status,200);assert.equal(proxies,1);assert.equal((await response.json() as {state:string}).state,'complete');
});
