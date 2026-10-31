import type {Database} from './db.ts';
/** Bounded private outcome memories only, never tool replay, raw provider bodies or resident records. */
export async function readManagerMemory(db:Database){
 const rows=(await db.prepare("SELECT v.cycle_id,v.kind,v.detail_json,v.created_at,c.outcome FROM tower_autonomy_events v LEFT JOIN tower_autonomy_cycles c ON c.id=v.cycle_id WHERE v.kind IN ('daily-private-memory','lobby-theme-private-memory','lobby-build-private-memory') ORDER BY v.created_at DESC,v.rowid DESC LIMIT 2").all<{cycle_id:string;kind:string;detail_json:string;created_at:string;outcome:string}>()).results;
 return rows.flatMap(row=>{const data=JSON.parse(row.detail_json) as Record<string,unknown>;if(typeof data.memory!=='string'||!Array.isArray(data.nextTasks))return [];return [{source:row.kind==='lobby-build-private-memory'?'lobby-build-selfreview':row.kind==='lobby-theme-private-memory'?'lobby-theme-selfreview':'daily-selfreview',taskId:row.cycle_id,at:row.created_at,outcome:typeof data.outcome==='string'?data.outcome:row.outcome,memory:data.memory.slice(0,2400),nextTasks:data.nextTasks.filter((x):x is string=>typeof x==='string').slice(0,8).map(x=>x.slice(0,400))}];});
}
export async function readBlockedThemeSummary(db:Database){
 if(!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tower_autonomy_extensions'").first())return [];
 const extensions=(await db.prepare("SELECT id,cycle_id AS taskId,state,error_code AS errorCode,generation_id AS preservedGeneration FROM tower_autonomy_extensions WHERE state='blocked' OR outcome='blocked' ORDER BY created_at DESC LIMIT 10").all()).results;
 const builds=await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tower_theme_build_reviews'").first()?(await db.prepare("SELECT id,cycle_id AS taskId,state,error_code AS errorCode,generation_id AS preservedGeneration FROM tower_theme_build_reviews WHERE state='blocked' OR outcome='blocked' ORDER BY created_at DESC LIMIT 10").all()).results:[];
 return [...extensions,...builds].slice(0,10);
}
