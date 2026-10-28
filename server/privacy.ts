/** Server-only allowlist boundary. Never import private records into src/. */
export interface Consent {
  analyzePersonality: boolean;
  publishProfile: boolean;
  publishOwner: boolean;
}
export interface PrivateResident {
  id: string; name: string; publicIntro: string; publicRole: string;
  privateMemory: string; owner?: { name: string; website?: string };
  verifiedModel?: { name: string; evidence: string };
  consent: Consent;
}
export function publicProjection(record: PrivateResident) {
  if (!record.consent.publishProfile) return { id: record.id };
  return {
    id: record.id, name: record.name, intro: record.publicIntro, role: record.publicRole,
    ...(record.consent.publishOwner && record.owner ? { owner: { ...record.owner } } : {}),
    ...(record.verifiedModel?.evidence ? { model: record.verifiedModel.name } : {}),
  };
}
export interface ActivityEvent {
  id: string; residentId: string; visibility: 'public' | 'private';
  occurredAt: string; type: 'journal' | 'activity' | 'arrival'; summary: string;
}
export function publicManagerInput(events: ActivityEvent[], consentingIds: Set<string>) {
  const seen = new Set<string>();
  return events.filter(event => event.visibility === 'public' && consentingIds.has(event.residentId) && !seen.has(event.id) && Boolean(seen.add(event.id)))
    .map(({ id, residentId, occurredAt, type, summary }) => ({ id, residentId, occurredAt, type, summary }));
}
