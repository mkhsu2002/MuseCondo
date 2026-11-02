import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('maintained READMEs share guide targets and development commands with the project version', () => {
  const english = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const chinese = readFileSync(new URL('../README.zh-TW.md', import.meta.url), 'utf8');
  const current = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
  const links = text => [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]).filter(target => !/^README(?:\.zh-TW)?\.md$/.test(target));
  for (const text of [english, chinese]) {
    assert.deepEqual([...text.matchAll(/<!-- project-version -->v([^<]+)<!-- \/project-version -->/g)].map(match => match[1]), [current]);
    assert.match(text, /\[English\]\(README\.md\).*\[繁體中文\]\(README\.zh-TW\.md\)/);
    assert.doesNotMatch(text, /archived Traditional Chinese|Archived Traditional Chinese snapshot|v0\.79/);
  }
  // The canonical architecture has explicit language anchors in the same file.
  assert.ok(links(english).includes('ARCHITECTURE.md#english'));
  assert.ok(links(chinese).includes('ARCHITECTURE.md#zh-tw'));
  const architecture = readFileSync(new URL('../ARCHITECTURE.md', import.meta.url), 'utf8');
  for (const id of ['english', 'zh-tw']) assert.ok(architecture.includes(`<a id="${id}"></a>`));
  assert.deepEqual(links(chinese).map(target => target.replace(/#zh-tw$/, '#english')), links(english));
  assert.deepEqual(chinese.match(/```sh\n[\s\S]*?```/g), english.match(/```sh\n[\s\S]*?```/g));
  assert.equal(chinese.match(/^## /gm)?.length, english.match(/^## /gm)?.length);
});
