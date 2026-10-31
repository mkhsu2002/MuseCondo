import { residents } from '../../src/residents.ts';
/** Deployment-only old-home redirects. Never accepts a destination from a request. */
const reserved = new Set([
  'activities', 'reception', 'admin', 'manage', 'login', 'api', 'home', 'move-in', 'neighbors', 'about', 'assets', 'community', 'tower',
  'examples', 'prototype-assets', '入住', '選輯紀錄', '.well-known', ...residents.map(resident => resident.id),
]);
function safePath(path: string): boolean {
  try {
    const decoded = decodeURIComponent(path);
    const controls = Array.from(decoded).some(char => {
      const code = char.codePointAt(0)!;
      return code <= 32 || code >= 127 && code <= 159;
    });
    return !controls && !decoded.includes('\\') && !decoded.includes('//') && !/%25/i.test(path);
  } catch { return false; }
}
function redirects(value: string | undefined): [string, string][] {
  if (!value || value.length > 16384 || new TextEncoder().encode(value).byteLength > 16384) return [];
  try {
    const map: unknown = JSON.parse(value);
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    const entries = Object.entries(map);
    if (entries.length > 20 || entries.some(([prefix, origin]) => {
      if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(prefix) || typeof origin !== 'string') return true;
      const url = new URL(origin);
      return url.protocol !== 'https:' || url.origin !== origin || !!url.username || !!url.password || !!url.search || !!url.hash;
    })) return [];
    return (entries as [string, string][]).sort((a, b) => b[0].length - a[0].length);
  } catch { return []; }
}
export function legacyHomeRedirect(request: Request, setting: string | undefined): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const path = new URL(request.url).pathname;
  if (!safePath(path)) return null;
  const first = decodeURIComponent(path.split('/')[1] ?? '');
  // Root files and existing historical demo doors remain Tower-owned.
  if (reserved.has(first) || first.includes('.')) return null;
  const match = redirects(setting).find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
  if (!match) return null;
  const target = new URL(match[1]);
  // Assign pathname, rather than resolving a request-controlled URL against a base.
  // This retains the configured origin even if URL resolution rules change.
  target.pathname = path.slice(match[0].length) || '/';
  return new Response(null, { status: 308, headers: {
    Location: target.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  } });
}
