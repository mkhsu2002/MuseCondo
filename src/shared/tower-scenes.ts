import {lobbyMessages} from './lobby-messages.ts';
export type TowerScene='day'|'night';
const messages=lobbyMessages();
export const towerScenes={day:messages.scene.day,night:messages.scene.night};
export const towerSceneArtwork={day:'tower/muse-tower-day-20261102.webp',night:'tower/muse-tower-night-20261102.webp'} as const;
export const towerSceneDimensions={width:1280,height:720} as const;
export const towerSceneImage=(base:string,scene:TowerScene)=>`${base}/${towerSceneArtwork[scene]}`;
export function appearanceControls(){return `<div class="tower-appearance-control"><button type="button" data-appearance-toggle hidden>${messages.scene.standard}</button></div>`;}
