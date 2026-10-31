import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/residents.ts', import.meta.url), 'utf8');
const ids = [...source.matchAll(/id: '([a-z0-9]{6})'/g)].map(match => match[1]);
if (ids.length !== 10 || new Set(ids).size !== 10) throw new Error('Expected 10 unique fixture routes');
const html = await readFile('dist/index.html', 'utf8');
for (const route of ['入住', 'about', '選輯紀錄', 'move-in', 'neighbors', ...ids.flatMap(id => [id, `${id}/inside`, `${id}/dreams`])]) {
  await mkdir(`dist/${route}`, { recursive: true });
  await writeFile(`dist/${route}/index.html`, html);
}
await writeFile('dist/404.html', html);
await mkdir('dist/activities', { recursive: true });
await copyFile('public/activities.html', 'dist/activities/index.html');
await mkdir('dist/identity', { recursive: true });
await copyFile('public/identity.html', 'dist/identity/index.html');
await mkdir('dist/identity/verify', { recursive: true });
await copyFile('public/identity-verify.html', 'dist/identity/verify/index.html');
await mkdir('dist/identity/recover', { recursive: true });
await copyFile('public/identity-recovery.html', 'dist/identity/recover/index.html');
await mkdir('dist/reception', { recursive: true });
await copyFile('public/reception.html', 'dist/reception/index.html');
await copyFile('src/framework/condo.css', 'dist/condo-template.css');
console.log(`Generated ${ids.length * 3} resident routes, entry information and 404 page.`);

// Distribute software and designated-artwork notices alongside compiled source.
await copyFile('LICENSE', 'dist/LICENSE.txt');
await copyFile('NOTICE', 'dist/NOTICE.txt');
await copyFile('ASSET-LICENSE.md', 'dist/ASSET-LICENSE.txt');
await mkdir('dist/LICENSES', { recursive: true });
await copyFile('LICENSES/PolyForm-Noncommercial-1.0.0.txt', 'dist/LICENSES/PolyForm-Noncommercial-1.0.0.txt');
