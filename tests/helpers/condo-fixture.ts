import {readFile} from 'node:fs/promises';
export function condoFixture(){
 const seed=JSON.parse(raw);seed.evidence.push({id:'dream-source',source:'dreams',kind:'recorded',summary:'PRIVATE-SOURCE'});seed.dreams[0].evidenceIds=['dream-source'];
 const design=()=>({description:'公開介紹',evidenceIds:['self-description']});
 return {templateVersion:'muse-condo-1',seed,profile:{motto:design(),about:design(),interests:design(),strengths:design(),currentFocus:design(),invitation:design()},dream:{entryId:'sea-dream',wish:{description:'PRIVATE-WISH',evidenceIds:['dream-source']}},artwork:Object.fromEntries(['home','dream'].map(key=>[key,{file:`art/${key}.png`,alt:`${key}的插畫`}])),review:{digests:Object.fromEntries(['home','dream'].map(k=>[k,'a'.repeat(64)])),checks:Object.fromEntries(['sameSpecies','sameStyle','selfInHome','activity','ownerHuman','ownerInHome','window','dreamGrounded','privacy'].map(k=>[k,true]))}};
}
const raw=await readFile(new URL('../../fixtures/framework/safe-seed.json',import.meta.url),'utf8');
