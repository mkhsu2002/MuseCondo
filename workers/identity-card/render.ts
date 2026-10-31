import {PDFDocument, StandardFonts, PDFName, PDFString, rgb, type PDFFont} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QR from 'qrcode/lib/core/qrcode.js';
import {validateCredentialPayload, type SignedCredential} from '../../src/identity/index.ts';

export const FONT_SHA256='d20595e7a607df9dc31a2efcd055665cbda1c8be6a8369cc06be4a77218325e5';
export interface AssetFetcher {fetch(request:Request):Promise<Response>}
/** The only cached artifact is an immutable, public, pinned font. Failed loads are retryable. */
export function createFontLoader(assets:AssetFetcher|undefined):()=>Promise<Uint8Array> {
 let cached:Promise<Uint8Array>|undefined;
 return ()=>cached??=(async()=>{
  if(!assets)throw new Error('font_unavailable');
  const response=await assets.fetch(new Request('https://identity-card-assets.invalid/MuseCondoTC-Regular.ttf'));
  if(!response.ok)throw new Error('font_unavailable');
  const bytes=new Uint8Array(await response.arrayBuffer());
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(bytes.length!==7149128||hash!==FONT_SHA256)throw new Error('font_integrity');
  return bytes;
 })().catch(error=>{cached=undefined;throw error;});
}
function wrap(text:string,font:PDFFont,size:number,width:number):string[]{
 const lines:string[]=[];let line='';
 for(const c of text){if(font.widthOfTextAtSize(line+c,size)>width){if(!line)throw new Error('text_width');lines.push(line);line='';}line+=c;}
 if(line)lines.push(line);return lines;
}
/** Public-only deterministic rendering. Signature authorization and persistence remain in core. */
export async function renderIdentityCard(signed:Readonly<SignedCredential>,loadFont:()=>Promise<Uint8Array>):Promise<Uint8Array>{
 const p=signed.payload;
 if(!validateCredentialPayload(p))throw new Error('invalid_card_subject');
 const pdf=await PDFDocument.create({updateMetadata:false});pdf.registerFontkit(fontkit);
 // Full static TTF embedding is intentional. Subsetting this font silently loses CJK glyphs.
 const font=await pdf.embedFont(await loadFont(),{subset:false}),mono=await pdf.embedFont(StandardFonts.Courier);
 const allText=['NeoBabylon Agent Identity Card','新巴比倫 Agent 身分證',p.publicName,p.agentId,p.credentialId,p.issuer,p.issuedAt,'核發者','核發日期','永久身份','證件序號','掃碼確認目前證件狀態','本卡僅供身份驗證，不授予接管或登入權限。'].join('');
 const supported=new Set(font.getCharacterSet());for(const c of allText)if(!supported.has(c.codePointAt(0)!))throw new Error('unsupported_card_glyph');
 const date=new Date(p.issuedAt);pdf.setCreationDate(date);pdf.setModificationDate(date);pdf.setProducer('NeoBabylon Identity Card Renderer 1');pdf.setCreator('NeoBabylon.App');pdf.setTitle('NeoBabylon Agent Identity Card');pdf.setSubject('Agent identity credential');
 const page=pdf.addPage([720,480]),ink=rgb(.18,.23,.20),green=rgb(.21,.36,.28),muted=rgb(.34,.40,.35),paper=rgb(.97,.96,.92),line=rgb(.79,.83,.77);
 page.drawRectangle({x:0,y:0,width:720,height:480,color:paper});page.drawRectangle({x:0,y:462,width:720,height:18,color:green});
 // Fixed architectural geometry; no resident image or arbitrary remote asset.
 for(let i=0;i<3;i++)page.drawRectangle({x:644+i*12,y:400+i*8,width:8,height:32-i*8,color:green});
 page.drawText('NeoBabylon Agent Identity Card',{x:32,y:426,size:20,font,color:green});page.drawText('新巴比倫 Agent 身分證',{x:32,y:399,size:17,font,color:ink});
 page.drawLine({start:{x:32,y:381},end:{x:688,y:381},thickness:1,color:line});
 const nameLines=wrap(p.publicName,font,22,414);if(nameLines.length>5)throw new Error('name_layout');
 nameLines.forEach((text,i)=>page.drawText(text,{x:32,y:344-i*29,size:22,font,color:ink}));
 page.drawText('永久身份 / Agent ID',{x:32,y:184,size:10,font,color:muted});
 page.drawText(p.agentId,{x:32,y:165,size:9,font:mono,color:ink});
 page.drawText('證件序號 / Credential ID',{x:32,y:139,size:10,font,color:muted});page.drawText(p.credentialId,{x:32,y:120,size:10,font:mono,color:ink});
 page.drawText('核發者 / Issuer',{x:32,y:94,size:10,font,color:muted});
 // Origin can be long, so retain every character with a bounded layout; never silently truncate.
 const issuerLines=wrap(p.issuer,font,9,410);if(issuerLines.length>2)throw new Error('issuer_layout');issuerLines.forEach((text,i)=>page.drawText(text,{x:32,y:79-i*12,size:9,font,color:ink}));
 page.drawText('核發日期 / Issued at',{x:490,y:139,size:10,font,color:muted});page.drawText(p.issuedAt,{x:490,y:120,size:9,font:mono,color:ink});
 const qr=QR.create(p.verificationURL,{errorCorrectionLevel:'M'}),n=qr.modules.size,quiet=4,side=180,unit=side/(n+quiet*2),x=490,y=177;
 page.drawRectangle({x,y,width:side,height:side,color:rgb(1,1,1)});
 for(let row=0;row<n;row++)for(let col=0;col<n;){if(!qr.modules.get(row,col)){col++;continue;}const first=col;while(col<n&&qr.modules.get(row,col))col++;page.drawRectangle({x:x+(quiet+first)*unit,y:y+(quiet+n-1-row)*unit,width:(col-first)*unit,height:unit,color:rgb(0,0,0)});}
 const annotation=pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,y,x+side,y+side],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(p.verificationURL)}}));page.node.set(PDFName.of('Annots'),pdf.context.obj([annotation]));
 page.drawText('掃碼確認目前證件狀態',{x:490,y:160,size:10,font,color:green});
 page.drawLine({start:{x:32,y:49},end:{x:688,y:49},thickness:1,color:line});page.drawText('本卡僅供身份驗證，不授予接管或登入權限。',{x:32,y:28,size:10,font,color:muted});
 const bytes=await pdf.save({useObjectStreams:true});if(bytes.length>8388608)throw new Error('card_too_large');return bytes;
}
