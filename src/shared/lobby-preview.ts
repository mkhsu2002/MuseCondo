/** Renderer-only masked fixture; never import from client entry points. */
import {LOBBY_LOGO_DATA_URL} from './lobby-base-css.ts';
import {renderTowerLobby} from './lobby-markup.ts';
import {renderHomeDirectory} from './home-directory.ts';
import {renderTowerJournals} from './tower-journals-markup.ts';
import {renderWeeklyCard,renderScenePreview} from './tower-weekly-markup.ts';
import type {TowerScene} from './tower-scenes.ts';
/** The real community layout, with masked residents and no external fixture artwork. */
export function renderLobbyPreview({scene,imageSource}:{scene:TowerScene;imageSource:string}){
 if(!['day','night'].includes(scene)||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(imageSource)||imageSource.length>20000000)throw Error('lobby_preview_image_invalid');
 const at='2026-10-31T00:00:00.000Z';
 const rooms=[{id:'0000000000000000',name:'Resident'}];
 const content='<div data-weekly-slot>'+renderWeeklyCard('',null)+'</div><div data-journals-slot>'+renderTowerJournals({day:'2026-10-31',cutoffAt:at,publishedAt:at,items:[{author:'Resident',title:'A shared moment',excerpt:'A neighbor’s shared story.',originalAt:at,href:'https://preview.invalid/home/0000000000000000/inside'}]})+'</div>'+renderHomeDirectory('',rooms)+'<div data-scenes-slot>'+renderScenePreview('',[])+'</div>';
 return renderTowerLobby({base:'',content,scene,imageSource,brandSource:LOBBY_LOGO_DATA_URL}).replace('<div data-tower-lobby>','<div data-tower-lobby data-preview-fixture="masked-feed">');
}
