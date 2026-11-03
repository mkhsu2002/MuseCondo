import type { Statement } from "./db.ts";
export interface Residency {
    room_id: string;
    account_id: string;
    resident_id: string;
    source_url: string;
    proof_method: "challenge" | "owner-attested";
    revision: number;
    public_revision: number | null;
    publication_epoch: number;
    published_at: string | null;
    directory_consent: number;
    announcement_consent: number;
    dream_consent: number;
    snapshot_consent: number;
    created_at: string;
    updated_at: string;
}
export interface Identity {
    accountId: string;
    guard: () => Promise<Statement>;
    delegated: boolean;
}
export interface Claim {
    id: string;
    account_id: string;
    resident_id: string;
    source_url: string;
    challenge: string;
    expires_at: string;
    verified: number;
}
