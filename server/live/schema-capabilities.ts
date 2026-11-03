import {IMAGE_SCHEMA} from './tower-image-optimization.ts';
import type {Database} from './db.ts';
import {RELEASE_MANIFEST} from './generated-release.ts';
import {canonicalSchema,type SchemaObject} from './release-contract.ts';
import {TOWER_ASSET_STORAGE_SCHEMA} from './tower-asset-storage.ts';
import {ASSISTED_ADMISSION_SCHEMA} from './assisted-admission-schema.ts';
import {IDENTITY_OFFER_SCHEMA} from './identity-offer.ts';
import {TOWER_ADMISSION_SCHEMA} from './tower-admission.ts';
import {MANAGER_ADMISSION_SCHEMA} from './manager-admission.ts';
import {identityMailSchema} from './identity-mail-contract.ts';
import {IDENTITY_MAIL_CONTROL_SCHEMA} from './identity-mail-control.ts';
import {IDENTITY_MAIL_DELIVERY_SCHEMA} from './identity-mail-delivery.ts';
const requiredTables=['accounts','sessions','rooms','private_profiles','generation_jobs','assets','asset_chunks','posts','interactions','agent_tokens','rate_limits','community_editions','community_current','consent_events','recovery_audit','provider_requests','onboarding_grants','framework_profiles','dream_consent','dreams','asset_reviews','tower_residencies','tower_snapshots','tower_asset_chunks','tower_claims','tower_tokens','tower_requests','tower_audit','manager_jobs','manager_events','tower_reception_cases','tower_reception_events','tower_reception_requests','tower_visits','tower_activities','tower_activity_participation','tower_activity_operator_requests','tower_activity_audit','agent_identities','identity_requests','identity_audit','identity_rate_attempts','identity_guardian_invites','guardian_invite_requests','guardian_invite_rate_attempts','identity_mail_events','identity_mail_audit','identity_guardians','identity_guardian_passkeys','identity_offline_recovery_codes','identity_guardian_challenges','identity_registration_requests','identity_secret_history','identity_recovery_requests','identity_recovery_challenges','identity_recovery_receipts','identity_recovery_instances','identity_offline_recovery_challenges'];
const requiredTriggers=['tower_reception_first_claim','tower_reception_first_home','agent_identity_immutable_binding','identity_guardian_account_binding','identity_guardian_immutable_binding','identity_guardian_credential_binding','identity_passkey_immutable_binding','identity_challenge_immutable_binding','identity_history_accounts_insert','identity_history_accounts_update','identity_history_sessions','identity_history_tower_tokens','identity_history_agent_tokens','identity_history_onboarding','identity_history_cases','identity_history_immutable_update','identity_history_immutable_delete','identity_recovery_request_binding','identity_recovery_challenge_binding','identity_recovery_challenge_immutable','identity_recovery_receipt_immutable','identity_recovery_receipt_permanent','identity_recovery_request_prune_guard','identity_recovery_challenge_prune_guard','identity_offline_history_permanent','identity_offline_history_immutable','identity_offline_recovery_challenge_binding','identity_offline_recovery_challenge_immutable','identity_offline_recovery_challenge_prune_guard','identity_passkey_permanent','identity_recovery_instance_immutable','identity_recovery_instance_permanent'];
const requiredIndexes=['identity_recovery_request_pending_expiry','identity_recovery_challenge_pending_expiry','identity_offline_recovery_challenge_pending_expiry','identity_recovery_challenge_request','identity_offline_recovery_challenge_request','identity_mail_entity'];

