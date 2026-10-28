import { readFile, mkdir, writeFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/residents.ts', import.meta.url), 'utf8');
const ids = [...source.matchAll(/id: '([a-z0-9]{6})'/g)].map(match => match[1]);
if (ids.length !== 10 || new Set(ids).size !== 10) throw new Error('Expected 10 unique fixture routes');
const html = await readFile('dist/index.html', 'utf8');
for (const route of ['入住', ...ids.flatMap(id => [id, `${id}/inside`])]) {
  await mkdir(`dist/${route}`, { recursive: true });
  await writeFile(`dist/${route}/index.html`, html);
}
await writeFile('dist/404.html', html);
console.log(`Generated ${ids.length * 2} resident routes, entry information and 404 page.`);
