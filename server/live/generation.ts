export interface GeneratedAsset {purpose:'home-desktop'|'home-mobile';mime:'image/png'|'image/jpeg'|'image/webp';bytes:Uint8Array;provenance:{provider:'meta-api'|'local-test';model:string|null;metadataSource:string|null;generatedAt:string|null;promptVersion:string;generationId:string;generationIdKind?:'provider-request'|'client-request';prompt:string}}
export interface HomeGenerator {kind:'meta-api'|'local-test'|'disconnected';generate(input:{personality:string;providerKey:string;frameworkSeed?:unknown}):Promise<GeneratedAsset[]>}
export class GenerationBlocked extends Error {}
export const disconnectedHome:HomeGenerator={kind:'disconnected',async generate(){throw new GenerationBlocked('Meta configuration and approved budget required');}};
