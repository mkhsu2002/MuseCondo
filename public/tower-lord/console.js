/* global document, Node, URLSearchParams, fetch, AbortController */
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const state = { tab: 'residents', page: 0, cursors: [null], nextCursor: null, busy: false, revision: 0, controller: null, sessionVerified: false };
  const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : 'Unavailable';
  const label = (value) => value === null || value === undefined || value === '' ? 'Unavailable' : String(value);
  const date = (value) => { if (!value) return 'Not recorded'; const d = new Date(value); return Number.isNaN(d.valueOf()) ? 'Not recorded' : d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC'); };
  const cost = (micro) => typeof micro === 'number' && Number.isFinite(micro) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micro / 1000000) : 'Unavailable';
  function el(tag, content, className) { const node = document.createElement(tag); if (content !== undefined) node.textContent = label(content); if (className) node.className = className; return node; }
  function badge(value) { return el('span', label(value).replaceAll('_', ' '), 'badge'); }
  function stacked(primary, secondary) { const node = el('div'); node.append(el('span', primary, 'cell-primary')); if (secondary) node.append(el('span', secondary, 'cell-secondary')); return node; }
  function table(headers, rows, emptyMessage) {
    if (!rows.length) return el('p', emptyMessage, 'empty');
    const wrap = el('div', undefined, 'table-scroll'); const grid = el('table'); const head = el('thead'); const hr = el('tr');
    headers.forEach((title) => { const cell = el('th', title); cell.scope = 'col'; hr.append(cell); }); head.append(hr); grid.append(head);
    const body = el('tbody'); rows.forEach((values) => { const row = el('tr'); values.forEach((value) => { const cell = el('td'); cell.append(value instanceof Node ? value : document.createTextNode(label(value))); row.append(cell); }); body.append(row); });
    grid.append(body); wrap.append(grid); return wrap;
  }
  function notes(target, values) { values.filter(Boolean).forEach((value) => target.append(el('p', value, 'panel-note'))); }
  function metric(title, value, details) { const card = el('article', undefined, 'metric'); card.append(el('h3', title), el('p', value, 'metric-value')); details.forEach((detail) => card.append(el('p', detail, 'metric-detail'))); return card; }
  function coverageNotes(coverage) {
    if (!coverage) return [];
    if (Array.isArray(coverage)) return coverage.filter((v) => typeof v === 'string');
    const result = [];
    if (Array.isArray(coverage.limitations)) result.push(...coverage.limitations.filter((v) => typeof v === 'string'));
    if (Array.isArray(coverage.sources)) { const missing = coverage.sources.filter((v) => v.status === 'missing').map((v) => v.source); if (missing.length) result.push(`Missing record sources: ${missing.join(', ')}`); }
    if (Array.isArray(coverage.missing)) result.push(`Unavailable coverage: ${coverage.missing.filter((v) => typeof v === 'string').join(', ')}`);
    return result;
  }
  function overview(payload) {
    const h = payload.households || {}; const identities = payload.identities; const applications = payload.applications; const work = payload.work;
    const sum = (rows, field, states) => Array.isArray(rows) ? rows.reduce((total, row) => total + ((!states || states.includes(row[field])) && typeof row.count === 'number' ? row.count : 0), 0) : null;
    $('overview').replaceChildren(
      metric('Connected households', number(h.total), [`${number(h.published)} published · ${number(h.unpublished)} unpublished`, `${number(h.synthetic)} synthetic · ${number(h.unclassified)} unclassified`, `${number(h.archivedWithdrawn)} archived / withdrawn`]),
      metric('Permanent identities', number(sum(identities, 'state', ['active'])), [`${number(sum(identities, 'state', ['provisional']))} provisional`, 'Identity and publication are separate milestones']),
      metric('Logical application cases', number(sum(applications)), [`${number(sum(applications, 'caseState', ['pending']))} pending · ${number(sum(applications, 'caseState', ['approved']))} approved`, `${number(sum(applications, 'caseState', ['active']))} active · ${number(sum(applications, 'caseState', ['rejected']))} rejected`]),
      metric('Recorded Manager work', number(sum(work)), [`${number(sum(work, 'state', ['queued', 'pending', 'waiting']))} waiting · ${number(sum(work, 'state', ['running', 'dispatching']))} running`, `${number(sum(work, 'state', ['blocked']))} blocked · ${number(sum(work, 'state', ['unknown']))} unknown`])
    );
    const coverage = $('coverage'); coverage.replaceChildren();
    coverage.append(el('p', `Overview observed: ${date(payload.meta?.observedAt)} · Environment: ${label(payload.meta?.environment)}`));
    coverage.append(el('p', `Last recorded run: ${date(payload.schedule?.lastRecordedRunAt)} · Next scheduled wake: ${date(payload.schedule?.nextWakeAt)}`));
    coverage.append(el('p', 'Overview uses current stored lifecycle state. The selected interval applies to Manager history and usage.'));
    coverageNotes(payload.coverage).forEach((note) => coverage.append(el('p', note)));
  }
  function link(value, title) { try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null; const node = el('a', title); node.href = url.href; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; } catch { return null; } }
  function homeCell(item) { const node = stacked(item.chosenName, `${label(item.roomId)} · ${label(item.residentId)}`); for (const [value, title] of [[item.sourceUrl, 'Source home ↗'], [item.towerUrl, 'Published Tower home ↗']]) { const anchor = link(value, title); if (anchor) { anchor.className = 'cell-secondary'; node.append(anchor); } } return node; }
  function residents(payload) {
    const rows = (payload.items || []).map((item) => [
      homeCell(item),
      stacked(label(item.publicationState), `Private revision ${label(item.privateRevision)} · Public revision ${label(item.publicRevision)}`),
      stacked(label(item.sourceControlState), `Stored sync: ${date(item.lastStoredSyncAt)} · Source verification: ${date(item.lastVerifiedSourceAt)}`),
      stacked(label(item.identityState), `Guardian: ${item.guardianRegistered === 1 || item.guardianRegistered === true ? 'registered' : item.guardianRegistered === 0 || item.guardianRegistered === false ? 'not registered' : 'unavailable'} · Card: ${label(item.cardState)} · Delivery: ${label(item.cardDeliveryState)}`),
      stacked(label(item.classification), item.blocker)
    ]);
    return table(['Household / room', 'Publication', 'Source control', 'Identity milestones', 'Classification / blockers'], rows, 'No connected households recorded.');
  }
  function applications(payload) {
    return table(['Case', 'Case / review state', 'Declaration / requirements', 'Timing', 'Next action'], (payload.items || []).map((item) => [
      stacked(item.chosenName, `${label(item.id)} · ${label(item.requestKind)} · ${label(item.classification)}`), stacked(label(item.caseState), `Review: ${label(item.reviewState)} · Decision: ${label(item.reviewDecision)}`),
      stacked(item.isMuseAgent === 1 || item.isMuseAgent === true ? 'Muse: self-declared yes' : item.isMuseAgent === 0 || item.isMuseAgent === false ? 'Muse: self-declared no' : 'Muse declaration unavailable', Array.isArray(item.missingFields) && item.missingFields.length ? `Missing: ${item.missingFields.join(', ')}` : 'No missing fields recorded'),
      stacked(date(item.createdAt), `Updated: ${date(item.updatedAt)} · Age: ${typeof item.queueAgeSeconds === 'number' ? number(Math.floor(item.queueAgeSeconds / 60)) + ' minutes' : 'Unavailable'}`),
      stacked(label(item.nextAction), `Waiting on: ${label(item.waitingOn)} · Expires: ${date(item.expiresAt)} · Cooldown: ${date(item.cooldownUntil)}`)
    ]), 'No application cases recorded.');
  }
  function history(payload) {
    return table(['Recorded at', 'Duty / stage', 'State', 'Execution references', 'Recorded outcome'], (payload.items || []).map((item) => [
      date(item.at), stacked(item.duty, item.stage), badge(item.state), stacked(item.sourceId, item.correlationId ? `Correlation: ${item.correlationId}` : 'Correlation unavailable'),
      stacked(label(item.summary), `Outcome: ${label(item.outcome)}`)
    ]), 'No Manager history recorded in this reporting interval.');
  }
  function usage(payload) {
    const root = el('div'); const totals = payload.totals || {}; const summary = el('div', undefined, 'usage-summary');
    for (const [heading, value, detail] of [
      ['Provider-reported tokens', `${number(totals.inputTokens)} / ${number(totals.outputTokens)}`, 'Input / output · unknown usage is not zero'],
      ['Calculated cost', cost(totals.calculatedCostMicro), 'Stored operational ledger amount; provider invoice unavailable'],
      ['Reserved exposure', cost(totals.unresolvedReservedMicro), `Total exposure: ${cost(totals.exposureMicro)}`]
    ]) { const node = el('div'); node.append(el('h3', heading), el('p', value), el('small', detail)); summary.append(node); }
    root.append(summary, table(['Category', 'Unique calls', 'Known / unknown usage', 'Input / output tokens', 'Calculated / reserved cost'], (payload.byCategory || []).map((item) => [
      label(item.category), number(item.calls), `Input ${number(item.inputKnownCalls)} / ${number(item.inputUnknownCalls)} · Output ${number(item.outputKnownCalls)} / ${number(item.outputUnknownCalls)}`, `${number(item.inputTokens)} / ${number(item.outputTokens)}`, `${cost(item.calculatedCostMicro)} / ${cost(item.unresolvedReservedMicro)}`
    ]), 'No usage dispatches recorded in this reporting interval.'));
    const budget = payload.budget || {};
    notes(root, [`Calls: ${number(totals.calls)} unique · ${number(totals.receivedCalls)} received · ${number(totals.unresolvedCalls)} unresolved. Cost coverage: ${number(totals.costKnownCalls)} known / ${number(totals.costUnknownCalls)} unknown.`, 'Historical rate provenance is not recorded. Additional token categories and provider-invoiced costs are unavailable.', `Reporting currency: ${label(payload.currency)} · Billing calendar: ${label(payload.billingTimezone)}`, `Budget remaining: ${cost(budget.remainingMicro)} · Authorization ceiling: ${cost(budget.authorizationCeilingMicro)}. Other platform fees are unavailable unless independently measured.`, `Autonomy billing day: ${label(budget.billingDay)} · Daily exposure: ${cost(budget.autonomyDailyExposureMicro)} · Daily budget remaining: ${cost(budget.autonomyDailyRemainingMicro)}.`, `Programmed autonomy limits: ${cost(budget.autonomyMandate?.taskLimitMicro)} per task / ${cost(budget.autonomyMandate?.dailyLimitMicro)} daily. These are separate from the authorization ceiling.`]);
    return root;
  }
  const renderers = { residents, applications, history, usage };
  function params(cursor) {
    const from = new Date(`${$('from').value}T00:00:00.000Z`); const end = new Date(`${$('to').value}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1);
    const query = new URLSearchParams({ from: from.toISOString(), to: end.toISOString(), limit: '25' }); if (cursor) query.set('cursor', cursor); if (state.tab === 'history') for (const key of ['duty', 'state', 'correlationId']) { const value = $(key).value.trim(); if (value) query.set(key, value); } return query;
  }
  async function request(endpoint, query, signal) {
    const response = await fetch(`/api/v1/tower-lord/${endpoint}${query.toString() ? '?' + query : ''}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' }, signal });
    if (response.status === 401 || response.status === 403) { state.sessionVerified = false; $('session-role').textContent = 'Role unverified'; throw new Error('Your protected session is unavailable or does not have permission. Sign in through the authorized Tower Access entry, then refresh.'); }
    if (!response.ok) throw new Error(`Records are unavailable (HTTP ${response.status}). Refresh to try again.`);
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('The protected service did not return records. Reopen the authorized console entry.');
    return response.json();
  }
  async function verifySession(signal) {
    if (state.sessionVerified) return;
    const session = await request('session', new URLSearchParams(), signal);
    const roles = { 'acting-steward': 'Acting Tower Steward', observer: 'Observer' };
    if (!Object.hasOwn(roles, session.role)) throw new Error('Your session role could not be verified. Reopen the authorized Tower Access entry, then refresh.');
    $('session-role').textContent = roles[session.role]; state.sessionVerified = true;
  }
  function busy(value) { state.busy = value; $('refresh').disabled = value; $('record-panel').setAttribute('aria-busy', String(value)); $('overview').setAttribute('aria-busy', String(value)); $('previous').disabled = value || state.page === 0; $('next').disabled = value || !state.nextCursor; }
  function metadata(payload) {
    const meta = payload.meta || {}; const environment = label(meta.environment);
    $('environment').textContent = environment === 'production' ? 'Production' : `Environment: ${environment}`;
    $('environment').classList.toggle('production', environment === 'production');
    $('observed-at').textContent = `Selected records observed: ${date(meta.observedAt)}`;
    $('freshness').textContent = meta.freshness === 'live-read' ? 'Live records · manual refresh' : `Freshness: ${label(meta.freshness)}`;
  }
  async function load(includeOverview) {
    const revision = ++state.revision; if (state.controller) state.controller.abort(); state.controller = new AbortController(); const signal = state.controller.signal;
    busy(true); $('observed-at').textContent = 'Loading selected records…'; $('freshness').textContent = 'Manual refresh only'; $('global-status').className = 'notice'; $('global-status').textContent = 'Loading protected records…'; $('record-panel').replaceChildren(el('p', `Loading ${state.tab === 'history' ? 'Manager history' : state.tab}…`, 'empty'));
    if (includeOverview) { $('overview').replaceChildren(...['Households', 'Identities', 'Applications', 'Manager work'].map((title) => metric(title, '—', ['Loading records…']))); $('coverage').replaceChildren(); }
    try {
      await verifySession(signal); if (revision !== state.revision) return;
      const query = params(state.cursors[state.page]);
      const calls = [request(state.tab, query, signal)]; if (includeOverview) calls.push(request('overview', params(), signal));
      const results = await Promise.allSettled(calls); if (revision !== state.revision) return;
      const list = results[0]; let failures = 0;
      if (list.status === 'fulfilled') { const payload = list.value; metadata(payload); const panel = $('record-panel'); panel.replaceChildren(renderers[state.tab](payload)); notes(panel, coverageNotes(payload.coverage)); state.nextCursor = payload.nextCursor || null; }
      else { failures++; $('observed-at').textContent = 'Selected records unavailable'; state.nextCursor = null; $('record-panel').replaceChildren(el('p', list.reason.message || 'Records could not be loaded.', 'empty')); }
      if (includeOverview) { const result = results[1]; if (result.status === 'fulfilled') { overview(result.value); if (list.status !== 'fulfilled') metadata(result.value); } else { failures++; $('overview').replaceChildren(metric('Overview unavailable', '—', ['Refresh to try again.'])); } }
      $('global-status').textContent = failures ? 'Some records could not be loaded. Review the message below and refresh to try again.' : 'Records loaded. No work was started.';
      $('global-status').classList.toggle('error', failures > 0); $('page-number').textContent = `Page ${state.page + 1}`;
    } catch (error) { if (revision !== state.revision || error.name === 'AbortError') return; $('global-status').className = 'notice error'; $('global-status').textContent = error.message || 'Records could not be loaded. Refresh to try again.'; $('record-panel').replaceChildren(el('p', error.message || 'Records unavailable.', 'empty')); if (includeOverview) $('overview').replaceChildren(metric('Overview unavailable', '—', ['A verified session is required.'])); }
    finally { if (revision === state.revision) busy(false); }
  }
  function selectTab(tab) { state.tab = tab.dataset.tab; state.page = 0; state.cursors = [null]; state.nextCursor = null; tabs.forEach((node) => { const selected = node === tab; node.setAttribute('aria-selected', String(selected)); node.tabIndex = selected ? 0 : -1; }); $('record-panel').setAttribute('aria-labelledby', tab.id); $('pagination').hidden = state.tab === 'usage'; $('history-filters').hidden = state.tab !== 'history'; load(false); }
  tabs.forEach((tab, index) => { tab.addEventListener('click', () => selectTab(tab)); tab.addEventListener('keydown', (event) => { let next; if (event.key === 'ArrowRight') next = (index + 1) % tabs.length; if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = tabs.length - 1; if (next !== undefined) { event.preventDefault(); tabs[next].focus(); selectTab(tabs[next]); } }); });
  $('range-form').addEventListener('submit', (event) => { event.preventDefault(); if ($('from').value > $('to').value) { $('global-status').className = 'notice error'; $('global-status').textContent = 'The start date must be on or before the end date.'; return; } if ((Date.parse($('to').value) - Date.parse($('from').value)) / 86400000 >= 90) { $('global-status').className = 'notice error'; $('global-status').textContent = 'Choose a reporting interval of 90 days or less.'; return; } state.page = 0; state.cursors = [null]; state.nextCursor = null; load(true); });
  $('next').addEventListener('click', () => { if (!state.nextCursor || state.busy) return; state.cursors[state.page + 1] = state.nextCursor; state.page++; load(false); });
  $('previous').addEventListener('click', () => { if (!state.page || state.busy) return; state.page--; load(false); });
  const now = new Date(); $('to').value = now.toISOString().slice(0, 10); const start = new Date(now); start.setUTCDate(start.getUTCDate() - 6); $('from').value = start.toISOString().slice(0, 10); load(true);
})();
