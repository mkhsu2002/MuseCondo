export const BASELINE_SHA='6f68c848ff2883ef903521f709edc3f4c78356652cbfbd8975b4c285b76f5d96';
export const BIBLE_VERSION='tower-v1';
export const BIBLE='Exactly the same single stepped terraced ivory/cream rounded-rect module tower as the primary reference: repeated small warm amber window grid; monumental open rounded arches and atriums; lush rooftop and balcony ivy, palms and cypress; slim cream rails; curved glass rooftop pavilions and telescope; warm amber interiors with deep dusk blue and peach sky. Detailed warm architectural illustration matching the original reference. Preserve the recognizable structure, proportions, material palette and visual world. Never replace it with brutalism, a glass skyscraper or another building. No neighboring towers, people, residents, events, text, logos or watermarks. The provided original reference is always primary.';
export const SCENES={
 'arrival-court':['The Arrival Court','Warm windows frame the reflection pool beside the great entrance arch.','reflection pool and arch entrance, ground-level courtyard'],
 'atrium-lobby':['Inside the Atrium','Evening light settles beneath the Tower’s open arches.','interior atrium lobby beneath monumental rounded arches'],
 'reading-lounge':['The Reading Lounge','A quiet lounge opens toward the garden terraces.','empty communal reading lounge with warm shelves and arch-framed terrace view'],
 'skybridge-garden':['The Skybridge Garden','Greenery follows the sheltered paths high above the courtyard.','planted skybridge within this same tower, no separate tower'],
 'rooftop-greenhouse':['The Rooftop Greenhouse','Curved glass shelters a little garden above the city.','curved glass rooftop greenhouse pavilion of this same tower'],
 'rooftop-telescope':['Under the Evening Sky','The rooftop telescope waits beneath the deepening blue.','rooftop telescope and curved pavilion at dusk'],
 'window-reading-nook':['By the Window','Amber light gathers around a quiet window seat.','empty cozy reading nook within one amber window, recognizable tower terraces outside'],
 'terrace-garden':['The Terrace Garden','Ivy and palms soften the edges of the evening terrace.','lush terraced balcony garden, ivory rails and stepped tower above'],
 'shared-dining-terrace':['The Dining Terrace','An open-air table rests among the terrace gardens.','empty shared dining terrace, no food suggesting an event, no people'],
 'elevated-arcade':['The Elevated Arcade','Rounded arches lead through a sheltered path in the sky.','elevated open rounded-arch arcade within the same stepped tower']
} as const;
export type SceneKey=keyof typeof SCENES;
export const sceneKey=(key:string):key is SceneKey=>Object.hasOwn(SCENES,key);
export const sha=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(v=>v.toString(16).padStart(2,'0')).join('');
export function b64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
