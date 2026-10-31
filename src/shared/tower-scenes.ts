import {lobbyMessages} from './lobby-messages.ts';
export type TowerScene='day'|'night';
const messages=lobbyMessages();
export const towerScenes={day:messages.scene.day,night:messages.scene.night};
export function appearanceControls(){return `<div class="tower-appearance-control"><button type="button" data-appearance-toggle hidden>${messages.scene.standard}</button></div>`;}
