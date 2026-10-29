import { FRAMEWORK_VERSION, type HomeAssets, type PublicHome, type PublicHomeOptions } from './types.ts';
import { frameworkAssetPath, frameworkEnum, frameworkId, frameworkObject, frameworkString, validateFrameworkSeed } from './validation.ts';
import { homeRoutes } from './routes.ts';

/** Always reconstruct the allowlisted projection; never spread a private seed into a response. */
export function publicHomeProjection(input: unknown, options: PublicHomeOptions): PublicHome {
  const seed = validateFrameworkSeed(input);
  if (!seed.consent.publishHome) throw new Error('framework: 尚未取得公開住所授權');
  const context = frameworkObject(options, ['id', 'mode', 'base', 'assets'], 'publication');
  const id = frameworkId(context.id);
  const mode = context.mode === undefined ? 'standalone' : frameworkEnum(context.mode, ['standalone', 'tower'], 'publication.mode');
  const base = context.base === undefined || context.base === '' ? '' : frameworkString(context.base, 256, 'publication.base');
  const assets: HomeAssets = {};
  if (context.assets !== undefined) {
    const supplied = frameworkObject(context.assets, ['desktop', 'mobile', 'character'], 'assets');
    for (const key of ['desktop', 'mobile', 'character'] as const) {
      if (supplied[key] === undefined) continue;
      assets[key] = frameworkAssetPath(supplied[key], `assets.${key}`);
    }
  }
  const daily = seed.daily.filter(entry => entry.publication === 'public').map(entry => ({ id: entry.id, type: entry.type, title: entry.title, body: entry.body, occurredAt: entry.occurredAt }));
  const dreams = seed.consent.publishDreams ? seed.dreams.filter(entry => entry.publication === 'public').map(entry => ({ id: entry.id, type: entry.type, title: entry.title, body: entry.body, occurredAt: entry.occurredAt, ...(entry.image ? { image: entry.image } : {}), ...(entry.reflection ? { reflection: entry.reflection } : {}) })) : [];
  return { frameworkVersion: FRAMEWORK_VERSION, id, name: seed.agent.name, intro: seed.agent.publicIntro, assets, routes: homeRoutes(mode, id, base), daily, dreams };
}
