import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculate, changesProduct, update } from './project-version.mjs';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function put(root, file, content) {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, file), content);
}
function commit(root, message) {
  git(root, 'add', '.');
  git(root, 'commit', '-m', message);
}
function fixture(t, version = '0.01') {
  const root = mkdtempSync(join(tmpdir(), 'condo-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'version-test@example.invalid');
  git(root, 'config', 'user.name', 'Version test');
  put(root, 'VERSION', `${version}\n`);
  put(root, 'package.json', JSON.stringify({ name: 'version-fixture', version: `${version}.0`, private: true }, null, 2) + '\n');
  put(root, 'README.md', `# Test\n<!-- project-version -->v${version}<!-- /project-version -->\n`);
  put(root, 'src/home.ts', 'export const home = 1;\n');
  commit(root, 'establish baseline');
  return root;
}

test('bootstrap and documentation commits preserve v0.01', t => {
  const root = fixture(t);
  assert.equal(calculate(root).increments, 0);
  put(root, 'docs/architecture.md', 'Framework documentation');
  put(root, 'docs/audit.json', '{}');
  commit(root, 'document framework');
  assert.equal(update(root, true).next, '0.01');
});

test('multiple code files in one commit increment once and synchronize README', t => {
  const root = fixture(t);
  put(root, 'src/home.ts', 'export const home = 2;\n');
  put(root, 'functions/home.ts', 'export const live = true;\n');
  commit(root, 'update home');
  assert.equal(update(root, true).next, '0.02');
  assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), '0.02\n');
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), />v0\.02</);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), { name: 'version-fixture', version: '0.02.0', private: true });
  commit(root, 'record automatic version');
  assert.equal(calculate(root).increments, 0);
});

test('an optional maintained Traditional Chinese README advances with English and keeps its text', t => {
  const root = fixture(t);
  put(root, 'README.zh-TW.md', '# 現行文件\n<!-- project-version -->v0.01<!-- /project-version -->\n監護人與住所。\n');
  commit(root, 'add maintained translation');
  assert.equal(calculate(root).increments, 0);
  put(root, 'src/home.ts', 'new code'); commit(root, 'change product');
  const before = readFileSync(join(root, 'README.zh-TW.md'), 'utf8');
  assert.equal(update(root, false).next, '0.02');
  assert.equal(readFileSync(join(root, 'README.zh-TW.md'), 'utf8'), before);
  update(root, true);
  for (const name of ['README.md', 'README.zh-TW.md']) assert.match(readFileSync(join(root, name), 'utf8'), />v0\.02</);
  assert.match(readFileSync(join(root, 'README.zh-TW.md'), 'utf8'), /監護人與住所。/);
  commit(root, 'record synchronized versions');
  assert.equal(calculate(root).increments, 0);
});

test('missing, duplicate or stale Chinese markers fail before any version file changes', t => {
  for (const content of ['# No marker', '<!-- project-version -->v0.09<!-- /project-version -->', '<!-- project-version -->v0.01<!-- /project-version -->\n<!-- project-version -->v0.01<!-- /project-version -->']) {
    const root = fixture(t);
    put(root, 'README.zh-TW.md', content); commit(root, 'add invalid translation');
    put(root, 'src/home.ts', 'new code'); commit(root, 'change product');
    const english = readFileSync(join(root, 'README.md'), 'utf8');
    assert.throws(() => update(root, true), /README.zh-TW.md.*matching VERSION/);
    assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), '0.01\n');
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), english);
    assert.equal(readFileSync(join(root, 'README.zh-TW.md'), 'utf8'), content);
  }
});

test('invalid package manifests leave all version files untouched', t => {
  for (const manifest of ['{', '{}', '{"version":1}']) {
    const root = fixture(t);
    put(root, 'package.json', manifest);
    put(root, 'src/home.ts', 'changed');
    commit(root, 'change product with invalid manifest');
    const before = Object.fromEntries(['VERSION', 'README.md', 'package.json'].map(name => [name, readFileSync(join(root, name), 'utf8')]));
    assert.throws(() => update(root, true));
    for (const [name, content] of Object.entries(before)) assert.equal(readFileSync(join(root, name), 'utf8'), content);
  }
});

test('several main commits accumulate while docs commits are ignored', t => {
  const root = fixture(t);
  put(root, 'src/home.ts', 'first'); commit(root, 'code one');
  put(root, 'docs/notes.md', 'notes'); commit(root, 'docs');
  put(root, 'package.json', '{}'); commit(root, 'runtime dependencies');
  assert.equal(calculate(root).next, '0.03');
  assert.equal(calculate(root).increments, 2);
});

test('hundredths carry exactly without floating point', t => {
  const root = fixture(t, '0.99');
  put(root, 'src/home.ts', 'changed'); commit(root, 'code');
  assert.equal(calculate(root).next, '1.00');
  update(root, true);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '1.00.0');
});

test('a merge counts once along main first-parent history', t => {
  const root = fixture(t);
  git(root, 'switch', '-c', 'feature');
  put(root, 'src/home.ts', 'one'); commit(root, 'feature one');
  put(root, 'src/home.ts', 'two'); commit(root, 'feature two');
  git(root, 'switch', 'main');
  git(root, 'merge', '--no-ff', 'feature', '-m', 'merge feature');
  assert.equal(calculate(root).next, '0.02');
});

test('moving code into docs still counts its removal from runtime', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'docs'), { recursive: true });
  git(root, 'mv', 'src/home.ts', 'docs/old-home.txt');
  commit(root, 'remove runtime code');
  assert.equal(calculate(root).increments, 1);
});

test('version mismatch fails without changing either file', t => {
  const root = fixture(t);
  put(root, 'README.md', '<!-- project-version -->v0.09<!-- /project-version -->');
  assert.throws(() => update(root, true), /matching VERSION/);
  assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), '0.01\n');
});

test('text, image and version-tool changes do not count; runtime changes do', () => {
  assert.equal(changesProduct('public/article.md'), false);
  assert.equal(changesProduct('.github/workflows/project-version.yml'), false);
  assert.equal(changesProduct('migrations/0005.sql'), true);
  assert.equal(changesProduct('docs/audit.json'), false);
  assert.equal(changesProduct('README.md'), false);
  assert.equal(changesProduct('README.zh-TW.md'), false);
});


test('presentation-only and counter-maintenance commits preserve the version', t => {
  const root = fixture(t);
  for (const path of ['public/og/share.jpg', 'public/tower/cover.svg', 'public/guide.md', 'public/help.txt', 'scripts/project-version.mjs', '.github/workflows/project-version.yml']) {
    put(root, path, 'presentation or version maintenance');
    commit(root, 'update presentation or counter');
  }
  assert.equal(update(root, true).increments, 0);
  assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), '0.01\n');
  put(root, 'server/api.ts', 'export const changed = true;');
  commit(root, 'change backend behavior');
  assert.equal(update(root, true).next, '0.02');
});
