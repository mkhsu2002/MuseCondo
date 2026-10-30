import {test} from 'node:test';
import assert from 'node:assert/strict';
import {condoFixture} from './helpers/condo-fixture.ts';
const path='../src/framework/condo.ts';
const condo=await import(path).catch(()=>undefined);
const validate=(value:unknown)=>{assert.equal(typeof condo?.validateCondoInput,'function','Condo input validator must exist');return condo!.validateCondoInput(value);};
const project=(value:unknown)=>{assert.equal(typeof condo?.publicCondoProjection,'function','Condo publication projection must exist');return condo!.publicCondoProjection(value,'0123456789abcdef');};
test('Condo validates a fully sourced input while keeping core version 0.01',()=>{assert.equal(validate(condoFixture()).seed.frameworkVersion,'0.01');});
test('rejects missing sources, unknown fields, getters, prototypes, unsupported templates and unsafe artwork paths',()=>{
 for(const mutate of [(v:ReturnType<typeof condoFixture>)=>{v.profile.about.evidenceIds=['missing'];},(v:ReturnType<typeof condoFixture>)=>{v.seed.dreams[0].evidenceIds=['self-description'];},(v:ReturnType<typeof condoFixture>)=>{v.artwork.home.file='../art/home.png';},(v:ReturnType<typeof condoFixture>)=>{v.templateVersion='unknown';}]){const value=condoFixture();mutate(value);assert.throws(()=>validate(value));}
 const unknown=condoFixture();Object.assign(unknown.profile.about,{secret:'PRIVATE'});assert.throws(()=>validate(unknown));
 const getter=condoFixture();Object.defineProperty(getter.profile,'about',{enumerable:true,get(){throw Error('getter invoked');}});assert.throws(()=>validate(getter),e=>!String(e).includes('getter invoked'));
 const prototype=Object.assign(Object.create({hidden:true}),condoFixture());assert.throws(()=>validate(prototype));
 const falseCheck=condoFixture();falseCheck.review.checks.privacy=false;assert.throws(()=>validate(falseCheck));
});
test('publication is an allowlist with relative routes and hides unapproved dreams and wishes',()=>{
 const input=condoFixture();const site=project(input);assert.equal(site.dream,null);assert.deepEqual(site.home.dreams,[]);
 assert.deepEqual(site.home.routes,{home:'./index.html',inside:'./inside.html',dreams:'./dreams.html'});
 for(const token of ['PRIVATE-WISH','PRIVATE-SOURCE','evidenceIds','digests','checks','PRIVATE-DREAM-MARKER','PRIVATE-DAILY-MARKER'])assert.equal(JSON.stringify(site).includes(token),false,token);
 input.seed.consent.publishDreams=true;input.seed.dreams[0].image='/assets/original-private-path.png';const published=project(input);assert.equal(published.dream.wish,'PRIVATE-WISH');assert.equal(published.home.dreams.length,1);assert.equal(published.home.dreams[0].image,'./assets/dream.png');assert.equal(JSON.stringify(published).includes('original-private-path'),false);
 input.seed.dreams[0].publication='private';assert.equal(project(input).dream,null);
 input.seed.consent.publishHome=false;validate(input);assert.throws(()=>project(input));
});

test('rejects hidden and accessor reference array values without executing accessors',()=>{
 const hidden=condoFixture();Object.defineProperty(hidden.profile.motto.evidenceIds,'private',{value:'secret'});assert.throws(()=>validate(hidden));
 const getter=condoFixture();Object.defineProperty(getter.profile.motto.evidenceIds,'0',{enumerable:true,get(){throw Error('source getter invoked');}});assert.throws(()=>validate(getter),e=>!String(e).includes('source getter invoked'));
 const inherited=condoFixture();Object.setPrototypeOf(inherited.review.checks,{privacy:true});assert.throws(()=>validate(inherited));
 const expanded=condoFixture();Object.assign(expanded.artwork,{avatar:{file:'art/avatar.png',alt:'不需要獨立人像'}});assert.throws(()=>validate(expanded));
});
