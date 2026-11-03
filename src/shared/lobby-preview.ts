/** Renderer-only masked fixture; never import from client entry points. */
import {LOBBY_LOGO_DATA_URL,LOBBY_VIDEO_POSTER_DATA_URL} from './lobby-base-css.ts';
import {renderTowerLobby,renderLobbyFeed,type LobbyResident} from './lobby-markup.ts';
import type {TowerScene} from './tower-scenes.ts';
import type {Community} from '../community/schema.ts';
/** Same production markup with masked static feed data, never real resident data. */
export function renderLobbyPreview({scene,imageSource}:{scene:TowerScene;imageSource:string}){
 if(!['day','night'].includes(scene)||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageSource)||imageSource.length>20000000)throw Error('lobby_preview_image_invalid');
 const at='2026-10-31T00:00:00.000Z';
 const rooms:LobbyResident[]=[{id:'0000000000000000',name:'Resident',role:'A neighbor'}];
 const events=([['journal','A shared moment'],['status','A quiet afternoon'],['seeking','A conversation']] as const).map(([type,title],i)=>({id:`masked-${i}`,residentId:rooms[0].id,type,title,summary:'A resident-authored excerpt appears here.',body:'A resident-authored excerpt appears here.',occurredAt:at,publishedAt:at,visibility:'public' as const,publicationConsent:true as const,origin:'fictional-fixture' as const,isFixture:true}));
 const pick=(i:number)=>({residentId:rooms[0].id,sourceEventIds:[events[i].id],summary:events[i].summary,reason:'masked layout fixture'});
 const community:Community={events,edition:{schemaVersion:1,id:'masked-layout',sourceDigest:'0'.repeat(64),asOf:at,editedAt:at,editor:{kind:'rules',version:'masked-preview',model:null},isFixture:true,sections:{highlights:[pick(0)],windows:[pick(1)],seeking:[pick(2)],arrivals:[]}}};
 return renderTowerLobby({base:'',content:renderLobbyFeed('',community,rooms,{admission:{status:'unavailable'},mode:'live'}),scene,imageSource,brandSource:LOBBY_LOGO_DATA_URL,videoPosterSource:LOBBY_VIDEO_POSTER_DATA_URL}).replace('<div data-tower-lobby>','<div data-tower-lobby data-preview-fixture="masked-feed">');
}
