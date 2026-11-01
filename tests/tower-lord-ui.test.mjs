/* global URLSearchParams, AbortController, setImmediate */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../public/tower-lord/console.js', import.meta.url), 'utf8');
class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.events = {}; this.dataset = {}; this.value = ''; this.className = ''; this.textContent = ''; this.classList = { toggle: (name, value) => { this.attributes[name] = value; } }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this.textContent = ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.events[name] = fn; }
  focus() { this.focused = true; }
  get text() { return this.textContent + this.children.map((child) => child instanceof Element ? child.text : String(child)).join(' '); }
}
const meta = {environment: 'production', observedAt: '2026-10-31T12:00:00Z', freshness: 'live-read'};
async function setup(responses = {}) {
  const elements = new Map(); const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const tabs = ['residents', 'applications', 'history', 'usage'].map((id) => { const node = get(`tab-${id}`); node.id = `tab-${id}`; node.dataset.tab = id; return node; });
  const calls = [];
  const context = {document: {getElementById: get, querySelectorAll: () => tabs, createElement: (tag) => new Element(tag), createTextNode: (text) => String(text)}, Node: Element, URL, URLSearchParams, Date, Intl, AbortController, console,
    fetch: async (url, options) => { calls.push({url, options}); const key = new URL(url, 'https://tower.test').pathname.split('/').at(-1); const body = responses[key] || (key === 'session' ? {role: 'acting-steward'} : {meta, items: [], coverage: {limitations: []}, nextCursor: null}); return {ok: !body.httpStatus, status: body.httpStatus || 200, headers: new Map([['content-type', 'application/json']]), json: async () => body}; }};
  vm.runInNewContext(source, context); await new Promise((resolve) => setImmediate(resolve)); return {get, tabs, calls};
}
test('read-only UI uses safe text rendering, correct DTO fields, and no secret storage', async () => {
  const ui = await setup({overview: {meta, households: {total: 1, published: 1, unpublished: 0}, identities: [{state: 'active', count: 1}], applications: [{caseState: 'pending', count: 2}], work: [{state: 'running', count: 1}]}, residents: {meta, items: [{chosenName: '<img src=x onerror=alert(1)>', roomId: 'room-1', residentId: 'resident-1', publicationState: 'published', guardianRegistered: 1, classification: 'unclassified', token: 'NEVER_RENDER_ME'}], nextCursor: 'next'}});
  assert.match(ui.get('overview').text, /Connected households 1/);
  assert.match(ui.get('record-panel').text, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(ui.get('record-panel').text, /NEVER_RENDER_ME/);
  assert.equal(ui.get('next').disabled, false);
  assert.equal(ui.get('environment').textContent, 'Production');
  assert.ok(ui.calls.every(({options}) => options.method === 'GET' && options.cache === 'no-store' && options.credentials === 'same-origin'));
  assert.doesNotMatch(source, /innerHTML|localStorage|sessionStorage|setInterval/);
});
test('tabs support keyboard navigation and paginated queries stay bounded', async () => {
  const ui = await setup({residents: {meta, items: [], nextCursor: 'cursor-value'}});
  ui.get('next').events.click(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(new URL(ui.calls.at(-1).url, 'https://tower.test').searchParams.get('cursor'), 'cursor-value');
  ui.tabs[0].events.keydown({key: 'ArrowRight', preventDefault() {}}); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ui.tabs[1].attributes['aria-selected'], 'true');
  assert.match(ui.calls.at(-1).url, /applications\?/);
  assert.equal(new URL(ui.calls.at(-1).url, 'https://tower.test').searchParams.get('limit'), '25');
});
test('unknown usage remains unavailable and recorded fields reconcile', async () => {
  const ui = await setup({usage: {meta, totals: {calls: 3, inputTokens: null, outputTokens: null, calculatedCostMicro: null, unresolvedReservedMicro: 2500, exposureMicro: 2500, costKnownCalls: 0, costUnknownCalls: 3}, byCategory: [], currency: 'USD', billingTimezone: 'America/Vancouver', budget: {remainingMicro: null}}});
  ui.tabs[3].events.click(); await new Promise((resolve) => setImmediate(resolve));
  const text = ui.get('record-panel').text;
  assert.match(text, /Unavailable \/ Unavailable/);
  assert.match(text, /\$0\.0025/);
  assert.match(text, /3 unique/);
  assert.match(text, /0 known \/ 3 unknown/);
  assert.equal(ui.get('pagination').hidden, true);
});

test('authorization errors show a recovery message without displaying server payloads', async () => {
  const ui = await setup({residents: {httpStatus: 403, secret: 'NEVER_RENDER_SERVER_ERROR'}});
  assert.match(ui.get('record-panel').text, /protected session is unavailable/);
  assert.doesNotMatch(ui.get('record-panel').text, /NEVER_RENDER_SERVER_ERROR/);
  assert.equal(ui.get('next').disabled, true);
  assert.equal(ui.get('refresh').disabled, false);
});

test('handover stays sealed and assets use external CSP-compatible files', async () => {
  const html = await readFile(new URL('../public/tower-lord/index.html', import.meta.url), 'utf8');
  assert.match(html, /<button type="button" disabled aria-describedby="handover-note">Formal Handover/);
  assert.match(html, /Project direction established; feature under development/);
  assert.match(html, /src="\/tower-lord\/console.js" defer/);
  assert.doesNotMatch(html, /<script>|onclick=|onerror=|style=/);
});

test('observer role uses the verified whitelist label before fetching records', async () => {
  const ui = await setup({session: {role: 'observer', displayName: '<img src=x onerror=alert(1)>'}});
  assert.equal(ui.get('session-role').textContent, 'Observer');
  assert.equal(new URL(ui.calls[0].url, 'https://tower.test').pathname, '/api/v1/tower-lord/session');
  assert.ok(ui.calls.some(({url}) => url.includes('/overview?')));
});
test('failed or unknown session blocks all operational data reads', async () => {
  for (const session of [{httpStatus: 403}, {role: 'administrator', displayName: 'Acting Tower Steward'}]) {
    const ui = await setup({session});
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.get('session-role').textContent === 'Acting Tower Steward', false);
    ui.tabs[1].events.click(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ui.calls.length, 2);
    assert.ok(ui.calls.every(({url}) => url.endsWith('/session')));
  }
});
