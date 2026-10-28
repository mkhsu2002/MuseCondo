import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Consent } from './privacy.ts';
import { MetaNotConnectedError, type MetaGateway, type MetaGenerationResult } from './meta.ts';

export interface OnboardingInput {
  /** Must be resolved from a future authenticated connection, never accepted as client authority. */
  identityKey: string;
  personality: string;
  consent: Consent;
}
export interface Job {
  identityHash: string; inputHash: string; residentId: string; idempotencyKey: string;
  state: 'prepared' | 'running' | 'failed' | 'needs-recovery' | 'complete';
  result?: MetaGenerationResult;
}
export class FileJobStore {
  private queue: Promise<unknown> = Promise.resolve();
  private file: string;
  constructor(file: string) { this.file = file; }
  /** Single-process lock + atomic replacement. Multi-process production requires a DB unique constraint. */
  transaction<T>(fn: (jobs: Job[]) => Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      let jobs: Job[] = [];
      try { jobs = JSON.parse(await readFile(this.file, 'utf8')) as Job[]; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const result = await fn(jobs);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, JSON.stringify(jobs, null, 2), { mode: 0o600 });
      await rename(temporary, this.file);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class OnboardingService {
  private store: FileJobStore;
  private meta: MetaGateway;
  constructor(store: FileJobStore, meta: MetaGateway) { this.store = store; this.meta = meta; }
  async prepare(input: OnboardingInput): Promise<Job> {
    if (!input.consent.analyzePersonality) throw new Error('需要個性分析授權。');
    if (!input.identityKey.trim() || !input.personality.trim()) throw new Error('需要經驗證身分與授權資料。');
    const identityHash = hash(input.identityKey);
    const inputHash = hash(JSON.stringify({ personality: input.personality, consent: input.consent, promptVersion: 'home-v1' }));
    return this.store.transaction(async jobs => {
      const existing = jobs.find(job => job.identityHash === identityHash);
      if (existing) {
        if (existing.inputHash !== inputHash) throw new Error('既有入住任務已固定；更正資料需走獨立授權流程，不能重新抽取。');
        return structuredClone(existing);
      }
      let residentId: string;
      do { residentId = randomBytes(4).toString('hex'); } while (jobs.some(job => job.residentId === residentId));
      const job: Job = { identityHash, inputHash, residentId, idempotencyKey: randomBytes(16).toString('hex'), state: 'prepared' };
      jobs.push(job);
      return structuredClone(job);
    });
  }
  /** Explicit operator action only; not called from the prototype browser. Same job and provider key on retry. */
  async run(input: OnboardingInput): Promise<Job> {
    const prepared = await this.prepare(input);
    const claim = await this.store.transaction(async jobs => {
      const job = jobs.find(item => item.idempotencyKey === prepared.idempotencyKey)!;
      if (['complete', 'running', 'needs-recovery'].includes(job.state)) return { execute: false, job: structuredClone(job) };
      job.state = 'running';
      return { execute: true, job: structuredClone(job) };
    });
    if (!claim.execute) return claim.job;
    // Persist running BEFORE the network call. A process crash or uncertain response must be
    // recovered against the provider's generation ID, never retried as a new paid generation.
    let result: MetaGenerationResult | undefined;
    let state: Job['state'] = 'complete';
    try {
      result = await this.meta.analyzeAndGenerate({ personality: input.personality, promptVersion: 'home-v1', idempotencyKey: claim.job.idempotencyKey });
      if (result.provider !== 'meta-api' || !result.verifiedModel.name || !result.verifiedModel.metadataSource) throw new Error('缺少經驗證的 Meta 模型資料。');
      for (const asset of [result.desktop, result.mobile]) {
        if (asset.provider !== 'meta-api' || asset.status !== 'generated' || !asset.model || !asset.generatedAt || !asset.file || !asset.promptVersion || !asset.generationId) throw new Error('素材來源紀錄不完整。');
      }
      if (result.desktop.purpose !== 'home-desktop' || result.mobile.purpose !== 'home-mobile') throw new Error('需要同一住家的兩種構圖。');
    } catch (error) {
      state = error instanceof MetaNotConnectedError ? 'failed' : 'needs-recovery';
      result = undefined;
    }
    return this.store.transaction(async jobs => {
      const job = jobs.find(item => item.idempotencyKey === claim.job.idempotencyKey)!;
      job.state = state;
      if (result) job.result = result;
      return structuredClone(job);
    });
  }
}
