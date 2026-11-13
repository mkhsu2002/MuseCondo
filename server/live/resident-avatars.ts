import type {Database} from './db.ts';
import type {ResidentAvatar} from '../../src/shared/resident-avatar.ts';
import {parsePortraitCrop} from '../../src/framework/condo.ts';
import {publishedAvatarCrops} from '../../src/shared/resident-avatar-crops.ts';
/** No private drafts, Guardian portraits, remote URLs or image bytes enter directory metadata. */
export async function withResidentAvatars<T extends {id:string}>(db:Database,rooms:readonly T[]):Promise<(T&{avatar?:ResidentAvatar})[]>{
 const ids=rooms.map(r=>r.id).filter(id=>/^[a-f0-9]{16}$/.test(id));if(!ids.length)return [...rooms];
 try{
  const rows=(await db.prepare(`SELECT h.id,h.public_revision revision,'native' kind,a.sha256 digest,json_extract(s.content_json,'$.characterPortraitCrop') crop FROM private_homes h
   JOIN tower_reception_cases c ON c.id=h.case_id AND c.state='active'
   JOIN private_home_snapshots s ON s.home_id=h.id AND s.revision=h.public_revision
   JOIN private_home_asset_refs r ON r.home_id=h.id AND r.revision=h.public_revision AND r.purpose='home'
   JOIN private_home_asset_metadata a ON a.home_id=r.home_id AND a.revision=r.asset_revision AND a.purpose=r.purpose
   WHERE h.directory_consent=1 AND h.id IN (SELECT value FROM json_each(?))
   UNION ALL
   SELECT t.room_id id,t.public_revision revision,'imported' kind,coalesce(a.digest,(SELECT digest FROM tower_asset_chunks WHERE room_id=t.room_id AND revision=t.public_revision AND purpose='home' LIMIT 1)) digest,json_extract(s.public_json,'$.profile.characterPortraitCrop') crop
   FROM tower_residencies t JOIN rooms r ON r.id=t.room_id AND r.published=1
   JOIN tower_snapshots s ON s.room_id=t.room_id AND s.revision=t.public_revision
   LEFT JOIN tower_asset_refs a ON a.room_id=t.room_id AND a.revision=t.public_revision AND a.purpose='home'
   WHERE t.directory_consent=1 AND t.snapshot_consent=1 AND t.room_id IN (SELECT value FROM json_each(?))`)
   .bind(JSON.stringify(ids),JSON.stringify(ids)).all<{id:string;revision:number;kind:string;digest:string|null;crop:string|null}>()).results;
  const avatars=new Map<string,ResidentAvatar>();
  for(const row of rows){const crop=row.crop??(row.digest?publishedAvatarCrops[row.digest]:undefined);if(!crop)continue;try{parsePortraitCrop(crop);}catch{continue;}
   const url=row.kind==='native'?`/home/${row.id}/assets/home.png?revision=${row.revision}`:`/api/v1/tower/assets/${row.id}/${row.revision}/home.png`;
   avatars.set(row.id,{url,crop});
  }
  return rooms.map(room=>({...room,...(avatars.has(room.id)?{avatar:avatars.get(room.id)}:{})}));
 }catch{/* Portrait metadata is optional; existing public doors remain available. */return [...rooms];}
}
