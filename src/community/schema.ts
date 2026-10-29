/** The public boundary shared by the file workflow and the browser. Never serialize input objects. */
export type EventType = 'journal' | 'status' | 'arrival' | 'seeking' | 'gift' | 'message' | 'invitation';
export interface PublicEvent {
  id: string; residentId: string; type: EventType; occurredAt: string; publishedAt: string;
  visibility: 'public'; publicationConsent: true; origin: 'fictional-fixture' | 'resident-authorized';
  isFixture: boolean; title: string; summary: string; body: string;
}
export const sections = ['highlights', 'windows', 'seeking', 'arrivals'] as const;
export type Section = typeof sections[number];
export interface Pick { residentId: string; sourceEventIds: string[]; summary: string; reason: string }
export interface Edition {
  schemaVersion: 1; id: string; sourceDigest: string; asOf: string; editedAt: string;
  editor: { kind: 'rules' | 'meta-api'; version: string; model: null | { id: string; metadataSource: string; verifiedAt: string } };
  isFixture: boolean; sections: Record<Section, Pick[]>;
}
export interface EventFile { schemaVersion: 1; sourceDigest: string; events: PublicEvent[] }
export interface CommunityIndex { schemaVersion: 1; editionId: string; eventsFile: string; editionFile: string }
export interface Community { events: PublicEvent[]; edition: Edition }
const timestamp = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x;
const safeId = (x: unknown): x is string => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{1,79}$/.test(x);
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
export function publicEvents(input: unknown, residentIds: readonly string[], asOf: string): PublicEvent[] {
  if (!timestamp(asOf) || !Array.isArray(input)) throw new Error('Invalid activity input or cutoff');
  const seen = new Set<string>();
  return input.flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('Malformed event');
    const e = raw as Record<string, unknown>;
    // Consent and origin checks happen before inspecting or projecting any content.
    if (e.visibility !== 'public' || e.publicationConsent !== true || !['fictional-fixture', 'resident-authorized'].includes(String(e.origin))) return [];
    if (!safeId(e.id) || seen.has(e.id) || typeof e.residentId !== 'string' || !residentIds.includes(e.residentId) || !['journal', 'status', 'arrival', 'seeking', 'gift', 'message', 'invitation'].includes(String(e.type)) || !timestamp(e.occurredAt) || !timestamp(e.publishedAt) || e.publishedAt < e.occurredAt || typeof e.isFixture !== 'boolean' || (e.origin === 'fictional-fixture') !== e.isFixture || !text(e.title, 120) || !text(e.summary, 320) || !text(e.body, 10000)) throw new Error('Invalid or duplicate public event');
    seen.add(e.id);
    if (e.publishedAt > asOf || e.occurredAt > asOf) return [];
    return [{ id: e.id, residentId: e.residentId, type: e.type as EventType, occurredAt: e.occurredAt, publishedAt: e.publishedAt, visibility: 'public' as const, publicationConsent: true as const, origin: e.origin as PublicEvent['origin'], isFixture: e.isFixture, title: e.title, summary: e.summary, body: e.body }];
  }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
}
export function sourcePath(e: PublicEvent): string { return `${e.residentId}${e.type === 'arrival' ? '' : '/inside'}#event-${e.id}`; }
export function canonicalEvents(events: PublicEvent[]): string { return JSON.stringify(events); }
export function validateCommunity(eventsFile: EventFile, edition: Edition, residentIds: readonly string[]): Community {
  if (eventsFile.schemaVersion !== 1 || edition.schemaVersion !== 1 || !timestamp(edition.asOf) || !timestamp(edition.editedAt) || edition.editedAt < edition.asOf || eventsFile.sourceDigest !== edition.sourceDigest || !/^[a-f0-9]{64}$/.test(edition.sourceDigest) || !safeId(edition.id)) throw new Error('Edition metadata mismatch');
  const events = publicEvents(eventsFile.events, residentIds, edition.asOf);
  if (canonicalEvents(events) !== canonicalEvents(eventsFile.events)) throw new Error('Public snapshot is not canonical');
  if (!edition.editor || !['rules', 'meta-api'].includes(edition.editor.kind) || !text(edition.editor.version, 100) || (edition.editor.kind === 'rules' && edition.editor.model !== null)) throw new Error('Missing editor provenance');
  if (edition.editor.kind === 'meta-api' && (!edition.editor.model || !text(edition.editor.model.id, 100) || !text(edition.editor.model.metadataSource, 500) || !timestamp(edition.editor.model.verifiedAt))) throw new Error('Unverified model');
  if (edition.isFixture !== events.every(e => e.isFixture)) throw new Error('Fixture provenance mismatch');
  const byId = new Map(events.map(e => [e.id, e]));
  const seen = new Set<string>();
  for (const section of sections) {
    const picks = edition.sections?.[section];
    if (!Array.isArray(picks) || picks.length > ({highlights: 3, windows: 4, seeking: 3, arrivals: 10}[section])) throw new Error('Invalid section');
    for (const p of picks) {
      if (!residentIds.includes(p.residentId) || !Array.isArray(p.sourceEventIds) || p.sourceEventIds.length !== 1 || !text(p.summary, 320) || !text(p.reason, 320)) throw new Error('Invalid editorial pick');
      const event = byId.get(p.sourceEventIds[0]);
      const key = `${section}:${p.sourceEventIds[0]}`;
      if (!event || event.residentId !== p.residentId || seen.has(key)) throw new Error('Untraceable source');
      const types: Record<Section, EventType[]> = { highlights: ['journal', 'status'], windows: ['status'], seeking: ['seeking'], arrivals: ['arrival'] };
      if (!types[section].includes(event.type)) throw new Error('Source does not belong in section');
      seen.add(key);
    }
  }
  return { events, edition };
}
