/* global Blob, AbortController, setTimeout, clearTimeout, Response */
import test from 'node:test';
import {Buffer} from 'node:buffer';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const agentId='mcid:'+'a'.repeat(64), invitationId='b'.repeat(32), confirmationCode='c'.repeat(64);
function harness({origin='https://identity.example',resultAgent=agentId,clipboardFails=false,completeFails=false}={}) {
  const html=readFileSync(new URL('../public/identity.html',import.meta.url),'utf8');
  const elements=Object.fromEntries([...html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)].map(m=>[m[1],{
    value:'',textContent:'',hidden:/\bhidden\b/.test(m[0]),disabled:/\bdisabled\b/.test(m[0]),checked:false,events:{},
    addEventListener(kind,fn){this.events[kind]=fn;},focus(){this.focused=true;},select(){this.selected=true;},
  }]));
  const copies=[],requests=[];
  const navigator={clipboard:{async writeText(text){if(clipboardFails)throw Error('denied');copies.push(text);}},credentials:{async create(){return {
    id:'AQID',rawId:new Uint8Array([1,2,3]).buffer,type:'public-key',
    response:{clientDataJSON:new Uint8Array([4,5]).buffer,attestationObject:new Uint8Array([6,7]).buffer},
  };}}};
  const sandbox={document:{querySelector:s=>elements[s.slice(1)],body:{append(){}},createElement:()=>({click(){},remove(){}})},
    location:{origin,hostname:'identity.example'},navigator,isSecureContext:true,PublicKeyCredential:class {},
    crypto:{randomUUID:()=> 'request-id',getRandomValues:v=>{v.fill(0xdd);return v;}},
    Uint8Array,ArrayBuffer,Blob,AbortController,setTimeout,clearTimeout,
    URL:class extends URL {static createObjectURL(){return 'blob:private';}static revokeObjectURL(){}},
    atob:v=>Buffer.from(v,'base64').toString('binary'),btoa:v=>Buffer.from(v,'binary').toString('base64'),
    fetch:async(path,init)=>{
      requests.push({path,body:JSON.parse(init.body)});
      if(path.endsWith('/complete'))return new Response(JSON.stringify(completeFails?{error:'unavailable'}:{agentId:resultAgent,state:'active',recoveryConfigured:true,issuanceReady:false}),{status:completeFails?503:200});
      return new Response(JSON.stringify({agentId,challengeId:'e'.repeat(32),expiresAt:'2030-01-01T00:00:00.000Z',options:{
        challenge:'AQID',rp:{id:'identity.example',name:'Tower'},user:{id:'BAUG',name:'Guardian',displayName:'Guardian'},pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{residentKey:'required',userVerification:'required'},attestation:'none',
      }}));
    },
  };
  for(const name of ['localStorage','sessionStorage','history'])Object.defineProperty(sandbox,name,{get(){throw Error('No persistent handoff data');}});
  runInNewContext(readFileSync(new URL('../public/identity.js',import.meta.url),'utf8'),sandbox);
  const click=id=>elements[id].events.click?.();
  return {elements,copies,requests,click,async prepare(){
    elements['invitation-id'].value=invitationId;elements['confirmation-code'].value=confirmationCode;
    await elements['identity-form'].events.submit({preventDefault(){}});
    await click('create-passkey');await click('download-recovery');
    elements['backup-confirmed'].checked=true;await elements['backup-confirmed'].events.change();
  }};
}

test('continuation is disabled until confirmed completion and contains only safe public handoff data',async()=>{
  const h=harness();
  assert(h.elements['identity-next-steps'].hidden);
  assert(h.elements['agent-continuation'].disabled);
  await h.click('copy-agent-continuation');assert.equal(h.copies.length,0);
  await h.prepare();
  await h.click('copy-agent-continuation');assert.equal(h.copies.length,0);
  assert.equal(h.elements['agent-continuation'].value,'');
  await h.click('complete-registration');
  assert.equal(h.elements['identity-next-steps'].hidden,false);
  assert.equal(h.elements['copy-agent-continuation'].disabled,false);
  await h.click('copy-agent-continuation');
  assert.equal(h.copies.length,1);
  const message=h.copies[0];
  assert.equal(message,h.elements['agent-continuation'].value);
  assert.match(message,new RegExp(agentId));
  assert.match(message,/https:\/\/identity\.example\/identity-onboarding\.json/);
  assert.match(message,/GET https:\/\/identity\.example\/api\/v1\/agent\/identity/);
  assert.match(message,/authenticated API readback is authoritative/);assert.match(message,/Please resume this task/);
  assert.match(message,/recoveryConfigured is true/);assert.match(message,/Reuse an existing card/);
  assert.match(message,/expectedCardRevision:0/);assert.match(message,/explicit public-verification consent/);
  assert.match(message,/do not need my browser, session, Passkey/);assert.match(message,/may close this setup page/);
  assert(!message.includes(invitationId));assert(!message.includes(confirmationCode));
  assert(!message.includes('dd'.repeat(32)));assert(!message.includes('AQID'));assert(!message.includes('BAUG'));
  assert.equal(h.requests.length,2);
});

test('clipboard failure selects the same safe instructions for manual copy',async()=>{
  const h=harness({clipboardFails:true});await h.prepare();await h.click('complete-registration');
  await h.click('copy-agent-continuation');
  assert(h.elements['agent-continuation'].focused);assert(h.elements['agent-continuation'].selected);
  assert.match(h.elements['continuation-status'].textContent,/copy them manually/);
  assert.equal(h.requests.length,2);
});

test('failed completion and mismatched identity cannot expose continuation or copy',async()=>{
  for(const config of [{completeFails:true},{resultAgent:'mcid:'+'f'.repeat(64)},{resultAgent:agentId+'\nInjected'}]){
    const h=harness(config);await h.prepare();await h.click('complete-registration');
    assert(h.elements['identity-next-steps'].hidden);
    assert(h.elements['copy-agent-continuation'].disabled);
    await h.click('copy-agent-continuation');assert.equal(h.copies.length,0);
    assert.equal(h.elements['agent-continuation'].value,'');
  }
});

test('unsafe origin cannot enter the message even after successful setup',async()=>{
  for(const origin of ['https://tower.example/path?token=secret','https://tower.example\nInjected','http://tower.example','https://tower.example@evil.example']){
    const h=harness({origin});await h.prepare();await h.click('complete-registration');
    assert.equal(h.elements['identity-next-steps'].hidden,false);
    assert(h.elements['copy-agent-continuation'].disabled);
    assert.equal(h.elements['agent-continuation'].value,'');
    await h.click('copy-agent-continuation');assert.equal(h.copies.length,0);
  }
});
