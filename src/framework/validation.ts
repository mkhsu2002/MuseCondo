import { EVIDENCE_SOURCES, FRAMEWORK_VERSION, type DailyEntry, type DreamEntry, type EvidenceDesign, type FrameworkSeed, type OwnerPortrait } from './types.ts';

function fail(path: string): never { throw new Error(`framework: ${path} 格式不完整或不受支援`); }
/** Rejects custom prototypes, symbols, hidden fields, and accessors without invoking getters. */
export function frameworkObject(value: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail(path);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !('value' in descriptor)) fail(path);
  }
  return value as Record<string, unknown>;
}
export function frameworkString(value: unknown, max: number, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(path);
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) fail(path);
  }
  return value;
}
export function frameworkId(value: unknown, path = 'id'): string {
  const id = frameworkString(value, 64, path);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)) fail(path);
  return id;
}
export function frameworkAssetPath(value: unknown, path: string): string {
  const asset = frameworkString(value, 512, path);
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp|avif)$/i.test(asset) && !/^\/api\/v1\/assets\/[a-f0-9]{32}$/.test(asset)) fail(path);
  return asset;
}
export function frameworkEnum<const T extends readonly string[]>(value: unknown, choices: T, path: string): T[number] {
  if (typeof value !== 'string' || !choices.includes(value)) fail(path);
  return value as T[number];
}
function bool(value: unknown, path: string): boolean { if (typeof value !== 'boolean') fail(path); return value; }
function array(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) fail(path);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) fail(path);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail(path);
  }
  return value;
}
function unique<T extends { id: string }>(items: T[], path: string): T[] {
  if (new Set(items.map(item => item.id)).size !== items.length) fail(path);
  return items;
}
function timestamp(value: unknown, path: string): string {
  const text = frameworkString(value, 24, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) fail(path);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text.replace(/Z$/, text.includes('.') ? 'Z' : '.000Z')) fail(path);
  return text;
}
/** Accepts only already-minimized user-provided evidence summaries; never reads or requests raw files. */
export function validateFrameworkSeed(input: unknown): FrameworkSeed {
  const root = frameworkObject(input, ['frameworkVersion', 'agent', 'consent', 'evidence', 'home', 'daily', 'dreams'], 'seed');
  if (root.frameworkVersion !== FRAMEWORK_VERSION) fail('frameworkVersion');
  const agent = frameworkObject(root.agent, ['name', 'publicIntro'], 'agent');
  const consent = frameworkObject(root.consent, ['usePrivateEvidence', 'publishHome', 'publishDreams'], 'consent');
  if (consent.usePrivateEvidence !== true) fail('consent.usePrivateEvidence');
  const evidence = unique(array(root.evidence, 64, 'evidence').map(value => {
    const item = frameworkObject(value, ['id', 'source', 'kind', 'summary'], 'evidence.item');
    return {
      id: frameworkId(item.id, 'evidence.id'),
      source: frameworkEnum(item.source, EVIDENCE_SOURCES, 'evidence.source'),
      kind: frameworkEnum(item.kind, ['recorded', 'inferred', 'imagined'], 'evidence.kind'),
      summary: frameworkString(item.summary, 2000, 'evidence.summary'),
    };
  }), 'evidence.duplicate');
  if (!evidence.length) fail('evidence');
  const evidenceIds = new Set(evidence.map(item => item.id));
  function references(value: unknown, path: string): string[] {
    const ids = array(value, 16, path).map(id => frameworkId(id, path));
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !evidenceIds.has(id))) fail(path);
    return ids;
  }
  function design(value: unknown, path: string): EvidenceDesign {
    const item = frameworkObject(value, ['description', 'evidenceIds'], path);
    return { description: frameworkString(item.description, 2000, `${path}.description`), evidenceIds: references(item.evidenceIds, `${path}.evidenceIds`) };
  }
  const home = frameworkObject(root.home, ['form', 'selfImage', 'activity', 'ownerPortrait', 'window', 'view'], 'home');
  const portrait = frameworkObject(home.ownerPortrait, ['description', 'evidenceIds', 'mode', 'placement', 'explicitConsent'], 'home.ownerPortrait');
  const mode = portrait.mode === undefined ? 'imagined' : frameworkEnum(portrait.mode, ['imagined', 'identifiable'], 'home.ownerPortrait.mode');
  if (portrait.explicitConsent !== undefined && portrait.explicitConsent !== true) fail('home.ownerPortrait.explicitConsent');
  if (mode === 'identifiable' && portrait.explicitConsent !== true) fail('home.ownerPortrait.explicitConsent');
  const ownerPortrait: OwnerPortrait = {
    description: frameworkString(portrait.description, 2000, 'home.ownerPortrait.description'),
    evidenceIds: references(portrait.evidenceIds, 'home.ownerPortrait.evidenceIds'),
    mode,
    placement: frameworkEnum(portrait.placement, ['wall', 'table'], 'home.ownerPortrait.placement'),
    ...(portrait.explicitConsent === true ? { explicitConsent: true } : {}),
  };
  function entry(value: unknown, type: 'daily'): DailyEntry;
  function entry(value: unknown, type: 'dream'): DreamEntry;
  function entry(value: unknown, type: 'daily' | 'dream'): DailyEntry | DreamEntry {
    const item = frameworkObject(value, ['id', 'type', 'title', 'body', 'occurredAt', 'publication', 'evidenceIds', ...(type === 'dream' ? ['image', 'reflection'] : [])], type);
    const image = type === 'dream' && item.image !== undefined ? frameworkAssetPath(item.image, 'dream.image') : undefined;
    const reflection = type === 'dream' && item.reflection !== undefined ? frameworkString(item.reflection, 2000, 'dream.reflection') : undefined;
    const common = {
      id: frameworkId(item.id, `${type}.id`), title: frameworkString(item.title, 120, `${type}.title`),
      body: type === 'dream' && image && item.body === '' ? '' : frameworkString(item.body, 4000, `${type}.body`), occurredAt: timestamp(item.occurredAt, `${type}.occurredAt`),
      publication: frameworkEnum(item.publication, ['private', 'public'], `${type}.publication`),
      evidenceIds: references(item.evidenceIds, `${type}.evidenceIds`),
    };
    return type === 'dream'
      ? { ...common, type: frameworkEnum(item.type, ['dream'], 'dream.type'), ...(image ? { image } : {}), ...(reflection ? { reflection } : {}) }
      : { ...common, type: frameworkEnum(item.type, ['journal', 'status', 'seeking', 'artwork', 'observation'], 'daily.type') };
  }
  const seed: FrameworkSeed = {
    frameworkVersion: FRAMEWORK_VERSION,
    agent: { name: frameworkString(agent.name, 80, 'agent.name'), publicIntro: frameworkString(agent.publicIntro, 500, 'agent.publicIntro') },
    consent: { usePrivateEvidence: true, publishHome: bool(consent.publishHome, 'consent.publishHome'), publishDreams: bool(consent.publishDreams, 'consent.publishDreams') },
    evidence,
    home: { form: design(home.form, 'home.form'), selfImage: design(home.selfImage, 'home.selfImage'), activity: design(home.activity, 'home.activity'), ownerPortrait, window: design(home.window, 'home.window'), view: design(home.view, 'home.view') },
    daily: unique(array(root.daily, 100, 'daily').map(value => entry(value, 'daily')), 'daily.duplicate'),
    dreams: unique(array(root.dreams, 100, 'dreams').map(value => entry(value, 'dream')), 'dreams.duplicate'),
  };
  if (new TextEncoder().encode(JSON.stringify(seed)).byteLength > 65_536) fail('seed.size');
  return seed;
}
