import test from 'node:test';
import assert from 'node:assert/strict';
import {staticRoutes} from '../scripts/static-routing.mjs';
// Cloudflare's documented wildcard spans all path segments; exclude wins.
const matches=(pattern,path)=>new RegExp('^'+pattern.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(path);
const invokes=(routes,path)=>routes.include.some(rule=>matches(rule,path))&&!routes.exclude.some(rule=>matches(rule,path));
test('static routing excludes only known static directories/exact styles and protects dynamic boundaries',()=>{
 const routes=staticRoutes();assert.equal(routes.version,1);assert.deepEqual(routes.include,['/*']);
 for(const path of ['/assets/main.js','/prototype-assets/old.png','/tower/day.webp','/media/nested/poster.jpg','/og/card.png','/examples/demo/condo.json','/condo-template.css'])assert.equal(invokes(routes,path),false,path);
 for(const path of ['/','/api/v1/assets/secret','/api/v1/tower/status','/home/0123456789abcdef','/home/0123456789abcdef/inside','/tower-lord','/tower-lord.js','/tower-lord.css','/identity','/identity/verify/x','/identity/maintenance','/identity-offer.js','/reception','/assets-private/secret','/condo-template.css/private'])assert.equal(invokes(routes,path),true,path);
});
