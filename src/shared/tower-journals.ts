/** Public projection: selection lineage and internal audit never leave the service. */
export interface TowerJournalItem {author:string;title:string;excerpt:string;originalAt:string;href:string}
export interface TowerJournalEdition {day:string;cutoffAt:string;publishedAt:string;items:TowerJournalItem[]}
