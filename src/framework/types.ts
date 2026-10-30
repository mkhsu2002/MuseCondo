/** Framework contract version; independent of the application's release version. */
export const FRAMEWORK_VERSION = '0.01' as const;
export const EVIDENCE_SOURCES = ['SOUL', 'IDENTITY', 'AGENTS', 'USER', 'TOOLS', 'PROACTIVE_PREFERENCES', 'ALIGNMENT_SYNTHESIS', 'custom-skills', 'skills-config', 'goals', 'agent-self-description', 'dreams'] as const;
export type EvidenceSource = typeof EVIDENCE_SOURCES[number];
export type EvidenceKind = 'recorded' | 'inferred' | 'imagined';
export interface PrivateEvidence { id: string; source: EvidenceSource; kind: EvidenceKind; summary: string }
export interface EvidenceDesign { description: string; evidenceIds: string[] }
export interface OwnerPortrait extends EvidenceDesign { mode: 'imagined' | 'identifiable'; placement: 'wall' | 'table'; explicitConsent?: true }
export interface HomeDesign {
  form: EvidenceDesign;
  selfImage: EvidenceDesign;
  activity: EvidenceDesign;
  ownerPortrait: OwnerPortrait;
  window: EvidenceDesign;
  view: EvidenceDesign;
}
export type DailyType = 'journal' | 'status' | 'seeking' | 'artwork' | 'observation';
export type Publication = 'private' | 'public';
export interface PublicationEntry {
  id: string;
  title: string;
  body: string;
  occurredAt: string;
  publication: Publication;
  evidenceIds: string[];
}
export interface DailyEntry extends PublicationEntry { type: DailyType }
export interface DreamEntry extends PublicationEntry { type: 'dream'; image?: string; reflection?: string }
export interface FrameworkSeed {
  frameworkVersion: typeof FRAMEWORK_VERSION;
  agent: { name: string; publicIntro: string };
  consent: { usePrivateEvidence: true; publishHome: boolean; publishDreams: boolean };
  evidence: PrivateEvidence[];
  home: HomeDesign;
  daily: DailyEntry[];
  dreams: DreamEntry[];
}
export type HomeMode = 'standalone' | 'tower';
export interface HomeRoutes { home: string; inside: string; dreams: string }
export interface HomeAssets { desktop?: string; mobile?: string; character?: string }
export interface PublicHomeOptions { id: string; mode?: HomeMode; base?: string; assets?: HomeAssets }
export type PublicDailyEntry = Omit<DailyEntry, 'evidenceIds' | 'publication'>;
export type PublicDreamEntry = Omit<DreamEntry, 'evidenceIds' | 'publication'>;
export interface PublicHome {
  frameworkVersion: typeof FRAMEWORK_VERSION;
  id: string;
  name: string;
  intro: string;
  assets: HomeAssets;
  routes: HomeRoutes;
  daily: PublicDailyEntry[];
  dreams: PublicDreamEntry[];
}
