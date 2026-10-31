import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PDFDocument} from 'pdf-lib';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';
import fontkit from '@pdf-lib/fontkit';
import {renderIdentityCard, FONT_SHA256, createFontLoader} from '../workers/identity-card/render.ts';
import type {SignedCredential} from '../src/identity/index.ts';
const issuer='https://framework-v001-0123456789.musecondo.pages.dev';
const signed:SignedCredential={payload:{type:'NeoBabylonAgentIdentity',version:'0.01',issuer,agentId:'mcid:'+'a'.repeat(64),credentialId:'b'.repeat(32),publicName:'繁體中文測試居民'.repeat(10),issuedAt:'2026-10-31T00:00:00.000Z',keyId:'test',verificationURL:issuer+'/identity/verify/'+'b'.repeat(32)},signature:'A'.repeat(86)};
const font=()=>Promise.resolve(new Uint8Array(readFileSync(new URL('../workers/identity-card/assets/MuseCondoTC-Regular.ttf',import.meta.url))));
test('real PDF is deterministic, one page with all 80 Chinese glyphs, full IDs and official linked QR',async()=>{
 const one=await renderIdentityCard(signed,font),two=await renderIdentityCard(signed,font);assert.deepEqual(one,two);assert(one.length<8388608);const pdf=await PDFDocument.load(one,{updateMetadata:false});assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getCreationDate()?.toISOString(),signed.payload.issuedAt);assert.equal(pdf.getModificationDate()?.toISOString(),signed.payload.issuedAt);
 const dir=mkdtempSync(join(tmpdir(),'identity-card-'));try{const path=join(dir,'card.pdf');writeFileSync(path,one);const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});assert(text.replace(/\s/g,'').includes(signed.payload.publicName));assert(text.replace(/\s/g,'').includes(signed.payload.agentId));assert(text.includes(signed.payload.credentialId));assert(!text.includes('guardian'));const fonts=execFileSync('pdffonts',[path],{encoding:'utf8'});assert.match(fonts,/MuseCondoTC/);assert.match(fonts,/yes/);
 // Independent jsQR decoder verifies the actual rasterized QR, not a re-created matrix.
 execFileSync('pdftoppm',['-scale-to','1800','-singlefile','-png',path,join(dir,'card')]);const png=PNG.sync.read(readFileSync(join(dir,'card.png')));const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);assert.equal(decoded?.data,signed.payload.verificationURL);assert(decoded);
 // Raster white quiet zone is >= four modules on every side of the detected symbol.
 const corners=[decoded.location.topLeftCorner,decoded.location.topRightCorner,decoded.location.bottomLeftCorner,decoded.location.bottomRightCorner];assert(corners.every(c=>Number.isFinite(c.x)&&Number.isFinite(c.y)));
 const white=(x:number,y:number)=>{const offset=(Math.round(y)*png.width+Math.round(x))*4;return png.data[offset]>245&&png.data[offset+1]>245&&png.data[offset+2]>245;};
 const left=decoded.location.topLeftCorner.x,right=decoded.location.topRightCorner.x,top=decoded.location.topLeftCorner.y,bottom=decoded.location.bottomLeftCorner.y;
 // Decoder-derived module count; no re-created encoder matrix.
 const modules=17+4*decoded.version,unit=(right-left)/modules;for(let q=1;q<=4;q++)for(let t=0;t<modules;t++){assert(white(left-q*unit+unit/2,top+(t+.5)*unit));assert(white(right+q*unit-unit/2,top+(t+.5)*unit));assert(white(left+(t+.5)*unit,top-q*unit+unit/2));assert(white(left+(t+.5)*unit,bottom+q*unit-unit/2));};
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('real PDF preserves numeric issuer and complete mixed Latin/CJK name without glyph spacing or clipping',async()=>{
 const publicName=('A0123456789 FangK1234 中文001 fi fl ffi '+'繁體中文測試居民'.repeat(10)).slice(0,80);
 assert.equal(Array.from(publicName).length,80);
 const subject={...signed,payload:{...signed.payload,publicName}};
 const one=await renderIdentityCard(subject,font),two=await renderIdentityCard(subject,font);
 assert.deepEqual(one,two);
 const pdf=await PDFDocument.load(one,{updateMetadata:false});assert.equal(pdf.getPageCount(),1);
 const dir=mkdtempSync(join(tmpdir(),'identity-card-numeric-'));let passed=false;
 try{
  const path=join(dir,'card.pdf');writeFileSync(path,one);
  const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});writeFileSync(join(dir,'card.txt'),text);
  const compact=text.replace(/\s/g,'');
  assert.deepEqual({completeName:compact.includes(publicName.replace(/\s/g,'')),completeIssuer:compact.includes(issuer)},{completeName:true,completeIssuer:true},`complete original name and numeric issuer; artifacts: ${dir}`);
  assert(compact.includes(signed.payload.agentId));assert(compact.includes(signed.payload.credentialId));
  const bbox=execFileSync('pdftotext',['-bbox',path,'-'],{encoding:'utf8'});writeFileSync(join(dir,'card-bbox.html'),bbox);
  const words=Array.from(bbox.matchAll(/<word xMin="(-?[\d.]+)" yMin="(-?[\d.]+)" xMax="(-?[\d.]+)" yMax="(-?[\d.]+)">([^<]*)<\/word>/g),match=>({xMin:Number(match[1]),yMin:Number(match[2]),xMax:Number(match[3]),yMax:Number(match[4]),text:match[5]}));
  assert(words.length>0);
  assert(words.every(word=>word.xMin>=0&&word.yMin>=0&&word.xMax<=720&&word.yMax<=480),'all glyph bounds stay inside the single page');
  const nameStart=words.findIndex(word=>word.text==='A0123456789'),nameEnd=words.findIndex(word=>word.text==='永久身份');
  assert(nameStart>=0&&nameEnd>nameStart);
  const nameWords=words.slice(nameStart,nameEnd);
  assert.equal(nameWords.map(word=>word.text).join(''),publicName.replace(/\s/g,''));
  assert(nameWords.every(word=>word.xMin>=32&&word.xMax<=446&&word.yMin>=100&&word.yMax<284),'complete name stays above permanent ID and left of QR');
  // Compare rendered advances with the original cmap glyph metrics, independently of layout/GSUB.
  const source=fontkit.create(await font());
  for(const token of ['A0123456789','FangK1234']){
   const word=nameWords.find(word=>word.text===token);assert(word,`unsplit numeric name token ${token}; artifacts: ${dir}`);
   const expected=Array.from(token).reduce((width,c)=>width+source.glyphForCodePoint(c.codePointAt(0)!).advanceWidth,0)/source.unitsPerEm*22;
   assert(Math.abs(word.xMax-word.xMin-expected)<.05,`nominal glyph spacing for ${token}; artifacts: ${dir}`);
  }
  const issuerWord=words.find(word=>word.text===issuer);assert(issuerWord,`issuer is one continuous word; artifacts: ${dir}`);
  const issuerWidth=Array.from(issuer).reduce((width,c)=>width+source.glyphForCodePoint(c.codePointAt(0)!).advanceWidth,0)/source.unitsPerEm*9;
  assert(Math.abs(issuerWord.xMax-issuerWord.xMin-issuerWidth)<.05,`nominal issuer glyph spacing; artifacts: ${dir}`);
  passed=true;
 }finally{if(passed)rmSync(dir,{recursive:true,force:true});}
});
test('unsupported glyph or overlong name fails closed without replacing subject',async()=>{
 for(const name of ['😀','字'.repeat(81)])await assert.rejects(renderIdentityCard({...signed,payload:{...signed.payload,publicName:name}},font));
 assert.equal(signed.payload.publicName.length,80);
});
test('font only loads fixed internal asset and rejects unavailable/corrupt bytes',async()=>{
 const paths:string[]=[];const loader=createFontLoader({async fetch(request){paths.push(request.url);return new Response(await font());}});assert.equal((await loader()).length,7149128);assert.equal((await loader()).length,7149128);assert.equal(paths.length,1);assert.equal(new URL(paths[0]).pathname,'/MuseCondoTC-Regular.ttf');assert.equal(FONT_SHA256,'d20595e7a607df9dc31a2efcd055665cbda1c8be6a8369cc06be4a77218325e5');
 for(const response of [new Response('missing',{status:404}),new Response('corrupt')])await assert.rejects(createFontLoader({async fetch(){return response;}})());
});
