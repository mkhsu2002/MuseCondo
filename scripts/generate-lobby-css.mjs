import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

// Vite's production CSS order: dependency styles, then the application's root style.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sources=['src/live/tower-welcome.css','src/framework/home.css','src/live.css','src/style.css'];
const css=sources.map(path=>readFileSync(resolve(root,path),'utf8')).join('\n');
if(/@import|url\(/i.test(css))throw Error('lobby_preview_external_style_dependency');
const hash=createHash('sha256').update(css).digest('hex');
const brand=readFileSync(resolve(root,'public/neobabylon-logo-v0.1.png'));
const logo='data:image/png;base64,'+brand.toString('base64');
const rendererSources=['src/shared/lobby-markup.ts','src/shared/tower-scenes.ts','src/shared/lobby-theme.ts','src/community/notices.json','index.html','workers/tower-manager/theme-renderer.ts'];
const sourceHashes=Object.fromEntries(rendererSources.map(path=>[path,createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')]));
const rendererHash=createHash('sha256').update(JSON.stringify({protocol:'lobby-renderer-build-v1',css:hash,sources:sourceHashes,brand:createHash('sha256').update(brand).digest('hex')})).digest('hex');
const output='// Generated from maintained production styles and original brand bytes. Run scripts/generate-lobby-css.mjs; do not edit.\n// Embedded brand bytes retain the separate rights in ASSET-LICENSE.md.\n'+`export const LOBBY_CSS_SOURCES=${JSON.stringify(sources)} as const;\n`+`export const LOBBY_BASE_CSS_HASH=${JSON.stringify(hash)};\n`+`export const LOBBY_RENDERER_SOURCES=${JSON.stringify(rendererSources)} as const;\n`+`export const LOBBY_RENDERER_BUILD_HASH=${JSON.stringify(rendererHash)};\n`+`export const LOBBY_BASE_CSS=${JSON.stringify(css)};\n`+`export const LOBBY_LOGO_DATA_URL=${JSON.stringify(logo)};\n`;
const destination=resolve(root,'src/shared/lobby-base-css.ts');
if(process.argv[2]==='--check'){
 if(readFileSync(destination,'utf8')!==output)throw Error('lobby_preview_styles_stale');
}else if(!process.argv[2]||process.argv[2]==='--write')writeFileSync(destination,output);
else throw Error('Use --write or --check');
