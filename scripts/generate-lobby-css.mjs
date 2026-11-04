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
const brand=readFileSync(resolve(root,'public/neobabylon-logo-v0.1-display.webp'));
const logo='data:image/webp;base64,'+brand.toString('base64');
const videoPoster='data:image/webp;base64,'+readFileSync(resolve(root,'public/media/musecondo-introduction-qb-fyaymkFg.webp')).toString('base64');
const rendererSources=['src/shared/community-resources.ts','src/shared/home-directory.ts','src/shared/tower-journals-markup.ts','src/shared/tower-journals.ts','src/shared/tower-weekly-markup.ts','src/shared/tower-weekly.ts','src/shared/tower-scene-types.ts','src/shared/lobby-preview.ts','src/shared/lobby-markup.ts','src/shared/tower-video.ts','public/media/musecondo-introduction-qb-fyaymkFg.webp','src/shared/lobby-messages.ts','src/shared/tower-scenes.ts','src/shared/lobby-theme.ts','src/community/notices.ts','index.html','workers/tower-manager/theme-renderer.ts'];
const sourceHashes=Object.fromEntries(rendererSources.map(path=>[path,createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')]));
const rendererHash=createHash('sha256').update(JSON.stringify({protocol:'lobby-renderer-build-v1',css:hash,sources:sourceHashes,brand:createHash('sha256').update(brand).digest('hex')})).digest('hex');
const output='// Generated from maintained production styles and approved brand display bytes. Run scripts/generate-lobby-css.mjs; do not edit.\n// Embedded brand bytes retain the separate rights in ASSET-LICENSE.md.\n'+`export const LOBBY_CSS_SOURCES=${JSON.stringify(sources)} as const;\n`+`export const LOBBY_BASE_CSS_HASH=${JSON.stringify(hash)};\n`+`export const LOBBY_RENDERER_SOURCES=${JSON.stringify(rendererSources)} as const;\n`+`export const LOBBY_RENDERER_BUILD_HASH=${JSON.stringify(rendererHash)};\n`+`export const LOBBY_BASE_CSS=${JSON.stringify(css)};\n`+`export const LOBBY_LOGO_DATA_URL=${JSON.stringify(logo)};\nexport const LOBBY_VIDEO_POSTER_DATA_URL=${JSON.stringify(videoPoster)};\n`;
const destination=resolve(root,'src/shared/lobby-base-css.ts');
if(process.argv[2]==='--check'){
 if(readFileSync(destination,'utf8')!==output)throw Error('lobby_preview_styles_stale');
}else if(!process.argv[2]||process.argv[2]==='--write')writeFileSync(destination,output);
else throw Error('Use --write or --check');
