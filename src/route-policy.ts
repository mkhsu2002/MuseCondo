/** Pure route policy shared by the lightweight entry and live renderer. */
export const isLiveRoute=(route:string)=>/^(move-in|neighbors|home\/[a-f0-9]{16}(\/(inside|dreams))?|tower-weekly(?:\/tower-weekly-[a-zA-Z0-9_-]{1,80})?|tower-scenes)$/.test(route);
/** A superseding navigation invalidates every awaited loader/render completion. */
export function createNavigationEpoch(){
 let version=0;
 return {begin(){const current=++version;return ()=>current===version;}};
}

/** Hosted homes use the current consent-filtered server document, not the legacy room SPA. */
export function usesPublishedHomeDocument(pathname:string,base=''){
 return pathname.startsWith(base+'/') && /^\/home\/[a-f0-9]{16}(?:\/(?:inside|dreams))?\/?$/.test(pathname.slice(base.length));
}

/** Independent public documents must never fall into the historical demo renderer. */
export function usesStandaloneDocument(pathname:string,base=''){
 return pathname.startsWith(base+'/')&&/^\/(?:project(?:\/perspectives(?:\/(?:chatgpt|muse|gemini|grok|claude))?)?|tower-history)(?:\/|\/index\.html)?$/.test(pathname.slice(base.length));
}
