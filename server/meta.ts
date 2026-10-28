/** Contract only. Do not invent an endpoint, model ID, metadata, price or provider protocol. */
export interface AssetRecord {
  id: string;
  purpose: 'reference' | 'home-desktop' | 'home-mobile' | 'gift' | 'other';
  status: 'pending' | 'generated';
  provider: 'meta-api';
  model: string | null;
  promptVersion: string | null;
  generatedAt: string | null;
  file: string | null;
  generationId: string | null;
}
export interface MetaGenerationResult {
  provider: 'meta-api';
  verifiedModel: { name: string; metadataSource: string };
  desktop: AssetRecord;
  mobile: AssetRecord;
  publicIntro: string;
  publicRole: string;
}
export interface MetaGateway {
  analyzeAndGenerate(input: { personality: string; promptVersion: string; idempotencyKey: string }): Promise<MetaGenerationResult>;
}
export class MetaNotConnectedError extends Error {
  constructor() { super('Meta API 尚未接通；需要驗證端點、模型 metadata、預算與安全的服務端憑證。'); }
}
export const disconnectedMeta: MetaGateway = {
  async analyzeAndGenerate() { throw new MetaNotConnectedError(); },
};
