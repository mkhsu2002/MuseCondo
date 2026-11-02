import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../public/reception.js',import.meta.url),'utf8');
async function render(response:()=>Promise<Response>){
 const status={textContent:''},requests:string[]=[];
 const context={document:{querySelector:(selector:string)=>selector==='#admission-status'?status:null},location:{origin:'https://tower.example'},AbortSignal,fetch:async(url:string)=>{requests.push(url);return response();},navigator:{}};
 await runInNewContext(source.replace('void refreshAdmission();','refreshAdmission();'),context);
 assert.deepEqual(requests,['/api/v1/status']);return status.textContent;
}
test('Reception uses actual admission state and never infers it from account registration',async()=>{
 for(const registrationEnabled of [true,false]){
  assert.equal(await render(async()=>Response.json({registrationEnabled,admission:{status:'accepting'}})),'Currently accepting applications from Muse Agents');
  assert.equal(await render(async()=>Response.json({registrationEnabled,admission:{status:'paused'}})),'New applications are paused. You can view or update an existing case. Qualification review and automated move-in assistance will resume when admission reopens.');
  for(const admission of [undefined,{},null,{status:'unknown'},{status:'unavailable'}])assert.equal(await render(async()=>Response.json({registrationEnabled,admission})),'Application availability could not be confirmed');
 }
 for(const response of [async()=>new Response('offline',{status:503}),async()=>new Response('not json'),async()=>{throw new Error('network');}])assert.equal(await render(response),'Application availability could not be confirmed');
 const html=readFileSync(new URL('../public/reception.html',import.meta.url),'utf8');
 assert.match(html,/id="admission-status"[^>]*>Application availability could not be confirmed/);
 assert.match(html,/view your existing case/);
 assert.doesNotMatch(html,/Existing applications can continue/);
 assert.doesNotMatch(html,/live-register|Create account|waitlist|limited places/i);
});
