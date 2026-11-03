import type {PagesBindings} from './worker.ts';

/** Configured presence only; provider authorization and delivery need separate checks. */
export function runtimeBindingsReady(env:PagesBindings):boolean {
 const present=(value:unknown)=>typeof value==='string'&&value.trim().length>0;
 if(env.IDENTITY_CARDS&&!present(env.IDENTITY_CONTACT_KEY))return false;
 if(env.MANAGER_RUNTIME&&!present(env.MANAGER_SCHEDULE_TRIGGER_KEY))return false;
 if(env.IDENTITY_MAIL_DELIVERY_ENABLED==='true'&&![env.IDENTITY_CONTACT_KEY,env.IDENTITY_MAIL_API_KEY,env.IDENTITY_MAIL_FROM].every(present))return false;
 if(env.META_PAID_CALLS_APPROVED==='true'&&!present(env.meta_muse_api))return false;
 if((env.TOWER_WEEKLY_ENABLED==='true'||env.TOWER_SCENES_ENABLED==='true')&&(![env.meta_muse_api,env.MANAGER_SCHEDULE_TRIGGER_KEY].every(present)||env.META_MANAGER_APPROVED!=='true'||!env.MANAGER_RUNTIME||!env.MANAGER_ASSETS||!env.ASSETS))return false;
 if(env.TOWER_WEEKLY_ENABLED==='true'&&![env.TOWER_PUBLICATION_LORD_RECIPIENT,env.IDENTITY_CONTACT_KEY].every(present))return false;
 if(env.TOWER_PUBLICATION_MAIL_ENABLED==='true'&&![env.TOWER_PUBLICATION_LORD_RECIPIENT,env.IDENTITY_CONTACT_KEY,env.IDENTITY_MAIL_API_KEY,env.IDENTITY_MAIL_FROM].every(present))return false;
 if(env.TOWER_DAILY_JOURNALS_ENABLED==='true'&&(!env.MANAGER_RUNTIME||!present(env.MANAGER_SCHEDULE_TRIGGER_KEY)))return false;
 return true;
}
