import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const marker = /<!-- project-version -->v\d+\.\d{2}<!-- \/project-version -->/g;
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

export function changesProduct(path) {
  if (/^(docs|audit|audits|tracker|handoff|outputs|test-results|playwright-report)\//i.test(path)) return false;
  if (/^(VERSION|LICENSE(?:\..*)?|COPYING(?:\..*)?|\.DS_Store)$/i.test(path)) return false;
  if (/^(src|app|server|worker|functions|db|migrations|public|assets|fixtures|content)\//.test(path)) return true;
  if (/\.(md|mdx|rst|txt)$/i.test(path)) return false;
  return true;
}

function hundredths(value) {
  const match = /^(0|[1-9]\d*)\.(\d{2})$/.exec(value);
  if (!match) throw new Error('VERSION must use hundredths, for example 0.01');
  return BigInt(match[1]) * 100n + BigInt(match[2]);
}

function display(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function calculate(root) {
  const current = readFileSync(resolve(root, 'VERSION'), 'utf8').trim();
  const value = hundredths(current);
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  const matches = [...readme.matchAll(marker)];
  if (matches.length !== 1 || !matches[0][0].includes(`>v${current}<`)) {
    throw new Error('README must contain exactly one version marker matching VERSION');
  }
  const baseline = git(root, 'log', '-1', '--format=%H', '--', 'VERSION');
  // The commit introducing VERSION establishes v0.01; it does not increment itself.
  const commits = baseline ? git(root, 'log', '--first-parent', '--format=%H', `${baseline}..HEAD`).split('\n').filter(Boolean) : [];
  const counted = commits.filter(commit => {
    const parent = git(root, 'rev-parse', `${commit}^1`);
    const files = git(root, 'diff', '--no-renames', '--name-only', '-z', parent, commit).split('\0').filter(Boolean);
    return files.some(changesProduct);
  });
  return { current, next: display(value + BigInt(counted.length)), increments: counted.length, counted };
}

export function update(root, write = false) {
  const result = calculate(root);
  if (write && result.increments) {
    const path = resolve(root, 'README.md');
    const readme = readFileSync(path, 'utf8').replace(marker, `<!-- project-version -->v${result.next}<!-- /project-version -->`);
    writeFileSync(resolve(root, 'VERSION'), `${result.next}\n`);
    writeFileSync(path, readme);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !['--check', '--write'].includes(process.argv[2])) throw new Error('Use --check or --write');
    console.log(JSON.stringify(update(process.cwd(), process.argv[2] === '--write')));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
