import type {Database} from './db.ts';
export const APPEARANCE_TIMEZONE='America/Vancouver';
export const HALLOWEEN_2026={startsAt:'2026-10-31T07:00:00.000Z',endsAt:'2026-11-01T07:00:00.000Z',timezone:APPEARANCE_TIMEZONE};
export interface AppearanceSnapshot {theme:'standard'|'halloween';startsAt:string|null;endsAt:string|null;timezone:typeof APPEARANCE_TIMEZONE}
interface State {revision:number;theme:AppearanceSnapshot['theme'];starts_at:string|null;ends_at:string|null;timezone:string}
interface Receipt extends AppearanceSnapshot {action:string;revision:number|null;requestKey:string}
interface Audit {fingerprint:string;snapshot_json:string;action:string;revision:number|null;request_key:string}
const standard:AppearanceSnapshot={theme:'standard',startsAt:null,endsAt:null,timezone:APPEARANCE_TIMEZONE};
function snapshot(value:Record<string,unknown>):AppearanceSnapshot {
 if(!['standard','halloween'].includes(String(value.theme)))throw Error('invalid_theme');
 if(value.theme==='standard'){if(value.startsAt!=null||value.endsAt!=null||value.timezone!=null&&value.timezone!==APPEARANCE_TIMEZONE)throw Error('invalid_window');return {...standard};}
 const {startsAt,endsAt,timezone}=value;
 if(timezone!==APPEARANCE_TIMEZONE||typeof startsAt!=='string'||typeof endsAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(startsAt)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(endsAt)||!Number.isFinite(Date.parse(startsAt))||!Number.isFinite(Date.parse(endsAt))||new Date(startsAt).toISOString()!==startsAt||new Date(endsAt).toISOString()!==endsAt||Date.parse(endsAt)<=Date.parse(startsAt)||Date.parse(endsAt)-Date.parse(startsAt)>7*86400000)throw Error('invalid_window');
 return {theme:'halloween',startsAt,endsAt,timezone:APPEARANCE_TIMEZONE};
}
function receipt(row:Audit):Receipt{return {...JSON.parse(row.snapshot_json),action:row.action,revision:row.revision,requestKey:row.request_key};}
export function createTowerAppearance(db:Database,now:()=>Date=()=>new Date()){
 const state=async()=>{const row=await db.prepare('SELECT * FROM tower_appearance_state WHERE id=1').first<State>();if(!row)throw Error('appearance_unavailable');return row;};
 async function command(input:unknown,actor:'operator'|'scheduler'):Promise<Receipt>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('invalid_command');
  const v=input as Record<string,unknown>,action=v.action;
  const fields=action==='preview'?['action','requestKey','theme','startsAt','endsAt','timezone']:action==='activate'?['action','requestKey','previewKey','expectedRevision']:action==='rollback'?['action','requestKey','targetRevision','expectedRevision']:action==='expire'?['action','requestKey','expectedRevision']:[];
  if(!fields.length||Object.keys(v).some(k=>!fields.includes(k))||typeof v.requestKey!=='string'||!/^[-a-zA-Z0-9:._]{8,120}$/.test(v.requestKey)||actor==='scheduler'&&action!=='expire')throw Error('invalid_command');
  const canonical=JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))));
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({actor,canonical}))))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const existing=async()=>db.prepare('SELECT * FROM tower_appearance_audit WHERE request_key=?').bind(v.requestKey).first<Audit>();
  const previous=await existing();if(previous){if(previous.fingerprint!==fingerprint)throw Error('request_key_conflict');return receipt(previous);}
  const current=await state();let next:AppearanceSnapshot;
  if(action==='preview')next=snapshot(v);
  else {
   if(!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision!==current.revision)throw Error('revision_conflict');
   if(action==='expire'){
    if(actor!=='scheduler'||!current.ends_at||current.ends_at>now().toISOString())throw Error('not_due');next={...standard};
   }else{
    let source:Audit|null=null;
    if(action==='activate'&&typeof v.previewKey==='string')source=await db.prepare("SELECT * FROM tower_appearance_audit WHERE request_key=? AND action='preview'").bind(v.previewKey).first<Audit>();
    if(action==='rollback'&&Number.isSafeInteger(v.targetRevision)&&Number(v.targetRevision)>=0){if(v.targetRevision===0)next={...standard};else source=await db.prepare('SELECT * FROM tower_appearance_audit WHERE revision=?').bind(v.targetRevision).first<Audit>();}
    if(!source&&!(action==='rollback'&&v.targetRevision===0))throw Error('preview_or_revision_missing');
    next=source?snapshot(JSON.parse(source.snapshot_json)):{...standard};
    if(next.endsAt&&next.endsAt<=now().toISOString())throw Error('expired_theme');
   }
  }
  const revision=action==='preview'?null:current.revision+1,time=now().toISOString(),serialized=JSON.stringify(next);
  await db.batch([
   db.prepare("INSERT INTO tower_appearance_audit(request_key,fingerprint,action,actor,revision,snapshot_json,created_at) SELECT ?,?,?,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM tower_appearance_state WHERE id=1 AND revision=? AND ((?='expire' AND ends_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (? IN ('activate','rollback') AND (? IS NULL OR ?>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))) ON CONFLICT(request_key) DO NOTHING").bind(v.requestKey,fingerprint,action,actor,revision,serialized,time,revision,current.revision,action,action,next.endsAt,next.endsAt),
   db.prepare('UPDATE tower_appearance_state SET revision=?,theme=?,starts_at=?,ends_at=?,timezone=? WHERE id=1 AND revision=? AND ? IS NOT NULL AND EXISTS(SELECT 1 FROM tower_appearance_audit WHERE request_key=? AND fingerprint=? AND revision=?)').bind(revision??current.revision,next.theme,next.startsAt,next.endsAt,next.timezone,current.revision,revision,v.requestKey,fingerprint,revision),
  ]);
  const saved=await existing();if(!saved)throw Error('revision_conflict');if(saved.fingerprint!==fingerprint)throw Error('request_key_conflict');return receipt(saved);
 }
 return {command,async publicState(){const s=await state(),time=now().toISOString();const active=s.theme==='halloween'&&s.starts_at!<=time&&time<s.ends_at!;return {theme:active?'halloween' as const:'standard' as const,revision:s.revision,endsAt:active?s.ends_at:null};},async inspect(){return {state:await state(),audit:(await db.prepare('SELECT request_key,action,actor,revision,snapshot_json,created_at FROM tower_appearance_audit ORDER BY created_at DESC, rowid DESC LIMIT 50').all()).results};},async expire(){const s=await state();if(!s.ends_at||s.ends_at>now().toISOString())return false;await command({action:'expire',requestKey:`expire:${s.revision}`,expectedRevision:s.revision},'scheduler');return true;}};
}
