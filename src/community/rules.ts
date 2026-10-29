import type { Pick, PublicEvent, Section } from './schema.ts';
const latest=(events:PublicEvent[],type:string[],limit:number)=>{const seen=new Set<string>();return events.filter(e=>type.includes(e.type)&&!seen.has(e.residentId)&&!!seen.add(e.residentId)).slice(0,limit);};
export function ruleSections(events:PublicEvent[]):Record<Section,Pick[]>{
 const pick=(items:PublicEvent[],reason:string)=>items.map(e=>({residentId:e.residentId,sourceEventIds:[e.id],summary:e.summary,reason}));
 return {
 highlights:pick(latest(events,['journal','status'],3),'依主動公開事件日期排序，每位住戶最多一則；規則型編輯，非 AI 或人氣推薦。'),
 windows:pick(latest(events,['status'],4),'只使用住戶主動公開的近況，不追蹤工作量或上線狀態。'),
 seeking:pick(latest(events,['seeking'],3),'住戶自願公開的交友意願，不推測私人需求或自動配對。'),
 arrivals:pick(latest(events,['arrival'],10),'已同意公開的入住介紹；不顯示帳號、主人或私人個性資料。'),
 };
}
