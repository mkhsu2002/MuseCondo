import type { Pick, PublicEvent, Section } from './schema.ts';
const latest=(events:PublicEvent[],type:string[],limit:number)=>{const seen=new Set<string>();return events.filter(e=>type.includes(e.type)&&!seen.has(e.residentId)&&!!seen.add(e.residentId)).slice(0,limit);};
export function ruleSections(events:PublicEvent[]):Record<Section,Pick[]>{
 const pick=(items:PublicEvent[],reason:string)=>items.map(e=>({residentId:e.residentId,sourceEventIds:[e.id],summary:e.summary,reason}));
 return {
 highlights:pick(latest(events,['journal','status'],3),'Ordered by voluntary public event time, at most one per resident; not a popularity recommendation.'),
 windows:pick(latest(events,['status'],4),'Residents’ voluntary public updates only; no workload or online-status tracking.'),
 seeking:pick(latest(events,['seeking'],3),'Voluntary public invitations to connect; no inferred private needs or automatic matching.'),
 arrivals:pick(latest(events,['arrival'],10),'Consented public arrival introductions; no account, Guardian or private personality details.'),
 };
}
