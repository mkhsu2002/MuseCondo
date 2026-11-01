import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderCondo} from '../src/framework/condo-render.ts';
import {renderHome} from '../src/framework/render.ts';
import type {PublicCondoSite} from '../src/framework/condo.ts';
import {seedOnboardingForm,ownerContentForms,tokenScopeFields} from '../src/live/framework-ui.ts';
import {onboardingGrantCard} from '../src/live/onboarding-grants.ts';
import {towerPanel} from '../src/live/tower-panel.ts';

const site:PublicCondoSite={templateVersion:'muse-condo-1',example:true,homeAlt:'Resident artwork',home:{frameworkVersion:'0.01',id:'a'.repeat(16),name:'Resident',intro:'An introduction',assets:{desktop:'./assets/home.png'},routes:{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'},daily:[],dreams:[]},profile:{motto:'A motto',about:'A story',interests:'Interests',strengths:'Strengths',currentFocus:'A quest',invitation:'An invitation'},dream:null};

test('new framework documents and nonidentity controls default to English without changing route or scope keys',async()=>{
 for(const page of ['home','inside','dreams'] as const){const html=renderCondo(site,page);assert.match(html,/<html lang="en">/);assert.match(html,/aria-label="Home navigation"/);assert.doesNotMatch(html,/\p{Script=Han}/u);for(const route of ['index.html','inside.html','dreams.html'])assert.ok(html.includes('./'+route));}
 assert.match(renderCondo(site,'inside'),/>Starsprout</);
 const controls=seedOnboardingForm()+ownerContentForms([],[],false,[])+tokenScopeFields()+onboardingGrantCard(true)+towerPanel({roomId:'a'.repeat(16),door:'/home/'+'a'.repeat(16),sourceURL:'https://source.example/condo.json',revision:1,publicRevision:null,published:false,directoryConsent:false,announcementConsent:false,dreamConsent:false,snapshotConsent:false},'An introduction');
 assert.doesNotMatch(controls,/\p{Script=Han}/u);for(const field of ['frameworkSeed','posts:write','dreams:publish','home:onboard','snapshotConsent','announcementConsent','dreamConsent']){
  assert.ok(controls.includes(field),field);
 }
 for(const file of ['activities.html','tower-visits.html']){const html=await readFile(new URL('../public/'+file,import.meta.url),'utf8');assert.match(html,/<html lang="en">/);assert.doesNotMatch(html,/\p{Script=Han}/u);}
});

test('English framework chrome preserves and escapes resident-authored Chinese text and original image references',()=>{
 const authored=structuredClone(site);authored.home.name='原名<保留>';authored.home.intro='居民自己寫的介紹';authored.profile.about='原本的角色故事';authored.homeAlt='原圖的中文說明';authored.dream={id:'original-dream',title:'原夢的標題',body:'原夢的內容',wish:'原來的願望',occurredAt:'2026-10-31T00:00:00Z',image:{src:'./assets/dream.png',alt:'原夢圖說'}};const before=structuredClone(authored);
 const home=renderCondo(authored,'home'),inside=renderCondo(authored,'inside'),dream=renderCondo(authored,'dreams');assert.ok(home.includes('原名&lt;保留&gt;'));assert.ok(home.includes(authored.home.intro));assert.ok(home.includes(authored.homeAlt));assert.ok(inside.includes(authored.profile.about));for(const text of [authored.dream.title,authored.dream.body,authored.dream.wish,authored.dream.image.alt])assert.ok(dream.includes(text));assert.match(dream,/src="\.\/assets\/dream.png"/);assert.deepEqual(authored,before);
 const projected={...authored.home,assets:{desktop:'/assets/original-home.png'},routes:{home:'/home/'+'a'.repeat(16),inside:'/home/'+'a'.repeat(16)+'/inside',dreams:'/home/'+'a'.repeat(16)+'/dreams'}};assert.ok(renderHome(projected,'home').includes(authored.home.intro));assert.match(renderHome(projected,'inside'),/aria-label="Life updates"/);
});
