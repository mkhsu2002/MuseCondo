import type { Database } from './db.ts';
import type { HomePreflightResult } from './home-preflight.ts';
import type { MoveInCompletion } from './move-in-assistance.ts';
export interface Options {
    db: Database;
    apiKey?: string;
    now?: () => Date;
    transport?: typeof fetch;
    sourceFetch?: typeof fetch;
    wake?: () => Promise<void>;
    preflight?: (homeURL: string, fetcher?: typeof fetch) => Promise<HomePreflightResult>;
    verifyCompletion?: (accountId: string) => Promise<MoveInCompletion>;
}
export interface Job {
    id: string;
    case_id: string;
    case_version: number;
    policy_version: number;
    snapshot_json: string;
    state: string;
    lease_until: string | null;
    admission_mode?: string;
}
export interface Case {
    id: string;
    state: string;
    version: number;
    name: string;
    request_kind: string;
    source_url: string | null;
    resident_id: string | null;
    account_id: string | null;
    expires_at: string;
    is_muse_agent: number | null;
    review_case_version: number;
}
