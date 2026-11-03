const output=process.env.MUSE_OUTPUT_DIR||'dist';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/residents.ts', import.meta.url), 'utf8');
const ids = [...source.matchAll(/id: '([a-z0-9]{6})'/g)].map(match => match[1]);
if (ids.length !== 10 || new Set(ids).size !== 10) throw new Error('Expected 10 unique fixture routes');
const html = await readFile(`${output}/index.html`, 'utf8');
for (const route of ['入住', 'about', '選輯紀錄', 'move-in', 'neighbors', ...ids.flatMap(id => [id, `${id}/inside`, `${id}/dreams`])]) {
  await mkdir(`${output}/${route}`, { recursive: true });
  await writeFile(`${output}/${route}/index.html`, html);
}
await writeFile(`${output}/404.html`, html);
await mkdir(`${output}/activities`, { recursive: true });
await copyFile('public/activities.html', `${output}/activities/index.html`);
await mkdir(`${output}/identity`, { recursive: true });
await copyFile('public/identity.html', `${output}/identity/index.html`);
await mkdir(`${output}/identity/verify`, { recursive: true });
await copyFile('public/identity-verify.html', `${output}/identity/verify/index.html`);
await mkdir(`${output}/identity/recover`, { recursive: true });
await copyFile('public/identity-recovery.html', `${output}/identity/recover/index.html`);
await mkdir(`${output}/reception`, { recursive: true });
await copyFile('public/reception.html', `${output}/reception/index.html`);
await copyFile('src/framework/condo.css', `${output}/condo-template.css`);
console.log(`Generated ${ids.length * 3} resident routes, entry information and 404 page.`);

// Distribute software and designated-artwork notices alongside compiled source.
await copyFile('LICENSE', `${output}/LICENSE.txt`);
await copyFile('NOTICE', `${output}/NOTICE.txt`);
await copyFile('ASSET-LICENSE.md', `${output}/ASSET-LICENSE.txt`);
await mkdir(`${output}/LICENSES`, { recursive: true });
await copyFile('LICENSES/PolyForm-Noncommercial-1.0.0.txt', `${output}/LICENSES/PolyForm-Noncommercial-1.0.0.txt`);

await mkdir(`${output}/identity/maintenance`, { recursive: true });
await copyFile('public/identity-maintenance.html', `${output}/identity/maintenance/index.html`);

await mkdir(`${output}/identity/offer`, { recursive: true });
await copyFile('public/identity-offer.html', `${output}/identity/offer/index.html`);

// An explicit allowlist prevents private routes from bypassing Pages Functions.
const {staticRoutes}=await import('./static-routing.mjs');
await writeFile(`${output}/_routes.json`,JSON.stringify(staticRoutes(),null,2)+'\n');
