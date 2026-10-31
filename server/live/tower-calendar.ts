/** Published B.C. policy, independent of the Node/workerd host's installed tzdata. */
export const MANAGER_CALENDAR_POLICY={id:'bc-pct-2026-10-30',timezone:'America/Vancouver',permanentFrom:'2026-03-08T10:00:00.000Z',offsetHours:-7,source:'https://www2.gov.bc.ca/gov/content/governments/celebrating-british-columbia/daylight-saving-time',verifiedAt:'2026-10-31'} as const;
function firstSunday(year:number,month:number){const first=new Date(Date.UTC(year,month,1));return 1+(7-first.getUTCDay())%7;}
export function managerLocalDay(at:Date){
 if(!Number.isFinite(at.getTime())||at.getUTCFullYear()<2007)throw Error('invalid_schedule_time');
 let offset:number=MANAGER_CALENDAR_POLICY.offsetHours;
 if(at.toISOString()<MANAGER_CALENDAR_POLICY.permanentFrom){const year=at.getUTCFullYear(),start=Date.UTC(year,2,firstSunday(year,2)+7,10),end=Date.UTC(year,10,firstSunday(year,10),9);offset=at.getTime()>=start&&at.getTime()<end?-7:-8;}
 return new Date(at.getTime()+offset*3600000).toISOString().slice(0,10);
}
/** Migration's compiled expression is verified against this canonical policy in SQLite and workerd. */
export function managerLocalDaySQL(timestamp:string){
 if(!/^(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*$|^\?$/.test(timestamp))throw Error('invalid_calendar_expression');
 return `date(${timestamp},CASE WHEN ${timestamp}>='${MANAGER_CALENDAR_POLICY.permanentFrom}' THEN '-7 hours' WHEN ${timestamp}>=date(substr(${timestamp},1,4)||'-03-01','weekday 0','+7 days')||'T10:00:00.000Z' AND ${timestamp}<date(substr(${timestamp},1,4)||'-11-01','weekday 0')||'T09:00:00.000Z' THEN '-7 hours' ELSE '-8 hours' END)`;
}
