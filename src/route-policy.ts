/** Pure route policy shared by the lightweight entry and live renderer. */
export const isLiveRoute=(route:string)=>/^(move-in|neighbors|home\/[a-f0-9]{16}(\/(inside|dreams))?)$/.test(route);
/** A superseding navigation invalidates every awaited loader/render completion. */
export function createNavigationEpoch(){
 let version=0;
 return {begin(){const current=++version;return ()=>current===version;}};
}
