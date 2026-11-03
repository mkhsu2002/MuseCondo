/** Cloudflare Pages version 1: exclusions take priority; * crosses path segments.
 * https://developers.cloudflare.com/pages/functions/routing/#functions-invocation-routes
 * Keep private consoles/identities and protected resident assets inside Functions.
 */
export const staticDirectories=['assets','prototype-assets','tower','media','og','examples'];
export const staticStyles=['condo-template.css'];
export function staticRoutes(){return {version:1,include:['/*'],exclude:[...staticDirectories.map(name=>`/${name}/*`),...staticStyles.map(name=>`/${name}`)]};}
