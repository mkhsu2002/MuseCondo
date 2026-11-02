import {INVITATION_CHOICE_SCHEMA} from './move-in-invitation-choice.ts';
import type {Database} from './db.ts';
export const ASSISTED_ADMISSION_SCHEMA=[...INVITATION_CHOICE_SCHEMA,'manager_admission_control',
 'manager_admission_policy_results','manager_admission_mode_immutable','manager_admission_policy_result_guard','manager_admission_policy_decision',
 'manager_admission_policy_result_delete','manager_admission_policy_result_update','manager_admission_policy_result_replace',
 'manager_move_in_progress','manager_move_in_events','manager_move_in_event_delete','manager_move_in_event_update',
 'manager_move_in_case_insert','manager_move_in_case_update','manager_move_in_claim_insert','manager_move_in_claim_update',
 'manager_move_in_residency_insert','manager_move_in_residency_update','manager_move_in_room_update','manager_move_in_snapshot_update',
] as const;
export async function assistedAdmissionReady(db:Database){const rows=(await db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')").all<{name:string}>()).results;return ASSISTED_ADMISSION_SCHEMA.every(name=>rows.some(r=>r.name===name));}
