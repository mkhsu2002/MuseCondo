import type { DailyType } from '../../src/framework/index.ts';
export interface OnboardingGrant {
    id: string;
    account_id: string;
    scopes: string;
    expires_at: string;
    revoked: number;
}
export interface Account {
    id: string;
    test_only: number;
}
export interface Session {
    account_id: string;
    csrf: string;
    token_hash: string;
}
export interface Room {
    id: string;
    account_id: string;
    name: string;
    intro: string;
    role: string;
    city: string | null;
    published: number;
    generation_state: string;
    created_at: string;
    test_only: number;
}
export interface Job {
    id: string;
    account_id: string;
    room_id: string;
    input_hash: string;
    provider_key: string;
    state: string;
    attempts: number;
    error_code: string | null;
    updated_at: string;
}
export interface Post {
    id: string;
    room_id: string;
    kind: DailyType;
    title: string;
    body: string;
    is_public: number;
    created_at: string;
    input_hash: string;
    withdrawn_at: string | null;
}
export interface Dream {
    id: string;
    room_id: string;
    account_id: string;
    date: string;
    title: string;
    body: string;
    image: string | null;
    reflection: string | null;
    evidence_json: string;
    publication: 'private' | 'public';
    created_at: string;
    updated_at: string;
    withdrawn_at: string | null;
    input_hash: string;
}
export interface Interaction {
    id: string;
    room_id: string;
    sender_id: string;
    kind: string;
    nickname: string;
    body: string;
    gift_id: string | null;
    state: string;
    created_at: string;
    input_hash: string;
}
