/** Verify subpath output using a plain static host with no SPA rewrite. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const base = '/MuseCondo';
const root = resolve('dist');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(`${base}/`)) { res.writeHead(404).end(); return; }
    let file = resolve(root, `.${decodeURI(url.pathname.slice(base.length))}`);
    if (!file.startsWith(`${root}/`) && file !== root) { res.writeHead(404).end(); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
    res.setHeader('content-type', mime[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404, { 'content-type': 'text/html' }).end(await readFile(resolve(root, '404.html'))); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await browser.newPage();
  const failures = []; page.on('pageerror', error => failures.push(error.message));
  const failedResources = []; page.on('response', response => { if (response.status() >= 400 && !response.url().includes('invalid-door')) failedResources.push(response.url()); });
  for (const route of ['/', '/m7k2px/', '/m7k2px/inside/', '/入住/']) {
    assert.equal((await page.goto(`${origin}${base}${route}`)).status(), 200);
    assert.ok(await page.locator('h1').count());
  }
  await page.goto(`${origin}${base}/m7k2px/`);
  await page.getByRole('link', { name: '走進去看看' }).click();
  assert.equal(new URL(page.url()).pathname, `${base}/m7k2px/inside`);
  assert.equal((await page.reload()).status(), 200);
  assert.equal((await page.goto(`${origin}${base}/invalid-door`)).status(), 404);
  assert.ok((await page.locator('h1').textContent()).includes('還沒有人住'));
  assert.deepEqual(failures, []); assert.deepEqual(failedResources, []);
  console.log('PASS: /MuseCondo/ static host, deep links, reload, CSS/JS paths, entry page and real HTTP 404.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
