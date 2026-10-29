import { frameworkEnum, frameworkId, frameworkString } from './validation.ts';
import type { HomeMode, HomeRoutes } from './types.ts';

export function homeRoutes(mode: HomeMode, id?: string, base = ''): HomeRoutes {
  frameworkEnum(mode, ['standalone', 'tower'], 'mode');
  if (base !== '' && base !== '/') {
    frameworkString(base, 256, 'base');
    if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\/?$/.test(base)) throw new Error('framework: base 必須是安全的站內路徑');
  }
  const prefix = base.replace(/\/$/, '');
  if (id !== undefined) frameworkId(id);
  const home = mode === 'tower' ? `${prefix}/home/${frameworkId(id)}` : `${prefix}/`;
  const path = mode === 'tower' ? home : prefix;
  return { home, inside: `${path}/inside`, dreams: `${path}/dreams` };
}
