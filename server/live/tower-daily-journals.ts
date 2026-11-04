import type {Database} from './db.ts';
import {managerLocalDay} from './tower-calendar.ts';
import {createPublicationSources,type PublicationJournal} from './tower-publication-sources.ts';
import {digest} from './live-contract.ts';
import {TOWER_DAILY_JOURNAL_LIMIT,type TowerJournalEdition,type TowerJournalItem} from '../../src/shared/tower-journals.ts';
interface Options {db:Database;origin:string;enabled:boolean;now?:()=>Date}
interface Frozen extends TowerJournalItem {sourceKind:'tower-snapshot';sourceKey:string;roomId:string;entryId:string;publicRevision:number;publicationEpoch:number;publishedAt:string|null;snapshotCreatedAt:string|null;bodyDigest:string}
const period=(day:string)=>({periodKey:day,periodStart:day+'T00:00:00.000Z',cutoffAt:day+'T16:00:00.000Z',recipientHash:'0'.repeat(64),inaugural:false});
async function freeze(j:PublicationJournal):Promise<Frozen>{const {body,...minimal}=j;return {...minimal,bodyDigest:await digest(body)};}
/** DB-only daily selection. A failed transaction can safely retry; a complete day is permanent. */
export function createTowerDailyJournals(options:Options){
 const {db}=options,sources=createPublicationSources({db,origin:options.origin,aggregateApproved:false});
 const now=()=>options.now?.()??new Date();
 async function runDue(){
  const observed=now(),day=managerLocalDay(observed),p=period(day),result=(state:'disabled'|'not_due'|'published'|'already_complete')=>({state,day});
  if(!options.enabled)return result('disabled');
  if(observed.toISOString()<p.cutoffAt)return result('not_due');
  if(await db.prepare('SELECT day FROM tower_daily_journal_editions WHERE day=?').bind(day).first())return result('already_complete');
  const source=await sources.readSource(p,{strictAsOf:true}),selected=await Promise.all(sources.journals(source).slice(0,TOWER_DAILY_JOURNAL_LIMIT).map(freeze));
  try{await db.batch([
   ...sources.publicationGuards(source),
   db.prepare(`INSERT INTO tower_daily_journal_jobs(day,cutoff_at,observed_at,source_digest,missed_days,actual_micro) SELECT ?,?,?,?,CASE WHEN MAX(day) IS NULL THEN 0 ELSE MAX(0,CAST(julianday(?)-julianday(MAX(day)) AS INTEGER)-1) END,0 FROM tower_daily_journal_jobs`).bind(day,p.cutoffAt,observed.toISOString(),source.sourceDigest,day),
   db.prepare('INSERT INTO tower_daily_journal_editions VALUES(?,?)').bind(day,JSON.stringify(selected)),
   db.prepare("INSERT INTO tower_daily_journal_audit VALUES(?,'published',?,0)").bind(day,observed.toISOString())
  ]);}catch(error){if(await db.prepare('SELECT day FROM tower_daily_journal_editions WHERE day=?').bind(day).first())return result('already_complete');throw error;}
  return result('published');
 }
 async function getLatest():Promise<TowerJournalEdition|null>{
  if(!options.enabled)return null;
  const row=await db.prepare('SELECT j.day,j.cutoff_at,j.observed_at,e.selection_json FROM tower_daily_journal_jobs j JOIN tower_daily_journal_editions e ON e.day=j.day ORDER BY j.day DESC LIMIT 1').first<{day:string;cutoff_at:string;observed_at:string;selection_json:string}>();if(!row)return null;
  // Fresh authority is checked on every read, including original body and all publication lineage.
  const fresh=await sources.readSource(period(row.day),{strictAsOf:true}),current=new Map((await Promise.all(sources.journals(fresh).map(freeze))).map(j=>[j.sourceKey,j]));
  const items=(JSON.parse(row.selection_json) as Frozen[]).filter(j=>JSON.stringify(current.get(j.sourceKey))===JSON.stringify(j)).map(({author,title,excerpt,originalAt,href})=>({author,title,excerpt,originalAt,href}));
  return {day:row.day,cutoffAt:row.cutoff_at,publishedAt:row.observed_at,items};
 }
 return {runDue,getLatest};
}
