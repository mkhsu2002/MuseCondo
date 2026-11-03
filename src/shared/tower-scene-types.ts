/** Public, reviewed Tower scenery. No production details are exposed. */
export interface TowerScene {id:string;title:string;caption:string;url:string;width:number;height:number;createdAt:string;issueId?:string}

/** Stable display-contract version avoids legacy immutable PNG cache entries. */
export const towerSceneDisplayURL=(base:string,id:string)=>`${base}/api/v1/tower/scenes/${encodeURIComponent(id)}.png?display=webp-v1`;
