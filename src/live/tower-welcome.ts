import './tower-welcome.css';
import {bindTowerAppearance} from './tower-appearance.ts';
import {towerWelcomeMarkup} from '../shared/lobby-markup.ts';
import type {TowerScene} from '../shared/tower-scenes.ts';
export {residentGuide,licenseAttribution} from '../shared/lobby-markup.ts';
export function towerScenePreference():TowerScene {
 try{return localStorage.getItem('musecondo.tower-scene')==='night'?'night':'day';}catch{return 'day';}
}
export function towerWelcome(base:string){return towerWelcomeMarkup(base,towerScenePreference());}
export function bindTowerWelcome(root:HTMLElement,base:string){
 if(!root.querySelector('[data-tower-panorama]'))return;
 void bindTowerAppearance(root,base);
 if(['#resident-guide','#community-covenant'].includes(location.hash))root.querySelector(location.hash)?.scrollIntoView({behavior:'instant'});
}