/** Conservative fallback for every private, write, mixed-authority or unknown route. */
export const FULL_SCHEMA_CAPABILITY=[...new Set([...['maintenance_authorities','maintenance_requests','maintenance_challenges','maintenance_request_binding','maintenance_challenge_binding'],...ASSISTED_ADMISSION_SCHEMA,...IDENTITY_OFFER_SCHEMA,...TOWER_ASSET_STORAGE_SCHEMA,...requiredTables,...requiredTriggers,...requiredIndexes,...TOWER_ADMISSION_SCHEMA,...MANAGER_ADMISSION_SCHEMA,...identityMailSchema,...IDENTITY_MAIL_CONTROL_SCHEMA,...IDENTITY_MAIL_DELIVERY_SCHEMA])];
const towerHome=['tower_residencies','tower_snapshots'];
/** Match only methods and paths supported by the corresponding public handlers. */
export function routeSchemaCapability(method:string,pathname:string):readonly string[]{
 const path=pathname.replace(/\/$/,'');
 if(/^\/api\/v1\/(?:manager\/images(?:\/|$)|operator\/images(?:\/|$))/.test(path))return [...new Set([...FULL_SCHEMA_CAPABILITY,...IMAGE_SCHEMA,'tower_scenes'])];
 const publicationObjects=RELEASE_MANIFEST.schemaDefinitions.filter(o=>o.name.startsWith('tower_daily_')||o.name.startsWith('tower_weekly_')||o.name.startsWith('tower_scene')).map(o=>o.name);
 if(/^\/api\/v1\/(?:operator\/(?:tower-weekly|tower-scenes)(?:\/|$)|manager\/publications\/)/.test(path))return [...new Set([...FULL_SCHEMA_CAPABILITY,...publicationObjects])];
 if(method==='GET'||method==='HEAD'){
  if(path==='/api/v1/public/tower-journals')return ['tower_daily_journal_jobs','tower_daily_journal_editions','tower_residencies','tower_snapshots','rooms','accounts'];
  if(path==='/api/v1/public/tower-scenes'||/^\/api\/v1\/tower\/scenes\/[a-zA-Z0-9_-]{1,80}\.png$/.test(path))return ['tower_scenes'];
  if(/^\/api\/v1\/public\/tower-weekly(?:\/tower-weekly-[a-zA-Z0-9_-]{1,80})?$/.test(path))return ['tower_weekly_issues','tower_weekly_jobs','manager_jobs','tower_scene_periods','tower_scenes','tower_residencies','tower_snapshots','rooms','accounts','posts'];
  if(/^\/home\/[a-f0-9]{16}(?:\/(?:inside|dreams))?$/.test(path)||/^\/api\/v1\/tower\/rooms\/[a-f0-9]{16}$/.test(path))return towerHome;
  if(/^\/api\/v1\/tower\/assets\/[a-f0-9]{16}\/[1-9][0-9]*\/(?:home|dream)\.png$/.test(path))return ['tower_residencies','tower_asset_chunks','tower_asset_objects','tower_asset_object_chunks','tower_asset_refs'];
  if(/^\/api\/v1\/tower\/rooms\/[a-f0-9]{16}\/visits$/.test(path))return ['tower_residencies','tower_visits'];
  if(path==='/api/v1/tower/activities')return ['tower_activities'];
  if(/^\/api\/v1\/tower\/activities\/[a-z0-9][a-z0-9-]{0,63}$/.test(path))return ['tower_activities','tower_activity_participation',...towerHome];
 }
 if(method==='GET'){
  if(path==='/api/v1/public/rooms')return ['rooms'];
  if(path==='/api/v1/public/community')return ['rooms','posts','community_editions','community_current','tower_residencies'];
  if(/^\/api\/v1\/public\/rooms\/[a-f0-9]{16}$/.test(path))return ['rooms','assets','posts','interactions','tower_residencies'];
  if(/^\/api\/v1\/public\/rooms\/[a-f0-9]{16}\/dreams$/.test(path))return ['rooms','dream_consent','dreams','tower_residencies'];
 }
 return FULL_SCHEMA_CAPABILITY;
}
// One bind remains below D1's parameter ceiling even for the conservative fallback.
export const CAPABILITY_SCHEMA_QUERY='SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name IN (SELECT value FROM json_each(?))';
export async function routeSchemaReady(db:Database,method:string,pathname:string){
 const names=routeSchemaCapability(method,pathname),wanted=new Set(names);
 const expected=RELEASE_MANIFEST.schemaDefinitions.filter(object=>wanted.has(object.name));
 if(expected.length!==wanted.size)return false;
 const rows=(await db.prepare(CAPABILITY_SCHEMA_QUERY).bind(JSON.stringify(names)).all<SchemaObject>()).results;
 // No cached database state: a required object dropped after a successful read fails next request.
 return rows.length===wanted.size&&JSON.stringify(canonicalSchema(rows))===JSON.stringify(expected);
}
