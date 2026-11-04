export const TOWER_DAILY_JOURNAL_LIMIT=4 as const;
/** Public projection: selection lineage and internal audit never leave the service. */
export interface TowerJournalItem {author:string;title:string;excerpt:string;originalAt:string;href:string}
export interface TowerJournalEdition {day:string;cutoffAt:string;publishedAt:string;items:TowerJournalItem[]}
