import type {Database,Statement} from './db.ts';
import type {WeeklyPeriod,WeeklyResident,WeeklySource} from '../../src/shared/tower-weekly.ts';
import type {PublicEvent} from '../../src/community/schema.ts';
import {digest} from './live-contract.ts';
/** Strict original publication dates; host-local timezone and calendar rollover are never inferred. */
export function publicationTimestamp(value:unknown,cutoff:string):string|null{
 if(typeof value!=='string')return null;
 const m=value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/);if(!m)return null;
 const [,y,mo,d,h,mi,se,offset]=m;const year=Number(y),month=Number(mo),day=Number(d);
 if(year<1970||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||Number(h)>23||Number(mi)>59||Number(se)>59)return null;
 if(offset!=='Z'&&(Number(offset.slice(1,3))*60+Number(offset.slice(4))>840||Number(offset.slice(4))>59))return null;
 const time=Date.parse(value);return Number.isFinite(time)&&time<=Date.parse(cutoff)?new Date(time).toISOString():null;
}
const joins='FROM tower_residencies t JOIN rooms r ON r.id=t.room_id AND r.account_id=t.account_id JOIN accounts a ON a.id=t.account_id';
const grants='t.public_revision IS NOT NULL AND t.snapshot_consent=1 AND t.announcement_consent=1 AND r.published=1 AND r.test_only=0 AND a.test_only=0';
const snapshots=`SELECT t.room_id,t.publication_epoch,t.public_revision,t.created_at admitted_at,r.name,s.content_digest,json_extract(s.public_json,'$.home.daily') daily_json ${joins} JOIN tower_snapshots s ON s.room_id=t.room_id AND s.revision=t.public_revision WHERE ${grants} ORDER BY t.room_id`;
const snapshotVector=`SELECT COALESCE(json_group_array(json_array(room_id,publication_epoch,public_revision,admitted_at,name,content_digest,daily_json)),'[]') value FROM (${snapshots})`;
interface Snapshot {room_id:string;publication_epoch:number;public_revision:number;admitted_at:string;name:string;content_digest:string;daily_json:string|null}
export interface PublicationJournal {sourceKind:'tower-snapshot';sourceKey:string;roomId:string;entryId:string;author:string;title:string;excerpt:string;body:string;originalAt:string;href:string}
interface Environment {db:Database;origin:string;aggregateApproved:boolean}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Published snapshots are the sole authority for connected Tower households. Legacy posts and private/latest drafts never supply publication content. */
export function createPublicationSources(env:Environment){
 const {db}=env,guards=new WeakMap<WeeklySource,Statement[]>(),journals=new WeakMap<WeeklySource,PublicationJournal[]>();
 async function readSource(period:WeeklyPeriod):Promise<WeeklySource>{
  if(!env.origin.startsWith('https:')||new URL(env.origin).origin!==env.origin||!publicationTimestamp(period.cutoffAt,period.cutoffAt))throw Error('publication_source_configuration');
  // Derive facts from the exact native SQL vectors later checked at commit.
  const sv=(await db.prepare(snapshotVector).first<{value:string}>())!.value;
  if(sv.length>524288)throw Error('publication_sources_too_large');
  const rows=(JSON.parse(sv) as unknown[][]).map(v=>({room_id:v[0],publication_epoch:v[1],public_revision:v[2],admitted_at:v[3],name:v[4],content_digest:v[5],daily_json:v[6]})) as Snapshot[];
  const residents:WeeklyResident[]=rows.filter(r=>!!publicationTimestamp(r.admitted_at,period.cutoffAt)).map(r=>({roomId:r.room_id,publicationEpoch:r.publication_epoch,publicRevision:r.public_revision,name:r.name,homeURL:env.origin+'/home/'+r.room_id,admittedAt:publicationTimestamp(r.admitted_at,period.cutoffAt)!}));
  const byRoom=new Map(residents.map(r=>[r.roomId,r])),entries=new Map<string,PublicationJournal>();
  function add(room:string,id:unknown,title:unknown,body:unknown,at:unknown){
   const resident=byRoom.get(room),time=publicationTimestamp(at,period.cutoffAt);
   if(!resident||typeof id!=='string'||!id||id.length>160||typeof title!=='string'||!title.trim()||title.length>120||typeof body!=='string'||!body.trim()||body.length>10000||!time)return;
   const sourceKey='tower-snapshot:'+room+':'+id;entries.set(sourceKey,{sourceKind:'tower-snapshot',sourceKey,roomId:room,entryId:id,author:resident.name,title,excerpt:body.slice(0,300),body,originalAt:time,href:resident.homeURL+'/inside'});
  }
  for(const row of rows){let daily:unknown;try{daily=JSON.parse(row.daily_json??'[]');}catch{throw Error('publication_source_invalid');}if(!Array.isArray(daily))throw Error('publication_source_invalid');for(const entry of daily)if(object(entry)&&entry.type==='journal')add(row.room_id,entry.id,entry.title,entry.body,entry.occurredAt);}
  const normalized=[...entries.values()].sort((a,b)=>b.originalAt.localeCompare(a.originalAt)||a.sourceKey.localeCompare(b.sourceKey));
  const seen=new Set<string>(),deduped=normalized.filter(e=>{const signature=JSON.stringify([e.roomId,e.originalAt,e.title,e.body]);if(seen.has(signature))return false;seen.add(signature);return true;});
  const events:PublicEvent[]=await Promise.all(deduped.slice(0,50).map(async e=>({id:'journal-'+(await digest('publication:'+e.sourceKey)).slice(0,56),residentId:e.roomId,type:'journal',occurredAt:e.originalAt,publishedAt:e.originalAt,visibility:'public',publicationConsent:true,origin:'resident-authorized',isFixture:false,title:e.title,summary:e.excerpt,body:e.body})));
  const count=env.aggregateApproved?Number((await db.prepare(`SELECT COUNT(*) n ${joins} WHERE r.test_only=0 AND a.test_only=0 AND julianday(t.created_at)<julianday(?)`).bind(period.cutoffAt).first<{n:number}>())!.n):null;
  const source:WeeklySource={sourceDigest:await digest(JSON.stringify({sv,count,cutoff:period.cutoffAt})),residentCount:count,residents,events,asOf:period.cutoffAt};
  guards.set(source,[db.prepare(`SELECT CASE WHEN (${snapshotVector})=? THEN 1 ELSE json('publication_snapshot_changed') END`).bind(sv)]);journals.set(source,deduped);return source;
 }
 return {readSource,publicationGuards(source:WeeklySource){const saved=guards.get(source);if(!saved)throw Error('publication_source_guard_missing');return saved;},journals(source:WeeklySource){return journals.get(source)??[];}};
}
export const readPublicationSource=(env:Environment,period:WeeklyPeriod)=>createPublicationSources(env).readSource(period);
