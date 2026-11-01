import type {EvidenceDesign, FrameworkSeed, PublicHome} from './types.ts';
import {publicHomeProjection} from './projection.ts';
import {frameworkId, frameworkObject, frameworkString, validateFrameworkSeed} from './validation.ts';
export const CONDO_TEMPLATE_VERSION = 'muse-condo-1' as const;
export const CONDO_PROFILE_FIELDS = ['motto','about','interests','strengths','currentFocus','invitation'] as const;
export const CONDO_APPEARANCE_FIELDS = ['characterAppearance','guardianAppearance','guardianPersonality'] as const;
export const CONDO_PORTRAIT_CROP_FIELDS = ['characterPortraitCrop','guardianPortraitCrop'] as const;
export const CONDO_OPTIONAL_PROFILE_FIELDS = [...CONDO_APPEARANCE_FIELDS,...CONDO_PORTRAIT_CROP_FIELDS] as const;
export const CONDO_ALL_PROFILE_FIELDS = [...CONDO_PROFILE_FIELDS,...CONDO_OPTIONAL_PROFILE_FIELDS] as const;
/** Percentage rectangle in the existing home scene; never arbitrary CSS or a URL. */
export function parsePortraitCrop(value:unknown):{x:number;y:number;width:number;height:number}{
 if(typeof value!=='string'||value.length>100||!/^\d+(?:\.\d+)?,\d+(?:\.\d+)?,\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(value))throw Error('condo: invalid portrait crop');
 const [x,y,width,height]=value.split(',').map(Number);
 if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||width>100-x||height>100-y)throw Error('condo: invalid portrait crop');
 return {x,y,width,height};
}
export const CONDO_ARTWORK_KEYS = ['home','dream'] as const;
export const CONDO_REVIEW_CHECKS = ['sameSpecies','sameStyle','selfInHome','activity','ownerHuman','ownerInHome','window','dreamGrounded','privacy'] as const;
export type CondoProfile = Record<typeof CONDO_PROFILE_FIELDS[number],string> & Partial<Record<typeof CONDO_OPTIONAL_PROFILE_FIELDS[number],string>>;
type PrivateCondoProfile = Record<typeof CONDO_PROFILE_FIELDS[number],EvidenceDesign> & Partial<Record<typeof CONDO_OPTIONAL_PROFILE_FIELDS[number],EvidenceDesign>>;
export interface CondoInput {
 templateVersion:typeof CONDO_TEMPLATE_VERSION;
 seed:FrameworkSeed;
 profile:PrivateCondoProfile;
 dream:{entryId:string;wish:EvidenceDesign};
 artwork:Record<typeof CONDO_ARTWORK_KEYS[number],{file:string;alt:string}>;
 review:{digests:Record<typeof CONDO_ARTWORK_KEYS[number],string>;checks:Record<typeof CONDO_REVIEW_CHECKS[number],true>};
 example?:true;
}
export interface PublicCondoSite {
 templateVersion:typeof CONDO_TEMPLATE_VERSION;
 home:PublicHome;
 homeAlt:string;
 profile:CondoProfile;
 dream:{id:string;title:string;body:string;occurredAt:string;reflection?:string;wish:string;image:{src:string;alt:string}}|null;
 example:boolean;
}
function fail(path:string):never{throw Error(`condo: ${path} is incomplete or unsupported`);}
function references(value:unknown,evidence:Set<string>,path:string):string[]{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||!value.length||value.length>16||Reflect.ownKeys(value).length!==value.length+1)fail(path);
 const ids:string[]=[];
 for(let i=0;i<value.length;i++){
  const descriptor=Object.getOwnPropertyDescriptor(value,String(i));if(!descriptor||!descriptor.enumerable||!('value' in descriptor))fail(path);
  ids.push(frameworkId(descriptor.value,path));
 }
 if(new Set(ids).size!==ids.length||ids.some(id=>!evidence.has(id)))fail(path);return ids;
}
export function validateCondoInput(input:unknown):CondoInput{
 const root=frameworkObject(input,['templateVersion','seed','profile','dream','artwork','review','example'],'condo');
 if(root.templateVersion!==CONDO_TEMPLATE_VERSION)fail('templateVersion');
 if(root.example!==undefined&&root.example!==true)fail('example');
 const seed=validateFrameworkSeed(root.seed),evidence=new Set(seed.evidence.map(item=>item.id));
 const design=(value:unknown,path:string):EvidenceDesign=>{const item=frameworkObject(value,['description','evidenceIds'],path);return {description:frameworkString(item.description,2000,path),evidenceIds:references(item.evidenceIds,evidence,path)};};
 const suppliedProfile=frameworkObject(root.profile,CONDO_ALL_PROFILE_FIELDS,'profile');
 const profile=Object.fromEntries(CONDO_PROFILE_FIELDS.map(key=>[key,design(suppliedProfile[key],`profile.${key}`)])) as CondoInput['profile'];
 for(const key of CONDO_OPTIONAL_PROFILE_FIELDS)if(suppliedProfile[key]!==undefined)profile[key]=design(suppliedProfile[key],`profile.${key}`);
 for(const key of CONDO_PORTRAIT_CROP_FIELDS)if(profile[key]!==undefined)parsePortraitCrop(profile[key]!.description);
 const suppliedDream=frameworkObject(root.dream,['entryId','wish'],'dream'),entryId=frameworkId(suppliedDream.entryId,'dream.entryId');
 const entry=seed.dreams.find(item=>item.id===entryId);
 if(!entry||!entry.evidenceIds.some(id=>seed.evidence.some(item=>item.id===id&&(item.source==='dreams'||item.source==='ALIGNMENT_SYNTHESIS'))))fail('dream.source');
 const dream={entryId,wish:design(suppliedDream.wish,'dream.wish')};
 const suppliedArtwork=frameworkObject(root.artwork,CONDO_ARTWORK_KEYS,'artwork');
 const artwork=Object.fromEntries(CONDO_ARTWORK_KEYS.map(key=>{const item=frameworkObject(suppliedArtwork[key],['file','alt'],`artwork.${key}`);if(item.file!==`art/${key}.png`)fail(`artwork.${key}.file`);return [key,{file:`art/${key}.png`,alt:frameworkString(item.alt,500,`artwork.${key}.alt`)}];})) as CondoInput['artwork'];
 const review=frameworkObject(root.review,['digests','checks'],'review'),suppliedDigests=frameworkObject(review.digests,CONDO_ARTWORK_KEYS,'review.digests'),suppliedChecks=frameworkObject(review.checks,CONDO_REVIEW_CHECKS,'review.checks');
 const digests=Object.fromEntries(CONDO_ARTWORK_KEYS.map(key=>{if(typeof suppliedDigests[key]!=='string'||!/^[a-f0-9]{64}$/.test(suppliedDigests[key]))fail(`review.digests.${key}`);return [key,suppliedDigests[key]];})) as CondoInput['review']['digests'];
 const checks=Object.fromEntries(CONDO_REVIEW_CHECKS.map(key=>{if(suppliedChecks[key]!==true)fail(`review.checks.${key}`);return [key,true];})) as CondoInput['review']['checks'];
 const result:CondoInput={templateVersion:CONDO_TEMPLATE_VERSION,seed,profile,dream,artwork,review:{digests,checks},...(root.example===true?{example:true}:{})};
 if(new TextEncoder().encode(JSON.stringify(result)).length>100_000)fail('size');return result;
}
/** Reconstruct every public field; the private evidence and review never enter export data. */
export function publicCondoProjection(input:unknown,id:string):PublicCondoSite{
 const data=validateCondoInput(input);if(!/^[a-f0-9]{16}$/.test(id))fail('id');
 const home=publicHomeProjection(data.seed,{id});
 home.assets={desktop:'./assets/home.png'};home.routes={home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'};
 const entry=data.seed.dreams.find(item=>item.id===data.dream.entryId)!;
 const publish=data.seed.consent.publishDreams&&entry.publication==='public';
 home.dreams=publish?[{id:entry.id,type:'dream',title:entry.title,body:entry.body,occurredAt:entry.occurredAt,image:'./assets/dream.png',...(entry.reflection?{reflection:entry.reflection}:{})}]:[];
 return {templateVersion:CONDO_TEMPLATE_VERSION,home,homeAlt:data.artwork.home.alt,profile:Object.fromEntries(CONDO_ALL_PROFILE_FIELDS.flatMap(key=>data.profile[key]===undefined?[]:[[key,data.profile[key]!.description]])) as CondoProfile,dream:publish?{id:entry.id,title:entry.title,body:entry.body,occurredAt:entry.occurredAt,...(entry.reflection?{reflection:entry.reflection}:{}),wish:data.dream.wish.description,image:{src:'./assets/dream.png',alt:data.artwork.dream.alt}}:null,example:data.example===true};
}
