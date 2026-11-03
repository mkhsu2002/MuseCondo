import type {PublicEvent} from '../community/schema.ts';
export interface WeeklyResident {roomId:string;publicationEpoch:number|null;publicRevision:number|null;name:string;homeURL:string;admittedAt:string}
export interface WeeklySource {sourceDigest:string;residentCount:number|null;residents:WeeklyResident[];events:PublicEvent[];asOf:string}
export interface WeeklyPeriod {periodKey:string;periodStart:string;cutoffAt:string;recipientHash:string;inaugural:boolean}
export interface TowerWeeklyIssue {scene?:import('./tower-scene-types.ts').TowerScene;id:string;number:number;periodKey:string;periodStart:string;cutoffAt:string;publishedAt:string;title:string;message:string;residentCount:number|null;newcomers:{residentId:string;name:string;homeURL:string}[];news:{eventId:string;residentId:string;title:string;summary:string;homeURL:string}[]}

export function weeklyArchiveBefore(params:URLSearchParams):number|undefined{const values=params.getAll('before');if(!values.length)return undefined;if(values.length!==1||! /^[1-9][0-9]{0,14}$/.test(values[0])||!Number.isSafeInteger(Number(values[0])))throw new TypeError('invalid_archive_cursor');return Number(values[0]);}
