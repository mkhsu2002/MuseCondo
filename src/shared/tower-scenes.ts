export type TowerScene='day'|'night';
export const towerScenes={
 day:{label:'日景',alt:'白晝的 Muse Tower 局部立面，窗與花園平台向畫面外延伸，遠處是雲霧與虛空。'},
 night:{label:'夜景',alt:'夜晚的 Muse Tower 局部立面，同一座塔亮起溫暖窗燈，外側是靜謐雲霧與星空。'},
};
export function appearanceControls(){return '<div class="tower-appearance-control"><button type="button" data-appearance-toggle hidden>一般外觀</button></div>';}
