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
  // Section anchors differ by language, so translate the Chinese slugs to the
  // English slugs before comparing the two link lists.
  const anchorTranslations = {
    '#評審快速導覽': '#reviewers-quick-tour',
    '#正式環境證據': '#production-evidence',
    '#由-meta-muse-驅動的樓管': '#built-with-meta-muse',
    '#如何開始': '#get-started',
    '#長期發展路線與社群共創': '#long-term-roadmap-and-community-development',
    '#開發者指南': '#for-developers',
  };
  const translate = target => anchorTranslations[target] ?? target.replace(/#zh-tw$/, '#english');
  assert.deepEqual(links(chinese).map(translate), links(english));
  assert.deepEqual(chinese.match(/```sh\n[\s\S]*?```/g), english.match(/```sh\n[\s\S]*?```/g));
  assert.equal(chinese.match(/^## /gm)?.length, english.match(/^## /gm)?.length);
});
